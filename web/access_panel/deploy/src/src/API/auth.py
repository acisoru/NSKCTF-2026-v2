import hmac
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import COOKIE_NAME, set_session_cookie, verify_session
from src.database import StaffManager, get_db

logger = logging.getLogger(__name__)
router = APIRouter()


def render_login(request: Request, error: str | None):
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={
            "request": request,
            "user": verify_session(request),
            "error": error,
        },
    )


@router.get("/login", tags=["Pages"])
async def login_page(request: Request):
    return render_login(request, None)


@router.post("/login", tags=["Auth"], status_code=302)
async def login_endpoint(request: Request, db_session: AsyncSession = Depends(get_db)):
    form = await request.form()
    username = str(form.get("username", ""))
    password = str(form.get("password", ""))
    logger.info(f"Login attempt {username=}")

    staff = await StaffManager(db_session).get_by_username(username)
    if staff is None or not hmac.compare_digest(password, staff.password):
        logger.info(f"Invalid credentials {username=}")
        response = render_login(request, "Неверный логин или пароль")
        response.status_code = 401
        return response

    response = RedirectResponse(url="/panel", status_code=302)
    is_operator = staff.username == "night_shift"
    set_session_cookie(response, staff.id, staff.username, is_operator)
    logger.info(f"Employee {username} is authorized")
    return response


@router.get("/logout", tags=["Auth"], status_code=302)
async def logout_endpoint(request: Request):
    logger.info("Request to log out of your account /logout")
    redirect = RedirectResponse("/", status_code=302)
    redirect.delete_cookie(key=COOKIE_NAME, httponly=True, samesite="strict")
    return redirect
