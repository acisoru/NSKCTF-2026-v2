from typing import AsyncGenerator
import logging

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from src.configurations import main_config
from src.database.tables import AnomalyCard, RegistryEntry, SupportTicket, SystemState, User  # noqa

logger = logging.getLogger(__name__)
engine: AsyncEngine = create_async_engine(main_config.db.db_url, echo=False)
SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    autocommit=False, autoflush=False, bind=engine
)


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(main_config.db.base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    db: AsyncSession = SessionLocal()
    try:
        logger.info("DataBase connection session has been created")
        yield db
    except Exception:
        logger.info("An error occurred while working with the session")
        await db.rollback()
        raise
    finally:
        logger.info("DataBase connection session has been closed")
        await db.close()
