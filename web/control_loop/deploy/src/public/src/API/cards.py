import datetime
import logging
import random

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import SourceBlocked, extract_url, fetch_source, require_user
from src.database import CardManager, get_db

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/cards", tags=["Pages"])
async def cards_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    token_data = require_user(request)
    manager = CardManager(db_session)
    filter_query = request.query_params.get("filter", "").strip()
    if filter_query:
        cards = await manager.search(token_data["sub"], filter_query)
    else:
        cards = await manager.list_by_user(token_data["sub"])
    return templates.TemplateResponse(
        request=request,
        name="cards.html",
        context={
            "request": request,
            "user": token_data["username"],
            "cards": cards,
            "filter_query": filter_query,
            "error": None,
        },
    )


@router.get("/cards/preview", tags=["Cards"])
async def preview_source(request: Request):
    require_user(request)
    source_url = request.query_params.get("source_url", "").strip()
    if not source_url:
        return JSONResponse({"error": "source_url is required"}, status_code=400)

    logger.info(f"Preview requested {source_url=}")
    try:
        status, body = await fetch_source(source_url)
    except SourceBlocked as exc:
        logger.info(f"SSRF filter rejected {source_url=} reason={exc.reason}")
        return JSONResponse({"error": exc.reason}, status_code=403)
    except httpx.HTTPError:
        logger.info(f"Fetch failed {source_url=}")
        return JSONResponse({"error": "fetch failed"}, status_code=502)

    return JSONResponse({"status": status, "preview": body}, status_code=status)


@router.post("/cards/create", tags=["Cards"])
async def create_card(request: Request, db_session: AsyncSession = Depends(get_db)):
    token_data = require_user(request)
    form = await request.form()
    description = str(form.get("description", "")).strip()[:1024]
    logger.info("Card creation requested")

    manager = CardManager(db_session)
    source_url = extract_url(description)
    preview = None
    if source_url:
        try:
            _, preview = await fetch_source(source_url)
        except SourceBlocked as exc:
            logger.info(f"SSRF filter rejected {source_url=} reason={exc.reason}")
        except httpx.HTTPError:
            logger.info(f"Fetch failed {source_url=}")

    await manager.create(
        user_id=token_data["sub"],
        anomaly_number=random.randint(1, 847),
        log_date=datetime.date.today().isoformat(),
        description=description or "без описания",
        source_url=source_url,
        preview=preview,
    )

    cards = await manager.list_by_user(token_data["sub"])
    return templates.TemplateResponse(
        request=request,
        name="cards.html",
        context={
            "request": request,
            "user": token_data["username"],
            "cards": cards,
            "filter_query": "",
            "error": None,
        },
    )
