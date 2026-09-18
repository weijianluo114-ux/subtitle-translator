#!/usr/bin/env python3
"""把 CMUdict 转换成扩展内置的离线英文音标词典。

用法：
    python3 tools/make_ipa_dict.py                 # 从 log/cmudict.tgz 读取，写出 src/data/ipa-en.tsv
    python3 tools/make_ipa_dict.py --dict /path/cmudict.dict
    python3 tools/make_ipa_dict.py --check         # 只校验已生成的 src/data/ipa-en.tsv

数据来源：CMUdict（cmusphinx/cmudict），BSD-2-Clause，Copyright (C) 1993-2015 Carnegie Mellon University。
本脚本只做 ARPAbet -> 美式 IPA 的确定性转换，不联网。

转换规则要点：
  1) ARPAbet -> IPA 符号表（ER0=ər / ER1=ɜːr / IY0=i / IY1=iː / UW0=u / UW1=uː，R=r，Y=j，G=ɡ）
  2) 重音符号 ˈ / ˌ 放在该音节「声母之前」（最大合法声母原则），例如 additional -> əˈdɪʃənəl（不是 ədˈɪʃənəl）
  3) 一个词出现多个主重音时（复合词），除最后一个外降为次重音：well-known -> ˌwelˈnoʊn
  4) 多音词默认保持 CMUdict 顺序；PREFER 表把高频歧义词的常用读音提到最前
"""
import argparse
import gzip
import io
import os
import re
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'data' / 'ipa-en.tsv'
DEFAULT_TGZ = ROOT / 'log' / 'cmudict.tgz'

# ---------------------------------------------------------------- 音素表
VOWELS = {
    'AA': 'ɑː', 'AE': 'æ', 'AH0': 'ə', 'AH1': 'ʌ', 'AH2': 'ʌ', 'AO': 'ɔː',
    'AW': 'aʊ', 'AY': 'aɪ', 'EH': 'e', 'ER0': 'ər', 'ER1': 'ɜːr', 'ER2': 'ɜːr',
    'EY': 'eɪ', 'IH': 'ɪ', 'IY0': 'i', 'IY1': 'iː', 'IY2': 'iː', 'OW': 'oʊ',
    'OY': 'ɔɪ', 'UH': 'ʊ', 'UW0': 'u', 'UW1': 'uː', 'UW2': 'uː',
}
CONSONANTS = {
    'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð', 'F': 'f', 'G': 'ɡ', 'HH': 'h',
    'JH': 'dʒ', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ', 'P': 'p',
    'R': 'r', 'S': 's', 'SH': 'ʃ', 'T': 't', 'TH': 'θ', 'V': 'v', 'W': 'w',
    'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
}
# 需要区分重音的元音（其余元音只有一种写法）
STRESSED_VOWELS = ('AH', 'ER', 'IY', 'UW')

