#!/usr/bin/env python3
"""生成扩展图标：蓝绿渐变对讲机，左右为「浮」与「T」，中间传输波纹，无外边框。
运行：python3 tools/make_icons.py
输出：src/icons/icon-{16,32,48,128}.png 与 log/icon-preview-512.png
"""
from PIL import Image, ImageDraw, ImageFont

S = 512
C1 = (14, 165, 233)   # 左上 亮蓝 #0EA5E9
C2 = (16, 185, 129)   # 右下 翠绿 #10B981
BLACK = (0, 0, 0, 255)

# 1) 对角渐变底
grad = Image.new('RGB', (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * (S - 1))
        px[x, y] = (
            round(C1[0] + (C2[0] - C1[0]) * t),
            round(C1[1] + (C2[1] - C1[1]) * t),
            round(C1[2] + (C2[2] - C1[2]) * t),
        )

# 2) 对讲机剪影（透明背景，无外边框）
mask = Image.new('L', (S, S), 0)
d = ImageDraw.Draw(mask)
def rr(x0, y0, x1, y1, r):
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)

# 左右机身
rr(40, 180, 224, 404, 52)
rr(288, 180, 472, 404, 52)
# 天线杆
rr(122, 76, 142, 180, 10)
rr(370, 76, 390, 180, 10)
# 天线顶端小球
d.ellipse([116, 52, 148, 84], fill=255)
d.ellipse([364, 52, 396, 84], fill=255)

icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(icon)

# 3) 传输波纹（中间，黑色，向右张开 = 左 → 右传输）
for r in (26, 38, 50):
    draw.arc([256 - r, 292 - r, 256 + r, 292 + r], start=300, end=60, fill=BLACK, width=10)

# 4) 底部旋钮（黑色）
draw.ellipse([122, 358, 142, 378], fill=BLACK)
draw.ellipse([370, 358, 390, 378], fill=BLACK)

# 5) 左右黑字：浮 / T（微软雅黑粗体）
font_fu = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', 116, index=0)
font_t = ImageFont.truetype('/mnt/c/Windows/Fonts/msyhbd.ttc', 136, index=0)
draw.text((132, 288), '浮', font=font_fu, fill=BLACK, anchor='mm')
draw.text((380, 288), 'T', font=font_t, fill=BLACK, anchor='mm')

# 6) 预览 + 多尺寸输出
icon.save('log/icon-preview-512.png')
for size in (128, 48, 32, 16):
    icon.resize((size, size), Image.LANCZOS).save(f'src/icons/icon-{size}.png')
    print('saved', f'src/icons/icon-{size}.png')
print('preview: log/icon-preview-512.png')
