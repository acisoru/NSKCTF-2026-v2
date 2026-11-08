import logging

from fastapi import APIRouter, Request

from src.API.api_config import templates
from src.API.functions import verify_session

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/alerts", tags=["Pages"])
async def alerts_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="alerts.html",
        context={"request": request, "user": verify_session(request)},
    )
