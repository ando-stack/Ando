"""Generación de subtítulos ASS (libass) con resaltado por palabra y animaciones."""

from __future__ import annotations

from .editspec import EditSpec


def _ass_color(hex_rgb: str, alpha: int = 0) -> str:
    r, g, b = hex_rgb[1:3], hex_rgb[3:5], hex_rgb[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ts(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(spec: EditSpec) -> str:
    st = spec.subtitles.style
    w, h = spec.size()
    scale = h / 1920 if spec.format != "16:9" else h / 1080
    size = int(st.size * (scale if spec.format != "16:9" else scale * 0.75))
    align = {"bottom": 2, "middle": 5, "top": 8}[st.position]
    margin_v = int(st.margin_v * scale) if st.position != "middle" else 0
    header = (
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n"
        f"PlayResX: {w}\nPlayResY: {h}\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, "
        "Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Main,{st.font},{size},{_ass_color(st.color)},{_ass_color(st.highlight_color)},"
        f"{_ass_color(st.outline_color)},{_ass_color('#000000', 0x80)},{-1 if st.bold else 0},0,0,0,100,100,"
        f"0,0,1,{st.outline * scale:.1f},{st.shadow * scale:.1f},{align},{int(60 * scale)},{int(60 * scale)},"
        f"{margin_v},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines: list[str] = []
    hl = _ass_color(st.highlight_color)
    base = _ass_color(st.color)
    for cue in spec.subtitles.cues:
        a = spec.to_output_time(cue.start)
        b = spec.to_output_time(min(cue.end, cue.end))
        if a is None and b is None:
            continue
        a = a if a is not None else 0.0
        b = b if b is not None else spec.output_duration
        if b - a < 0.05:
            continue
        words = [wd for wd in cue.words if spec.to_output_time(wd.start) is not None]
        text_of = (lambda s: s.upper()) if st.uppercase else (lambda s: s)
        if st.animation == "none" or not words:
            lines.append(f"Dialogue: 0,{_ts(a)},{_ts(b)},Main,,0,0,0,,{_escape(text_of(cue.text))}")
            continue
        # Una línea por palabra: la palabra activa se resalta (y "pop" la escala un instante)
        for i, wd in enumerate(words):
            ws = spec.to_output_time(wd.start) or a
            we = spec.to_output_time(words[i + 1].start) if i + 1 < len(words) else b
            we = we if we is not None else b
            if we - ws < 0.03:
                continue
            parts = []
            for j, other in enumerate(words):
                token = _escape(text_of(other.text))
                if j == i:
                    pop = r"\t(0,80,\fscx112\fscy112)\t(80,160,\fscx100\fscy100)" if st.animation == "pop" else ""
                    parts.append(f"{{\\c{hl}{pop}}}{token}{{\\c{base}\\fscx100\\fscy100}}")
                else:
                    parts.append(token)
            lines.append(f"Dialogue: 0,{_ts(ws)},{_ts(we)},Main,,0,0,0,,{' '.join(parts)}")
    return header + "\n".join(lines) + "\n"
