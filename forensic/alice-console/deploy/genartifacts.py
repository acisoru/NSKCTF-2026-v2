#!/usr/bin/env python3
"""Генератор архива: артефакты (≥100), правильный один, flag-заглушка, дерево папок.

Дизайн приманок (spec п.5 — ≥20 ложных улик на каждую отличительную черту):
- ~24 decoy с owner=mr.x, ~30 с status=restored, ~40 с admission=000, ~30 с chain 2018–2019;
- 7 near-miss decoy: все 4 meta-условия сразу, но sha256 в meta НЕ сходится с фактическим
  («устаревшая контрольная сумма») — дискриминатор ровно один: сходящийся sha256.
Инвариант в конце: ровно одна папка удовлетворяет всем пяти условиям.
"""
import hashlib
import json
import os
import random
import sys

ART = sys.argv[1] if len(sys.argv) > 1 else '/home/archive/artifacts'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 120
FLAG = sys.argv[3] if len(sys.argv) > 3 else 'nskctf{th4_2rch1v4_h2s_b44n_r2154d}'
SEED = int(sys.argv[4]) if len(sys.argv) > 4 else 20181030

rng = random.Random(SEED)
os.makedirs(ART, exist_ok=True)

FIRST = ['кассета', 'журнал', 'смена', 'срез', 'сигнал', 'плёнка', 'отчёт', 'запись', 'лента', 'манифест']
SRC = ['camera-07', 'operator-console', 'sensor-grid', 'shift-log', 'perimeter', 'power-monitor']
TAGS = ['archive', 'gap', '2018', '2019', 'revision', 'restored', 'quarantine', 'intake', 'verified']
OWNERS = ['a.petrova', 's.ivanov', 'd.kuznetsov', 'archive-bot', 'observer', 'm.elliott', 'l.chen', 'r.octavo']
STATUSES = ['indexed', 'damaged', 'partial', 'pending', 'degraded', 'quarantined']

NEAR_MISS = 7  # decoy со всеми meta-условиями, но битым sha256


def chain_for(year_a, year_b=None):
    year_b = year_a if year_b is None else year_b
    return [f'{year_a}-04-{rng.randint(10, 28):02d}T{rng.randint(10, 19):02d}:12:04Z',
            f'{year_b}-09-{rng.randint(10, 28):02d}T{rng.randint(10, 19):02d}:41:00Z']


