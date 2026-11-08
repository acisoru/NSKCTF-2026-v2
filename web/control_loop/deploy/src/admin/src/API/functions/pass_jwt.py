import datetime
import logging

import jwt

from src.configurations import main_config as mc

logger = logging.getLogger(__name__)

OBSERVER_STATUS = "Observer"
OPERATOR_STATUS = "Operator"


def generate_pass_token(request_id: int, username: str, status: str = OPERATOR_STATUS) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": request_id,
        "username": username,
        "status": status,
        "iat": now,
        "exp": now + datetime.timedelta(minutes=mc.jwt_conf.expire),
    }
    try:
        return jwt.encode(payload, key=mc.jwt_conf.jwt_key, algorithm=mc.jwt_conf.algorithm)
    except Exception:
        logger.error("Error when generating the pass token", exc_info=True)
        raise
