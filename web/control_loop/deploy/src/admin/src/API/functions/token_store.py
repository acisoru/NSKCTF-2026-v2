import secrets

from fastapi import Request

MAINTENANCE_TOKEN = secrets.token_hex(12)
MAINTENANCE_HEADER = "X-Maintenance-Token"
TOKEN_PARAM_NAMES = ("token", "access_token", "api_key")


def check_token(request: Request) -> bool:
    supplied = request.headers.get(MAINTENANCE_HEADER)
    if not supplied:
        for name in TOKEN_PARAM_NAMES:
            supplied = request.query_params.get(name)
            if supplied:
                break
    return supplied == MAINTENANCE_TOKEN


def get_internal_user(request: Request) -> str | None:
    return request.headers.get("X-Internal-User") or request.query_params.get("internal_user")