def write_artifact(folder, body, ext, meta_over=None):
    fname = f'artifact.{ext}'
    with open(os.path.join(folder, fname), 'wb') as f:
        f.write(body)
    meta = {
        'id': os.path.basename(folder),
        'title': rng.choice(FIRST).capitalize() + ' ' + rng.choice(['№' + str(rng.randint(3, 97)), 'серии X', 'протокола', 'обзора']),
        'source': rng.choice(SRC),
        'timestamp': f'{rng.choice([2018, 2019])}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}T{rng.randint(0, 23):02d}:00:00Z',
        'sha256': hashlib.sha256(body).hexdigest(),
        'size': len(body),
        'mime': 'text/plain' if ext in ('log', 'txt') else 'application/octet-stream',
        'tags': rng.sample(TAGS, rng.randint(2, 4)),
        'status': rng.choice(STATUSES),
        'admission': rng.choice(['001', '002', '003', '017', '101']),
        'owner': rng.choice(OWNERS),
        'chain': chain_for(rng.choice([2017, 2018, 2019, 2020])),
        'notes': rng.choice(['целостность не проверена', 'передан в ревизию', 'дубликат снят', 'пометка фильтра: threat', '']),
    }
    if meta_over:
        meta.update(meta_over)
    with open(os.path.join(folder, 'meta.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2, sort_keys=True)
    return meta


def body_for(i, real=False):
    if real:
        return ('ЗАПИСЬ ВОССТАНОВЛЕНА\n'
                'оператор: mr. X\nдопуск: 000\n'
                'период наблюдения: 2018-04-19 — 2019-10-30 (559 суток)\n'
                'правило отделения: любой результат считается результатом\n'
                'подпись: X\n').encode('utf-8')
    r = random.Random(SEED * 1000 + i)
    lines = [f'AUDIT TRAIL {r.randint(1000, 9999)}']
    for _ in range(r.randint(6, 20)):
        lines.append(f'{r.choice(SRC)}::{r.randint(100, 999)}::{r.choice(["ok", "skip", "hold", "sig"])}::{r.randint(2018, 2019)}-{r.randint(1, 12):02d}-{r.randint(1, 28):02d}')
    return ('\n'.join(lines) + '\n').encode('utf-8')


# правильный артефакт: детерминированная позиция
real_idx = rng.randrange(N)
folders = []
for i in range(N):
    name = f'ART-{rng.getrandbits(48):012x}'
    folder = os.path.join(ART, name)
    os.makedirs(folder, exist_ok=True)
    folders.append((i, folder))

for i, folder in folders:
    if i == real_idx:
        write_artifact(folder, body_for(i, real=True), 'log', {
            'title': 'Запись наблюдательная',
            'source': 'observation-room',
            'timestamp': '2019-10-30T06:00:00Z',
            'status': 'restored',
            'admission': '000',
            'owner': 'mr.x',
            'chain': ['2018-04-19T00:00:00Z', '2019-10-30T00:00:00Z'],
            'notes': 'полная цепочка; контрольная сумма сверена архивом',
            'tags': ['gap', 'restored', '000'],
        })
        continue
    decoy_no = i if i < real_idx else i - 1  # номер среди decoy (0..N-2)
    body = body_for(i)
    over = {}
    if decoy_no % 5 == 0:
        over['owner'] = 'mr.x'          # ~24 ложных owner=mr.x
    if decoy_no % 4 == 0:
        over['status'] = 'restored'     # ~30 ложных restored
    if decoy_no % 3 == 0:
        over['admission'] = '000'       # ~40 ложных admission=000
    if decoy_no % 4 == 1:
        over['chain'] = chain_for(2018, 2019)  # ~30 ложных chain 2018–2019
    if decoy_no < NEAR_MISS:
        # near-miss: все meta-условия, sha256 «устарел» (не равен фактическому)
        over.update({
            'owner': 'mr.x',
            'status': 'restored',
            'admission': '000',
            'chain': chain_for(2018, 2019),
            'sha256': hashlib.sha256(body + b'stale').hexdigest(),
            'notes': 'контрольная сумма не сверялась после переноса',
        })
    write_artifact(folder, body, rng.choice(['log', 'txt', 'bin']), over)

# flag: файл создаётся на build-стадии (права выставляет Dockerfile)
FLAG_PATH = '/var/lib/alice/flag'
os.makedirs(os.path.dirname(FLAG_PATH), exist_ok=True)
dst = os.open(FLAG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.write(dst, FLAG.encode())
os.close(dst)

for sub in ['home/user', 'home/mr.x', 'etc/alice', 'opt/alice', 'var/log/alice']:
    os.makedirs('/' + sub, exist_ok=True)
os.chmod('/home/archive', 0o755)
os.chmod('/home/user', 0o755)
os.chmod('/home/mr.x', 0o755)
os.chmod('/var/lib/alice', 0o755)
with open('/etc/alice/archive.conf', 'w') as f:
    f.write('# ALICE archive node\nmode=observe\nintegrity=sha256\nadmission_audit=on\n')
with open('/var/log/alice/restore.log', 'w') as f:
    f.write('2019-10-30 восстановление журнала: первый импульс\n2025-08-12 аномалия #1: подпись X\n2026-11-07 ревизия периметра завершена\n')
with open('/opt/alice/manifest.txt', 'w') as f:
    f.write('ALICE archive node manifest\nstorage=/home/archive/artifacts\ntool=/bin/alice-auth\n')

# инварианты
import glob
good = []
cnt = {'owner': 0, 'status': 0, 'adm': 0, 'chain': 0, 'nearmiss': 0}
for mf in glob.glob(os.path.join(ART, '*', 'meta.json')):
    m = json.load(open(mf))
    art = glob.glob(os.path.join(os.path.dirname(mf), 'artifact.*'))[0]
    h = hashlib.sha256(open(art, 'rb').read()).hexdigest()
    is000 = m['admission'] == '000'
    isx = m['owner'] == 'mr.x'
    isrest = m['status'] == 'restored'
    ischain = str(m['chain'][0]).startswith('2018') and str(m['chain'][-1]).startswith('2019')
    ishash = m['sha256'] == h
    cnt['owner'] += isx
    cnt['status'] += isrest
    cnt['adm'] += is000
    cnt['chain'] += ischain
    if is000 and isx and isrest and ischain and ishash:
        good.append(m['id'])
    if is000 and isx and isrest and ischain and not ishash:
        cnt['nearmiss'] += 1

assert len(good) == 1, f'инвариант нарушен: {good}'
assert cnt['owner'] >= 21 and cnt['status'] >= 21 and cnt['adm'] >= 21 and cnt['chain'] >= 21, cnt
assert cnt['nearmiss'] == NEAR_MISS, cnt
print(f'OK: {N} артефактов, правильный: {good[0]}, приманки: {cnt}')
