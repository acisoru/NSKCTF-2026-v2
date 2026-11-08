import logging
import random

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import get_token_data, verify_session
from src.database import StateManager, SupportManager, get_db

logger = logging.getLogger(__name__)
router = APIRouter()

TOPIC_LABELS = {
    "login": "проблема со входом",
    "cards": "карточки аномалий",
    "telemetry": "телеметрия узла",
    "other": "другое",
}


@router.get("/", tags=["Pages"])
async def home_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"request": request, "user": verify_session(request)},
    )


@router.get("/bulletin", tags=["Pages"])
async def bulletin_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="bulletin.html",
        context={"request": request, "user": verify_session(request)},
    )


@router.get("/changelog", tags=["Pages"])
async def changelog_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    state = await StateManager(db_session).get()
    return templates.TemplateResponse(
        request=request,
        name="changelog.html",
        context={
            "request": request,
            "user": verify_session(request),
            "last_check": state.last_update_check,
            "check_count": state.update_check_count or 0,
        },
    )


@router.get("/changelog/check", tags=["Pages"])
async def changelog_check(db_session: AsyncSession = Depends(get_db)):
    logger.info("Update check requested")
    state = await StateManager(db_session).record_update_check()
    return JSONResponse(
        {
            "current": "2018.11-r4",
            "latest": "2018.11-r4",
            "up_to_date": True,
            "checked_at": state.last_update_check,
            "check_count": state.update_check_count,
            "message": "установлена актуальная сборка 2018.11-r4",
        }
    )


@router.get("/diagnostics", tags=["Pages"])
async def diagnostics_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    state = await StateManager(db_session).get()
    sensors = [
        {"code": "PWR", "name": "питание основное", "value": f"{random.randint(214, 223)} В", "ok": True},
        {"code": "PWR", "name": "питание резервное", "value": "ожидание", "ok": True},
        {"code": "TMP", "name": "температура стойки", "value": f"{random.uniform(29.5, 33.5):.1f} °C", "ok": True},
        {"code": "HUM", "name": "влажность архива", "value": f"{random.randint(40, 49)} %", "ok": True},
        {"code": "FAN", "name": "вентиляция серверной", "value": "вкл", "ok": True},
        {"code": "NET", "name": "канал телеметрии", "value": "стабилен", "ok": True},
        {"code": "NET", "name": "резервный контур связи", "value": "не используется", "ok": False},
    ]
    return templates.TemplateResponse(
        request=request,
        name="diagnostics.html",
        context={
            "request": request,
            "user": verify_session(request),
            "sensors": sensors,
            "last_selftest": state.last_selftest,
            "selftest_count": state.selftest_count or 0,
        },
    )


@router.get("/diagnostics/selftest", tags=["Pages"])
async def diagnostics_selftest(db_session: AsyncSession = Depends(get_db)):
    logger.info("Node self-test requested")
    state = await StateManager(db_session).record_selftest()
    checks = random.randint(23, 27)
    return JSONResponse(
        {
            "checks": checks,
            "failed": 0,
            "ran_at": state.last_selftest,
            "selftest_count": state.selftest_count,
            "message": f"самопроверка завершена: {checks} проверок, отклонений не выявлено",
        }
    )


@router.get("/admin", tags=["Pages"])
async def admin_dead_end(request: Request):
    logger.info("Public /admin dead end probed")
    raise HTTPException(status_code=403, detail="раздел доступен только с технического пути")


@router.get("/support", tags=["Pages"])
async def support_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    token_data = get_token_data(request)
    tickets = []
    if token_data is not None:
        tickets = await SupportManager(db_session).list_by_user(token_data["sub"])
    return templates.TemplateResponse(
        request=request,
        name="support.html",
        context={
            "request": request,
            "user": token_data["username"] if token_data else None,
            "tickets": tickets,
            "topic_labels": TOPIC_LABELS,
        },
    )


@router.post("/support/send", tags=["Support"])
async def send_support_request(request: Request, db_session: AsyncSession = Depends(get_db)):
    token_data = get_token_data(request)
    if token_data is None:
        raise HTTPException(status_code=401, detail="войдите, чтобы отправить обращение")

    form = await request.form()
    topic = str(form.get("topic", "other"))[:32]
    message = str(form.get("message", "")).strip()[:512]
    if not message:
        raise HTTPException(status_code=400, detail="сообщение не может быть пустым")

    ticket = await SupportManager(db_session).create(token_data["sub"], topic, message)
    return JSONResponse(
        {
            "status": ticket.status,
            "code": ticket.code,
            "message": f"обращение {ticket.code} зарегистрировано",
        }
    )
