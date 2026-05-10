"""
database.py
异步数据库引擎配置与 Session 管理。

使用 aiosqlite 作为 SQLite 异步驱动，零配置启动。
可通过环境变量 DATABASE_URL 切换到 PostgreSQL。
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

# ──────────────────────────────
# 配置
# ──────────────────────────────

# 默认使用 SQLite（零配置），生产环境可切 PostgreSQL
DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./macrofactor.db"
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)

# ──────────────────────────────
# 引擎
# ──────────────────────────────

engine = create_async_engine(
    DATABASE_URL,
    echo=False,           # True 调试 SQL 语句
    future=True,
    # SQLite 必需：避免 "too many open files"
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

# ──────────────────────────────
# Session 工厂
# ──────────────────────────────

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

# ──────────────────────────────
# ORM 基类
# ──────────────────────────────

Base = declarative_base()


# ──────────────────────────────
# 生命周期管理
# ──────────────────────────────

async def init_db() -> None:
    """创建所有表结构（应用启动时调用）。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """关闭引擎连接池（应用关闭时调用）。"""
    await engine.dispose()


async def get_db() -> AsyncSession:
    """FastAPI Depends 用的依赖注入函数。"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
