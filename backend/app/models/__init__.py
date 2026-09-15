"""Import every model so Alembic autogenerate sees the full metadata."""

from app.models.ai_plan import AIPlan
from app.models.base import Base
from app.models.enums import FriendScale, Goal, ServingSize
from app.models.food_log import FoodLog
from app.models.reference import Cuisine, FoodCategory
from app.models.restaurant import Restaurant
from app.models.user import RefreshToken, User

__all__ = [
    "AIPlan",
    "Base",
    "Cuisine",
    "FoodCategory",
    "FoodLog",
    "FriendScale",
    "Goal",
    "RefreshToken",
    "Restaurant",
    "ServingSize",
    "User",
]
