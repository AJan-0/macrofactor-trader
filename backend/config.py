"""
全局配置管理 (pydantic-settings)
支持 .env 文件和环境变量覆盖
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，优先级：环境变量 > .env 文件 > 默认值"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── 环境 ──
    env: str = "development"  # development | staging | production

    # ── 安全 ──
    admin_api_key: str = ""  # 管理端点 API Key，生产环境必须设置
    cors_origins: str = "*"  # 逗号分隔的 CORS 白名单，生产环境必须收紧

    # ── 数据库 ──
    database_url: str = "sqlite+aiosqlite:///./macrofactor.db"

    # ── 缓存 ──
    cache_backend: str = "memory"  # memory | redis
    redis_url: str = "redis://localhost:6379/0"

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def admin_key_configured(self) -> bool:
        return bool(self.admin_api_key) and self.admin_api_key not in ("", "your-admin-api-key")


@lru_cache
def get_settings() -> Settings:
    return Settings()
