import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import RegistryEntry

logger = logging.getLogger(__name__)

SORT_COLUMNS = {
    "clearance": RegistryEntry.clearance,
    "name": RegistryEntry.name,
    "operator": RegistryEntry.operator,
}


class RegistryManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_visible(self, sort: str | None = None) -> list[RegistryEntry]:
        order_col = SORT_COLUMNS.get(sort or "")
        stmt = select(RegistryEntry).where(RegistryEntry.visible.is_(True))
        stmt = stmt.order_by(order_col, RegistryEntry.id) if order_col is not None else stmt.order_by(RegistryEntry.id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, entry_id: int) -> RegistryEntry | None:
        logger.info(f"Registry lookup {entry_id=}")
        result = await self.session.execute(select(RegistryEntry).where(RegistryEntry.id == entry_id))
        return result.scalar_one_or_none()
