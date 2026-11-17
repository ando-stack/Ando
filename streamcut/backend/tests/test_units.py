"""Pruebas unitarias: enlaces, SSRF, cifrado, redacción de logs, chat y puntuación."""

from __future__ import annotations

import numpy as np
import pytest

from app.analysis import audio as A
from app.analysis import chat as C
from app.analysis import semantic as S
from app.analysis.scoring import DEFAULT_WEIGHTS, DetectionParams, Signals, deduplicate, generate_candidates, Candidate
from app.analysis.transcribe import Segment, Word
from app.core.logging import redact
from app.core.netsafe import UnsafeURL, validate_source_url
from app.core.security import decrypt, encrypt, read_session_token, make_session_token
from app.integrations.urls import InvalidChannelURL, parse_channel
from app.live.chat_listeners import parse_privmsg
from app.media.editspec import EditSpec, cues_from_words


@pytest.mark.parametrize("text,platform,kind,value", [
    ("https://www.twitch.tv/Ibai", "twitch", "login", "ibai"),
    ("twitch.tv/auronplay?ref=x", "twitch", "login", "auronplay"),
    ("m.twitch.tv/some_user/videos", "twitch", "login", "some_user"),
    ("xqc", "twitch", "login", "xqc"),
    ("https://www.youtube.com/@MrBeast", "youtube", "handle", "MrBeast"),
    ("@midudev", "youtube", "handle", "midudev"),
    ("https://youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA", "youtube", "channel_id", "UCX6OQ3DkcsbYNE6H8uQQuVA"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ?si=1", "youtube", "video", "dQw4w9WgXcQ"),
])
def test_parse_channel(text, platform, kind, value):
    p = parse_channel(text)
    assert (p.platform, p.kind, p.value) == (platform, kind, value)


@pytest.mark.parametrize("bad", ["", "https://evil.com/twitch.tv/x", "https://www.twitch.tv/directory",
                                 "ftp://twitch.tv/x", "https://twitch.tv/a", "javascript:alert(1)"])
def test_parse_channel_rejects(bad):
    with pytest.raises(InvalidChannelURL):
        parse_channel(bad)


def test_ssrf_protection():
    for url in ("rtmp://127.0.0.1/live/x", "http://169.254.169.254/latest/meta-data", "srt://10.0.0.5:9000",
                "rtmp://localhost/live", "http://[::1]/x"):
        with pytest.raises(UnsafeURL):
            validate_source_url(url, allow_private=False)
    for url in ("file:///etc/passwd", "concat:a|b", "gopher://x", "rtmp://host with space"):
        with pytest.raises(UnsafeURL):
            validate_source_url(url, allow_private=True)
    assert validate_source_url("rtmp://127.0.0.1:1935/live/k", allow_private=True)


def test_encryption_and_sessions():
    token = "oauth-access-token-123"
    enc = encrypt(token)
    assert enc != token and token not in enc
    assert decrypt(enc) == token
    assert read_session_token(make_session_token("u1", 3)) == {"u": "u1", "v": 3}
    assert read_session_token("forjado.token") is None


def test_log_redaction():
    line = 'POST access_token=abc123&refresh_token=zzz Authorization: Bearer qwerty {"client_secret": "s3cr3t"}'
    out = redact(line)
    for secret in ("abc123", "zzz", "qwerty", "s3cr3t"):
        assert secret not in out
    assert "rtmp://a.b/live/[REDACTED]" in redact("rtmp://a.b/live/live_123_secretkey")


def test_irc_parse_and_chat_spike():
    line = "@badge-info=;color=#FF0000 :alice!alice@alice.tmi.twitch.tv PRIVMSG #canal :KEKW que risa"
    assert parse_privmsg(line) == ("alice", "KEKW que risa")
    assert parse_privmsg(":tmi.twitch.tv PING") is None
    det = C.ChatSpikeDetector(window_s=10, baseline_s=300, min_rate=1, z_threshold=3, cooldown_s=30)
    t = 1000.0
    spike = None
    for sec in range(200):  # 0.5 msg/s normal y luego una explosión de risas
        n = 1 if sec % 2 == 0 else 0
        if 150 <= sec < 160:
            n = 12
        for i in range(n):
            det.add(t + sec + i / max(n, 1), "KEKW" if sec >= 150 else "hola")
        s = det.check(t + sec)
        if s and spike is None:
            spike = (sec, s)
    assert spike is not None and 150 <= spike[0] <= 160
    assert spike[1]["laugh"] > 0


def _signals_with_peak(peak_at: float = 60.0, duration: float = 120.0, loud_baseline_db: float = -20.0):
    sr = 16000
    t = np.arange(int(duration * sr)) / sr
    rng = np.random.default_rng(1)
    x = rng.normal(0, 1, t.size).astype(np.float32) * 10 ** (loud_baseline_db / 20)
    burst = (t > peak_at) & (t < peak_at + 3)
    x[burst] *= 8
    f = A.compute_features(x)
    events = A.detect_events(f)
    segs = [Segment(s, s + 4, f"frase normal número {i}", 0.8, [Word(s, s + 1, "frase", 0.9)])
            for i, s in enumerate(np.arange(1, duration - 5, 6))]
    segs.append(Segment(peak_at - 0.5, peak_at + 2.5, "¡No puede ser! ¡Qué locura!", 0.9))
    segs.sort(key=lambda s: s.start)
    return Signals(hop=f.hop, duration=duration, audio=f, audio_events=events, segments=segs,
                   seg_scores=S.score_segments(segs)), events


def test_relative_baseline_no_false_positive_when_always_loud():
    sr = 16000
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.3, sr * 90).astype(np.float32)  # micro siempre alto y constante
    events = [e for e in A.detect_events(A.compute_features(x)) if e.type != "silence"]
    assert events == []


