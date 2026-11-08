import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import HashPassword, set_session_cookie, verify_session
from src.database import UserManager, get_db

logger = logging.getLogger(__name__)
router = APIRouter()
hasher = HashPassword()


@router.get("/login", tags=["Pages"])
async def login_page(request: Request, registered: str | None = None):
    notice = "Регистрация прошла успешно, теперь можно войти." if registered else None
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={
            "request": request,
            "user": verify_session(request),
            "notice": notice,
            "error": None,
        },
    )


@router.get("/register", tags=["Pages"])
async def register_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="register.html",
        context={
            "request": request,
            "user": verify_session(request),
            "error": None,
        },
    )


@router.post("/register", tags=["Auth"], status_code=302)
async def register_endpoint(request: Request, db_session: AsyncSession = Depends(get_db)):
    form = await request.form()
    username = str(form.get("username", "")).strip()
    password = str(form.get("password", ""))
    logger.info(f"Registration attempt {username=}")

    manager = UserManager(db_session)
    if not username or not password:
        response = templates.TemplateResponse(
            request=request,
            name="register.html",
            context={
                "request": request,
                "user": None,
                "error": "Укажите имя наблюдателя и пароль",
            },
        )
        response.status_code = 400
        return response

    existing = await manager.get_by_username(username)
    if existing is not None:
        response = templates.TemplateResponse(
            request=request,
            name="register.html",
            context={
                "request": request,
                "user": None,
                "error": "Такой наблюдатель уже зарегистрирован",
            },
        )
        response.status_code = 409
        return response

    await manager.create(username, hasher.create_hash(password))
    logger.info(f"Observer registered {username=}")
    return RedirectResponse(url="/login?registered=1", status_code=302)


@router.post("/login", tags=["Auth"], status_code=302)
async def login_endpoint(request: Request, db_session: AsyncSession = Depends(get_db)):
    form = await request.form()
    username = str(form.get("username", ""))
    password = str(form.get("password", ""))
    logger.info(f"Login attempt {username=}")

    user = await UserManager(db_session).get_by_username(username)
    if user is None or not hasher.verify_hash(password, user.hash_password):
        logger.info(f"Invalid credentials {username=}")
        response = templates.TemplateResponse(
            request=request,
            name="login.html",
            context={
                "request": request,
                "user": None,
                "notice": None,
                "error": "Неверное имя наблюдателя или пароль",
            },
        )
        response.status_code = 401
        return response

    response = RedirectResponse(url="/cards", status_code=302)
    set_session_cookie(response, user.id, user.username)
    logger.info(f"Observer {username} is authorized")
    return response


@router.get("/logout", tags=["Auth"], status_code=302)
async def logout_endpoint(request: Request):
    logger.info("Request to log out of your account /logout")
    redirect = RedirectResponse("/", status_code=302)
    redirect.delete_cookie(key="access_token", httponly=True, samesite="strict")
    return redirect
