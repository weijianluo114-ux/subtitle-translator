#!/usr/bin/env python3
"""扩展图标 v6：黄绿渐变徽章（外框）+ 黑色机身包住「横线在上、浮字在下」+ 右侧天线。
整体按组合图形边界在徽章内自动居中，比例微调以保证美观。
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

# 先以临时锚点计算「浮」几何
font_fu = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', 144, index=0)
fu_cx, fu_cy = 200, 296
bb = draw.textbbox((0, 0), '浮', font=font_fu, anchor='mm')
fu_left = fu_cx + bb[0]
fu_top = fu_cy + bb[1]
fu_right = fu_cx + bb[2]
fu_bottom = fu_cy + bb[3]
fu_w = fu_right - fu_left

# 黄色横线
bar_h = 40
bar_gap = 18
bar_left = fu_cx - 22
bar_right = fu_right + fu_w / 3
bar_bottom = fu_top - bar_gap
bar_top = bar_bottom - bar_h

# 黑色机身（包住横线+浮字）
pad_x, pad_top, pad_bottom = 24, 20, 22
body_left = min(fu_left, bar_left) - pad_x
body_right = max(fu_right, bar_right) + pad_x
body_top = bar_top - pad_top
body_bottom = fu_bottom + pad_bottom

# 右侧天线
ant_w = 22
ant_x0 = body_right - 46
ant_x1 = ant_x0 + ant_w
ant_top = body_top - 60
ball_r = 16
ball_cx = ant_x0 + ant_w / 2
ball_top = ant_top - ball_r * 2

# 组合图形整体边界 → 计算居中偏移
comp_left = min(body_left, fu_left, bar_left)
comp_right = max(body_right, fu_right, bar_right)
comp_top = min(body_top, ball_top)
comp_bottom = max(body_bottom, fu_bottom)

dx = S / 2 - (comp_left + comp_right) / 2
dy = S / 2 - (comp_top + comp_bottom) / 2

def shift(v):
    return v + dx

def shift_y(v):
    return v + dy

# 应用偏移后绘制
B = lambda r: [shift(r[0]), shift_y(r[1]), shift(r[2]), shift_y(r[3])]
draw.rounded_rectangle(B([body_left, body_top, body_right, body_bottom]), radius=54, fill=(*DARK, 255))
draw.rounded_rectangle(B([bar_left, bar_top, bar_right, bar_bottom]), radius=16, fill=(*YELLOW, 255))
draw.text((shift(fu_cx), shift_y(fu_cy)), '浮', font=font_fu, fill=(*YELLOW, 255), anchor='mm')
draw.rounded_rectangle(B([ant_x0, ant_top, ant_x1, body_top]), radius=11, fill=(*DARK, 255))
draw.ellipse(B([ball_cx - ball_r, ant_top - ball_r * 2, ball_cx + ball_r, ant_top]), fill=(*DARK, 255))

badge.save('log/icon-preview-512.png')
for size in (128, 48, 32, 16):
    badge.resize((size, size), Image.LANCZOS).save(f'src/icons/icon-{size}.png')
    print('saved', f'src/icons/icon-{size}.png')
print('preview: log/icon-preview-512.png')
