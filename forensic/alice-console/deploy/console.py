#!/usr/bin/env python3
"""Веб-консоль ALICE: /, /login, /console (xterm.js + WS PTY с allowlist)."""
import base64
import hashlib
import json
import os
import pty
import re
import resource
import secrets
import select
import shlex
import signal
import socket
import stat
import struct
import termios
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import bcrypt

HASH = bcrypt.hashpw(b'user', bcrypt.gensalt(rounds=12))
SESSIONS = {}
ATTEMPTS = defaultdict(deque)
ACTIVE = Counter()
MAX_SESSIONS = 400
MAX_SESSIONS_PER_IP = 40
PROCS_MAX = 1000
LOCK = threading.Lock()

ALLOWED = {
    'ls', 'cd', 'pwd', 'tree', 'cat', 'less', 'head', 'tail', 'more', 'grep', 'egrep',
    'find', 'file', 'stat', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'strings',
    'xxd', 'hexdump', 'od', 'zcat', 'gzip', 'base64', 'tar', 'sha256sum', 'md5sum',
    'clear', 'help', 'id', 'whoami',
}
# alice-auth — единственный разрешённый бинарник вне allowlist (без аргументов)
AUTH_BIN = '/bin/alice-auth'
AUTH_CMDS = {'alice-auth', '/bin/alice-auth', '/usr/bin/alice-auth'}
HOME = '/home/user'
NEVER_SUBSTR = ['..', '$(', '`', '>', '<', '&&', '||', ';', '\n', '\r', '!', '&']
FIND_FORBIDDEN = re.compile(r'(-exec|-execdir|-ok|-okdir|-delete|-fls|-fprint|-fprintf|-newer)')
LINE_MAX = 1024
OUT_CMD = 1024 * 1024     # лимит вывода на одну команду
OUT_TOTAL = 32 * 1024 * 1024  # лимит вывода на сессию

CSS = '''<style>
:root{color-scheme:dark;font:15px/1.45 "SF Mono",Menlo,monospace;background:#0a0f0a;color:#33ff66}
*{box-sizing:border-box}body{margin:0;background:#0a0f0a}
header{padding:10px 18px;border-bottom:1px solid #1d3a22;color:#33ff66;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
a,button{color:#4dff79;background:none;border:1px solid #2a5c37;padding:7px 14px;font:inherit;cursor:pointer;text-decoration:none}
a:hover,button:hover{background:#12240f}
main{max-width:860px;margin:0 auto;padding:36px 20px}
.term{background:#060a06;border:1px solid #1d3a22;box-shadow:0 0 18px rgba(51,255,102,.12);padding:10px;height:78vh}
.status{padding:6px 12px;border-bottom:1px solid #1d3a22;color:#2fd35f;font-size:13px;display:flex;gap:14px;flex-wrap:wrap}
input{background:#0a140a;color:#33ff66;border:1px solid #2a5c37;font:inherit;padding:8px}
.mut{color:#1f8f45}
.center-page{min-height:100vh;display:flex;flex-direction:column}
main.center{flex:1 1 auto;max-width:none;min-height:0;display:flex;align-items:center;justify-content:center;padding:28px}
.enter{font-size:20px;padding:16px 36px;border-color:#2f7040;box-shadow:0 0 18px rgba(51,255,102,.12)}
.login-wrap{width:min(460px,92vw)}
.login-wrap h1{font-size:30px;margin:0 0 24px;font-weight:600}
.login-wrap label{display:block;margin:0 0 18px}
.login-wrap input{width:100%;padding:13px 14px;margin-top:6px;font-size:16px}
.login-wrap button{width:100%;padding:13px;font-size:16px;margin-top:4px}
.login-wrap .mut{min-height:1.45em;margin:16px 0 0}
</style>'''

INDEX = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALICE // ARCHIVE</title>''' + CSS + '''
<body class="center-page"><header><strong>ALICE // ARCHIVE</strong><span class="mut">дело GAP 2018–2019</span></header>
<main class="center"><a class="enter" href="/login">Войти в консоль</a></main></body>'''

LOGIN = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход</title>''' + CSS + '''
<body class="center-page"><header><strong>ALICE // ARCHIVE</strong><span class="mut">вход специалиста</span></header>
<main class="center"><div class="login-wrap"><h1>Вход</h1><form method="post" action="/login">
<label>Логин<input name="username" autocomplete="username" required></label>
<label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
<input type="hidden" name="csrf" value="__CSRF__"><button>Войти</button></form>
<p class="mut">__MSG__</p></div></main></body>'''

