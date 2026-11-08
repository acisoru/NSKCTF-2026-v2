import hmac
import http.server
import json
import os
import pathlib
import threading
import traceback
from runtime import start_ovs, verify

token = os.environ.get('CHECKER_TOKEN') or pathlib.Path(os.environ.get('CHECKER_TOKEN_FILE', '/secrets/checker')).read_text().strip()
if len(token) < 32:
    raise ValueError('A strong checker token is required')
capacity = threading.BoundedSemaphore(1)


class Handler(http.server.BaseHTTPRequestHandler):
    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.reply(200 if self.path == '/healthz' else 404, {'ok': self.path == '/healthz'})

    def do_POST(self):
        if self.path != '/verify' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            self.reply(403, {'error': 'Forbidden'}); return
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 131072:
                self.reply(413, {'error': 'Too large'}); return
            self.connection.settimeout(160)
            data = json.loads(self.rfile.read(length))
        except (ValueError, TimeoutError):
            self.reply(400, {'error': 'Invalid request'}); return
        if not capacity.acquire(blocking=False):
            self.reply(503, {'error': 'Worker busy'}); return
        try:
            self.reply(200, verify(data))
        except ValueError as error:
            self.reply(400, {'error': str(error)})
        except Exception:
            traceback.print_exc()
            self.reply(500, {'error': 'Network verification failed; no result awarded'})
        finally:
            capacity.release()

    def log_message(self, fmt, *args):
        print('checker: ' + fmt % args, flush=True)


os.chmod('/opt/checker/dhcp.py', 0o755)
start_ovs()
print('Isolated network checker ready', flush=True)
http.server.ThreadingHTTPServer(('0.0.0.0', 9134), Handler).serve_forever()
