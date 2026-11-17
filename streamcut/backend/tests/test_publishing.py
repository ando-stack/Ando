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
        res = P.InstagramClient().publish("tok", "999", video, "caption", lambda p, s: None)
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
                                 access_token_enc=encrypt("ig-token")))
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
