import html
import json
import os
import secrets
import socket
import struct
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import bcrypt

from captcha import new_code, render as render_captcha

HASH = Path('/web-secret/hash').read_bytes()
FLAG = Path('/web-secret/flag').read_text().strip()
SOCKET = '/run/alice/logfmt.sock'
SESSIONS = {}
ATTEMPTS = defaultdict(deque)
LOCK = threading.Lock()
CAPTCHA_ENABLED = os.environ.get('PWN_CAPTCHA', '1') not in ('0', 'false', 'no')
CAPTCHA_TEST_TOKEN = os.environ.get('PWN_CAPTCHA_TEST_TOKEN', '')
CAPTCHA_TTL = 120.0
HUMAN_TTL = 300.0

LOGS = [
    {'id': 1, 'date': '2018-04-19', 'code': 'POWER LOSS', 'severity': 'critical', 'origin': 'CORE-01',
     'title': 'Наблюдение прервано', 'summary': 'Канал ALICE молчит. Последний пакет получен в 03:41.',
     'detail': 'Питание лабораторного контура пропало без предупреждения. Буфер наблюдения сохранил 41 секунду телеметрии; источник сигнала не восстановлен.'},
    {'id': 2, 'date': '2019-10-30', 'code': 'GAP CLOSED', 'severity': 'warning', 'origin': 'ARCHIVE-04',
     'title': 'Первый импульс после пробела', 'summary': '559 суток без записей. Восстановлен одиночный маркер.',
     'detail': 'Архивный узел принял пакет с меткой 2019-10-30. Контрольная сумма совпала с шаблоном 2018 года, но отправитель в журнале отсутствует.'},
    {'id': 3, 'date': '2025-08-12', 'code': 'ANOMALY #1', 'severity': 'high', 'origin': 'SENSOR-17',
     'title': 'Неучтённая подпись X', 'summary': 'В архиве обнаружена подпись, которой нет в реестре допусков.',
     'detail': 'Подпись X повторяется в трёх независимых сегментах. Совпадение по времени с внутренними ревизиями составляет 97.4%.'},
    {'id': 4, 'date': '2026-04-07', 'code': 'HACKED', 'severity': 'high', 'origin': 'EDGE-02',
     'title': 'Сообщение без отправителя', 'summary': 'Текст прошёл фильтр угроз, но не имеет учётной записи.',
     'detail': 'Строка «HACKED» помечена как попытка быть замеченной. Вложение отсутствует; заголовок источника подменён на внутренний адрес.'},
    {'id': 5, 'date': '2026-11-07', 'code': 'REVISION', 'severity': 'medium', 'origin': 'CORE-01',
     'title': 'Источник внутри периметра', 'summary': 'Трассировка указывает на узел, расположенный в лаборатории.',
     'detail': 'Маршрут сигнала замкнут на сегмент Q-17. Внешний шлюз не участвовал. ALICE оставила запись без интерпретации.'},
]
PERSONNEL = [
    ('000', 'mr. X', 'нулевой сотрудник', 'резерв', 'не выдан'),
    ('001', 'a. volkova', 'наблюдатель', 'активен', '2019-10-31'),
    ('002', 'l. chen', 'архивист', 'активен', '2026-04-08'),
    ('003', 'r. meier', 'инженер контура', 'отпуск', '2025-12-19'),
    ('004', 's. garcia', 'аналитик сигналов', 'активен', '2026-11-06'),
    ('005', 'd. ivanov', 'сопровождение', 'активен', '2026-10-30'),
]
ARTIFACTS = [
    ('ART-0007', 'телеметрия', '41 KB', 'проверена', 'CORE-01'),
    ('ART-0014', 'снимок журнала', '512 KB', 'ожидает', 'ARCHIVE-04'),
    ('ART-0021', 'аудиофрагмент', '1.8 MB', 'проверена', 'SENSOR-17'),
    ('ART-0033', 'таблица допусков', '18 KB', 'проверена', 'PERSONNEL'),
    ('ART-0042', 'манифест узла', '7 KB', 'расхождение', 'EDGE-02'),
    ('ART-0059', 'резервная копия', '2.4 MB', 'ожидает', 'ARCHIVE-04'),
]
SEGMENTS = [
    ('Q-17', 'изолированный сегмент', 'высокий', 'Импульс ALICE перемещён после нарушения протокола.'),
    ('Q-04', 'карантин архива', 'средний', 'Дубликаты записей удерживаются до сверки контрольных сумм.'),
    ('Q-22', 'резервный контур', 'низкий', 'Узел доступен только для чтения, внешние маршруты отсутствуют.'),
]
NOTES = [
    ('2018-04-20', 'Не восстанавливать питание до сверки буфера.'),
    ('2019-10-31', 'Первый импульс принят. Отправитель не определён.'),
    ('2026-04-07', 'HACKED — это сообщение, а не диагностика.'),
]
FEEDBACK = [
    ('2026-10-30', 'Запрос на выгрузку журнала смен отклонён: нет допуска.'),
    ('2026-11-02', 'Прошу проверить контрольную сумму сегмента Q-17.'),
    ('2026-11-05', 'Маршрут внешнего шлюза по-прежнему пуст.'),
]
PROFILE = {'display': 'ALICE / archive', 'theme': 'neon-brown', 'density': 'comfortable', 'export_template': 'date,event,summary'}
SAVED_THEME = {'theme': 'neon-brown', 'density': 'comfortable', 'node_label': 'LAB-X / NODE 07', 'status_line': '[ALICE] signal received', 'export_template': 'date,event,summary'}

