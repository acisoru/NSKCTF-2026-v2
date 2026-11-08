import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.tables import SystemState

logger = logging.getLogger(__name__)


class StateManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self) -> SystemState:
        result = await self.session.execute(select(SystemState).where(SystemState.id == 1))
        state = result.scalar_one_or_none()
        if state is None:
            state = SystemState(id=1, update_check_count=0, selftest_count=0)
            self.session.add(state)
            await self.session.commit()
            await self.session.refresh(state)
        return state

    async def record_update_check(self) -> SystemState:
        state = await self.get()
        state.last_update_check = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state.update_check_count = (state.update_check_count or 0) + 1
        await self.session.commit()
        await self.session.refresh(state)
        return state

    async def record_selftest(self) -> SystemState:
        state = await self.get()
        state.last_selftest = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state.selftest_count = (state.selftest_count or 0) + 1
        await self.session.commit()
        await self.session.refresh(state)
        return state
