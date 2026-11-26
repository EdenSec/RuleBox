#!/usr/bin/env python3
"""生成扩展商店上架素材（全部输出到 store/，该目录不入库）。

用法：python scripts/make-store-assets.py
依赖：Pillow（已装）；字体使用 Windows 系统自带的微软雅黑。
所有文案只描述功能，不包含任何个人信息、内网地址或密钥。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
STORE = ROOT / "store"
STORE.mkdir(exist_ok=True)

W, H = 1280, 800
BG = (13, 17, 23)
FG = (230, 237, 243)
MUTED = (139, 148, 158)
SUBTLE = (110, 118, 129)
ACCENT = (63, 185, 80)
BORDER = (48, 54, 61)

FONT_REG = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """按像素宽度折行，中文按字符切分。"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if draw.textlength(cur + ch, font=f) <= width:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def rounded_paste(canvas: Image.Image, img: Image.Image, box: tuple[int, int], radius: int = 10) -> None:
    """带圆角、描边与投影地贴入截图。"""
    x, y = box
    w, h = img.size

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x + 6, y + 10, x + w + 6, y + h + 10], radius=radius, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    canvas.paste(img, (x, y), mask)
    ImageDraw.Draw(canvas).rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, outline=BORDER, width=1)


def build_shot(src: Path, title: str, desc: str, out: Path) -> None:
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    draw = ImageDraw.Draw(canvas)

    shot = Image.open(src).convert("RGB")
    target_h = 700
    target_w = round(shot.width * target_h / shot.height)
    shot = shot.resize((target_w, target_h), Image.LANCZOS)
    shot_x = W - 72 - target_w
    rounded_paste(canvas, shot, (shot_x, 50))

    text_w = shot_x - 72 - 48

    draw.text((72, 118), "R U L E B O X", font=font(15, True), fill=ACCENT)

    y = 152
    f_title = font(42, True)
    for line in wrap(draw, title, f_title, text_w):
        draw.text((72, y), line, font=f_title, fill=FG)
        y += 58

    y += 14
    f_desc = font(19)
    for line in wrap(draw, desc, f_desc, text_w):
        draw.text((72, y), line, font=f_desc, fill=MUTED)
        y += 32

    draw.line([72, 690, shot_x - 48, 690], fill=BORDER, width=1)
    draw.text((72, 712), "Chrome / Edge 116+   ·   数据仅存本地   ·   仅限授权安全测试",
              font=font(15), fill=SUBTLE)

    canvas.convert("RGB").save(out, "PNG", optimize=True)
    print(f"OK {out.name} {canvas.size}")


# 标题手动断行，避免自动折行后留下单字孤行
SHOTS = [
    ("screenshot-popup-dark.png", "一个快捷键\n取用语法与 Payload",
     "Ctrl+Shift+Y 唤起面板，搜索、分类筛选、变量填充、一键复制，都不必离开当前页面。",
     "screenshot-1-popup.png"),
    ("screenshot-cyber-dark.png", "多平台聚合查询\n结果一屏看全",
     "FOFA / Hunter / Quake / ZoomEye / Shodan 等平台并行查询，卡片直接展示完整 URL 与状态码。",
     "screenshot-2-cyber.png"),
    ("screenshot-payloads-dark.png", "19 类 267 条 Payload\n按类型随手查",
     "SQLi、XSS、命令注入等覆盖主流场景，支持自定义扩充与隐藏不需要的条目。",
     "screenshot-3-payloads.png"),
    ("screenshot-varfill-dark.png", "变量填完即复制\n不再手改语法",
     "语法中的占位变量会弹窗提示，填入目标后自动替换，复制出来的就是可直接粘贴的语句。",
     "screenshot-4-varfill.png"),
    ("screenshot-ai-dark.png", "AI 助手生成\n定制测绘语法",
     "填入自己的模型档案，用自然语言描述需求，直接产出可用语句；数据不经过任何中间服务。",
     "screenshot-5-ai.png"),
]


def build_icon() -> None:
    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA")
    canvas = Image.new("RGBA", (300, 300), BG + (255,))
    size = 200
    icon = icon.resize((size, size), Image.LANCZOS)
    canvas.alpha_composite(icon, ((300 - size) // 2, (300 - size) // 2))
    canvas.convert("RGB").save(STORE / "store-icon-300.png", "PNG", optimize=True)
    print("OK store-icon-300.png")


def build_promo() -> None:
    canvas = Image.new("RGBA", (440, 280), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA").resize((72, 72), Image.LANCZOS)
    canvas.alpha_composite(icon, (32, 40))
    draw.text((118, 48), "RuleBox", font=font(30, True), fill=FG)
    draw.text((118, 88), "安全语法与 Payload 速取", font=font(15), fill=MUTED)
    draw.line([32, 148, 408, 148], fill=BORDER, width=1)
    for i, line in enumerate(["测绘语法 · Payload · 聚合查询 · AI", "仅限授权安全测试"]):
        draw.text((32, 168 + i * 26), line, font=font(14), fill=MUTED if i == 0 else SUBTLE)
    canvas.convert("RGB").save(STORE / "promo-440x280.png", "PNG", optimize=True)
    print("OK promo-440x280.png")


def main() -> None:
    for src, title, desc, out in SHOTS:
        build_shot(ASSETS / src, title, desc, STORE / out)
    build_icon()
    build_promo()


if __name__ == "__main__":
    main()
