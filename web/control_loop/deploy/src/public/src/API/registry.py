import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.API.api_config import templates
from src.API.functions import require_operator, verify_session
from src.database import RegistryManager, get_db

logger = logging.getLogger(__name__)
router = APIRouter()

INT32_MAX = 2147483647

EXPORT_TEMPLATES = {
    "registry.csv": ("clearance,name,operator", lambda e: f"{e.clearance},{e.name},{e.operator}"),
    "registry_full.csv": (
        "clearance,name,operator,note",
        lambda e: f"{e.clearance},{e.name},{e.operator},{e.note}",
    ),
}


@router.get("/registry", tags=["Pages"])
async def registry_page(request: Request, db_session: AsyncSession = Depends(get_db)):
    require_operator(request)

    sort = request.query_params.get("sort")
    entries = await RegistryManager(db_session).list_visible(sort)
    return templates.TemplateResponse(
        request=request,
        name="registry.html",
        context={
            "request": request,
            "user": verify_session(request),
            "entries": entries,
            "sort": sort,
        },
    )


@router.get("/registry/export", tags=["Registry"])
async def registry_export(request: Request, db_session: AsyncSession = Depends(get_db)):
    require_operator(request)

    filename = request.query_params.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")

    template = EXPORT_TEMPLATES.get(filename)
    if template is None:
        logger.info(f"Export requested for unknown template {filename=}")
        raise HTTPException(status_code=404, detail="шаблон экспорта не найден")

    header, row_fn = template
    entries = await RegistryManager(db_session).list_visible()
    lines = [header] + [row_fn(entry) for entry in entries]

    logger.info(f"Registry exported {filename=}")
    return Response(
        content="\n".join(lines),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/registry/entry", tags=["Registry"])
async def registry_entry(request: Request, db_session: AsyncSession = Depends(get_db)):
    require_operator(request)

    raw_id = request.query_params.get("id", "")
    try:
        entry_id = int(raw_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="некорректный идентификатор записи")

    if not -INT32_MAX - 1 <= entry_id <= INT32_MAX:
        raise HTTPException(status_code=400, detail="некорректный идентификатор записи")

    entry = await RegistryManager(db_session).get_by_id(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="запись не найдена")

    logger.info(f"Registry entry opened {entry_id=}")
    return templates.TemplateResponse(
        request=request,
        name="registry_entry.html",
        context={
            "request": request,
            "user": verify_session(request),
            "entry": entry,
        },
    )