def test_detects_reaction_and_scores_candidate():
    sig, events = _signals_with_peak()
    assert any(e.type == "loud_reaction" and 59 <= e.start <= 61.5 for e in events)
    accepted, _ = generate_candidates(sig, DetectionParams())
    assert accepted, "debe haber al menos un candidato"
    best = accepted[0]
    assert best.start <= 60 <= best.end
    assert 0 <= best.score <= 100
    assert 15 <= best.duration <= 60.5
    assert set(best.scores) >= {"semantic", "vocal", "context", "clarity", "originality", "audio_quality",
                                "resolution"}
    assert best.explanation and best.category in S.CATEGORY_LABELS
    # Nunca corta frases: ni el inicio ni el final caen dentro de una frase
    for seg in sig.segments:
        assert not (seg.start + 0.1 < best.start < seg.end - 0.1), (best.start, seg)
        assert not (seg.start + 0.1 < best.end < seg.end - 0.1), (best.end, seg)


@pytest.mark.parametrize("mode,target", [("15", 15), ("30", 30), ("60", 60)])
def test_duration_presets(mode, target):
    sig, _ = _signals_with_peak()
    accepted, _ = generate_candidates(sig, DetectionParams(duration_mode=mode))
    assert accepted
    d = accepted[0].duration
    assert target * 0.7 <= d <= target * 1.3, d


def test_weights_are_configurable():
    sig, _ = _signals_with_peak()
    a1, _ = generate_candidates(sig, DetectionParams())
    w = dict(DEFAULT_WEIGHTS, semantic=0.0, vocal=1.0)
    a2, _ = generate_candidates(sig, DetectionParams(weights=w))
    assert a1[0].score != a2[0].score


def test_deduplication():
    base = Candidate(10, 30, 20, 80, {"vocal": 1.0, "originality": 1.0}, "reaction", 0.8, "", [], "hola qué tal")
    overlap = Candidate(12, 32, 22, 70, {"vocal": 0.9, "originality": 1.0}, "reaction", 0.8, "", [], "otra cosa")
    other = Candidate(100, 120, 110, 60, {"vocal": 0.8, "originality": 1.0}, "funny", 0.7, "", [], "algo distinto")
    acc, dups = deduplicate([overlap, base, other], DEFAULT_WEIGHTS)
    assert [c.start for c in acc] == [10, 100]
    assert dups == [overlap]


def test_semantic_lexicon():
    cats, matches = S.score_text("¡No puede ser! Jajaja qué risa, ganamos")
    assert {"reaction", "funny", "victory"} <= set(cats)
    assert S.generate_title("bla bla. ¡No puede ser lo que acaba de pasar!", "reaction").startswith("¡No puede ser")


def test_cues_from_words_and_spec_mapping():
    words = [{"start": 10 + i * 0.4, "end": 10 + i * 0.4 + 0.3, "text": w}
             for i, w in enumerate("esto es una prueba de subtítulos muy largos.".split())]
    cues = cues_from_words(words, 10, 20, words_per_line=3)
    assert len(cues) >= 3 and all(len(c["words"]) <= 3 for c in cues)
    spec = EditSpec.model_validate({"source_asset_id": "x", "segments": [{"start": 10, "end": 12}, {"start": 15, "end": 18}]})
    assert spec.output_duration == 5
    assert spec.to_output_time(11) == 1 and spec.to_output_time(16) == 3 and spec.to_output_time(13) is None
    with pytest.raises(Exception):
        EditSpec.model_validate({"source_asset_id": "x", "segments": []})
    with pytest.raises(Exception):
        EditSpec.model_validate({"source_asset_id": "x", "segments": [{"start": 1, "end": 2}],
                                 "subtitles": {"style": {"color": "red"}}})


def test_w_spam_triggers_without_rate_change():
    """Chat siempre rápido (5 msg/s): el spam de «W» dispara el clip aunque la velocidad no cambie."""
    det = C.ChatSpikeDetector()
    t0 = 5000.0
    found = None
    for sec in range(240):
        for k in range(5):
            if 200 <= sec < 210:
                msg = "W" if k < 4 else "WWWW"
            else:
                msg = ["hola", "que tal", "jugando a esto", "w kata", "buenas"][k]
            det.add(t0 + sec + k / 5, msg)
        s = det.check(t0 + sec)
        if s and found is None:
            found = (sec, s)
    assert found is not None and 200 <= found[0] <= 210, found
    assert found[1]["kind"] == "emotes" and found[1]["top"] == "W"


def test_normal_chat_with_some_w_does_not_trigger():
    det = C.ChatSpikeDetector()
    t0 = 9000.0
    fired = []
    for sec in range(300):
        for k in range(5):
            det.add(t0 + sec + k / 5, ["W", "hola", "que dices", "jaja", "buenas"][(sec + k) % 5])
        if det.check(t0 + sec):
            fired.append(sec)
    assert fired == []
