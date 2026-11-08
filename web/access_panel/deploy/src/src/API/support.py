import logging
import random

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.API.api_config import templates
from src.API.functions import verify_session

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/support", tags=["Pages"])
async def support_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="support.html",
        context={"request": request, "user": verify_session(request)},
    )


@router.post("/support/send", tags=["Support"])
async def send_support_request(request: Request):
    await request.form()
    ticket = f"LX-{random.randint(100000, 999999)}"
    logger.info(f"Support request registered {ticket=}")

    return JSONResponse(
        {
            "status": "registered",
            "ticket": ticket,
            "message": f"Обращение зарегистрировано, номер {ticket}. "
            "Ответ поступит в порядке очереди.",
        }
    )
