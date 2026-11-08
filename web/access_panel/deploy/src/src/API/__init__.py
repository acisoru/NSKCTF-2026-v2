from .alerts import router as alerts_router
from .archive import router as archive_router
from .auth import router as auth_router
from .panel import router as panel_router
from .support import router as support_router

__all__ = [
    "alerts_router",
    "archive_router",
    "auth_router",
    "panel_router",
    "support_router",
]
