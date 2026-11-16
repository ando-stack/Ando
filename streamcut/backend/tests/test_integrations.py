"""Integraciones con Twitch y YouTube (respuestas simuladas de las APIs oficiales con respx:
aquí no hay credenciales reales; el código es el mismo que se usa en producción)."""

from __future__ import annotations

import uuid

import httpx
import pytest
import respx
from sqlalchemy import select

from app.db.models import Channel, ChannelConnection, StreamSession, Workspace
from app.db.session import SessionLocal
from app.integrations import twitch as tw_mod
from app.integrations import youtube as yt_mod
from app.integrations.twitch import TwitchClient, TwitchError
from app.integrations.youtube import YouTubeClient
from app.services.channels import compute_capabilities, refresh_status


@pytest.fixture()
def twitch_mock():
    client = TwitchClient("cid", "secret")
    tw_mod.set_twitch(client)
    with respx.mock(assert_all_called=False) as m:
        m.post("https://id.twitch.tv/oauth2/token").respond(json={"access_token": "app-token", "expires_in": 3600})
        yield m
    tw_mod.set_twitch(None)


@pytest.fixture()
def youtube_mock():
    yt_mod.set_youtube(YouTubeClient("yt-key"))
    with respx.mock(assert_all_called=False) as m:
        yield m
    yt_mod.set_youtube(None)


def test_twitch_resolve_and_live_status(auth_client, twitch_mock):
    twitch_mock.get("https://api.twitch.tv/helix/users").respond(json={"data": [
        {"id": "123", "login": "ibai", "display_name": "Ibai", "profile_image_url": "https://x/img.png"}]})
    streams = twitch_mock.get("https://api.twitch.tv/helix/streams")
    streams.respond(json={"data": [{"id": "s1", "user_id": "123", "type": "live", "title": "Velada",
                                    "game_name": "Just Chatting", "viewer_count": 50000,
                                    "started_at": "2026-11-16T10:00:00Z"}]})
    r = auth_client.post("/api/channels/resolve", json={"url": "https://www.twitch.tv/ibai", "platform": "twitch"})
    assert r.status_code == 200, r.text
    ch = r.json()
    assert ch["status"] == "online" and ch["viewer_count"] == 50000 and ch["category"] == "Just Chatting"
    assert ch["verified"] and ch["avatar_url"] and ch["session"]["status"] == "live"
    assert ch["capabilities"]["mode"] == "VIEW_ONLY"
    feats = {f["key"]: f["status"] for f in ch["capabilities"]["features"]}
    assert feats["live_status"] == "available" and feats["platform_clips"] == "needs_permission"
    assert feats["media_analysis"] == "needs_permission"
    emb = auth_client.get(f"/api/live/{ch['id']}/embed", params={"parent": "localhost"}).json()
    assert emb["player"].startswith("https://player.twitch.tv/?channel=ibai&parent=localhost")
    # Fin de la emisión
    streams.respond(json={"data": []})
    r = auth_client.post(f"/api/channels/{ch['id']}/refresh").json()
    assert r["status"] == "offline" and r["session"] is None
    with SessionLocal() as db:
        s = db.scalar(select(StreamSession).where(StreamSession.channel_id == uuid.UUID(ch["id"])))
        assert s.status == "ended" and s.ended_at is not None


def test_twitch_rate_limit_and_errors(twitch_mock):
    route = twitch_mock.get("https://api.twitch.tv/helix/streams")
    route.side_effect = [httpx.Response(429, headers={"Ratelimit-Reset": "0"}), httpx.Response(200, json={"data": []})]
    assert tw_mod.get_twitch().get_streams(["1"]) == []
    twitch_mock.post("https://api.twitch.tv/helix/clips").respond(403, json={"message": "forbidden"})
    with pytest.raises(TwitchError, match="clips:edit"):
        tw_mod.get_twitch().create_clip("user-token", "123")


def test_without_credentials_status_unknown(auth_client):
    tw_mod.set_twitch(TwitchClient("", ""))
    try:
        r = auth_client.post("/api/channels/resolve", json={"url": "twitch.tv/sin_credenciales"}).json()
        assert r["status"] == "unknown" and r["verified"] is False
        feats = {f["key"]: f for f in r["capabilities"]["features"]}
        assert feats["live_status"]["status"] == "needs_permission"
        assert feats["player"]["status"] == "available" and feats["chat"]["status"] == "available"
        # Se puede monitorizar igualmente (sesión manual, señal de chat)
        assert auth_client.post(f"/api/live/{r['id']}/start").json()["session"]["monitoring"] is True
        assert auth_client.post(f"/api/live/{r['id']}/stop").json()["session"] is None
    finally:
        tw_mod.set_twitch(None)


