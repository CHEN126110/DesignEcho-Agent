from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "icons"


def _lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def _gradient_image(size: int) -> Image.Image:
    start = (20, 103, 255, 255)
    end = (33, 197, 255, 255)
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    denom = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            pixels[x, y] = tuple(_lerp(s, e, t) for s, e in zip(start, end))
    return image


def _draw_icon(size: int) -> Image.Image:
    scale = 8
    canvas_size = size * scale
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    gradient = _gradient_image(canvas_size)

    mask = Image.new("L", (canvas_size, canvas_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    padding = int(canvas_size * 0.065)
    radius = int(canvas_size * 0.24)
    mask_draw.rounded_rectangle(
        (padding, padding, canvas_size - padding, canvas_size - padding),
        radius=radius,
        fill=255,
    )
    canvas.alpha_composite(Image.composite(gradient, Image.new("RGBA", gradient.size, (0, 0, 0, 0)), mask))

    draw = ImageDraw.Draw(canvas)

    # Highlight for depth.
    highlight_top = padding + int(canvas_size * 0.03)
    highlight_height = int(canvas_size * 0.28)
    draw.rounded_rectangle(
        (padding, highlight_top, canvas_size - padding, highlight_top + highlight_height),
        radius=radius,
        fill=(255, 255, 255, 30),
    )

    # Corner accent to keep the mark visible on dark panels.
    accent = [
        (canvas_size - padding - int(canvas_size * 0.17), canvas_size - padding),
        (canvas_size - padding, canvas_size - padding),
        (canvas_size - padding, canvas_size - padding - int(canvas_size * 0.17)),
    ]
    draw.polygon(accent, fill=(148, 233, 255, 255))

    cx = cy = canvas_size / 2

    # Main echo glyph: central dot + bold ring + open outer arcs.
    dot_r = int(canvas_size * 0.085)
    draw.ellipse((cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r), fill=(255, 255, 255, 255))

    ring_r = int(canvas_size * 0.225)
    ring_w = max(10, int(canvas_size * 0.06))
    draw.ellipse(
        (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
        outline=(255, 255, 255, 255),
        width=ring_w,
    )

    outer_r = int(canvas_size * 0.345)
    outer_w = max(8, int(canvas_size * 0.045))
    arc_box = (cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r)
    draw.arc(arc_box, start=205, end=335, fill=(255, 255, 255, 230), width=outer_w)
    draw.arc(arc_box, start=25, end=155, fill=(255, 255, 255, 230), width=outer_w)

    # Small anchor dots to make the icon readable at 23x23.
    mini_r = max(4, int(canvas_size * 0.028))
    offset = int(canvas_size * 0.195)
    draw.ellipse(
        (cx - outer_r + offset - mini_r, cy - outer_r + offset - mini_r,
         cx - outer_r + offset + mini_r, cy - outer_r + offset + mini_r),
        fill=(255, 255, 255, 210),
    )
    draw.ellipse(
        (cx + outer_r - offset - mini_r, cy + outer_r - offset - mini_r,
         cx + outer_r - offset + mini_r, cy + outer_r - offset + mini_r),
        fill=(255, 255, 255, 210),
    )

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def _draw_panel_glyph(size: int, color: tuple[int, int, int, int]) -> Image.Image:
    scale = 8
    canvas_size = size * scale
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    cx = cy = canvas_size / 2
    dot_r = int(canvas_size * 0.085)
    ring_r = int(canvas_size * 0.225)
    ring_w = max(10, int(canvas_size * 0.06))
    outer_r = int(canvas_size * 0.345)
    outer_w = max(8, int(canvas_size * 0.045))

    draw.ellipse((cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r), fill=color)
    draw.ellipse(
        (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
        outline=color,
        width=ring_w,
    )
    arc_box = (cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r)
    draw.arc(arc_box, start=205, end=335, fill=color, width=outer_w)
    draw.arc(arc_box, start=25, end=155, fill=color, width=outer_w)

    mini_r = max(4, int(canvas_size * 0.028))
    offset = int(canvas_size * 0.195)
    draw.ellipse(
        (cx - outer_r + offset - mini_r, cy - outer_r + offset - mini_r,
         cx - outer_r + offset + mini_r, cy - outer_r + offset + mini_r),
        fill=color,
    )
    draw.ellipse(
        (cx + outer_r - offset - mini_r, cy + outer_r - offset - mini_r,
         cx + outer_r - offset + mini_r, cy + outer_r - offset + mini_r),
        fill=color,
    )

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def _draw_plugin_list_icon(size: int, glyph_color: tuple[int, int, int, int], accent_color: tuple[int, int, int, int]) -> Image.Image:
    scale = 8
    canvas_size = size * scale
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    padding = int(canvas_size * 0.08)
    radius = int(canvas_size * 0.18)
    stroke = max(8, int(canvas_size * 0.045))
    draw.rounded_rectangle(
        (padding, padding, canvas_size - padding, canvas_size - padding),
        radius=radius,
        outline=accent_color,
        width=stroke,
    )

    glyph = _draw_panel_glyph(size, glyph_color).resize((canvas_size, canvas_size), Image.Resampling.NEAREST)
    canvas.alpha_composite(glyph)

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def _build_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="de-bg" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1467FF"/>
      <stop offset="1" stop-color="#21C5FF"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="42" height="42" rx="10" fill="url(#de-bg)"/>
  <path d="M37 45H45V37L37 45Z" fill="#94E9FF"/>
  <rect x="3" y="4" width="42" height="13" rx="10" fill="white" fill-opacity=".12"/>
  <circle cx="24" cy="24" r="4" fill="white"/>
  <circle cx="24" cy="24" r="10.5" stroke="white" stroke-width="3"/>
  <path d="M10.5 18.5C12.8 13.2 17.8 9.5 24 9.5C30.2 9.5 35.2 13.2 37.5 18.5" stroke="white" stroke-width="2.3" stroke-linecap="round"/>
  <path d="M10.5 29.5C12.8 34.8 17.8 38.5 24 38.5C30.2 38.5 35.2 34.8 37.5 29.5" stroke="white" stroke-width="2.3" stroke-linecap="round"/>
  <circle cx="13.6" cy="13.6" r="1.4" fill="white" fill-opacity=".85"/>
  <circle cx="34.4" cy="34.4" r="1.4" fill="white" fill-opacity=".85"/>
</svg>
"""


def generate_all() -> Iterable[Path]:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for name, size in (
        ("icon@1x.png", 23),
        ("icon@2x.png", 46),
        ("plugin-icon.png", 48),
        ("icon-large.png", 128),
    ):
        image = _draw_icon(size)
        path = ICONS_DIR / name
        image.save(path)
        outputs.append(path)

    theme_defs = [
        ("light", (255, 255, 255, 255), (255, 255, 255, 255)),
        ("dark", (47, 64, 84, 255), (47, 64, 84, 255)),
    ]

    for theme_name, glyph_color, accent_color in theme_defs:
        panel_1x = _draw_panel_glyph(23, glyph_color)
        panel_2x = _draw_panel_glyph(46, glyph_color)
        plugin_1x = _draw_plugin_list_icon(24, glyph_color, accent_color)
        plugin_2x = _draw_plugin_list_icon(48, glyph_color, accent_color)

        theme_paths = [
            (f"{theme_name}@1x.png", panel_1x),
            (f"{theme_name}.png", panel_1x),
            (f"{theme_name}@2x.png", panel_2x),
            (f"{theme_name}Plugin@1x.png", plugin_1x),
            (f"{theme_name}Plugin.png", plugin_1x),
            (f"{theme_name}Plugin@2x.png", plugin_2x),
        ]
        for file_name, image in theme_paths:
            path = ICONS_DIR / file_name
            image.save(path)
            outputs.append(path)

    svg_path = ICONS_DIR / "icon.svg"
    svg_path.write_text(_build_svg(), encoding="utf-8")
    outputs.append(svg_path)
    return outputs


if __name__ == "__main__":
    for output in generate_all():
        print(output)
