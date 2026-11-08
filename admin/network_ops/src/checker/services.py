import http.server
import socket
import threading


class Archive(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"LABX ARCHIVE ONLINE\n")

    def log_message(self, *args):
        pass


def management():
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", 22))
    server.listen(8)
    while True:
        conn, _ = server.accept()
        with conn:
            conn.sendall(b"SSH-2.0-LabX_connectivity_probe\r\n")


threading.Thread(target=management, daemon=True).start()
http.server.ThreadingHTTPServer(("0.0.0.0", 80), Archive).serve_forever()
