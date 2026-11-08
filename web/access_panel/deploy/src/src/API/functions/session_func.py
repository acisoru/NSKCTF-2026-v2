import logging
from typing import Any

from fastapi import HTTPException, Request, Response

from src.API.functions.jwt_func import JWTConfig
from src.configurations import main_config as mc

logger = logging.getLogger(__name__)

COOKIE_NAME = "access_token"
OPERATOR_STATUS = "Operator"
STAFF_STATUS = "Staff"


def get_token_data(request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        return JWTConfig.decode_jwt_token(token)
    except HTTPException:
        return None


def verify_session(request: Request) -> str | None:
    token_data = get_token_data(request)
    if token_data is None:
        return None
    return token_data.get("username")


def set_session_cookie(response: Response, staff_id: int, username: str, is_operator: bool) -> None:
    status = OPERATOR_STATUS if is_operator else STAFF_STATUS
    token = JWTConfig.generate_jwt_token(
        {"sub": staff_id, "username": username, "status": status}
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=mc.jwt_conf.expire * 60,
        samesite="strict",
    )


def require_operator(request: Request) -> str:
    token_data = get_token_data(request)
    if token_data is None:
        logger.info("Attempt to access the panel without authorization")
        raise HTTPException(status_code=401, detail="Требуется вход в систему")
    if token_data.get("status") != OPERATOR_STATUS:
        logger.info(f"User {token_data.get('username')=} has insufficient clearance")
        raise HTTPException(status_code=403, detail="Недостаточно допуска")
    return token_data["username"]
