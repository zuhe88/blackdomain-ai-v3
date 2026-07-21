from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(
    r"C:\Users\User\.codex\generated_images\019f8390-1a76-7a20-a1de-57b4b72b2b1a\exec-46c5e7c5-b683-4ebc-bef8-e91d313a20f9.png"
)
OUT = ROOT / "public" / "brand"

TITLE_FONT = r"C:\Windows\Fonts\bahnschrift.ttf"
ZH_FONT = r"C:\Windows\Fonts\NotoSansTC-VF.ttf"

GOLD = (212, 175, 55)
CHAMPAGNE = (240, 213, 138)
SOFT_WHITE = (245, 241, 228)


def cover_crop(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_ratio = size[0] / size[1]
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        crop_w = round(image.height * target_ratio)
        x0 = (image.width - crop_w) // 2
        image = image.crop((x0, 0, x0 + crop_w, image.height))
    else:
        crop_h = round(image.width / target_ratio)
        y0 = (image.height - crop_h) // 2
        image = image.crop((0, y0, image.width, y0 + crop_h))
    return image.resize(size, Image.Resampling.LANCZOS)


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, spacing: int) -> int:
    return sum(draw.textlength(char, font=font) for char in text) + spacing * max(0, len(text) - 1)


def tracked_text(
    draw: ImageDraw.ImageDraw,
    center_x: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    spacing: int,
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int, int] | None = None,
) -> None:
    width = text_width(draw, text, font, spacing)
    x = center_x - width / 2
    for char in text:
        draw.text(
            (round(x), y),
            char,
            font=font,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        x += draw.textlength(char, font=font) + spacing


def build_master(source: Image.Image) -> Image.Image:
    canvas = cover_crop(source.convert("RGB"), (820, 360)).convert("RGBA")

    # Reduce detail behind the wordmark while retaining the AI-core halo.
    veil = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    veil_draw = ImageDraw.Draw(veil)
    veil_draw.rounded_rectangle((92, 91, 728, 271), radius=42, fill=(0, 0, 0, 154))
    veil = veil.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas, veil)

    accent = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(accent)
    draw.line((157, 115, 663, 115), fill=(*GOLD, 112), width=1)
    draw.ellipse((405, 111, 415, 121), fill=(*CHAMPAGNE, 230))

    title_font = ImageFont.truetype(TITLE_FONT, 54)
    zh_font = ImageFont.truetype(ZH_FONT, 23)
    mini_font = ImageFont.truetype(TITLE_FONT, 12)

    tracked_text(
        draw,
        410,
        127,
        "BLACKDOMAIN AI",
        title_font,
        (*SOFT_WHITE, 255),
        spacing=3,
        stroke_width=1,
        stroke_fill=(0, 0, 0, 230),
    )

    tagline = "黑域AI  ·  AI 智能分析平台"
    box = draw.textbbox((0, 0), tagline, font=zh_font)
    draw.text(
        (410 - (box[2] - box[0]) / 2, 202),
        tagline,
        font=zh_font,
        fill=(*CHAMPAGNE, 255),
        stroke_width=1,
        stroke_fill=(0, 0, 0, 210),
    )
    tracked_text(draw, 410, 246, "ANALYZE  •  PREDICT  •  INSIGHT", mini_font, (225, 218, 196, 220), 2)
    return Image.alpha_composite(canvas, accent).convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE) as source:
        master = build_master(source)

    master.save(OUT / "blackdomain-ai-fb-cover-master-820x360.png", optimize=True)
    desktop = master.crop((0, 24, 820, 336))
    desktop.save(OUT / "blackdomain-ai-fb-cover-desktop-820x312.png", optimize=True)
    mobile = master.crop((90, 0, 730, 360))
    mobile.save(OUT / "blackdomain-ai-fb-cover-mobile-640x360.png", optimize=True)


if __name__ == "__main__":
    main()
