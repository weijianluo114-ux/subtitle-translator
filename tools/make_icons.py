#!/usr/bin/env python3
"""扩展图标 v7：对讲机整体放大至紧贴外框（占据徽章内约 94%），并自动居中。
所有内部尺寸按「浮」字号比例缩放，两遍计算保证刚好贴合。
"""
from PIL import Image, ImageDraw, ImageFont

S = 512
YELLOW = (255, 238, 84)
GREEN = (16, 185, 129)
DARK = (17, 24, 39)
BORDER = (31, 41, 55)
INNER = [34, 34, 478, 478]  # 徽章外框内侧安全区

def layout(fu_size, fu_cx=0, fu_cy=0):
    font = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', fu_size, index=0)
    # 临时画布用于量字
    tmp = Image.new('RGBA', (8, 8))
    d = ImageDraw.Draw(tmp)
    bb = d.textbbox((0, 0), '浮', font=font, anchor='mm')
    fu_left = fu_cx + bb[0]
    fu_top = fu_cy + bb[1]
    fu_right = fu_cx + bb[2]
    fu_bottom = fu_cy + bb[3]
    fu_w = fu_right - fu_left

    bar_h = 0.28 * fu_size
    bar_gap = 0.12 * fu_size
    bar_left = fu_cx - 0.15 * fu_size
    bar_right = fu_right + fu_w / 3
    bar_bottom = fu_top - bar_gap
    bar_top = bar_bottom - bar_h

    pad_x = 0.17 * fu_size
    pad_top = 0.14 * fu_size
    pad_bottom = 0.15 * fu_size
    body_left = min(fu_left, bar_left) - pad_x
    body_right = max(fu_right, bar_right) + pad_x
    body_top = bar_top - pad_top
    body_bottom = fu_bottom + pad_bottom
    body_r = 0.30 * fu_size

    ant_w = 0.12 * fu_size
    ant_x0 = body_right - 0.22 * fu_size
    ant_x1 = ant_x0 + ant_w
    ant_top = body_top - 0.22 * fu_size
    ball_r = 0.08 * fu_size
    ball_cx = ant_x0 + ant_w / 2
    ball_top = ant_top - ball_r * 2

    comp_left = min(body_left, fu_left, bar_left)
    comp_right = max(body_right, fu_right, bar_right)
    comp_top = min(body_top, ball_top)
    comp_bottom = max(body_bottom, fu_bottom)
    return dict(font=font, fu_cx=fu_cx, fu_cy=fu_cy,
                fu_left=fu_left, fu_top=fu_top, fu_right=fu_right, fu_bottom=fu_bottom,
                bar_left=bar_left, bar_top=bar_top, bar_right=bar_right, bar_bottom=bar_bottom,
                body_left=body_left, body_top=body_top, body_right=body_right, body_bottom=body_bottom,
                body_r=body_r, ant_x0=ant_x0, ant_x1=ant_x1, ant_top=ant_top,
                ball_cx=ball_cx, ball_top=ball_top, ball_r=ball_r,
                comp_left=comp_left, comp_right=comp_right, comp_top=comp_top, comp_bottom=comp_bottom)

# 第一遍：用 200 号字估算尺寸，求出放大倍率
L0 = layout(200)
inner_w = INNER[2] - INNER[0]
inner_h = INNER[3] - INNER[1]
comp_w0 = L0['comp_right'] - L0['comp_left']
comp_h0 = L0['comp_bottom'] - L0['comp_top']
scale = min(inner_w * 0.96 / comp_w0, inner_h * 0.96 / comp_h0)
fu_size = max(60, round(200 * scale))

# 第二遍：最终布局（先以 (0,0) 计算，再平移到徽章中心）
L = layout(fu_size)
dx = S / 2 - (L['comp_left'] + L['comp_right']) / 2
dy = S / 2 - (L['comp_top'] + L['comp_bottom']) / 2

# 徽章
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

X = lambda v: v + dx
Y = lambda v: v + dy
R = lambda a, b, c, d: [X(a), Y(b), X(c), Y(d)]

draw.rounded_rectangle(R(L['body_left'], L['body_top'], L['body_right'], L['body_bottom']),
                       radius=L['body_r'], fill=(*DARK, 255))
draw.rounded_rectangle(R(L['bar_left'], L['bar_top'], L['bar_right'], L['bar_bottom']),
                       radius=0.10 * fu_size, fill=(*YELLOW, 255))
draw.text((X(L['fu_cx']), Y(L['fu_cy'])), '浮', font=L['font'], fill=(*YELLOW, 255), anchor='mm')
draw.rounded_rectangle(R(L['ant_x0'], L['ant_top'], L['ant_x1'], L['body_top']),
                       radius=0.075 * fu_size, fill=(*DARK, 255))
draw.ellipse(R(L['ball_cx'] - L['ball_r'], L['ant_top'] - L['ball_r'] * 2, L['ball_cx'] + L['ball_r'], L['ant_top']),
             fill=(*DARK, 255))

badge.save('log/icon-preview-512.png')
for size in (128, 48, 32, 16):
    badge.resize((size, size), Image.LANCZOS).save(f'src/icons/icon-{size}.png')
    print('saved', f'src/icons/icon-{size}.png')
print('preview: log/icon-preview-512.png | fu_size =', fu_size, '| scale =', round(scale, 3))
