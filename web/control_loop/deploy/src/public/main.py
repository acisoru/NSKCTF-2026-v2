import logging
import logging.config
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from uvicorn import run

from src import API
from src.API.api_config import templates
from src.API.functions import verify_session
from src.configurations import main_config as mc
from src.database import SessionLocal, create_tables
from src.database.tables import RegistryEntry
from src.log import config

logging.config.dictConfig(config)

logger = logging.getLogger(__name__)


HIDDEN_ENTRY_ID = secrets.randbelow(14000) + 1000

REGISTRY_SEED = [
    RegistryEntry(
        id=1,
        name="mr. S",
        clearance="003",
        operator="night_shift",
        note="допуск выдан, действующий",
        visible=True,
    ),
    RegistryEntry(
        id=2,
        name="dr. Demon",
        clearance="002",
        operator="night_shift",
        note="допуск выдан, действующий",
        visible=True,
    ),
    RegistryEntry(
        id=3,
        name="mr. Fade",
        clearance="001",
        operator="day_shift",
        note="допуск выдан, действующий",
        visible=True,
    ),
    RegistryEntry(
        id=HIDDEN_ENTRY_ID,
        name="[———]",
        clearance="000",
        operator="[———]",
        note=(
            "допуск 000 — резервный, не выдан\n"
            "история входов:\n"
            "2018-11-02 03:12 | архив | оператор [———]\n"
            f"FLAG={mc.flag}"
        ),
        visible=False,
    ),
]


async def seed_database() -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(RegistryEntry))
        if result.scalars().first() is not None:
            logger.info("The database is already filled, skipping seed")
            return

        session.add_all(REGISTRY_SEED)
        await session.commit()
        logger.info("Registry seed data has been uploaded")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Start of the public terminal of Laboratory X")
    logger.info("Creating database tables")
    await create_tables()
    await seed_database()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="LabXControlTerminal",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    logger.info("App initialized")

    app.include_router(API.pages_router)
    app.include_router(API.auth_router)
    app.include_router(API.cards_router)
    app.include_router(API.registry_router)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        return templates.TemplateResponse(
            request=request,
            name="error.html",
            status_code=exc.status_code,
            context={
                "request": request,
                "user": verify_session(request),
                "status_code": exc.status_code,
                "detail": exc.detail,
            },
        )

    logger.info("Routers connected")

    return app


app = create_app()
app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    run("main:app", host="0.0.0.0", port=mc.app_port)