# 合法声母（用于把重音符号放到声母前）
ONSETS = set(CONSONANTS.values()) | {'j', 'w'}
for _c in ['p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'm', 'n', 'h', 's', 'z', 'l', 'r', 'θ', 'ʃ', 'tʃ', 'dʒ']:
    ONSETS.add(_c + 'j')
for _s in ['p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'θ', 'ʃ']:
    for _l in ('l', 'r'):
        ONSETS.add(_s + _l)
for _l in ('l', 'r'):
    ONSETS.add('s' + _l)
ONSETS |= {'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'tw', 'dw', 'kw', 'ɡw', 'hw', 'tʃr', 'dʒr', 'ʃr'}
ONSETS |= {'spr', 'str', 'skr', 'spl', 'skl', 'skw', 'spj', 'stj', 'skj'}

# ---------------------------------------------------------------- 常用读音优先表
# 键 = 小写词；值 = 正则，命中该正则的读音会被提到第一位（正则锚定开头，避免 aɪ 里误命中 ɪ）
PREFER = {
    'read': r'^riːd',
    'live': r'^lɪv',
    'record': r'^ˈrek',
    'was': r'^wəz',
    'were': r'^wər',
    'does': r'^dʌz',
    'do': r'^duː',
    'use': r'^juːs',
    'used': r'^juːst',
    'present': r'^ˈprez',
    'object': r'^ˈɑːbdʒ',
    'project': r'^ˈprɑːdʒ',
    'produce': r'^prəˈduːs',
    'refuse': r'^rɪˈfjuːz',
    'close': r'^kloʊz',
    'wind': r'^wɪnd',
    'tear': r'^tɪr',
    'bow': r'^baʊ',
    'lead': r'^liːd',
    'minute': r'^ˈmɪn',
    'wound': r'^wuːnd',
    'bass': r'^beɪs',
    'desert': r'^ˈdez',
    'content': r'^ˈkɑːnt',
    'contract': r'^ˈkɑːntr',
    'address': r'^əˈdres',
    'either': r'^ˈiːð',
    'often': r'^ˈɔːfən',
    'route': r'^ruːt',
    'data': r'^ˈdeɪtə',
    'tomato': r'^təˈmeɪtoʊ',
    'schedule': r'^ˈskedʒuːl',
    'again': r'^əˈɡen',
    'garage': r'^ɡəˈrɑːʒ',
    'neither': r'^ˈniːð',
    'their': r'^ðer',
    'there': r'^ðer',
    'your': r'^jər',
    'our': r'^aʊ',
    'what': r'^wʌt',
    'been': r'^bɪn',
    'and': r'^ənd',
    'can': r'^kən',
    'have': r'^həv',
    'has': r'^həz',
    'had': r'^həd',
    'of': r'^əv',
    'to': r'^tə',
    'for': r'^fər',
    'sure': r'^ʃʊr',
    'poor': r'^pʊr',
    'tour': r'^tʊr',
    'figure': r'^ˈfɪɡjər',
    'comfortable': r'^ˈkʌmftərbəl',
    'vegetable': r'^ˈvedʒtəbəl',
    'interesting': r'^ˈɪntrəstɪŋ',
    'february': r'^ˈfebju',
    'economic': r'^ˌek',
    'envelope': r'^ˈenv',
    'adult': r'^əˈdʌlt',
    'leisure': r'^ˈliːʒ',
    'missile': r'^ˈmɪsəl',
    'says': r'^sez',
    'said': r'^sed',
}

MAX_VARIANTS = 4          # 每个词最多保留几个读音
WORD_RE = re.compile(r"^[a-z][a-z'\-]*$")
PHONE_RE = re.compile(r'^([A-Z]+)([0-2])?$')
# 生成结果允许出现的字符（用于 --check 自检）
ALLOWED_CHARS = set('abcdefghijklmnopqrstuvwxyz-\'ɑæəʌɔaʊɪeɜrɛioʊuʊʃʒθðŋɡtʃdʒˈˌː ')


def phones_to_ipa(phones: str):
    """ARPAbet 串 -> 带重音符号的 IPA；无法转换返回 None。"""
    seq = []
    for p in phones.split():
        m = PHONE_RE.match(p)
        if not m:
            return None
        base, stress = m.group(1), m.group(2) or '0'
        if base in CONSONANTS:
            seq.append(('C', CONSONANTS[base], None))
            continue
        key = base + stress if base in STRESSED_VOWELS else base
        if key not in VOWELS:
            return None
        seq.append(('V', VOWELS[key], stress))
    vowel_pos = [i for i, t in enumerate(seq) if t[0] == 'V']
    if not vowel_pos:
        return ''.join(t[1] for t in seq)
    primary = [i for i in vowel_pos if seq[i][2] == '1']
    demote = set(primary[:-1]) if len(primary) > 1 else set()
    out = []
    for idx, pos in enumerate(vowel_pos):
        prev = vowel_pos[idx - 1] if idx > 0 else -1
        cons = [seq[k][1] for k in range(prev + 1, pos)]
        take = 0
        for n in range(len(cons), 0, -1):
            if n == 1 or ''.join(cons[-n:]) in ONSETS:
                take = n
                break
        out.extend(cons[:len(cons) - take])          # 前一音节的韵尾
        stress = seq[pos][2]
        if pos in demote:
            out.append('ˌ')
        elif stress == '1':
            out.append('ˈ')
        elif stress == '2':
            out.append('ˌ')
        out.extend(cons[len(cons) - take:])          # 本音节声母
        out.append(seq[pos][1])
    out.extend(seq[k][1] for k in range(vowel_pos[-1] + 1, len(seq)))
    return ''.join(out)


def build(dict_path: Path):
    entries = {}
    failed = 0
    for line in dict_path.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = line.strip()
        if not line or line.startswith(';;;'):
            continue
        parts = line.split(' ')
        word = parts[0].split('(')[0].lower()
        if not WORD_RE.match(word):
            continue
        ipa = phones_to_ipa(' '.join(parts[1:]))
        if not ipa:
            failed += 1
            continue
        variants = entries.setdefault(word, [])
        if ipa not in variants and len(variants) < MAX_VARIANTS:
            variants.append(ipa)
    # 常用读音优先表
    for word, pattern in PREFER.items():
        variants = entries.get(word)
        if not variants or len(variants) < 2:
            continue
        rx = re.compile('^[ˈˌ]?' + pattern.lstrip('^'))
        hit = [v for v in variants if rx.match(v)]
        if hit:
            entries[word] = hit + [v for v in variants if v not in hit]
    return entries, failed


def write_tsv(entries: dict, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        '# CMUdict-derived US English IPA. Source: cmusphinx/cmudict (BSD-2-Clause,',
        '# Copyright (C) 1993-2015 Carnegie Mellon University). See THIRD_PARTY_NOTICES.md.',
        '# Format: word<TAB>ipa1;ipa2;...   Generated by tools/make_ipa_dict.py — do not edit by hand.',
    ]
    for word in sorted(entries):
        lines.append(word + '\t' + ';'.join(entries[word]))
    data = ('\n'.join(lines) + '\n').encode('utf-8')
    out_path.write_bytes(data)
    return len(data)


def load_cmudict(args) -> Path:
    if args.dict:
        p = Path(args.dict)
        if not p.is_file():
            sys.exit(f'找不到 cmudict.dict：{p}')
        return p
    tgz = Path(args.tgz)
    if not tgz.is_file():
        sys.exit(f'找不到 {tgz}；请先下载 cmusphinx/cmudict 的 tar.gz，或用 --dict 指定 cmudict.dict')
    tmp = ROOT / 'log' / '_cmudict_extract'
    tmp.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz, 'r:gz') as tf:
        for member in tf.getmembers():
            if member.name.endswith('cmudict.dict'):
                tf.extract(member, tmp)
                return tmp / member.name
    sys.exit(f'{tgz} 里没有 cmudict.dict')


def check(out_path: Path = OUT):
    """自检：词条数、样本词、字符合法性、体积。"""
    if not out_path.is_file():
        sys.exit(f'✗ 缺少 {out_path}，请先运行 python3 tools/make_ipa_dict.py')
    raw = out_path.read_bytes()
    entries = {}
    for line in raw.decode('utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        word, _, ipas = line.partition('\t')
        entries[word] = ipas.split(';')
    problems = []
    if len(entries) < 100000:
        problems.append(f'词条数偏少：{len(entries)}（期望 > 100000）')
    samples = {
        'additional': 'əˈdɪʃənəl', 'sentiment': 'ˈsentəmənt', 'beautiful': 'ˈbjuːtəfəl',
        'well-known': 'ˌwelˈnoʊn', 'afternoon': 'ˌæftərˈnuːn', 'live': 'ˈlɪv',
        'read': 'ˈriːd', 'record': 'ˈrekərd', 'was': 'wəz', 'the': 'ðə',
    }
    for word, expect in samples.items():
        got = entries.get(word)
        if not got:
            problems.append(f'缺少样本词：{word}')
        elif got[0] != expect:
            problems.append(f'{word} 首选读音为 {got[0]}，期望 {expect}')
    for word, ipas in entries.items():
        if not WORD_RE.match(word):
            problems.append(f'非法词条：{word}')
            break
        for ipa in ipas:
            bad = set(ipa) - ALLOWED_CHARS
            if bad or not ipa:
                problems.append(f'{word} 音标含非法字符 {bad!r}：{ipa}')
                break
    print(f'词条数：{len(entries)}   读音总数：{sum(len(v) for v in entries.values())}')
    print(f'文件体积：{len(raw) / 1024:.0f} KB（zip 内约 {len(gzip.compress(raw, 9)) / 1024:.0f} KB）')
    if problems:
        print('✗ 自检失败：')
        for p in problems[:20]:
            print('   -', p)
        return 1
    print('✓ 自检通过')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dict', help='cmudict.dict 路径')
    ap.add_argument('--tgz', default=str(DEFAULT_TGZ), help='cmudict tar.gz 路径（默认 log/cmudict.tgz）')
    ap.add_argument('--out', default=str(OUT), help='输出 TSV 路径')
    ap.add_argument('--check', action='store_true', help='只校验已生成的 TSV')
    args = ap.parse_args()

    if args.check:
        sys.exit(check(Path(args.out)))

    dict_path = load_cmudict(args)
    entries, failed = build(dict_path)
    size = write_tsv(entries, Path(args.out))
    print(f'源文件：{dict_path}')
    print(f'词条数：{len(entries)}   读音总数：{sum(len(v) for v in entries.values())}   转换失败行：{failed}')
    print(f'已写出：{args.out}   {size / 1024:.0f} KB（zip 内约 {len(gzip.compress(Path(args.out).read_bytes(), 9)) / 1024:.0f} KB）')
    for word in ('additional', 'beautiful', 'well-known', 'live', 'read', 'record', 'was'):
        if word in entries:
            print(f'  {word:12s} ' + ' | '.join('/' + v + '/' for v in entries[word][:2]))
    sys.exit(check(Path(args.out)))


if __name__ == '__main__':
    main()
