import os

from app.config import load_environment
import uvicorn


if __name__ == "__main__":
    load_environment()
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        access_log=True,
        server_header=False,
        limit_concurrency=128,
        timeout_keep_alive=10,
        forwarded_allow_ips=os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )
