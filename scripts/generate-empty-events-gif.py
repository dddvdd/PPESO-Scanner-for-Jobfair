"""Render the local PPESO calendar animation. Requires Pillow and Segoe UI.

Plays once in four seconds. The PNG is used for reduced-motion preferences.
No remote assets or services are used.
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "assets"
BG = "#101722"
TEXT = "#f3f5f8"
MUTED = "#bec8d6"
BLUE = "#a8caff"
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 24)
bold = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 40)


def render(progress):
    frame = Image.new("RGB", (640, 400), BG)
    draw = ImageDraw.Draw(frame)
    # A calendar without invented event dates, with a small waiting clock.
    draw.rounded_rectangle((235, 35, 405, 205), radius=14, fill="#182230", outline=BLUE, width=3)
    draw.rounded_rectangle((235, 35, 405, 83), radius=14, fill="#245caa")
    draw.rectangle((238, 63, 402, 83), fill="#245caa")
    for x in (273, 367):
        draw.line((x, 24, x, 48), fill=TEXT, width=7)
    for x in (275, 320, 365):
        draw.ellipse((x - 5, 121, x + 5, 131), fill=MUTED)
    draw.line((273, 161, 342, 161), fill=MUTED, width=3)
    draw.ellipse((362, 155, 438, 231), fill=BG, outline=BLUE, width=3)
    angle = -math.pi / 2 + progress * 2 * math.pi
    draw.line((400, 193, 400 + 23 * math.cos(angle), 193 + 23 * math.sin(angle)), fill=TEXT, width=3)
    draw.line((400, 193, 416, 200), fill=BLUE, width=3)
    draw.text((320, 272), "PPESO Cagayan", font=font, anchor="mm", fill=MUTED)
    draw.text((320, 327), "No events right now.", font=bold, anchor="mm", fill=TEXT)
    return frame


frames = [render(i / 39) for i in range(40)]
OUT.mkdir(exist_ok=True)
frames[-1].save(OUT / "no-events.png")
# Omitting the loop extension means the GIF plays once, then holds its last frame.
frames[0].save(OUT / "no-events.gif", save_all=True, append_images=frames[1:], duration=100, optimize=True)
print("Created no-events.gif (4 seconds, plays once) and reduced-motion PNG.")
