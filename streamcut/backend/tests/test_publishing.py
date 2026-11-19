"""Publicación en YouTube Shorts, TikTok e Instagram Reels.

Las APIs oficiales se simulan con respx (aquí no hay cuentas reales); se comprueba el protocolo
completo: subida reanudable/por trozos, sondeo del procesamiento, URLs y errores conocidos."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import encrypt
from app.db.models import ChannelConnection, Clip, Publication, Workspace
from app.db.session import SessionLocal
from app.integrations import publishing as P


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(P.time, "sleep", lambda s: None)


@pytest.fixture()
def video(tmp_path) -> Path:
    p = tmp_path / "clip.mp4"
    p.write_bytes(b"\x00" * (3 * 1024 * 1024 + 123))
    return p


@pytest.fixture()
def creds(monkeypatch):
    s = get_settings()
    for k, v in {"tiktok_client_key": "tk", "tiktok_client_secret": "ts", "instagram_app_id": "ig",
                 "instagram_app_secret": "is", "google_client_id": "g", "google_client_secret": "gs"}.items():
        monkeypatch.setattr(s, k, v)
    from app.integrations import youtube as yt
    yt.set_youtube(None)
    yield
    yt.set_youtube(None)


def test_youtube_short_upload(video):
    seen = []
    with respx.mock() as m:
        m.post(P.YT_UPLOAD).respond(200, headers={"Location": "https://upload.example/session1"})

        def put(request):
            seen.append(request.headers["Content-Range"])
            end = int(request.headers["Content-Range"].split("-")[1].split("/")[0])
            if end + 1 < video.stat().st_size:
                return httpx.Response(308)
            return httpx.Response(200, json={"id": "abc123", "status": {"privacyStatus": "private",
                                                                       "uploadStatus": "uploaded"}})
        m.put("https://upload.example/session1").mock(side_effect=put)
        res = P.youtube_upload("tok", video, "Clip épico", "desc", "public", ["gg"], lambda p, s: None)
        meta = json.loads(m.calls[0].request.content)
    assert res.url == "https://www.youtube.com/shorts/abc123"
    assert res.privacy == "private"  # proyectos sin verificar: YouTube lo deja privado
    assert "#Shorts" in meta["snippet"]["description"]
    assert seen[-1].endswith(f"/{video.stat().st_size}")


def test_tiktok_publish_flow(video, creds):
    with respx.mock() as m:
        m.post(f"{P.TT_API}/post/publish/creator_info/query/").respond(json={
            "data": {"privacy_level_options": ["SELF_ONLY"]}, "error": {"code": "ok"}})
        init = m.post(f"{P.TT_API}/post/publish/video/init/").respond(json={
            "data": {"publish_id": "p1", "upload_url": "https://up.tiktok.example/u1"}, "error": {"code": "ok"}})
        m.put("https://up.tiktok.example/u1").respond(201)
        m.post(f"{P.TT_API}/post/publish/status/fetch/").mock(side_effect=[
            httpx.Response(200, json={"data": {"status": "PROCESSING_UPLOAD"}, "error": {"code": "ok"}}),
            httpx.Response(200, json={"data": {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [777]},
                                      "error": {"code": "ok"}})])
        res = P.TikTokClient().publish("tok", video, "Título", "public", lambda p, s: None)
        body = json.loads(init.calls[0].request.content)
    # app sin auditar: solo SELF_ONLY disponible → se usa privado
    assert body["post_info"]["privacy_level"] == "SELF_ONLY"
    assert body["source_info"]["total_chunk_count"] == 1
    assert res.url == "https://www.tiktok.com/video/777"


def test_tiktok_unaudited_error_is_explained(video, creds):
    with respx.mock() as m:
        m.post(f"{P.TT_API}/post/publish/creator_info/query/").respond(json={
            "data": {"privacy_level_options": ["PUBLIC_TO_EVERYONE"]}, "error": {"code": "ok"}})
        m.post(f"{P.TT_API}/post/publish/video/init/").respond(403, json={
            "error": {"code": "unaudited_client_can_only_post_to_private_accounts", "message": "x"}})
        with pytest.raises(P.PublishError, match="auditada"):
            P.TikTokClient().publish("tok", video, "T", "public", lambda p, s: None)


def test_instagram_reel_flow(video, creds):
    g = f"{P.IG_GRAPH}/{P.IG_VERSION}"
    with respx.mock() as m:
        m.post(f"{g}/999/media").respond(json={"id": "c1"})
        up = m.post(f"https://rupload.facebook.com/ig-api-upload/{P.IG_VERSION}/c1").respond(json={"success": True})
        m.get(f"{g}/c1").mock(side_effect=[httpx.Response(200, json={"status_code": "IN_PROGRESS"}),
                                           httpx.Response(200, json={"status_code": "FINISHED"})])
        m.post(f"{g}/999/media_publish").respond(json={"id": "m1"})
        m.get(f"{g}/m1").respond(json={"permalink": "https://www.instagram.com/reel/XYZ/"})
        res = P.InstagramClient().publish("IGAAtok", "999", video, "caption", lambda p, s: None)
        assert up.calls[0].request.headers["file_size"] == str(video.stat().st_size)
    assert res.url == "https://www.instagram.com/reel/XYZ/"


def test_publish_endpoint_requires_connection_and_render(auth_client, creds):
    t = auth_client.get("/api/oauth/publish-targets").json()
    assert {x["platform"] for x in t} == {"youtube", "tiktok", "instagram"}
    assert all(not x["ready"] for x in t)
    clips = auth_client.get("/api/clips").json()["items"]
    if not clips:
        pytest.skip("sin clips renderizados en esta sesión de pruebas")
    r = auth_client.post(f"/api/clips/{clips[0]['id']}/publish", json={"platforms": ["tiktok"], "title": "x"})
    assert r.status_code == 409 and "TikTok" in r.json()["detail"]


def test_publish_end_to_end_with_worker(auth_client, worker, creds, highlight_video):
    from tests.conftest import upload_file
    res = upload_file(auth_client, highlight_video)
    worker.drain()
    clip = next(c for c in auth_client.get("/api/clips", params={"sort": "score"}).json()["items"] if c["video_url"])
    with SessionLocal() as db:
        ws = db.scalar(select(Workspace))
        db.add(ChannelConnection(workspace_id=ws.id, platform="instagram", kind="oauth_user", external_user_id="999",
                                 external_login="mi_cuenta", scopes=["content_publish"],
                                 access_token_enc=encrypt("IGAA-token")))
        db.commit()
    g = f"{P.IG_GRAPH}/{P.IG_VERSION}"
    with respx.mock(assert_all_called=False) as m:
        m.route(host="localhost").pass_through()
        m.route(host="testserver").pass_through()
        m.post(f"{g}/999/media").respond(json={"id": "c9"})
        m.post(f"https://rupload.facebook.com/ig-api-upload/{P.IG_VERSION}/c9").respond(json={"success": True})
        m.get(f"{g}/c9").respond(json={"status_code": "FINISHED"})
        m.post(f"{g}/999/media_publish").respond(json={"id": "m9"})
        m.get(f"{g}/m9").respond(json={"permalink": "https://www.instagram.com/reel/AAA/"})
        r = auth_client.post(f"/api/clips/{clip['id']}/publish",
                             json={"platforms": ["instagram"], "title": "Momentazo", "description": "#gaming"})
        assert r.status_code == 200, r.text
        worker.drain()
    pubs = auth_client.get(f"/api/clips/{clip['id']}/publications").json()
    assert pubs[0]["status"] == "succeeded", pubs[0]
    assert pubs[0]["external_url"] == "https://www.instagram.com/reel/AAA/"
    assert auth_client.get(f"/api/clips/{clip['id']}").json()["status"] == "published"


def _twitch_platform_clip(scopes):
    from app.integrations import twitch as tw_mod
    from app.integrations.twitch import TwitchClient
    tw_mod.set_twitch(TwitchClient("cid", "sec"))
    with SessionLocal() as db:
        from app.db.models import Channel
        ws = db.scalar(select(Workspace))
        for old in db.scalars(select(ChannelConnection).where(ChannelConnection.platform == "twitch",
                                                               ChannelConnection.kind == "oauth_user")):
            db.delete(old)
        ch = Channel(workspace_id=ws.id, platform="twitch", external_id=f"canal{uuid.uuid4().hex[:6]}",
                     display_name="Peereira7", url="https://www.twitch.tv/x", platform_user_id="555")
        db.add(ch)
        db.add(ChannelConnection(workspace_id=ws.id, platform="twitch", kind="oauth_user", external_user_id="999",
                                 external_login="yo", scopes=scopes, access_token_enc=encrypt("user-token")))
        db.flush()
        clip = Clip(workspace_id=ws.id, origin="platform", channel_id=ch.id, title="Clip de chat", status="detected",
                    format="16:9", platform="twitch", platform_clip_id="ClipABC",
                    platform_clip_url="https://clips.twitch.tv/ClipABC", streamer_name="Peereira7")
        db.add(clip)
        db.commit()
        return clip.id


def test_twitch_clip_not_editor_is_explained(auth_client):
    from app.integrations import twitch as tw_mod
    cid = _twitch_platform_clip(["clips:edit"])
    r = auth_client.post(f"/api/clips/{cid}/fetch-media")
    assert r.status_code == 409 and "descarga de clips" in r.json()["detail"]
    cid = _twitch_platform_clip(["clips:edit", "editor:manage:clips"])
    with respx.mock(assert_all_called=False) as m:
        m.route(host="testserver").pass_through()
        m.route(host="localhost").pass_through()
        m.post("https://id.twitch.tv/oauth2/token").respond(json={"access_token": "app", "expires_in": 3600})
        m.get("https://api.twitch.tv/helix/clips/downloads").respond(403, json={"message": "not editor"})
        r = auth_client.post(f"/api/clips/{cid}/fetch-media")
    tw_mod.set_twitch(None)
    assert r.status_code == 409 and "editora" in r.json()["detail"]


def test_twitch_clip_download_is_edited_and_publishable(auth_client, worker, highlight_video, monkeypatch):
    from app.integrations import twitch as tw_mod
    from app.live import clipper
    monkeypatch.setattr(clipper, "validate_public_http_url", lambda u: u)
    cid = _twitch_platform_clip(["clips:edit", "editor:manage:clips"])
    data = highlight_video.read_bytes()
    with respx.mock(assert_all_called=False) as m:
        m.route(host="testserver").pass_through()
        m.route(host="localhost").pass_through()
        m.post("https://id.twitch.tv/oauth2/token").respond(json={"access_token": "app", "expires_in": 3600})
        m.get("https://api.twitch.tv/helix/clips/downloads").respond(json={"data": [
            {"clip_id": "ClipABC", "landscape_download_url": "https://media.twitch.example/c.mp4"}]})
        m.get("https://media.twitch.example/c.mp4").respond(200, content=data)
        r = auth_client.post(f"/api/clips/{cid}/fetch-media")
        assert r.status_code == 200, r.text
    tw_mod.set_twitch(None)
    worker.drain()
    clip = auth_client.get(f"/api/clips/{cid}").json()
    assert clip["source_asset_id"] and clip["video_url"] and clip["download_url"], clip
    assert clip["format"] == "9:16" and clip["versions"][0]["status"] == "ready"
    # sigue conservando el enlace oficial de Twitch
    assert clip["platform_clip_url"] == "https://clips.twitch.tv/ClipABC"


def test_instagram_system_user_token_uses_facebook_graph(video, creds):
    """Apps nuevas de Meta: identificador de usuario del sistema (EAA…) → graph.facebook.com."""
    g = f"{P.FB_GRAPH}/{P.IG_VERSION}"
    with respx.mock() as m:
        m.post(f"{g}/178/media").respond(json={"id": "c2"})
        m.post(f"https://rupload.facebook.com/ig-api-upload/{P.IG_VERSION}/c2").respond(json={"success": True})
        m.get(f"{g}/c2").respond(json={"status_code": "FINISHED"})
        m.post(f"{g}/178/media_publish").respond(json={"id": "m2"})
        m.get(f"{g}/m2").respond(json={"permalink": "https://www.instagram.com/reel/BBB/"})
        res = P.InstagramClient().publish("EAAsystemtoken", "178", video, "cap", lambda p, s: None)
    assert res.url == "https://www.instagram.com/reel/BBB/"


def test_instagram_token_endpoint_discovers_account(auth_client):
    g = f"{P.FB_GRAPH}/{P.IG_VERSION}"
    with respx.mock(assert_all_called=False) as m:
        m.route(host="testserver").pass_through()
        m.route(host="localhost").pass_through()
        m.get(f"{g}/me/accounts").respond(400, json={"error": {"message": "not a user"}})
        m.get(f"{g}/me").respond(json={"businesses": {"data": [{"instagram_business_accounts": {
            "data": [{"id": "17841400000000", "username": "mi_cuenta_pro"}]}}]}})
        r = auth_client.post("/api/oauth/instagram/token", json={"token": "EAA" + "x" * 40})
    assert r.status_code == 200, r.text
    assert r.json()["login"] == "mi_cuenta_pro" and "fb_graph" in r.json()["scopes"]
    with respx.mock(assert_all_called=False) as m:
        m.route(host="testserver").pass_through()
        m.route(host="localhost").pass_through()
        m.get(f"{g}/me/accounts").respond(json={"data": []})
        m.get(f"{g}/me").respond(json={})
        r = auth_client.post("/api/oauth/instagram/token", json={"token": "EAA" + "y" * 40})
    assert r.status_code == 422 and "ID de la cuenta" in r.json()["detail"]
    with respx.mock(assert_all_called=False) as m:
        m.route(host="testserver").pass_through()
        m.route(host="localhost").pass_through()
        m.get(f"{g}/17841400000001").respond(json={"id": "17841400000001", "username": "otra"})
        r = auth_client.post("/api/oauth/instagram/token",
                             json={"token": "EAA" + "z" * 40, "account_id": "17841400000001"})
    assert r.status_code == 200 and r.json()["login"] == "otra"


def test_tiktok_redirect_uri_puente(monkeypatch):
    from app.api.routes import oauth
    from app.core.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "tiktok_redirect_uri", "https://x.github.io/legal/tiktok.html")
    assert oauth._redirect_uri("tiktok") == "https://x.github.io/legal/tiktok.html"
    assert oauth._redirect_uri("youtube").endswith("/api/oauth/youtube/callback")
    monkeypatch.setattr(s, "tiktok_redirect_uri", "")
    assert oauth._redirect_uri("tiktok").endswith("/api/oauth/tiktok/callback")
