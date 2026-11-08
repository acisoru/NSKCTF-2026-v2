import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import Staff

logger = logging.getLogger(__name__)


class StaffManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_username(self, username: str) -> Staff | None:
        logger.info(f"Search for an employee {username=}")
        result = await self.session.execute(select(Staff).where(Staff.username == username))
        return result.scalar_one_or_none()
