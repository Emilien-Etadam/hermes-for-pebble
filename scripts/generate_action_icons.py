#!/usr/bin/env python3
"""Generate 33x33 action bar icons for Pebble (white on transparent)."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 33
OUT = Path(__file__).resolve().parent.parent / "resources"


def new_canvas():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def save(name, image):
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / f"{name}.png")


def icon_up():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(16, 6), (26, 22), (6, 22)], fill=(255, 255, 255, 255))
    draw.rectangle([(13, 20), (20, 28)], fill=(255, 255, 255, 255))
    save("action_up", img)


def icon_down():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.rectangle([(13, 5), (20, 13)], fill=(255, 255, 255, 255))
    draw.polygon([(16, 27), (26, 11), (6, 11)], fill=(255, 255, 255, 255))
    save("action_down", img)


def icon_mic():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([(12, 5), (21, 18)], radius=4, fill=(255, 255, 255, 255))
    draw.arc([(8, 10), (25, 24)], start=0, end=180, fill=(255, 255, 255, 255), width=2)
    draw.line([(16, 24), (16, 28)], fill=(255, 255, 255, 255), width=2)
    draw.line([(11, 28), (21, 28)], fill=(255, 255, 255, 255), width=2)
    save("action_mic", img)


def icon_history():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.ellipse([(6, 6), (27, 27)], outline=(255, 255, 255, 255), width=2)
    draw.line([(16, 16), (16, 10)], fill=(255, 255, 255, 255), width=2)
    draw.line([(16, 16), (22, 16)], fill=(255, 255, 255, 255), width=2)
    save("action_history", img)


def icon_read():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(8, 8), (25, 16), (8, 24)], fill=(255, 255, 255, 255))
    save("action_read", img)


def icon_back():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(20, 6), (10, 16), (20, 26)], fill=(255, 255, 255, 255))
    draw.line([(10, 16), (26, 16)], fill=(255, 255, 255, 255), width=2)
    save("action_back", img)


if __name__ == "__main__":
    icon_up()
    icon_down()
    icon_mic()
    icon_history()
    icon_read()
    icon_back()
    print("Wrote icons to", OUT)
