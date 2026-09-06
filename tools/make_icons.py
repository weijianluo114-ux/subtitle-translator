#!/usr/bin/env python3
"""扩展图标 v5：黄绿渐变徽章（外框）+ 黑色机身包住「横线在上、浮字在下」的整体 + 右侧天线。
横线左边界 = 浮字正中心偏左一点；横线右边界 = 浮字右边界 + 浮宽/3。
"""
from PIL import Image, ImageDraw, ImageFont

S = 512
YELLOW = (255, 238, 84)
GREEN = (16, 185, 129)
DARK = (17, 24, 39)
BORDER = (31, 41, 55)

# 徽章渐变 + 外框
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

# 「浮」尺寸与位置（锚点即字中心）
font_fu = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', 152, index=0)
fu_cx, fu_cy = 200, 300
bb = draw.textbbox((0, 0), '浮', font=font_fu, anchor='mm')
fu_left = fu_cx + bb[0]
fu_top = fu_cy + bb[1]
fu_right = fu_cx + bb[2]
fu_bottom = fu_cy + bb[3]
fu_w = fu_right - fu_left

# 黄色横线：位于浮字上方；左边界=浮中心偏左一点；右边界=浮右边界 + 浮宽/3
bar_h = 44
bar_gap = 20
bar_left = fu_cx - 24
bar_right = fu_right + fu_w / 3
bar_bottom = fu_top - bar_gap
bar_top = bar_bottom - bar_h

# 黑色机身：包住横线 + 浮字（含内边距）
pad_x, pad_top, pad_bottom = 26, 22, 24
body_left = min(fu_left, bar_left) - pad_x
body_right = max(fu_right, bar_right) + pad_x
body_top = bar_top - pad_top
body_bottom = fu_bottom + pad_bottom

draw.rounded_rectangle([body_left, body_top, body_right, body_bottom], radius=60, fill=(*DARK, 255))
draw.rounded_rectangle([bar_left, bar_top, bar_right, bar_bottom], radius=18, fill=(*YELLOW, 255))
draw.text((fu_cx, fu_cy), '浮', font=font_fu, fill=(*YELLOW, 255), anchor='mm')

# 右侧天线（杆 + 圆头，向上伸出，整体仍在徽章内）
ant_w = 24
ant_x0 = body_right - 52
ant_x1 = ant_x0 + ant_w
ant_top = body_top - 68
draw.rounded_rectangle([ant_x0, ant_top, ant_x1, body_top], radius=12, fill=(*DARK, 255))
draw.ellipse([ant_x0 + ant_w / 2 - 18, ant_top - 36, ant_x0 + ant_w / 2 + 18, ant_top], fill=(*DARK, 255))

badge.save('log/icon-preview-512.png')
for size in (128, 48, 32, 16):
    badge.resize((size, size), Image.LANCZOS).save(f'src/icons/icon-{size}.png')
    print('saved', f'src/icons/icon-{size}.png')
print('preview: log/icon-preview-512.png')