CONSOLE = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Консоль</title>''' + CSS + '''
<style>
html,body{height:100%;overflow:hidden}body{display:flex;flex-direction:column}header{flex:0 0 auto}
.term{flex:1 1 auto;height:auto;margin:0;max-width:none;padding:8px;display:flex;flex-direction:column;box-shadow:none}
.status{flex:0 0 auto}#t{flex:1 1 auto;min-height:0;min-width:0;height:auto}
</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css">
<header><strong>ALICE // ARCHIVE</strong><span>USER: user · MODE: READ-ONLY · CASE: GAP 2018–2019</span></header>
<div class="term"><div class="status"><span>ALICE // ARCHIVE</span><span>USER: user</span><span>MODE: READ-ONLY</span><span>CASE: GAP 2018–2019</span><span>ARTIFACTS: 120</span><span id="tm">30:00</span></div>
<div id="t"></div></div>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
<script>
const term = new Terminal({cursorBlink:true, theme:{background:'#060a06', foreground:'#33ff66', cursor:'#33ff66'}});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('t'));
term.attachCustomKeyEventHandler(ev => {
  if(ev.type==='keydown' && ev.key.toLowerCase()==='c' && term.hasSelection() && (ev.metaKey || ev.ctrlKey)){
    const sel=term.getSelection();
    if(sel && navigator.clipboard) navigator.clipboard.writeText(sel).catch(()=>{});
    ev.preventDefault();
    return false;
  }
  return true;
});
let ws, alive=true, retry=1500, opened=0;
function sendSize(){ if(ws && ws.readyState===1) ws.send('\\x00SIZE:'+term.cols+','+term.rows+'\\n'); }
term.onResize(sendSize);
function fit(){ try{fitAddon.fit();}catch(e){} sendSize(); }
function connect(){
  ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  ws.binaryType='arraybuffer';
  ws.onopen = () => { opened=Date.now(); sendSize(); term.focus(); };
  ws.onmessage = e => term.write(new Uint8Array(e.data));
  ws.onclose = () => {
    if(!alive) return;
    if(Date.now()-opened>10000) retry=1500;
    setTimeout(connect, retry);
    retry=Math.min(retry*2, 30000);
  };
}
connect();
term.onData(d => { if(ws && ws.readyState===1) ws.send(new TextEncoder().encode(d)); });
requestAnimationFrame(()=>{fit(); term.focus();});
window.addEventListener('resize', ()=>setTimeout(fit,50));
let left=1800;
setInterval(()=>{ if(left>0){left--; document.getElementById('tm').textContent = String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');} },1000);
</script>'''

HELP_TEXT = (
    'ALICE // ARCHIVE — read-only console\r\n'
    'Команды: ls, cd, pwd, tree, cat, less, head, tail, more, grep, egrep, find, file, stat, wc, sort, uniq, cut, tr, '
    'diff, strings, xxd, hexdump, od, zcat, gzip, base64, tar, sha256sum, md5sum, id, whoami, clear, help. Пайпы: |.\r\n'
    'Отдельно: alice-auth — служебная проверка допуска (только путь к артефакту).\r\n'
    'Клавиши: ←/→ — курсор, Home/End, Backspace/Delete, ↑/↓ — история, Tab — автодополнение, Ctrl+C — отмена, Ctrl+U — очистить строку.\r\n'
)
PROMPT_RE = re.compile(rb'user@alice:(?:~|/[^\r\n]*)\$ \Z')
COLS = 100


def check_command(line):
    """Allowlist-проверка одной строки. Возвращает (ok, reason)."""
    s = line.strip()
    if not s:
        return True, None
    if len(s) > LINE_MAX:
        return False, 'command not allowed'
    if any(sub in s for sub in NEVER_SUBSTR):
        return False, 'command not allowed'
    if s in AUTH_CMDS:
        return True, None
    for seg in s.split('|'):
        seg = seg.strip()
        if not seg:
            return False, 'command not allowed'
        m = re.match(r"^([A-Za-z0-9_.\-]+)((?:\s+[^|]*?)*)$", seg)
        if not m:
            return False, 'command not allowed'
        cmd = m.group(1)
        if cmd not in ALLOWED:
            return False, 'command not allowed'
        args = m.group(2).split()
        if cmd == 'find':
            if any(FIND_FORBIDDEN.search(a) for a in args):
                return False, 'command not allowed'
            # глоб в аргументах find запрещён (ТЗ п.3); для выборок — grep по */meta.json
            if any('*' in a or '?' in a for a in args):
                return False, 'command not allowed'
        if cmd == 'gzip':
            flags = [a for a in args if a.startswith('-')]
            if not flags or not all(
                    re.fullmatch(r'-[cdlt]+', a) and ('c' in a or 'l' in a or 't' in a)
                    for a in flags):
                return False, 'command not allowed'
        if cmd == 'sort' and any(a.startswith('-o') or a.startswith('--output') for a in args):
            return False, 'command not allowed'
        if cmd == 'uniq':
            positional = [a for a in args if not a.startswith('-')]
            if len(positional) > 1:
                return False, 'command not allowed'
        if cmd == 'xxd':
            positional = [a for a in args if not a.startswith('-')]
            if len(positional) > 1:
                return False, 'command not allowed'
        if cmd == 'tar':
            # только чтение: -t/-v/-o/-O/-f-комбо и ровно -xO
            for a in args:
                if a.startswith('-') and not (re.fullmatch(r'-[tvoOf]+', a) or a == '-xO'):
                    return False, 'command not allowed'
        for a in args:
            # опции — только из безопасных символов (отсекает --opt=value, --to-command и т.п.)
            if a.startswith('-') and not re.fullmatch(r'[A-Za-z0-9_.:,@\-]+', a):
                return False, 'command not allowed'
    return True, None


class WS:
    """Минимальный WebSocket-сервер на том же HTTP-порту (upgrade)."""
    def __init__(self, rfile, wfile, headers, connection):
        self.connection = connection
        self.lock = threading.Lock()
        self.rfile = rfile
        self.wfile = wfile
        key = headers.get('Sec-WebSocket-Key')
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.wfile.write(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept.encode() + b'\r\n\r\n')
        self.wfile.flush()

    def recv(self):
        hdr = self.rfile.read(2)
        if not hdr or len(hdr) < 2:
            return None
        fin_op = hdr[0]
        op = fin_op & 0x0F
        ln = hdr[1] & 0x7F
        masked = hdr[1] & 0x80
        if ln == 126:
            ln = struct.unpack('>H', self.rfile.read(2))[0]
        elif ln == 127:
            ln = struct.unpack('>Q', self.rfile.read(8))[0]
        if ln > 4096:
            return None
        mask = self.rfile.read(4) if masked else b''
        data = self.rfile.read(ln) if ln else b''
        if masked and data:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        if op == 8:
            return None
        if op in (9,):  # ping → pong
            self.send(b'', op=10)
            return b''
        return data

    def send(self, data, op=2):
        if isinstance(data, str):
            data = data.encode('utf-8', 'replace')
        hdr = bytes([0x80 | op])
        n = len(data)
        if n < 126:
            hdr += bytes([n])
        elif n < 65536:
            hdr += bytes([126]) + struct.pack('>H', n)
        else:
            hdr += bytes([127]) + struct.pack('>Q', n)
        with self.lock:
            self.wfile.write(hdr + data)
            self.wfile.flush()

    def shutdown(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


EDIT = {}
# сессии, где следующий Enter — ввод для stdin запущенной программы (alice-auth)
stdin_mode = set()
# сессии после отправки Enter в alice-auth: ввод отбрасывается до возврата промпта
# (лишние строки не должны утечь в bash в обход allowlist)
post_submit = set()
MAX_HISTORY = 200


def new_edit_state():
    return {'line': '', 'pos': 0, 'hist': [], 'hidx': 0, 'draft': '',
            'cwd': HOME, 'busy': True, 'raw': False, 'inbuf': '', 'cols': COLS}


def remember(st, line):
    line = line.strip()
    if not line:
        return
    if not st['hist'] or st['hist'][-1] != line:
        st['hist'].append(line)
        if len(st['hist']) > MAX_HISTORY:
            del st['hist'][0]
    st['hidx'] = len(st['hist'])
    st['draft'] = ''


def cursor_rowcol(total, cols):
    if total and total % cols == 0:
        return total // cols - 1, cols - 1
    return divmod(total, cols)


def prompt_for(cwd):
    shown = '~' if cwd == HOME else cwd
    return f'user@alice:{shown}$ '


def redraw_cmd(ws, st):
    cols = st.get('cols', COLS)
    ps = prompt_for(st['cwd'])
    before = len(ps) + st['pos']
    row, _ = cursor_rowcol(before, cols)
    out = (f'\x1b[{row}A' if row else '') + '\r' + ps + st['line'] + '\x1b[J'
    end_row, _ = cursor_rowcol(len(ps) + len(st['line']), cols)
    dest_row, dest_col = cursor_rowcol(before, cols)
    if end_row > dest_row:
        out += f'\x1b[{end_row - dest_row}A'
    out += '\r' + (f'\x1b[{dest_col}C' if dest_col else '')
    ws.send(out)


def redraw_stdin(ws, st):
    left = f'\x1b[{st["pos"]}D' if st['pos'] else ''
    tail = len(st['line']) - st['pos']
    ws.send(left + st['line'] + '\x1b[K' + (f'\x1b[{tail}D' if tail else ''))


def can_enter(path):
    try:
        info = os.stat(path)
    except OSError:
        return False
    if not stat.S_ISDIR(info.st_mode):
        return False
    if info.st_uid == 11001:
        bits = (info.st_mode >> 6) & 7
    elif info.st_gid == 11001:
        bits = (info.st_mode >> 3) & 7
    else:
        bits = info.st_mode & 7
    return bool(bits & 1)


def complete_commands(token):
    names = sorted(ALLOWED)
    matches = [n for n in names if n.startswith(token)]
    if not matches:
        return None
    prefix = os.path.commonprefix(matches)
    if prefix == token and len(matches) > 1:
        return ''
    return prefix + (' ' if len(matches) == 1 else '')


def complete_path(token, cwd, dirs_only):
    if not token or token.startswith('-') or '*' in token or '?' in token:
        return None
    tilde = token.startswith('~')
    if tilde:
        if token == '~':
            return '~/'
        if not token.startswith('~/'):
            return None
        token = HOME + token[1:]
    if '$' in token or '`' in token:
        return None
    if '/' in token:
        cut = token.rfind('/') + 1
        head, base = token[:cut], token[cut:]
        lookup = head if head.startswith('/') else os.path.join(cwd, head)
    else:
        head, base = '', token
        lookup = cwd
    lookup = os.path.realpath(os.path.normpath(lookup))
    if not can_enter(lookup):
        return None
    try:
        entries = list(os.scandir(lookup))
    except OSError:
        return None
    matches = []
    for ent in entries:
        if not ent.name.startswith(base):
            continue
        try:
            is_dir = ent.is_dir(follow_symlinks=False)
        except OSError:
            continue
        if dirs_only and (not is_dir or not can_enter(ent.path)):
            continue
        name = head + ent.name + ('/' if is_dir else '')
        if tilde:
            name = '~' + name[len(HOME):]
        matches.append(name)
    if not matches:
        return None
    prefix = os.path.commonprefix(matches)
    if prefix == token and len(matches) > 1:
        return ''
    if len(matches) == 1:
        only = matches[0]
        return only if only.endswith('/') else only + ' '
    return prefix


def check_cd(line, cwd):
    s = line.strip()
    if any(sub in s for sub in NEVER_SUBSTR if sub != '..'):
        return False, 'command not allowed', None, False
    parts = s.split()
    if len(parts) > 2:
        return False, 'command not allowed', None, False
    raw = parts[1] if len(parts) == 2 else '~'
    if raw == '-' or not re.fullmatch(r'[A-Za-z0-9_./~@+-]+', raw):
        return False, 'command not allowed', None, False
    if raw == '~':
        target = HOME
    elif raw.startswith('~/'):
        target = os.path.join(HOME, raw[2:])
    elif raw.startswith('~'):
        return False, 'cd: permission denied', None, False
    else:
        target = raw if raw.startswith('/') else os.path.join(cwd, raw)
    target = os.path.normpath(target)
    real = os.path.realpath(target)
    if not os.path.exists(real):
        return False, 'cd: no such file or directory', None, False
    if not os.path.isdir(real):
        return False, 'cd: not a directory', None, False
    if not can_enter(real):
        return False, 'cd: permission denied', None, False
    return True, None, real, False


def submit_cmd(ws, master, user_token, st, out_budget):
    line = st['line']
    st['line'] = ''
    st['pos'] = 0
    ws.send('\r\n')
    if line.strip() == 'help':
        remember(st, line)
        ws.send(HELP_TEXT + prompt_for(st['cwd']))
        st['busy'] = False
        return
    parts = line.split()
    if parts and parts[0] == 'cd':
        ok, reason, target, _clamped = check_cd(line, st['cwd'])
        if not ok:
            ws.send(reason + '\r\n' + prompt_for(st['cwd']))
            st['busy'] = False
            return
        remember(st, line)
        st['cwd'] = target
        st['busy'] = True
        os.write(master, ('cd -- ' + shlex.quote(target) + '\r').encode())
        return
    ok, reason = check_command(line)
    if not ok:
        ws.send(reason + '\r\n' + prompt_for(st['cwd']))
        st['busy'] = False
        return
    remember(st, line)
    if line.strip() in AUTH_CMDS:
        stdin_mode.add(user_token)
    if re.search(r'(^|\|)\s*(less|more)(\s|$)', line):
        st['raw'] = True
    st['busy'] = True
    os.write(master, (line + '\r').encode())


def submit_stdin(ws, master, user_token, st):
    line = st['line']
    st['line'] = ''
    st['pos'] = 0
    ws.send('\r\n')
    post_submit.add(user_token)
    st['busy'] = True
    os.write(master, (line + '\r').encode())


def insert_char(ws, user_token, st, ch):
    if len(st['line']) >= LINE_MAX:
        ws.send('\x07')
        return
    at_end = st['pos'] == len(st['line'])
    st['line'] = st['line'][:st['pos']] + ch + st['line'][st['pos']:]
    st['pos'] += 1
    if at_end:
        ws.send(ch)
    elif user_token in stdin_mode:
        redraw_stdin(ws, st)
    else:
        redraw_cmd(ws, st)
    if user_token not in stdin_mode:
        st['hidx'] = len(st['hist'])


def handle_tab(ws, user_token, st):
    line = st['line']
    start = line.rfind(' ', 0, st['pos']) + 1
    token = line[start:st['pos']]
    if user_token in stdin_mode:
        new = complete_path(token, st['cwd'], False)
    elif start == 0:
        new = complete_commands(token)
    else:
        cmd = line.split(None, 1)[0]
        new = complete_path(token, st['cwd'], cmd == 'cd')
    if not new:
        ws.send('\x07')
        return
    st['line'] = line[:start] + new + line[st['pos']:]
    st['pos'] = start + len(new)
    if user_token in stdin_mode:
        if start + len(token) == len(line) and new.startswith(token):
            ws.send(new[len(token):])
        else:
            redraw_stdin(ws, st)
    else:
        st['hidx'] = len(st['hist'])
        redraw_cmd(ws, st)


def handle_escape(ws, user_token, st, seq):
    if seq in ('\x1b[200~', '\x1b[201~'):
        return
    if seq in ('\x1b[A', '\x1bOA'):
        if user_token in stdin_mode or not st['hist']:
            return
        if st['hidx'] == len(st['hist']):
            st['draft'] = st['line']
        st['hidx'] = max(0, st['hidx'] - 1)
        st['line'] = st['hist'][st['hidx']]
        st['pos'] = len(st['line'])
        redraw_cmd(ws, st)
    elif seq in ('\x1b[B', '\x1bOB'):
        if user_token in stdin_mode:
            return
        if st['hidx'] < len(st['hist']) - 1:
            st['hidx'] += 1
            st['line'] = st['hist'][st['hidx']]
        else:
            st['hidx'] = len(st['hist'])
            st['line'] = st['draft']
        st['pos'] = len(st['line'])
        redraw_cmd(ws, st)
    elif seq in ('\x1b[C', '\x1bOC'):
        if st['pos'] < len(st['line']):
            st['pos'] += 1
            ws.send('\x1b[C')
    elif seq in ('\x1b[D', '\x1bOD'):
        if st['pos'] > 0:
            st['pos'] -= 1
            ws.send('\x1b[D')
    elif seq in ('\x1b[H', '\x1b[1~', '\x1b[7~', '\x1bOH'):
        if st['pos']:
            ws.send(f'\x1b[{st["pos"]}D')
            st['pos'] = 0
    elif seq in ('\x1b[F', '\x1b[4~', '\x1b[8~', '\x1bOF'):
        tail = len(st['line']) - st['pos']
        if tail:
            ws.send(f'\x1b[{tail}C')
            st['pos'] = len(st['line'])
    elif seq == '\x1b[3~':
        if st['pos'] < len(st['line']):
            st['line'] = st['line'][:st['pos']] + st['line'][st['pos'] + 1:]
            if user_token in stdin_mode:
                redraw_stdin(ws, st)
            else:
                redraw_cmd(ws, st)


def handle_input(ws, master, user_token, st, text, out_budget):
    m = re.match(r'\x00SIZE:(\d+),(\d+)\n', text)
    if m:
        st['cols'] = max(20, min(400, int(m.group(1))))
        return
    if st['raw']:
        safe = text.replace('!', '').replace('&', '')
        if safe:
            os.write(master, safe.encode('utf-8', 'replace'))
        return
    if user_token in post_submit:
        return
    if st['busy'] and user_token not in stdin_mode:
        if '\x03' in text:
            os.write(master, b'\x03')
        return
    buf = st['inbuf'] + text
    i = 0
    while i < len(buf):
        ch = buf[i]
        if ch == '\x1b':
            if i + 1 >= len(buf):
                break
            if buf[i + 1] == '[':
                m = re.match(r'\x1b\[[0-9;]*[A-Za-z~]', buf[i:])
                if not m:
                    if len(buf) - i < 8:
                        break
                    i += 1
                    continue
                handle_escape(ws, user_token, st, m.group(0))
                i += len(m.group(0))
            elif buf[i + 1] == 'O':
                if i + 2 >= len(buf):
                    break
                handle_escape(ws, user_token, st, buf[i:i + 3])
                i += 3
            else:
                i += 2
        elif ch in '\r\n':
            if ch == '\r' and i + 1 < len(buf) and buf[i + 1] == '\n':
                i += 1
            out_budget[0] = OUT_CMD
            if user_token in stdin_mode:
                submit_stdin(ws, master, user_token, st)
            else:
                submit_cmd(ws, master, user_token, st, out_budget)
            i += 1
        elif ch in ('\x7f', '\x08'):
            if st['pos']:
                at_end = st['pos'] == len(st['line'])
                st['line'] = st['line'][:st['pos'] - 1] + st['line'][st['pos']:]
                st['pos'] -= 1
                if at_end:
                    ws.send('\b \b')
                elif user_token in stdin_mode:
                    redraw_stdin(ws, st)
                else:
                    redraw_cmd(ws, st)
            i += 1
        elif ch == '\t':
            handle_tab(ws, user_token, st)
            i += 1
        elif ch == '\x03':
            if user_token in stdin_mode:
                os.write(master, b'\x03')
                st['line'] = ''
                st['pos'] = 0
                post_submit.add(user_token)
                ws.send('^C\r\n')
            else:
                st['line'] = ''
                st['pos'] = 0
                ws.send('^C\r\n' + prompt_for(st['cwd']))
                st['busy'] = False
            i += 1
        elif ch == '\x04':
            if user_token in stdin_mode:
                os.write(master, b'\x04')
            i += 1
        elif ch == '\x15':
            st['line'] = ''
            st['pos'] = 0
            if user_token in stdin_mode:
                redraw_stdin(ws, st)
            else:
                redraw_cmd(ws, st)
            i += 1
        elif ch == '\x01':
            if st['pos']:
                ws.send(f'\x1b[{st["pos"]}D')
                st['pos'] = 0
            i += 1
        elif ch == '\x05':
            tail = len(st['line']) - st['pos']
            if tail:
                ws.send(f'\x1b[{tail}C')
                st['pos'] = len(st['line'])
            i += 1
        elif ch == '\x17':
            cut = st['pos']
            while cut > 0 and st['line'][cut - 1] == ' ':
                cut -= 1
            while cut > 0 and st['line'][cut - 1] != ' ':
                cut -= 1
            st['line'] = st['line'][:cut] + st['line'][st['pos']:]
            st['pos'] = cut
            if user_token in stdin_mode:
                redraw_stdin(ws, st)
            else:
                redraw_cmd(ws, st)
            i += 1
        elif ord(ch) >= 32:
            insert_char(ws, user_token, st, ch)
            i += 1
        else:
            i += 1
    st['inbuf'] = buf[i:]


def pty_session(ws, user_token):
    # LESSSECURE=1 запрещает '!cmd'/'|cmd'/'v' в less; EDITOR/VISUAL обезвреживают 'v'
    env = {'PATH': '/usr/bin:/bin', 'HOME': HOME, 'TERM': 'xterm-256color',
           'USER': 'user', 'LANG': 'C.UTF-8', 'LESSSECURE': '1',
           'EDITOR': '/bin/false', 'VISUAL': '/bin/false'}
    master, slave = pty.openpty()
    attrs = termios.tcgetattr(slave)
    attrs[3] &= ~(termios.ECHO | termios.ECHONL)
    termios.tcsetattr(slave, termios.TCSANOW, attrs)
    pid = os.fork()
    if pid == 0:
        os.setsid()
        signal.signal(signal.SIGCHLD, signal.SIG_DFL)
        resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (PROCS_MAX, PROCS_MAX))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        # дроп привилегий до непривилегированного user (однократный дроп)
        uid = gid = 11001
        if os.getuid() == 0:
            os.setgid(gid)
            os.setuid(uid)
        os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
        os.close(master); os.close(slave)
        try:
            import fcntl
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        except Exception:
            pass
        os.chdir(HOME)
        env['PS1'] = r'user@alice:\w$ '
        os.execve('/bin/bash', ['bash', '--noprofile', '--norc', '--noediting', '-i'], env)
        os._exit(127)
    os.close(slave)
    os.set_blocking(master, False)
    out_budget = [OUT_CMD]
    out_total = [OUT_TOTAL]
    pending = [b'']
    idle = [time.monotonic()]
    stop = threading.Event()

    def reader():
        try:
            while not stop.is_set():
                r, _, _ = select.select([master], [], [], 1.0)
                if r:
                    try:
                        chunk = os.read(master, 4096)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        break
                    out_budget[0] -= len(chunk)
                    out_total[0] -= len(chunk)
                    if out_total[0] < 0 or out_budget[0] < 0:
                        ws.send('\r\n[вывод превышает лимит, сессия закрыта]\r\n')
                        break
                    ws.send(chunk, op=2)
                    # свежий prompt = shell снова готов принимать команды
                    pending[0] = (pending[0] + chunk)[-512:]
                    if PROMPT_RE.search(pending[0]):
                        stdin_mode.discard(user_token)
                        post_submit.discard(user_token)
                        st = EDIT.get(user_token)
                        if st:
                            st['busy'] = False
                            st['raw'] = False
                            st['line'] = ''
                            st['pos'] = 0
                            st['hidx'] = len(st['hist'])
                            st['draft'] = ''
                            st['inbuf'] = ''
                elif time.monotonic() - idle[0] > 600:
                    ws.send('\r\n[сессия закрыта по таймауту простоя]\r\n')
                    break
        except OSError:
            pass
        ws.shutdown()

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()
    st = EDIT[user_token]
    try:
        while True:
            data = ws.recv()
            if data is None:
                break
            idle[0] = time.monotonic()
            if not data:
                continue
            handle_input(ws, master, user_token, st, data.decode('utf-8', 'replace'), out_budget)
    finally:
        stdin_mode.discard(user_token)
        post_submit.discard(user_token)
        stop.set()
        reader_thread.join(3)
        os.close(master)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def version_string(self):
        return 'ALICE'

    def session(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['sid'].value if 'sid' in jar else ''
        except Exception:
            token = ''
        with LOCK:
            return SESSIONS.get(token)

    def send(self, status, content, ctype='text/html; charset=utf-8', cookie=None):
        body = content.encode() if isinstance(content, str) else content
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', f'sid={cookie}; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/health':
            return self.send(200, 'ok', 'text/plain')
        if path == '/':
            return self.send(200, INDEX)
        if path == '/login' and 'websocket' not in (self.headers.get('Upgrade') or '').lower():
            with LOCK:
                if len(SESSIONS) > 4096:  # prune старых сессий
                    for k in list(SESSIONS)[:len(SESSIONS) - 2048]:
                        SESSIONS.pop(k, None)
                token = secrets.token_urlsafe(32)
                SESSIONS[token] = {'csrf': secrets.token_urlsafe(32), 'auth': False}
                csrf = SESSIONS[token]['csrf']
            return self.send(200, LOGIN.replace('__CSRF__', csrf).replace('__MSG__', ''), cookie=token)
        if path == '/console':
            if not (self.session() or {}).get('auth'):
                self.redirect('/login')
                return
            return self.send(200, CONSOLE)
        if path == '/ws':
            if not (self.session() or {}).get('auth'):
                return self.send(403, 'forbidden', 'text/plain')
            origin = self.headers.get('Origin') or ''
            if origin and urlsplit(origin).netloc != (self.headers.get('Host') or ''):
                return self.send(403, 'forbidden', 'text/plain')
            if not self.headers.get('Sec-WebSocket-Key'):
                return self.send(400, 'bad request', 'text/plain')
            ip = self.headers.get('X-Real-IP') or self.client_address[0]
            with LOCK:
                busy = sum(ACTIVE.values()) >= MAX_SESSIONS or ACTIVE[ip] >= MAX_SESSIONS_PER_IP
                if not busy:
                    ACTIVE[ip] += 1
            ws = WS(self.rfile, self.wfile, self.headers, self.connection)
            if busy:
                ws.send('\r\n[консоль занята, повторное подключение]\r\n')
                return
            token = uuid.uuid4().hex
            EDIT[token] = new_edit_state()
            try:
                pty_session(ws, token)
            finally:
                EDIT.pop(token, None)
                with LOCK:
                    ACTIVE[ip] -= 1
                    if ACTIVE[ip] <= 0:
                        del ACTIVE[ip]
            return
        return self.send(404, 'not found', 'text/plain')

    def redirect(self, to):
        self.send_response(303)
        self.send_header('Location', to)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        path = self.path.split('?')[0]
        length = int(self.headers.get('Content-Length', '0') or 0)
        if not 0 < length <= 2048:
            return self.send(400, 'bad request', 'text/plain')
        raw = self.rfile.read(length)
        if path != '/login':
            return self.send(404, 'not found', 'text/plain')
        fields = parse_qs(raw.decode('utf-8', 'replace'), keep_blank_values=True)
        session = self.session()
        csrf = fields.get('csrf', [''])[0]
        if not session or not secrets.compare_digest(session['csrf'].encode(), csrf.encode()):
            return self.send(403, LOGIN.replace('__CSRF__', 'x').replace('__MSG__', 'Неверный запрос.'))
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
            return self.send(429, LOGIN.replace('__CSRF__', 'x').replace('__MSG__', 'Попробуйте позже.'))
        username = fields.get('username', [''])[0]
        password = fields.get('password', [''])[0]
        if secrets.compare_digest(username.encode(), b'user') and bcrypt.checkpw(password[:256].encode(), HASH):
            session['auth'] = True
            return self.redirect('/console')
        return self.send(401, LOGIN.replace('__CSRF__', 'x').replace('__MSG__', 'Неверный логин или пароль.'))


if __name__ == '__main__':
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    resource.setrlimit(resource.RLIMIT_NOFILE, (8192, resource.getrlimit(resource.RLIMIT_NOFILE)[1]))
    srv = ThreadingHTTPServer(('0.0.0.0', 8080), Handler)
    srv.daemon_threads = True
    print('console on :8080', flush=True)
    srv.serve_forever()
