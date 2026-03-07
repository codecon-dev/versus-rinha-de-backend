from typing import Optional
from datetime import datetime
from sqlalchemy import String, DateTime, Column, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


from uuid import uuid4
import uuid

class Base(DeclarativeBase):
    pass

class UrlModel(Base):
    __tablename__ = "urls"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    url: Mapped[Optional[str]]
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    click_count: Mapped[int] = mapped_column(default=0)
    # created_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    # created_at: Mapped[datetime] = mapped_column(
    #     DateTime(timezone=True),
    #     server_default=func.now(),
    #     nullable=False,
    # )
    # updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class ClickModel(Base):
    __tablename__ = "clicks"

    id = Column(Integer, primary_key=True)
    url_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid4)
    clicked_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
