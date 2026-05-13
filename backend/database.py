"""
database.py
异步数据库引擎配置与 Session 管理。

支持 SQLite（开发）和 PostgreSQL（生产）。
通过环境变量 DATABASE_URL 切换，生产环境强烈推荐 PostgreSQL。
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from config import get_settings

# ──────────────────────────────
# 配置
# ──────────────────────────────

settings = get_settings()
DATABASE_URL = settings.database_url
IS_SQLITE = "sqlite" in DATABASE_URL

# ──────────────────────────────
# 引擎
# ──────────────────────────────

_engine_kwargs: dict = {
    "echo": False,
    "future": True,
    "pool_pre_ping": True,  # 检测并回收死连接
}

if IS_SQLITE:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # PostgreSQL 连接池配置
    _engine_kwargs.update({
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 3600,
    })

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)

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
    """创建所有表结构（应用启动时调用）。

    注意：生产环境应使用 Alembic 管理 schema 变更，
    此函数仅在开发/测试环境使用。
    """
    if not IS_SQLITE:
        # 生产环境禁止自动 create_all
        return
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
