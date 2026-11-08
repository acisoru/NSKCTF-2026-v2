import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import User

logger = logging.getLogger(__name__)


class UserManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_username(self, username: str) -> User | None:
        logger.info(f"Search for a user {username=}")
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def create(self, username: str, hash_password: str) -> User:
        user = User(username=username, hash_password=hash_password)
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        logger.info(f"User registered {username=}")
        return user
