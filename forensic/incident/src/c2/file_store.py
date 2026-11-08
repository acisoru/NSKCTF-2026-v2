import os
import pathlib
import threading

MAX_FILE = 4 * 1024 * 1024
MAX_ID = 1000000

SEED_FILES = (
    (
        ".env",
        "LOGGW_LISTEN=0.0.0.0:8443\n"
        "LOGGW_UPSTREAM=https://archive.lab.internal:9200\n"
        "API_KEY=366bcca6531c49c497272c98130e6475\n"
        "DB_URL=postgres://loggw:9wRt2mXe@127.0.0.1:5432/loggateway\n"
        "JWT_SECRET=8ac86b1f9a5716a180a1f1c5b2da9b86\n",
    ),
    (
        "gateway.conf",
        "server {\n"
        "  listen 8443 ssl;\n"
        "  server_name log-gw-07;\n"
        "  access_log /var/log/loggateway/access.log;\n"
        "  location /ingest { proxy_pass http://127.0.0.1:8080; }\n"
        "}\n",
    ),
    (
        "auth-snippet.log",
        "Accepted publickey for root from 10.40.5.55 port 51422 ssh2\n"
        "session opened for user loggw by (uid=0)\n"
        "Failed password for invalid user backup from 198.51.100.7 port 44210 ssh2\n",
    ),
    ("flag.txt", None),
    (
        "sysinfo.txt",
        "hostname=log-gw-07\nkernel=7.0.0-38-generic\ncpus=16\nuptime=41d\n",
    ),
    ("task-0042.log", "ex_command id=42 cmd='cat /etc/hostname' exit=0\nlog-gw-07\n"),
    ("heartbeat.log", "23s poll jitter<=7s last=accepted\n"),
    ("notes.tmp", "rotate beacon identity weekly\n"),
)


class FileStore:
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.lock = threading.Lock()
        self.next_id = 1
        for entry in self.root.iterdir():
            if entry.name.isdigit():
                self.next_id = max(self.next_id, int(entry.name) + 1)

    def seed(self, flag):
        with self.lock:
            if any(self.root.iterdir()):
                return
            self.root.mkdir(parents=True, exist_ok=True)
            for name, content in SEED_FILES:
                if name == "flag.txt":
                    content = flag
                path = self.root / str(self.next_id)
                path.write_bytes(content.encode())
                (self.root / f"{self.next_id}.name").write_text(name + "\n")
                self.next_id += 1

    def save(self, data):
        if not data or len(data) > MAX_FILE:
            raise ValueError("upload size out of range")
        with self.lock:
            file_id = self.next_id
            if file_id >= MAX_ID:
                raise ValueError("store exhausted")
            (self.root / str(file_id)).write_bytes(data)
            (self.root / f"{file_id}.name").write_text("upload.bin\n")
            self.next_id += 1
        return file_id

    def load(self, file_id):
        if not 1 <= file_id < MAX_ID:
            return None
        path = self.root / str(file_id)
        try:
            return path.read_bytes()
        except OSError:
            return None


def open_store():
    root = pathlib.Path(os.environ.get("C2_FILE_STORE", "/store"))
    root.mkdir(parents=True, exist_ok=True)
    store = FileStore(root)
    store.seed(os.environ["C2_FLAG"])
    return store