NAV = [('dashboard', 'Dashboard'), ('logs', 'Logs'), ('personnel', 'Personnel'), ('quarantine', 'Quarantine'), ('artifacts', 'Artifacts'), ('about', 'About'), ('search', 'Search'), ('feedback', 'Feedback'), ('notes', 'Notes'), ('reports', 'Reports'), ('settings', 'Settings'), ('login', 'Login')]
CSS = '''<style>
:root{color-scheme:dark;font:16px system-ui;background:#120b08;color:#ffe0ba}*{box-sizing:border-box}body{margin:0;background:#120b08}header{padding:18px 28px;background:#1d120d;border-bottom:1px solid #754124;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:#ff8a3d}header small{display:block;color:#c8a080;font-weight:400;margin-top:4px}nav{width:220px;flex-shrink:0;padding:20px;background:#1d120d;display:flex;flex-direction:column;gap:6px}nav a{padding:8px 12px;border-left:2px solid transparent}nav a:hover{border-left-color:#ff8a3d}a{color:#ffb86b;text-decoration:none}a:hover{text-decoration:underline}.layout{display:flex;min-height:80vh}main{padding:28px;max-width:1050px;width:100%}h1,h2{color:#ff8a3d}h1{margin-top:0}h3{color:#ffb86b;margin:0 0 8px}section,.card{background:#24160f;border:1px solid #754124;border-radius:8px;padding:18px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.muted{color:#c8a080}.ok{color:#8fd18a}.warn{color:#ffb86b}.danger{color:#ff6b5e}input,textarea,button,select{font:inherit;padding:10px;background:#120b08;color:#ffe0ba;border:1px solid #a45b2e;border-radius:4px}textarea{width:100%;min-height:100px}button{background:#a64d1c;cursor:pointer}label{display:block;margin:12px 0}footer{padding:18px;border-top:1px solid #754124;color:#c8a080}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#120b08;border:1px solid #4a2a1a;padding:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #754124}.tag{display:inline-block;border:1px solid #754124;border-radius:999px;padding:2px 9px;margin:2px 4px 2px 0;color:#ffb86b;font-size:13px}.bar{height:9px;background:#120b08;border:1px solid #4a2a1a;margin-top:6px}.bar i{display:block;height:100%;background:#a64d1c}.timeline{border-left:2px solid #754124;margin-left:8px;padding-left:16px}.timeline p{margin:0 0 12px}.split{display:grid;grid-template-columns:1.1fr .9fr;gap:12px}@media(max-width:650px){.layout{display:block}nav{width:100%;flex-direction:row;flex-wrap:wrap}main{padding:16px}.split{grid-template-columns:1fr}}
</style>'''


def esc(value):
    return html.escape(str(value), quote=True)


def table(headers, rows):
    head = ''.join(f'<th>{esc(h)}</th>' for h in headers)
    body = ''.join('<tr>' + ''.join(f'<td>{cell}</td>' for cell in row) + '</tr>' for row in rows)
    return f'<table><tr>{head}</tr>{body}</table>'


