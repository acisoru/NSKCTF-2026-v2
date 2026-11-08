import datetime
import logging
import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import SupportTicket

logger = logging.getLogger(__name__)


class SupportManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_user(self, user_id: int) -> list[SupportTicket]:
        result = await self.session.execute(
            select(SupportTicket)
            .where(SupportTicket.user_id == user_id)
            .order_by(SupportTicket.id.desc())
        )
        return list(result.scalars().all())

    async def create(self, user_id: int, topic: str, message: str) -> SupportTicket:
        ticket = SupportTicket(
            user_id=user_id,
            code=f"LX-{random.randint(100000, 999999)}",
            topic=topic,
            message=message,
            status="в очереди",
            created_at=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        )
        self.session.add(ticket)
        await self.session.commit()
        await self.session.refresh(ticket)
        logger.info(f"Support ticket created {ticket.code=}")
        return ticket
