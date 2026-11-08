from .auth import router as auth_router
from .cards import router as cards_router
from .pages import router as pages_router
from .registry import router as registry_router

__all__ = [
    "auth_router",
    "cards_router",
    "pages_router",
    "registry_router",
]