def page(title, body, subtitle=''):
    links = ''.join(f'<a href="/{path}">{label}</a>' for path, label in NAV)
    sub = f'<small>{esc(subtitle)}</small>' if subtitle else ''
    return f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)} | Laboratory X</title>{CSS}<header><div><strong>◈ LABORATORY X</strong>{sub}</div><span>ALICE ONLINE &nbsp;·&nbsp; 847 ANOMALIES &nbsp;·&nbsp; GAP 559 DAYS</span></header><div class="layout"><nav><a href="/">Overview</a>{links}</nav><main><h1>{esc(title)}</h1>{body}</main></div><footer>ALICE / archive v2.6 · Наблюдать, не вмешиваться. Внутренний контур лаборатории X.</footer></html>'


def form(action, field, label, csrf='', typ='text'):
    return f'<form method="post" action="{action}"><label>{label}<br><input name="{field}" type="{typ}" maxlength="512" required></label>{csrf}<button>Отправить</button></form>'


def call_formatter(template: bytes) -> str:
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(3)
        conn.connect(SOCKET)
        conn.sendall(struct.pack('=H', len(template)) + template)
        return conn.recv(4096).decode('utf-8', 'replace')


def safe_text(value):
    data = value.encode('utf-8')
    if not 0 < len(data) <= 512 or b'\0' in data:
        raise ValueError()
    return data


