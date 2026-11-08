import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import verify_session
from src.database import get_db
from src.database.tables import AccessLog, Badge

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_default_log(db_session: AsyncSession) -> list[dict]:
    result = await db_session.execute(select(AccessLog).order_by(AccessLog.log_date))
    rows = result.scalars().all()
    return [
        {
            "log_date": row.log_date,
            "username": row.username,
            "room": row.room,
            "device": row.device,
            "status": row.status,
        }
        for row in rows
    ]


@router.get("/", tags=["Pages"])
async def index_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    result = await db_session.execute(select(Badge).order_by(Badge.clearance))
    badges = result.scalars().all()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "request": request,
            "badges": badges,
            "user": verify_session(request),
        },
    )


@router.get("/journal", tags=["Pages"])
async def journal_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    return templates.TemplateResponse(
        request=request,
        name="journal.html",
        context={
            "request": request,
            "log_rows": await get_default_log(db_session),
            "user": verify_session(request),
        },
    )


@router.post("/archive/access-log", tags=["Archive"])
async def sort_access_log(
    request: Request, db_session: AsyncSession = Depends(get_db)
):
    form = await request.form()
    sort = str(form.get("sort", "log_date"))
    logger.info(f"Sorting the issue log {sort=}")

    default_rows = await get_default_log(db_session)
    try:
        query = text(
            f"SELECT log_date, username, room, device, status FROM access_log ORDER BY {sort}"
        )
        result = await db_session.execute(query)
        rows = [
            {
                "log_date": row.log_date,
                "username": row.username,
                "room": row.room,
                "device": row.device,
                "status": row.status,
            }
            for row in result.all()
        ]
    except Exception:
        logger.info("The sorting was completed with the default order")
        rows = default_rows

    return JSONResponse({"rows": rows})
