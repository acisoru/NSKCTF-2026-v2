#!/usr/bin/env python3
"""TCP-кромка: единственный вход к консоли. Сама консоль живёт во внутренней сети."""
import os
import socket
import threading

LISTEN = ('0.0.0.0', int(os.environ.get('EDGE_PORT', '8080')))
UPSTREAM = os.environ.get('UPSTREAM', 'forensic_console:8080')
_host, _port = UPSTREAM.rsplit(':', 1)
UP = (_host, int(_port))


def pump(src, dst):
    try:
        while True:
            chunk = src.recv(65536)
            if not chunk:
                break
            dst.sendall(chunk)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client):
    try:
        server = socket.create_connection(UP, timeout=10)
        server.settimeout(None)
    except OSError:
        client.close()
        return
    threading.Thread(target=pump, args=(client, server), daemon=True).start()
    pump(server, client)
    client.close()
    server.close()


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(128)
    while True:
        client, _ = srv.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == '__main__':
    main()
