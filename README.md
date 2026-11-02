# dict-v1 — 字幕整行翻译 / Subtitle Line Translator 的可选离线词典包

本分支**只存放词典数据**（orphan 分支，无源码、无历史），供扩展按需下载：

    https://cdn.jsdelivr.net/gh/weijianluo114-ux/subtitle-translator@dict-v1/dicts/

目录结构：

    dicts/catalog.json                 清单：条目数 / 字节数 / 每片 sha256
    dicts/<dictId>/<bucket>.tsv.gz     32 个 hash 分片，gzip，每行 "key<TAB>body"

| id | 词典 | 词条 | 许可 | 来源 |
| --- | --- | --- | --- | --- |
| ecdict | ECDICT（英汉，主选） | 401,606 | MIT | https://github.com/skywind3000/ECDICT |
| wordnet | WordNet 3.1（英英） | 82,810 | WordNet License | https://wordnet.princeton.edu/ |
| cedict | CC-CEDICT（汉英） | 198,553 | CC BY-SA 4.0 | https://www.mdbg.net/chinese/dictionary?page=cc-cedict |

分片规则：bucket = fnv1a_utf16(key.toLowerCase()) % 32，两位十六进制。

数据由主仓库 tools/build_dicts.py 生成（可复现）。扩展端逐片校验 sha256 后才写入本地 IndexedDB。
