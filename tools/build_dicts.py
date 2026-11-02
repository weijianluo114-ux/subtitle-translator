#!/usr/bin/env python3
"""生成可选的离线词典包（分片 + 清单），供扩展按需下载。

产物：
    dicts/catalog.json            词典清单（id / 名称 / 许可 / 条目数 / 分片 sha256）
    dicts/<id>/<bucket>.tsv.gz    32 个 hash 分片，每片 gzip（扩展用 DecompressionStream 解压）

分片规则：bucket = fnv1a(lowercase key) % 32，与 src/dict.js 的 bucketOf() 必须一致。

源数据（均缓存到 log/dict/，不入库）：
    ECDICT          https://github.com/skywind3000/ECDICT        MIT
    CC-CEDICT       https://www.mdbg.net/chinese/export/cedict/  CC BY-SA 4.0
    WordNet 3.1     https://wordnet.princeton.edu/               WordNet License

用法：
    python3 tools/build_dicts.py              # 只用已缓存源文件，缺了就报错
    python3 tools/build_dicts.py --download    # 允许联网下载源文件
    python3 tools/build_dicts.py --only ecdict # 只重建某个词典
"""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'log', 'dict')
OUT = os.path.join(ROOT, 'dicts')
BUCKETS = 32

SOURCES = {
    'ecdict': {
        'url': 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
        'path': os.path.join(CACHE, 'ecdict.csv'),
    },
    'cedict': {
        'url': 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
        'path': os.path.join(CACHE, 'src', 'cedict.txt.gz'),
    },
    'wordnet': {
        'url': 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz',
        'path': os.path.join(CACHE, 'src', 'wn3.1.dict.tar.gz'),
    },
}


def fnv1a(text):
    h = 0x811c9dc5
    for ch in text:
        h ^= ord(ch) & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    # 只取低 8 位的稳定性：这里对 UTF-8 的每个字节做一遍，避免丢高位
    return h


def key_hash(text):
    """与 src/dict.js 的 keyHash() 完全一致的 FNV-1a（逐 UTF-16 码元，取 32 位）。"""
    h = 0x811c9dc5
    for i in range(len(text)):
        h ^= ord(text[i]) & 0xFFFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def bucket_of(key):
    return '%02x' % (key_hash(key) % BUCKETS)


def clean(text):
    text = (text or '').replace('\\n', '；').replace('\n', '；').replace('\r', '；')
    text = re.sub(r'；+', '；', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip('； ')


def cap(text, limit):
    return text if len(text) <= limit else text[:limit].rstrip('； ') + '…'


# ---------------------------------------------------------------- 各词典候选
def read_ecdict():
    """ECDICT → (key, gloss)。按词频降序，保证同形词取最常用的释义。"""
    csv.field_size_limit(10**9)
    rows = []
    with open(SOURCES['ecdict']['path'], encoding='utf-8', errors='ignore', newline='') as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) < 11:
                continue
            word = row[0].strip()
            if not word or len(word) > 40 or ' ' in word:
                continue
            if not re.match(r"^[A-Za-z][A-Za-z'\-]*$", word):
                continue
            gloss = clean(row[3])
            if not gloss:
                continue
            try:
                frq = int(row[9] or 0)
            except ValueError:
                frq = 0
            try:
                bnc = int(row[8] or 0)
            except ValueError:
                bnc = 0
            try:
                collins = int(row[5] or 0)
            except ValueError:
                collins = 0
            rows.append((frq, bnc, collins, word, gloss))
    rows.sort(key=lambda x: (-x[0], -x[1], -x[2]))
    return [(word.lower(), cap(gloss, 320)) for frq, bnc, collins, word, gloss in rows]