def captcha_html(session):
    if not CAPTCHA_ENABLED:
        return ''
    if time.monotonic() < session.get('human_until', 0):
        return '<p class="ok">Проверка оператора подтверждена.</p>'
    return (
        '<label>Проверка оператора<br>'
        f'<img src="/captcha?t={secrets.token_hex(8)}" width="190" height="64" alt="captcha">'
        '<br><input name="captcha" maxlength="8" autocomplete="off" required></label>'
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def version_string(self):
        return 'ALICE'

    def cookie_token(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            return jar['sid'].value if 'sid' in jar else ''
        except Exception:
            return ''

    def session(self):
        token = self.cookie_token()
        with LOCK:
            return SESSIONS.get(token)

    def ensure_session(self):
        token = self.cookie_token()
        with LOCK:
            data = SESSIONS.get(token)
            if data is not None:
                return token, data
        token = secrets.token_urlsafe(32)
        data = {
            'csrf': secrets.token_urlsafe(32),
            'auth': False,
            'captcha': None,
            'human_until': 0.0,
        }
        with LOCK:
            SESSIONS[token] = data
        return token, data

    def captcha_bypass(self):
        supplied = self.headers.get('X-Alice-Check', '')
        return bool(CAPTCHA_TEST_TOKEN) and secrets.compare_digest(supplied, CAPTCHA_TEST_TOKEN)

    def captcha_valid(self, session, answer):
        if not CAPTCHA_ENABLED:
            return True
        if not session:
            return False
        if time.monotonic() < session.get('human_until', 0):
            return True
        item = session.pop('captcha', None)
        if not item or item['expires'] < time.monotonic():
            return False
        if not answer or not secrets.compare_digest(item['answer'], answer.strip().upper()):
            return False
        session['human_until'] = time.monotonic() + HUMAN_TTL
        return True

    def send(self, status, content, content_type='text/html; charset=utf-8', cookie=None, script=False):
        body = content.encode() if isinstance(content, str) else content
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        policy = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'"
        if script:
            policy += "; script-src 'unsafe-inline'; connect-src 'self'"
        self.send_header('Content-Security-Policy', policy)
        if cookie:
            self.send_header('Set-Cookie', f'sid={cookie}; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/health':
            return self.send(200, 'ok', 'text/plain')
        if path == '/captcha':
            if not CAPTCHA_ENABLED:
                return self.send(404, 'not found', 'text/plain')
            token, session = self.ensure_session()
            code = new_code()
            session['captcha'] = {'answer': code, 'expires': time.monotonic() + CAPTCHA_TTL}
            return self.send(200, render_captcha(code), 'image/png', cookie=token)
        if path == '/vault':
            if not self.session() or not self.session()['auth']:
                return self.send(403, page('Доступ закрыт', '<section>Требуется вход оператора.</section>', 'защищённый сегмент'))
            body = ('<section><h2>Восстановленная запись</h2><p>Допуск подтверждён. Запись оператора восстановлена из сегмента Q-17.</p>'
                    f'<pre>{esc(FLAG)}</pre></section><div class="grid"><div class="card"><h3>Источник</h3>внутренний контур</div>'
                    '<div class="card"><h3>Статус</h3><span class="ok">подтверждено</span></div><div class="card"><h3>Ревизия</h3>ALICE / 2.6</div></div>')
            return self.send(200, page('Восстановленная запись', body, 'операторский доступ'))
        if path == '/login':
            token = secrets.token_urlsafe(32)
            with LOCK:
                SESSIONS[token] = {'csrf': secrets.token_urlsafe(32), 'auth': False}
                csrf = SESSIONS[token]['csrf']
            fields = '<label>Логин<br><input name="username" autocomplete="username" required></label><label>Пароль<br><input name="password" type="password" autocomplete="current-password" required></label>'
            body = (f'<div class="split"><section><h2>Вход оператора</h2><p>Доступ к восстановленным записям открыт только сотрудникам внутреннего контура.</p>'
                    f'<form method="post" action="/login">{fields}<input type="hidden" name="csrf" value="{csrf}"><button>Войти</button></form>'
                    '<p class="muted">После восьми неудачных попыток сеанс временно ограничивается.</p></section>'
                    '<section><h2>Состояние контура</h2><p><span class="ok">ALICE ONLINE</span></p><p>Архив: 847 записей<br>Пробел: 559 суток<br>Карантин: 3 сегмента</p>'
                    '<p class="muted">Не передавайте служебные строки третьим лицам.</p></section></div>')
            return self.send(200, page('Вход оператора', body, 'аутентификация'), cookie=token)
        title = 'Overview' if path == '/' else dict(NAV).get(path.lstrip('/'), 'Laboratory X')
        if path == '/':
            recent = table(['Дата', 'Событие', 'Сводка'], [
                (f'<a href="/logs/{x["id"]}">{esc(x["date"])}</a>', esc(x['code']), esc(x['summary'])) for x in LOGS[:3]
            ])
            body = ('<section><h2>Наблюдать, не вмешиваться</h2><p>Лаборатория X фиксирует результаты, которые нельзя воспроизвести дважды. '
                    'ALICE ведёт журнал наблюдения с момента восстановления связи и сохраняет всё, что попадает в контур.</p>'
                    '<p>После инцидента 2018 года архив содержит пробел длиной 559 суток. Восстановленные сигналы всё ещё исследуются; '
                    'часть записей помечена как резервная и не выдана сотрудникам.</p></section>'
                    '<div class="grid"><div class="card"><h3>847</h3>зарегистрированных аномалий</div><div class="card"><h3>559</h3>суток без наблюдения</div>'
                    '<div class="card"><h3>3</h3>сегмента в карантине</div><div class="card"><h3>2.6</h3>версия архива ALICE</div></div>'
                    f'<section><h2>Последние сигналы</h2>{recent}<p><a href="/logs">Открыть полную ленту →</a></p></section>'
                    '<div class="split"><section><h2>Протокол наблюдения</h2><p>1. Не вмешиваться в источник сигнала.<br>2. Не выбрасывать повторные записи.<br>3. '
                    'Фиксировать расхождения контрольных сумм.<br>4. Передавать результат в архив без интерпретации.</p></section>'
                    '<section><h2>Сводка смены</h2><p>Активных операторов: 4<br>Открытых ревизий: 2<br>Последняя синхронизация: 2026-11-07 04:12</p>'
                    '<p class="muted">Внутренний контур. Внешние маршруты отсутствуют.</p></section></div>')
        elif path == '/dashboard':
            events = table(['Дата', 'Код', 'Узел', 'Метка'], [
                (esc(x['date']), f'<a href="/logs/{x["id"]}">{esc(x["code"])}</a>', esc(x['origin']), esc(x['severity'])) for x in LOGS
            ])
            body = ('<div class="grid"><div class="card"><h2>GAP 2018–2019</h2><p>Наблюдение прервано на 559 суток.</p><div class="bar"><i style="width:78%"></i></div></div>'
                    '<div class="card"><h2>ANOMALY #1</h2><p>Источник не установлен. Совпадение с внутренними ревизиями: 97.4%.</p><div class="bar"><i style="width:97%"></i></div></div>'
                    '<div class="card"><h2>QUARANTINE</h2><p>Один сегмент изолирован, два ожидают сверки.</p><div class="bar"><i style="width:33%"></i></div></div>'
                    '<div class="card"><h2>EDGE</h2><p>Внешний шлюз пуст. Внутренний маршрут замкнут.</p><div class="bar"><i style="width:12%"></i></div></div></div>'
                    f'<section><h2>Лента событий</h2>{events}</section>'
                    '<div class="split"><section><h2>Последние действия</h2><p>04:12 — сверка сегмента Q-17.<br>03:58 — отклонена выгрузка журнала смен.<br>'
                    '03:41 — повторная проверка контрольных сумм.<br>02:56 — оператор вошёл в контур.</p></section>'
                    '<section><h2>Состояние узлов</h2><p><span class="ok">CORE-01</span> — наблюдение<br><span class="ok">ARCHIVE-04</span> — чтение<br>'
                    '<span class="warn">EDGE-02</span> — маршрут пуст<br><span class="danger">SENSOR-17</span> — карантин</p></section></div>')
        elif path == '/logs':
            rows = ''.join(f'<tr><td><a href="/logs/{x["id"]}">{esc(x["date"])}</a></td><td>{esc(x["code"])}</td><td>{esc(x["origin"])}</td><td>{esc(x["summary"])}</td></tr>' for x in LOGS)
            body = ('<section><h2>Лента наблюдения</h2><p>Пять восстановленных записей; порядок соответствует времени поступления в архив.</p>'
                    '<p><span class="tag">2018</span><span class="tag">2019</span><span class="tag">2025</span><span class="tag">2026</span><span class="tag">GAP</span></p>'
                    f'<table><tr><th>Дата</th><th>Событие</th><th>Источник</th><th>Сводка</th></tr>{rows}</table></section>'
                    '<div class="grid"><div class="card"><h3>5</h3>записей в ленте</div><div class="card"><h3>559</h3>суток пробела</div><div class="card"><h3>3</h3>открытые ревизии</div></div>'
                    '<section><h2>Примечание архивиста</h2><p>Событие HACKED сохранено без отправителя. Это не диагностическое сообщение; метка угрозы оставлена для ревизии.</p></section>')
        elif path.startswith('/logs/') and path[6:].isdigit() and 1 <= int(path[6:]) <= len(LOGS):
            item = LOGS[int(path[6:]) - 1]
            title = item['code']
            related = ''.join(f'<li><a href="/logs/{x["id"]}">{esc(x["code"])}</a> — {esc(x["date"])}</li>' for x in LOGS if x['id'] != item['id'])
            body = (f'<section><h2>{esc(item["code"])}</h2><p>{esc(item["date"])} · {esc(item["origin"])} · {esc(item["severity"])}</p>'
                    f'<p>{esc(item["detail"])}</p></section><div class="split"><section><h2>Карточка записи</h2>'
                    f'{table(["Поле", "Значение"], [("Сводка", esc(item["summary"])), ("Источник", esc(item["origin"])), ("Метка", esc(item["severity"])), ("Статус", "восстановлена")])}'
                    '</section><section><h2>Связанные записи</h2><ul>' + related + '</ul><p class="muted">Цепочка хранения: ALICE / ARCHIVE-04 / Q-17.</p></section></div>'
                    '<p><a href="/logs">← К журналу</a></p>')
        elif path == '/personnel':
            rows = table(['Допуск', 'Сотрудник', 'Роль', 'Статус', 'Активность'], [
                (esc(c), esc(n), esc(r), f'<span class="{"ok" if s == "активен" else "warn"}">{esc(s)}</span>', esc(last)) for c, n, r, s, last in PERSONNEL
            ])
            body = ('<section><h2>Реестр допусков</h2><p>Шесть записей восстановлены после инцидента. Допуск 000 отмечен как «резервный, не выдан».</p>'
                    f'{rows}</section><div class="grid"><div class="card"><h3>4</h3>активных сотрудника</div><div class="card"><h3>1</h3>отпуск</div>'
                    '<div class="card"><h3>1</h3>нулевой допуск</div></div><section><h2>Примечание</h2><p>mr. X не числится в активном составе. '
                    'Запись допуска 000 хранится в сегменте ревизии и не связана с текущими сеансами.</p></section>')
        elif path == '/quarantine':
            cards = ''.join(f'<div class="card"><h3>{esc(s)}</h3><p>{esc(name)}</p><p>Уровень: {esc(level)}</p><p class="muted">{esc(text)}</p></div>' for s, name, level, text in SEGMENTS)
            body = (f'<section><h2>Сегменты карантина</h2><p>Изоляция применяется к сигналам, которые нельзя интерпретировать без нарушения протокола.</p><div class="grid">{cards}</div></section>'
                    '<div class="split"><section><h2>Хронология</h2><div class="timeline"><p><strong>2018-04-19</strong> — канал ALICE потерян.</p>'
                    '<p><strong>2019-10-30</strong> — первый импульс после пробела.</p><p><strong>2026-04-07</strong> — HACKED прошёл фильтр.</p>'
                    '<p><strong>2026-11-07</strong> — источник замкнут на Q-17.</p></div></section>'
                    '<section><h2>Действия оператора</h2><p>Просмотр разрешён.<br>Выгрузка запрещена.<br>Изменение маршрутов запрещено.<br>Сверка контрольных сумм разрешена.</p>'
                    '<p class="muted">Сегмент Q-17 не подключён к внешнему шлюзу.</p></section></div>')
        elif path == '/artifacts':
            rows = table(['ID', 'Тип', 'Размер', 'Сверка', 'Узел'], [
                (esc(i), esc(t), esc(s), f'<span class="{"ok" if c == "проверена" else "warn"}">{esc(c)}</span>', esc(n)) for i, t, s, c, n in ARTIFACTS
            ])
            body = ('<section><h2>Индекс архива</h2><p>Указатели: наблюдательная · журнал смен · реестр доступа. Содержимое ожидает сверки контрольных сумм.</p>'
                    f'{rows}</section><div class="split"><section><h2>Манифест</h2><p>storage: /home/archive<br>checksum: sha256<br>retention: indefinite<br>owner: laboratory-x</p></section>'
                    '<section><h2>Сверка</h2><p><span class="ok">4</span> проверено<br><span class="warn">2</span> ожидает<br><span class="danger">1</span> расхождение</p>'
                    '<p class="muted">Расхождение ART-0042 относится к резервной копии, не к активному журналу.</p></section></div>')
        elif path == '/about':
            body = ('<section><h2>Устав отделения</h2><p>Любой результат считается результатом. Ничего не выбрасывается, всё заносится в журнал.</p>'
                    '<p>ALICE наблюдает и не вмешивается. Оператор фиксирует, но не интерпретирует источник сигнала.</p></section>'
                    '<div class="grid"><div class="card"><h3>Наблюдение</h3>без вмешательства</div><div class="card"><h3>Архив</h3>без потерь</div>'
                    '<div class="card"><h3>Ревизия</h3>без исключений</div></div><section><h2>Хронология контура</h2><p>2018 — потеря питания.<br>'
                    '2019 — первый импульс.<br>2025 — подпись X.<br>2026 — сообщение HACKED.<br>2026 — источник внутри периметра.</p></section>'
                    '<section><h2>Контакты</h2><p>Внутренний узел: ARCHIVE-04<br>Дежурная смена: 04:00–12:00<br>Внешние запросы: не предусмотрены.</p></section>')
        elif path == '/search':
            q = parse_qs(urlsplit(self.path).query).get('q', [''])[0][:100]
            matches = [x for x in LOGS if q and (q.lower() in x['summary'].lower() or q.lower() in x['detail'].lower() or q.lower() in x['code'].lower())]
            results = ''.join(f'<p><a href="/logs/{x["id"]}">{esc(x["code"])}</a> — {esc(x["summary"])}</p>' for x in matches)
            body = (f'<section><h2>Поиск по журналу</h2><form><label>Запрос<br><input name="q" value="{esc(q)}" maxlength="100"></label><button>Искать</button></form>'
                    f'<p>Совпадений: {len(matches)}</p>{results}</section><div class="split"><section><h2>Область поиска</h2><p>Код события, сводка и подробности. '
                    'Регистр не учитывается. Поиск выполняется по восстановленным записям.</p></section><section><h2>Подсказка</h2><p>Попробуйте: GAP, '
                    'HACKED, ревизия, Q-17.</p></section></div>')
        elif path in ('/feedback', '/notes'):
            field = 'message' if path == '/feedback' else 'note'
            title = 'Обратная связь' if field == 'message' else 'Заметки оператора'
            if field == 'message':
                items = ''.join(f'<p><strong>{esc(d)}</strong><br>{esc(t)}</p>' for d, t in FEEDBACK)
                hint = 'Сообщение принимается архивом без публикации.'
            else:
                items = ''.join(f'<p><strong>{esc(d)}</strong><br>{esc(t)}</p>' for d, t in NOTES)
                hint = 'Личные заметки видимы только текущей смене.'
            body = (f'<div class="split"><section><h2>{title}</h2><p>{hint}</p>{form(path, field, "Текст")}</section>'
                    f'<section><h2>Последние записи</h2>{items}</section></div><p class="muted">Текст сохраняется как есть; служебные поля архива не изменяются.</p>')
        elif path == '/settings':
            links = '<p><a href="/settings/appearance">Настроить отображение панели →</a></p>'
            body = (f'<section><h2>Профиль</h2><p>Тема журнала и параметры уведомлений.</p><form method="post" action="/settings">'
                    '<label>Имя панели<br><input name="display" maxlength="60" value="' + esc(PROFILE['display']) + '"></label>'
                    '<label>Тема<select name="theme"><option selected>neon-brown</option><option>archive-dark</option><option>signal-red</option></select></label>'
                    '<label>Шаблон экспорта<br><textarea name="export_template" maxlength="512">' + esc(PROFILE['export_template']) + '</textarea></label>'
                    '<button>Сохранить</button></form></section>'
                    '<section><h2>Отображение</h2><p>Строка состояния, плотность таблиц и подпись узла настраиваются отдельно.</p>'
                    f'{links}</section><div class="grid"><div class="card"><h3>Сеанс</h3>внутренний контур</div><div class="card"><h3>Архив</h3>2.6</div>'
                    '<div class="card"><h3>Уведомления</h3>только критические</div></div>')
        elif path == '/settings/appearance':
            title = 'Оформление панели'
            token, session = self.ensure_session()
            captcha = captcha_html(session)
            body = ('<section><h2>Оформление панели</h2><p>Настройте строку состояния, подпись узла и вид архивных таблиц. '
                    'Изменения применяются к текущему сеансу после проверки вида.</p>'
                    '<form method="post" action="/settings/appearance">'
                    '<label>Строка состояния<textarea name="status_line" maxlength="512">' + esc(SAVED_THEME['status_line']) + '</textarea></label>'
                    '<label>Подпись узла<br><input name="node_label" maxlength="80" value="' + esc(SAVED_THEME['node_label']) + '"></label>'
                    '<label>Шаблон экспорта<br><textarea name="export_template" maxlength="512">' + esc(SAVED_THEME['export_template']) + '</textarea></label>'
                    '<label>Плотность<select name="density"><option selected>comfortable</option><option>compact</option><option>dense</option></select></label>'
                    + captcha +
                    '<button>Проверить вид</button></form></section>'
                    '<div class="split"><section><h2>Как это выглядит</h2><pre id="preview">[ALICE] signal received</pre></section>'
                    '<section><h2>Параметры сеанса</h2><p>Тема: neon-brown<br>Плотность: comfortable<br>Источник: внутренний контур</p>'
                    '<p class="muted">Строка состояния не влияет на содержимое архива.</p></section></div>')
            return self.send(200, page(title, body), cookie=token)
        elif path == '/reports':
            body = ('<section><h2>Экспорт смены</h2><p>Сформируйте текстовый макет отчёта для архива. '
                    'Макет не изменяет журнал и не запускает повторную обработку записей.</p>'
                    '<form method="post" action="/reports"><label>Макет отчёта<br><textarea name="report_template" maxlength="512">date,event,summary</textarea></label>'
                    '<button>Собрать макет</button></form></section>'
                    '<div class="split"><section><h2>Доступные поля</h2><p>date · event · summary · origin · severity</p><p class="muted">Поля перечислены для справки.</p></section>'
                    '<section><h2>Последние выгрузки</h2><p>2026-11-05 — журнал смен, отклонено.<br>2026-11-02 — сегмент Q-17, ожидает.<br>'
                    '2026-10-30 — телеметрия, проверено.</p></section></div>')
        else:
            return self.send(404, page('Не найдено', '<section>Запись отсутствует.</section><p><a href="/">Вернуться на панель</a></p>', 'архив'))
        return self.send(200, page(title, body))

    def do_POST(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get('Content-Length', '0')) if self.headers.get('Content-Length', '0').isdigit() else 0
        if not 0 < length <= 4096:
            return self.send(400, 'invalid request', 'text/plain')
        raw = self.rfile.read(length)
        fields = parse_qs(raw.decode('utf-8', 'replace'), keep_blank_values=True)
        if path == '/login':
            session = self.session()
            csrf = fields.get('csrf', [''])[0]
            if not session or not secrets.compare_digest(session['csrf'], csrf):
                return self.send(403, page('Вход оператора', '<section>Неверный запрос.</section>', 'аутентификация'))
            ip = self.headers.get('X-Real-IP') or self.client_address[0]
            with LOCK:
                now = time.monotonic()
                attempts = ATTEMPTS[ip]
                while attempts and attempts[0] < now - 60:
                    attempts.popleft()
                limited = len(attempts) >= 8
                if not limited:
                    attempts.append(now)
            if limited:
                return self.send(429, page('Вход оператора', '<section>Попробуйте позже.</section>', 'аутентификация'))
            username = fields.get('username', [''])[0]
            password = fields.get('password', [''])[0]
            valid = bcrypt.checkpw(password[:256].encode(), HASH)
            if username == 'operator' and valid:
                with LOCK:
                    session['auth'] = True
                    session['csrf'] = secrets.token_urlsafe(32)
                self.send_response(303)
                self.send_header('Location', '/vault')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            return self.send(401, page('Вход оператора', '<section>Неверный логин или пароль. <a href="/login">Повторить</a></section>', 'аутентификация'))
        if path == '/settings/appearance':
            session = self.session()
            answer = fields.get('captcha', [''])[0]
            if not self.captcha_bypass() and not self.captcha_valid(session, answer):
                return self.send(429, page('Оформление панели', '<section>Проверка оператора не пройдена. '
                                           '<a href="/settings/appearance">Запросить новый код</a></section>',
                                           'настройки сеанса'))
            line = fields.get('status_line', [''])[0]
            node = fields.get('node_label', [''])[0][:80]
            export = fields.get('export_template', [''])[0][:512]
            try:
                preview = call_formatter(safe_text(line))
            except (ValueError, OSError, UnicodeError):
                preview = 'предпросмотр недоступен'
            SAVED_THEME.update({'node_label': node, 'export_template': export})
            captcha = captcha_html(session) if session else ''
            body = ('<section><h2>Оформление панели</h2><p>Проверка вида завершена. Строка состояния не влияет на архив.</p>'
                    f'<form method="post" action="/settings/appearance"><label>Строка состояния<textarea name="status_line" maxlength="512">{esc(line)}</textarea></label>'
                    f'<label>Подпись узла<br><input name="node_label" maxlength="80" value="{esc(node)}"></label>'
                    f'<label>Шаблон экспорта<br><textarea name="export_template" maxlength="512">{esc(export)}</textarea></label>'
                    '<label>Плотность<select name="density"><option selected>comfortable</option><option>compact</option><option>dense</option></select></label>'
                    + captcha +
                    '<button>Проверить вид</button></form></section>'
                    f'<div class="split"><section><h2>Результат проверки</h2><pre>{esc(preview)}</pre></section>'
                    f'<section><h2>Сохранённый макет</h2><pre>{esc(export)}</pre><p class="muted">Подпись узла: {esc(node)}</p></section></div>')
            return self.send(200, page('Оформление панели', body, 'настройки сеанса'))
        if path == '/reports':
            template = fields.get('report_template', [''])[0][:512]
            body = ('<section><h2>Экспорт смены</h2><p>Макет собран. Это только текстовый preview, архив не изменён.</p>'
                    f'<form method="post" action="/reports"><label>Макет отчёта<br><textarea name="report_template" maxlength="512">{esc(template)}</textarea></label>'
                    '<button>Собрать макет</button></form></section>'
                    f'<section><h2>Предпросмотр</h2><pre>{esc(template)}</pre><p class="muted">Служебные поля не подставляются в этом режиме.</p></section>')
            return self.send(200, page('Экспорт смены', body, 'архив'))
        if path in ('/feedback', '/notes', '/settings'):
            if path == '/settings':
                PROFILE['display'] = fields.get('display', [PROFILE['display']])[0][:60]
                PROFILE['export_template'] = fields.get('export_template', [PROFILE['export_template']])[0][:512]
                body = (f'<section><h2>Параметры сохранены</h2><p>Имя панели: {esc(PROFILE["display"])}</p>'
                        f'<p>Макет экспорта: {esc(PROFILE["export_template"])}</p><p><a href="/settings">Вернуться к настройкам</a></p></section>')
            else:
                body = '<section><h2>Запись принята</h2><p>Изменение сохранено в текущем сеансе. <a href="/dashboard">На панель</a></p></section>'
            return self.send(200, page('Запись принята', body, 'архив'))
        return self.send(404, 'not found', 'text/plain')


ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
