import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import AnomalyCard

logger = logging.getLogger(__name__)


class CardManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_user(self, user_id: int) -> list[AnomalyCard]:
        result = await self.session.execute(
            select(AnomalyCard).where(AnomalyCard.user_id == user_id).order_by(AnomalyCard.id.desc())
        )
        return list(result.scalars().all())

    async def search(self, user_id: int, filter_text: str) -> list[AnomalyCard]:
        pattern = f"%{filter_text}%"
        result = await self.session.execute(
            select(AnomalyCard)
            .where(AnomalyCard.user_id == user_id, AnomalyCard.description.ilike(pattern))
            .order_by(AnomalyCard.id.desc())
        )
        return list(result.scalars().all())

    async def create(
        self,
        user_id: int,
        anomaly_number: int,
        log_date: str,
        description: str,
        source_url: str | None,
        preview: str | None,
    ) -> AnomalyCard:
        card = AnomalyCard(
            user_id=user_id,
            anomaly_number=anomaly_number,
            log_date=log_date,
            description=description,
            source_url=source_url,
            preview=preview,
        )
        self.session.add(card)
        await self.session.commit()
        await self.session.refresh(card)
        logger.info(f"Card created {user_id=} {anomaly_number=}")
        return card
