#!/usr/bin/env python3
"""Generate 33x33 action bar icons for Pebble (white on black)."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 33
OUT = Path(__file__).resolve().parent.parent / "resources"


def new_canvas():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))


def save(name, image):
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / f"{name}.png")


def icon_up():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(16, 5), (27, 23), (5, 23)], fill=(255, 255, 255, 255))
    draw.rectangle([(13, 19), (20, 28)], fill=(255, 255, 255, 255))
    save("action_up", img)


def icon_down():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.rectangle([(13, 4), (20, 12)], fill=(255, 255, 255, 255))
    draw.polygon([(16, 28), (27, 10), (5, 10)], fill=(255, 255, 255, 255))
    save("action_down", img)


def icon_mic():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([(12, 4), (21, 17)], radius=4, fill=(255, 255, 255, 255))
    draw.arc([(8, 9), (25, 23)], start=0, end=180, fill=(255, 255, 255, 255), width=3)
    draw.line([(16, 23), (16, 28)], fill=(255, 255, 255, 255), width=3)
    draw.line([(10, 28), (22, 28)], fill=(255, 255, 255, 255), width=3)
    save("action_mic", img)


def icon_history():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.ellipse([(5, 5), (28, 28)], outline=(255, 255, 255, 255), width=3)
    draw.line([(16, 16), (16, 9)], fill=(255, 255, 255, 255), width=3)
    draw.line([(16, 16), (23, 16)], fill=(255, 255, 255, 255), width=3)
    save("action_history", img)


def icon_read():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(7, 7), (26, 16), (7, 25)], fill=(255, 255, 255, 255))
    save("action_read", img)


def icon_back():
    img = new_canvas()
    draw = ImageDraw.Draw(img)
    draw.polygon([(21, 5), (9, 16), (21, 27)], fill=(255, 255, 255, 255))
    draw.line([(9, 16), (27, 16)], fill=(255, 255, 255, 255), width=3)
    save("action_back", img)


if __name__ == "__main__":
    icon_up()
    icon_down()
    icon_mic()
    icon_history()
    icon_read()
    icon_back()
    print("Wrote icons to", OUT)
