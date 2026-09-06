#!/usr/bin/env python3
"""生成扩展图标 v2：黄绿渐变圆角徽章（带外框）+ 一个对讲机（天线在右）+「浮」。
主色 #FFEE54，结合蓝绿渐变；对讲机深色机身，黄色屏幕/旋钮/文字。
运行：python3 tools/make_icons.py
输出：src/icons/icon-{16,32,48,128}.png 与 log/icon-preview-512.png
"""
from PIL import Image, ImageDraw, ImageFont

S = 512
YELLOW = (255, 238, 84)    # 主色 #FFEE54
GREEN = (16, 185, 129)     # 渐变终点 #10B981
DARK = (17, 24, 39)        # 机身深色 #111827
BORDER = (31, 41, 55)      # 外框 #1F2937
LIGHT = (229, 231, 235)    # 扬声器孔 #E5E7EB

grad = Image.new('RGB', (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * (S - 1))
        px[x, y] = (
            round(YELLOW[0] + (GREEN[0] - YELLOW[0]) * t),
            round(YELLOW[1] + (GREEN[1] - YELLOW[1]) * t),
            round(YELLOW[2] + (GREEN[2] - YELLOW[2]) * t),
        )

mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([20, 20, 492, 492], radius=112, fill=255)

badge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
badge.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(badge)
draw.rounded_rectangle([20, 20, 492, 492], radius=112, outline=(*BORDER, 255), width=14)

draw.rounded_rectangle([104, 176, 408, 388], radius=64, fill=(*DARK, 255))
draw.rounded_rectangle([354, 72, 386, 176], radius=16, fill=(*DARK, 255))
draw.ellipse([350, 46, 390, 86], fill=(*DARK, 255))

draw.rounded_rectangle([140, 126, 280, 168], radius=18, fill=(*YELLOW, 255))
font_fu = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', 152, index=0)
draw.text((188, 282), '浮', font=font_fu, fill=(*YELLOW, 255), anchor='mm')

badge.save('log/icon-preview-512.png')
for size in (128, 48, 32, 16):
    badge.resize((size, size), Image.LANCZOS).save(f'src/icons/icon-{size}.png')
    print('saved', f'src/icons/icon-{size}.png')
print('preview: log/icon-preview-512.png')
