import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import OPERATOR_STATUS, get_token_data, require_operator
from src.configurations import main_config as mc
from src.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/panel", tags=["Pages"])
async def panel_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    token_data = get_token_data(request)
    if token_data is None:
        logger.info("Attempt to open the panel without authorization")
        raise HTTPException(status_code=401, detail="Требуется вход в систему")

    user = token_data["username"]
    is_operator = token_data.get("status") == OPERATOR_STATUS
    logger.info(f"Opening the panel {user=} {is_operator=}")
    return templates.TemplateResponse(
        request=request,
        name="panel.html",
        context={"request": request, "user": user, "is_operator": is_operator},
    )


@router.get("/panel/export", tags=["Panel"])
async def export_protocol(request: Request):
    username = require_operator(request)

    filename = request.query_params.get("file", "export_2018.log")
    if filename.startswith("/") or filename.startswith("../") or "/../" in filename:
        logger.info(f"Attempted path traversal {filename=} {username=}")
        raise HTTPException(status_code=403, detail="Доступ запрещён")

    safe_name = filename.replace("../", "")
    path = os.path.join(mc.export_dir, safe_name)

    if not os.path.isfile(path):
        logger.info(f"Export file not found {safe_name=}")
        raise HTTPException(status_code=404, detail="Файл выгрузки не найден")

    logger.info(f"The protocol has been exported {safe_name=} {username=}")
    try:
        with open(path, "rb") as protocol_file:
            content = protocol_file.read()
    except OSError:
        logger.info(f"Export file cannot be read {safe_name=}")
        raise HTTPException(status_code=404, detail="Файл выгрузки не найден")

    return Response(content=content, media_type="text/plain")


@router.post("/panel/alerts/send", tags=["Panel"])
async def send_alert(request: Request):
    username = require_operator(request)
    await request.form()
    logger.info(f"Alert dispatch requested {username=}")

    return JSONResponse(
        {
            "status": "queued",
            "message": "Оповещение поставлено в очередь рассылки отделения.",
        }
    )
