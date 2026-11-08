import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from uvicorn import run

from src import API
from src.configurations import main_config as mc
from src.database import SessionLocal, create_tables
from src.database.tables import AccessLog, Badge, Staff
from src.log import config

logging.config.dictConfig(config)

logger = logging.getLogger(__name__)


BADGES_SEED = [
    Badge(name="dr. Demon", clearance="001"),
    Badge(name="mr. Fade", clearance="002"),
    Badge(name="mr. S", clearance="003"),
]

ACCESS_LOG_SEED = [
    AccessLog(log_date="2018-01-15", username="dr. Demon", room="серверная", device="RDR-01", status="разрешено"),
    AccessLog(log_date="2018-01-29", username="mr. S", room="склад", device="RDR-03", status="разрешено"),
    AccessLog(log_date="2018-02-08", username="mr. Fade", room="пультовая", device="RDR-02", status="разрешено"),
    AccessLog(log_date="2018-02-21", username="mr. S", room="архив", device="RDR-04", status="отказано"),
    AccessLog(log_date="2018-03-11", username="dr. Demon", room="серверная", device="RDR-01", status="разрешено"),
    AccessLog(log_date="2018-03-27", username="mr. Fade", room="склад", device="RDR-03", status="разрешено"),
    AccessLog(log_date="2018-04-02", username="mr. Fade", room="пультовая", device="RDR-02", status="разрешено"),
    AccessLog(log_date="2018-04-19", username="dr. Demon", room="архив", device="RDR-04", status="разрешено"),
    AccessLog(log_date="2018-05-17", username="mr. S", room="архив", device="RDR-04", status="разрешено"),
    AccessLog(log_date="2018-06-01", username="mr. Fade", room="серверная", device="RDR-01", status="отказано"),
    AccessLog(log_date="2018-06-23", username="dr. Demon", room="склад", device="RDR-03", status="разрешено"),
    AccessLog(log_date="2018-07-14", username="mr. S", room="пультовая", device="RDR-02", status="разрешено"),
    AccessLog(log_date="2018-08-05", username="dr. Demon", room="пультовая", device="RDR-02", status="разрешено"),
    AccessLog(log_date="2018-08-30", username="mr. Fade", room="архив", device="RDR-04", status="разрешено"),
    AccessLog(log_date="2018-09-18", username="mr. S", room="серверная", device="RDR-01", status="разрешено"),
    AccessLog(log_date="2018-10-04", username="mr. S", room="серверная", device="RDR-01", status="разрешено"),
]

STAFF_SEED = [
    Staff(username="dr_demon", password="d3m0n_2018", note="допуск 001, смена днём"),
    Staff(username="mr_fade", password="f4d3_2018", note="допуск 002, смена днём"),
    Staff(username="night_shift", password="n1ght'sh1ft2018", note="с 2018 не меняли"),
]


async def seed_database() -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(Staff))
        if result.scalars().first() is not None:
            logger.info("The database is already filled, skipping seed")
            return

        session.add_all(BADGES_SEED)
        session.add_all(ACCESS_LOG_SEED)
        session.add_all(STAFF_SEED)
        await session.commit()
        logger.info("Archive data for 2018 has been uploaded")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Start of the access panel of Laboratory X")
    logger.info("Creating database tables")
    await create_tables()
    await seed_database()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="LabXAccessPanel",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    logger.info("App initialized")

    app.include_router(API.archive_router)
    app.include_router(API.auth_router)
    app.include_router(API.panel_router)
    app.include_router(API.support_router)
    app.include_router(API.alerts_router)

    logger.info("Routers connected")

    return app


app = create_app()
app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    run("main:app", host="0.0.0.0", port=mc.app_port)
