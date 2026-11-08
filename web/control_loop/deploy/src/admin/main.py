import asyncio
import logging
import logging.config

from fastapi import FastAPI
import uvicorn

from src import API
from src.configurations import main_config as mc
from src.log import config

logging.config.dictConfig(config)

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(
        title="ControlLoopAdmin",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.include_router(API.status_router)
    app.include_router(API.maintenance_router)
    logger.info("Admin service initialized")
    return app


app = create_app()


async def serve_dual_stack() -> None:
    config_v4 = uvicorn.Config(app, host="127.0.0.1", port=mc.admin_port, log_config=None)
    config_v6 = uvicorn.Config(app, host="::1", port=mc.admin_port, log_config=None)
    server_v4 = uvicorn.Server(config_v4)
    server_v6 = uvicorn.Server(config_v6)
    logger.info("Starting admin service on 127.0.0.1 and ::1")
    await asyncio.gather(server_v4.serve(), server_v6.serve())


if __name__ == "__main__":
    asyncio.run(serve_dual_stack())
