"""The photo attached to a meal."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    select,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.models.base import Base, new_uuid7
from app.models.food_log import FoodLog

# 1000 KiB. Deliberately under Starlette's 1 MiB request body ceiling, which
# rejects the upload before this route ever runs, so a larger number here would
# simply never be reachable and the friendlier message below would never be
# seen. The app resizes before uploading and lands nearer 300 KB, so this is a
# backstop rather than a working budget.
MAX_PHOTO_BYTES = 1000 * 1024


class FoodLogPhoto(Base):
    """One photo per meal, stored as bytes in Postgres.

    Kept in its own table rather than as a column on food_logs because a photo
    is two orders of magnitude larger than the row it belongs to, and every list
    query would otherwise drag the images along with it.

    Bytes in the database rather than object storage is a deliberate trade. It
    needs no second service and no account, it survives a redeploy that would
    wipe a container's disk, and it is included in the same backup as everything
    else. The cost is database size, which is why the app resizes first and why
    this is a table that can be swapped for a URL column later without touching
    any route: the route already hands the caller bytes, not a location.
    """

    __tablename__ = "food_log_photos"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=new_uuid7,
        server_default=text("uuidv7()"),
    )
    food_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("food_logs.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    log: Mapped["FoodLog"] = relationship(back_populates="photo")  # noqa: F821

    __table_args__ = (
        CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_PHOTO_BYTES}",
            name="photo_size_sane",
        ),
        # One photo per meal. A diary entry has a picture or it does not; a
        # gallery is a different feature and would need an ordering column.
        Index("uq_food_log_photos_food_log_id", "food_log_id", unique=True),
    )


# Whether a log has a picture, answered by the database as part of the same
# SELECT that loads the log. A boolean on the row rather than a relationship,
# so listing a hundred meals costs one EXISTS each and never a byte of image
# data. Defined here rather than on FoodLog because it needs both classes, and
# food_log.py must not import this module or the two would cycle.
FoodLog.has_photo = column_property(
    select(1)
    .where(FoodLogPhoto.food_log_id == FoodLog.id)
    .exists()
    .label("has_photo")
)