def read_cedict():
    """CC-CEDICT → (中文词, '拼音\t释义')"""
    out = []
    with gzip.open(SOURCES['cedict']['path'], 'rt', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip() or line.startswith('#'):
                continue
            m = re.match(r'^(\S+)\s+(\S+)\s+\[(.+?)\]\s+/(.+)/\s*$', line.rstrip())
            if not m:
                continue
            trad, simp, pinyin, defs = m.groups()
            gloss = clean('；'.join(d for d in defs.split('/') if d))
            if not gloss:
                continue
            body = pinyin.replace('u:', 'ü') + '\t' + cap(gloss, 300)
            out.append((simp, body))
            if trad != simp:
                out.append((trad, body))
    return out


def read_wordnet():
    """WordNet 3.1 → (英文词, 'pos\t英文释义')"""
    src = SOURCES['wordnet']['path']
    tmp = os.path.join(CACHE, 'src', 'wn')
    if not os.path.isdir(os.path.join(tmp, 'dict')):
        os.makedirs(tmp, exist_ok=True)
        with tarfile.open(src, 'r:gz') as tf:
            tf.extractall(tmp)
    pos_names = {'n': 'n.', 'v': 'v.', 'a': 'adj.', 's': 'adj.', 'r': 'adv.'}
    out = []
    for fname in ('data.noun', 'data.verb', 'data.adj', 'data.adv'):
        path = os.path.join(tmp, 'dict', fname)
        if not os.path.exists(path):
            continue
        for line in open(path, encoding='utf-8', errors='ignore'):
            if not line.strip() or line.startswith('  '):
                continue
            body_part, _, gloss_part = line.rstrip('\n').partition('|')
            head = body_part.split()
            gloss = clean(gloss_part)
            if len(head) < 5 or not gloss:
                continue
            try:
                wcnt = int(head[3], 16)
            except ValueError:
                continue
            words, idx = [], 4
            for _ in range(wcnt):
                if idx + 1 >= len(head):
                    break
                lemma = head[idx]
                idx += 2
                lemma = lemma.replace('_', ' ')
                lemma = re.sub(r'\([^)]*\)', '', lemma).strip()
                if lemma and ' ' not in lemma and re.match(r"^[A-Za-z][A-Za-z'\-]*$", lemma):
                    words.append(lemma.lower())
            pos = pos_names.get(head[2], head[2])
            for word in words:
                out.append((word, pos + '\t' + cap(gloss, 260)))
    return out


READERS = {'ecdict': read_ecdict, 'cedict': read_cedict, 'wordnet': read_wordnet}

CATALOG = {
    'ecdict': {
        'name': 'ECDICT 英汉词典',
        'nameEn': 'ECDICT (English–Chinese)',
        'license': 'MIT',
        'source': 'https://github.com/skywind3000/ECDICT',
        'lang': 'en',
        'role': 'primary',
        'desc': '最全的开源英汉词典：40 万词条，含词性、中文释义与专业术语。',
        'descEn': 'The most complete open English–Chinese dictionary: 400k entries with part of speech, Chinese glosses and technical terms.',
    },
    'wordnet': {
        'name': 'WordNet 3.1 英英词典',
        'nameEn': 'WordNet 3.1 (English–English)',
        'license': 'WordNet License',
        'source': 'https://wordnet.princeton.edu/',
        'lang': 'en',
        'role': 'backup',
        'desc': '普林斯顿大学 WordNet：8.2 万英文词，英英释义（ECDICT 查不到时兜底）。',
        'descEn': 'Princeton WordNet: 82k English words with English definitions (fallback when ECDICT has no entry).',
    },
    'cedict': {
        'name': 'CC-CEDICT 汉英词典',
        'nameEn': 'CC-CEDICT (Chinese–English)',
        'license': 'CC BY-SA 4.0',
        'source': 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
        'lang': 'zh',
        'role': 'backup',
        'desc': '社区维护的汉英词典：20 万词条（简繁同收），含拼音与英文释义，用于中文字幕。',
        'descEn': 'Community-maintained Chinese–English dictionary: 200k entries (simplified + traditional) with pinyin and English glosses, for Chinese subtitles.',
    },
}


def build_one(dict_id, entries):
    """写出分片并返回清单条目。"""
    seen = {}
    for key, body in entries:
        key = key.strip()
        if not key or not body:
            continue
        body = str(body).replace('\t', ' ').replace('\n', ' ')
        if key not in seen:
            seen[key] = body            # 先到先得（源文件已按优先级排序）
    shards = collections.defaultdict(list)
    for key in sorted(seen):
        shards[bucket_of(key)].append(key + '\t' + seen[key])

    out_dir = os.path.join(OUT, dict_id)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    info = {}
    total_raw = total_gz = 0
    for bucket in sorted(shards):
        raw = ('\n'.join(shards[bucket]) + '\n').encode('utf-8')
        gz = gzip.compress(raw, 9, mtime=0)
        with open(os.path.join(out_dir, bucket + '.tsv.gz'), 'wb') as f:
            f.write(gz)
        info[bucket] = {'entries': len(shards[bucket]), 'raw': len(raw), 'bytes': len(gz),
                        'sha256': hashlib.sha256(gz).hexdigest()}
        total_raw += len(raw)
        total_gz += len(gz)
    print(f'  {dict_id}: {len(seen)} 词条 / {len(shards)} 分片 / {total_gz / 1024 / 1024:.2f} MB gz')
    return {'entries': len(seen), 'bytes': total_gz, 'rawBytes': total_raw, 'shards': info}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--download', action='store_true', help='缺少源文件时联网下载')
    ap.add_argument('--only', help='只重建指定词典（ecdict/cedict/wordnet）')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    for sid, spec in SOURCES.items():
        if not os.path.exists(spec['path']):
            if not args.download:
                sys.exit(f'缺少源文件 {spec["path"]}；加 --download 重新下载')
            os.makedirs(os.path.dirname(spec['path']), exist_ok=True)
            print(f'下载 {sid}: {spec["url"]}')
            urllib.request.urlretrieve(spec['url'], spec['path'])

    targets = [args.only] if args.only else list(CATALOG)
    catalog_path = os.path.join(OUT, 'catalog.json')
    catalog = {'version': 1, 'buckets': BUCKETS, 'cdn': 'https://cdn.jsdelivr.net/gh/weijianluo114-ux/subtitle-translator@dict-v1/dicts',
               'dicts': {}}
    if os.path.exists(catalog_path):
        try:
            old = json.load(open(catalog_path, encoding='utf-8'))
            catalog['dicts'].update(old.get('dicts') or {})
        except (ValueError, OSError):
            pass

    for dict_id in targets:
        print(f'构建 {dict_id} ...')
        info = build_one(dict_id, READERS[dict_id]())
        meta = dict(CATALOG[dict_id])
        meta.update(info)
        meta['buckets'] = BUCKETS
        catalog['dicts'][dict_id] = meta
    catalog['dicts'] = dict(sorted(catalog['dicts'].items()))
    with open(catalog_path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('清单写入', catalog_path)

    # 扩展包里也放一份清单（src/data/dict-catalog.json），后台据此校验分片 sha256
    data_dir = os.path.join(ROOT, 'src', 'data')
    os.makedirs(data_dir, exist_ok=True)
    shipped = os.path.join(data_dir, 'dict-catalog.json')
    with open(shipped, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('清单副本写入', shipped)


if __name__ == '__main__':
    main()
