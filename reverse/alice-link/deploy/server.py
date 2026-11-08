#!/usr/bin/env python3
"""ALICE link server: challenge-response, binary packet, flag in env only."""
import hashlib
import hmac
import os
import secrets
import socket
import struct
import threading
import time

HOST = '0.0.0.0'
PORT = int(os.environ.get('PORT', '23231'))
FLAG = os.environ['FLAG']
MASTER = bytes.fromhex(os.environ['KEY_HEX'])
MAGIC = b'AL1C'
VERSION = 3
PKT_TYPE = 0x10
SESSION_TTL = 60.0
LIMIT_INSTANCE = (10, 60.0)
LIMIT_IP = (30, 60.0)

sessions = {}
send_times = []
ip_times = {}
lock = threading.Lock()


def derive_session_key(challenge):
    return hmac.new(MASTER, b'AL1C/3/' + challenge, hashlib.sha256).digest()


def peek_session(token):
    now = time.monotonic()
    with lock:
        item = sessions.get(token)
        if item is None or now - item[0] > SESSION_TTL:
            return None
        return item[1], item[2]


def take_session(token):
    now = time.monotonic()
    with lock:
        item = sessions.pop(token, None)
        if item is None or now - item[0] > SESSION_TTL:
            return None
        return item[1], item[2]


def issue_session(conn):
    nonce = secrets.token_bytes(16)
    challenge = secrets.token_bytes(16)
    with lock:
        now = time.monotonic()
        for key in [key for key, value in sessions.items() if now - value[0] > SESSION_TTL]:
            del sessions[key]
        sessions[conn] = (now, nonce, challenge)
    return nonce, challenge


def limited(key, store, cap, window):
    now = time.monotonic()
    with lock:
        times = store(key)
        while times and times[0] < now - window:
            times.pop(0)
        if len(times) >= cap:
            return True
        times.append(now)
        return False


def handle(conn, addr):
    conn.settimeout(75)
    try:
        conn.sendall(b'ALICE-LINK 1.2 READY\n')
        buf = b''
        while True:
            try:
                chunk = conn.recv(4096)
            except socket.timeout:
                return
            if not chunk:
                return
            buf += chunk
            if b'\n' in buf:
                line, _, rest = buf.partition(b'\n')
                buf = rest
                if not respond(conn, line.strip(), addr):
                    return
    finally:
        conn.close()


def respond(conn, line, addr):
    parts = line.split()
    if not parts:
        return True
    cmd = parts[0].upper()
    if cmd == b'CONNECT':
        nonce, challenge = issue_session(conn)
        conn.sendall(
            b'OK nonce=' + nonce.hex().encode() +
            b' challenge=' + challenge.hex().encode() + b'\n'
        )
        return True
    if cmd == b'SEND':
        if limited('inst', lambda _: send_times, *LIMIT_INSTANCE):
            conn.sendall(b'429 rate limited\n')
            return False
        if limited(addr[0], lambda key: ip_times.setdefault(key, []), *LIMIT_IP):
            conn.sendall(b'429 rate limited\n')
            return False
        if len(parts) < 2:
            conn.sendall(b'ERR invalid combination\n')
            return True
        try:
            data = bytes.fromhex(parts[1].decode())
        except ValueError:
            conn.sendall(b'ERR invalid combination\n')
            return True
        conn.sendall(verify(data, conn) + b'\n')
        return True
    conn.sendall(b'ERR invalid combination\n')
    return True


def verify(data, conn):
    if len(data) < 4 + 2 + 1 + 1 + 2 + 16 + 32:
        return b'ERR invalid combination'
    magic = data[:4]
    version, pkt_type, _res, plen = struct.unpack('>HBBH', data[4:10])
    if magic != MAGIC or version != VERSION or pkt_type != PKT_TYPE:
        return b'ERR invalid combination'
    payload = data[10:10 + plen]
    nonce = data[10 + plen:10 + plen + 16]
    tag = data[10 + plen + 16:10 + plen + 16 + 32]
    if len(payload) != plen or len(data) != 10 + plen + 16 + 32:
        return b'ERR invalid combination'
    session = peek_session(conn)
    if session is None:
        return b'ERR invalid combination'
    expected_nonce, challenge = session
    if not hmac.compare_digest(expected_nonce, nonce):
        return b'ERR invalid combination'
    key = derive_session_key(challenge)
    if not hmac.compare_digest(hmac.new(key, data[:-32], hashlib.sha256).digest(), tag):
        return b'ERR invalid combination'
    if not valid_payload(payload):
        return b'ERR invalid combination'
    if take_session(conn) is None:
        return b'ERR invalid combination'
    return b'FLAG ' + FLAG.encode()


def valid_payload(payload):
    if len(payload) != 12:
        return False
    a, b, timestamp = struct.unpack('>III', payload)
    if a != 0x3E7 or b != 0x58414C:
        return False
    return abs(int(time.time()) - timestamp) <= 30


if __name__ == '__main__':
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT))
    srv.listen(64)
    print(f'alice-link server on {HOST}:{PORT}', flush=True)
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle, args=(conn, addr), daemon=True).start()
