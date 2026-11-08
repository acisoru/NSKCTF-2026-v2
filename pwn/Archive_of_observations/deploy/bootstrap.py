import os
import secrets
from pathlib import Path

import bcrypt

password = secrets.token_urlsafe(24)
Path('/formatter-secret/secret').write_text(password)
Path('/web-secret/hash').write_bytes(bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)))
Path('/web-secret/flag').write_text(os.environ['FLAG'])
os.chown('/formatter-secret/secret', 10001, 10001)
for name in ('hash', 'flag'):
    os.chown('/web-secret/' + name, 10002, 10002)
    os.chmod('/web-secret/' + name, 0o400)
os.chmod('/formatter-secret/secret', 0o400)
os.chown('/run/alice', 10001, 10001)
os.chmod('/run/alice', 0o755)
