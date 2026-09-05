#!/usr/bin/env python3
"""把 src/ 打包成可上传 Chrome Web Store 的 zip。

用法：python3 build.py
产物：dist/subtitle-translator-<版本>.zip
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'

version = json.loads((SRC / 'manifest.json').read_text(encoding='utf-8'))['version']
DIST.mkdir(exist_ok=True)
zip_path = DIST / f'subtitle-translator-{version}.zip'

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(SRC.rglob('*')):
        if f.is_file():
            zf.write(f, f.relative_to(SRC))
            print('  +', f.relative_to(SRC))

print(f'\n打包完成：{zip_path}')
print('Chrome 商店上传该 zip 即可；本地开发请直接"加载已解压的扩展程序"选择 src/ 目录。')