def test_platform_clips_capability_with_oauth(auth_client, twitch_mock):
    from app.core.security import encrypt
    with SessionLocal() as db:
        ws = db.scalar(select(Workspace))
        conn = ChannelConnection(workspace_id=ws.id, platform="twitch", kind="oauth_user", external_user_id="999",
                                 external_login="yo", scopes=["clips:edit"], access_token_enc=encrypt("user-token"))
        db.add(conn)
        db.commit()
        ch = Channel(workspace_id=ws.id, platform="twitch", external_id="otro", display_name="otro",
                     url="https://www.twitch.tv/otro", platform_user_id="555")
        db.add(ch)
        db.commit()
        caps = compute_capabilities(db, ch)
        assert caps["mode"] == "PLATFORM_CLIPS"
        db.delete(conn)
        db.commit()


def test_youtube_resolve_and_live(auth_client, youtube_mock):
    api = "https://www.googleapis.com/youtube/v3"
    youtube_mock.get(f"{api}/channels").respond(json={"items": [{
        "id": "UC1234567890123456789012", "snippet": {"title": "Canal YT", "customUrl": "@canalyt",
                                                       "thumbnails": {"default": {"url": "https://x/a.jpg"}}},
        "contentDetails": {"relatedPlaylists": {"uploads": "UU1234567890123456789012"}}}]})
    youtube_mock.get(f"{api}/playlistItems").respond(json={"items": [{"contentDetails": {"videoId": "abcdefghijk"}}]})
    youtube_mock.get(f"{api}/videos").respond(json={"items": [{
        "id": "abcdefghijk", "snippet": {"title": "Directo", "liveBroadcastContent": "live",
                                         "channelId": "UC1234567890123456789012"},
        "liveStreamingDetails": {"actualStartTime": "2026-11-16T09:00:00Z", "concurrentViewers": "321"}}]})
    r = auth_client.post("/api/channels/resolve", json={"url": "https://www.youtube.com/@canalyt"})
    assert r.status_code == 200, r.text
    ch = r.json()
    assert ch["platform"] == "youtube" and ch["status"] == "online" and ch["viewer_count"] == 321
    assert ch["live_video_id"] == "abcdefghijk"
    feats = {f["key"]: f["status"] for f in ch["capabilities"]["features"]}
    assert feats["platform_clips"] == "unavailable" and feats["clip_download"] == "unavailable"
    emb = auth_client.get(f"/api/live/{ch['id']}/embed", params={"parent": "localhost"}).json()
    assert "abcdefghijk" in emb["player"]
    youtube_mock.get(f"{api}/playlistItems").respond(403, json={"error": {"message": "quota",
                                                                          "errors": [{"reason": "quotaExceeded"}]}})
    r = auth_client.post(f"/api/channels/{ch['id']}/refresh").json()
    assert r["status"] == "error" and "cuota" in r["last_error"]


def test_authorized_source_validation(auth_client):
    tw_mod.set_twitch(TwitchClient("", ""))
    try:
        ch = auth_client.post("/api/channels/resolve", json={"url": "twitch.tv/fuente_test"}).json()
        r = auth_client.put(f"/api/channels/{ch['id']}/source", json={"mode": "pull", "url": "rtmp://10.0.0.1/x",
                                                                      "rights_confirmed": True})
        assert r.status_code == 422
        r = auth_client.put(f"/api/channels/{ch['id']}/source", json={"mode": "listen", "rights_confirmed": False})
        assert r.status_code == 422
        r = auth_client.put(f"/api/channels/{ch['id']}/source", json={"mode": "listen", "rights_confirmed": True})
        assert r.status_code == 200 and r.json()["stream_key"] and r.json()["capabilities"]["mode"] == "FULL_ANALYSIS"
        r = auth_client.delete(f"/api/channels/{ch['id']}/source").json()
        assert r["capabilities"]["mode"] == "VIEW_ONLY"
    finally:
        tw_mod.set_twitch(None)


def test_oauth_start_requires_config(auth_client):
    tw_mod.set_twitch(TwitchClient("", ""))
    try:
        assert auth_client.get("/api/oauth/twitch/start").status_code == 409
    finally:
        tw_mod.set_twitch(None)
    tw_mod.set_twitch(TwitchClient("cid", "sec"))
    try:
        url = auth_client.get("/api/oauth/twitch/start").json()["url"]
        assert url.startswith("https://id.twitch.tv/oauth2/authorize?client_id=cid") and "clips%3Aedit" in url
        # callback con state manipulado → error, sin crear conexión
        r = auth_client.get("/api/oauth/twitch/callback", params={"code": "x", "state": "forjado"},
                            follow_redirects=False)
        assert r.status_code in (302, 307) and "oauth=error" in r.headers["location"]
    finally:
        tw_mod.set_twitch(None)
