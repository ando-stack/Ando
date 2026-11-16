"""Genera vídeos de prueba REALES con FFmpeg: voz sintetizada (flite), risa modulada, grito y
cambios de escena. Se usan en los tests de importación, análisis, render y extremo a extremo."""

from __future__ import annotations

import subprocess
from pathlib import Path

CALM = [
    (2.0, "Hello everyone and welcome back to the stream."),
    (7.0, "Today we are going to play a few rounds and talk about the new update."),
    (14.0, "I think the new map is pretty interesting but the spawn points are strange."),
    (21.0, "Let me check the settings before we start the next match."),
    (28.0, "Okay so the plan is to stay together and hold the middle."),
    (34.0, "Wait, there is someone behind that wall."),
]
HYPE = [(39.0, "No way! Oh my god! That was insane! We won! Let's go!")]
AFTER = [
    (52.0, "That was the best round of the whole week."),
    (58.0, "Thank you all for the support in the chat."),
    (64.0, "Now let me explain what happened in that last fight."),
    (71.0, "So basically I jumped from the roof and landed right behind them."),
    (78.0, "Okay, next game, let us see if we can do it again."),
]


def _have_flite() -> bool:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return " flite " in out


def make_highlight_video(dest: Path, duration: float = 88.0, with_audio: bool = True) -> Path:
    """Vídeo 1280x720 con conversación tranquila y un momento destacado alrededor de t≈39-46 s."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return dest
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    idx = 0
    # Vídeo: escena tranquila → escena intensa (39-50 s) → tranquila
    inputs += ["-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=30:duration={duration}"]
    inputs += ["-f", "lavfi", "-i", f"cellauto=size=320x180:rate=30:rule=110:random_fill_ratio=0.5"]
    filters.append(f"[1:v]trim=0:{duration},setpts=PTS-STARTPTS,scale=1280:720:flags=neighbor,format=yuv420p[mb]")
    filters.append("[0:v][mb]overlay=enable='between(t,39,50)'[vid]")
    idx = 2
    if with_audio:
        if not _have_flite():
            raise RuntimeError("FFmpeg sin flite: no se puede sintetizar voz de prueba")
        for t, text in CALM + AFTER:
            safe = text.replace("'", "").replace(",", "\\,").replace(":", "\\:")
            inputs += ["-f", "lavfi", "-i", f"flite=text='{safe}':voice=slt"]
            filters.append(f"[{idx}:a]aresample=16000,volume=0.25,adelay={int(t * 1000)}:all=1[s{idx}]")
            labels.append(f"[s{idx}]")
            idx += 1
        for t, text in HYPE:
            safe = text.replace("'", "").replace(",", "\\,").replace(":", "\\:")
            inputs += ["-f", "lavfi", "-i", f"flite=text='{safe}':voice=kal"]
            filters.append(f"[{idx}:a]aresample=16000,volume=1.0,atempo=1.15,adelay={int(t * 1000)}:all=1[s{idx}]")
            labels.append(f"[s{idx}]")
            idx += 1
        # Grito (tono agudo con vibrato) a 42.5 s y risa (ráfagas a 5 Hz) a 44 s
        inputs += ["-f", "lavfi", "-i", "sine=frequency=880:duration=1.4:sample_rate=16000"]
        filters.append(f"[{idx}:a]vibrato=f=6:d=0.5,volume=0.7,adelay=42500:all=1[s{idx}]")
        labels.append(f"[s{idx}]")
        idx += 1
        inputs += ["-f", "lavfi", "-i", "anoisesrc=d=3:c=pink:a=0.6:r=16000"]
        filters.append(f"[{idx}:a]bandpass=f=900:width_type=h:w=700,tremolo=f=5:d=0.95,"
                       f"volume=1.5,adelay=44000:all=1[s{idx}]")
        labels.append(f"[s{idx}]")
        idx += 1
        inputs += ["-f", "lavfi", "-i", f"anoisesrc=d={duration}:c=brown:a=0.004:r=16000"]
        labels.append(f"[{idx}:a]")
        idx += 1
        filters.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,"
                       f"atrim=0:{duration},aresample=48000[aud]")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(filters),
           "-map", "[vid]"]
    if with_audio:
        cmd += ["-map", "[aud]", "-c:a", "aac", "-b:a", "128k"]
    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-t", str(duration),
            "-movflags", "+faststart", str(dest)]
    subprocess.run(cmd, check=True)
    return dest


if __name__ == "__main__":
    import sys
    print(make_highlight_video(Path(sys.argv[1] if len(sys.argv) > 1 else "highlight.mp4")))
