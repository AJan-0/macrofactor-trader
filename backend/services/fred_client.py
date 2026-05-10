"""
services/fred_client.py
FRED (Federal Reserve Economic Data) API 客户端。

FRED Series IDs:
    DFF  - Federal Funds Effective Rate (日频，联邦基金有效利率)
    FEDFUNDS - Federal Funds Rate (月频)
    CPIAUCSL - CPI for All Urban Consumers (月频)
    UNRATE   - Unemployment Rate (月频)
    PAYEMS   - All Employees, Total Nonfarm (月频，非农数据)

官网: https://fred.stlouisfed.org/
API 文档: https://fred.stlouisfed.org/docs/api/fred/
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Any

from models import MacroEvent, EventCategory, ImpactLevel

logger = logging.getLogger(__name__)

# ──────────────────────────────
# 常量
# ──────────────────────────────

_FRED_SERIES_ID: str = "DFF"  # Federal Funds Effective Rate
_FRED_API_URL: str = "https://api.stlouisfed.org/fred/series/observations"


class FREDClientError(Exception):
    """FRED API 调用异常基类。"""
    pass


class FREDRequestError(FREDClientError):
    """HTTP 请求层异常。"""
    pass


class FREDAPIError(FREDClientError):
    """FRED 返回的业务错误。"""
    def __init__(self, code: int, msg: str) -> None:
        self.code = code
        self.msg = msg
        super().__init__(f"FRED API error [{code}]: {msg}")


class FREDAPIKeyMissing(FREDClientError):
    """API Key 未配置。"""
    pass


# ──────────────────────────────
# Mock 数据（当 API Key 不可用时回退）
# ──────────────────────────────

_MOCK_FED_RATES: list[dict[str, Any]] = [
    {"date": "2022-03-17", "value": 0.50,  "title": "美联储启动加息周期：+25bp 至 0.25%-0.50%",     "impact": "high"},
    {"date": "2022-05-05", "value": 1.00,  "title": "美联储加息 50bp 至 0.75%-1.00%",              "impact": "high"},
    {"date": "2022-06-16", "value": 1.75,  "title": "美联储加息 75bp 至 1.50%-1.75%",              "impact": "high"},
    {"date": "2022-07-28", "value": 2.50,  "title": "美联储加息 75bp 至 2.25%-2.50%",              "impact": "high"},
    {"date": "2022-09-22", "value": 3.25,  "title": "美联储加息 75bp 至 3.00%-3.25%",              "impact": "high"},
    {"date": "2022-11-03", "value": 4.00,  "title": "美联储加息 75bp 至 3.75%-4.00%",              "impact": "high"},
    {"date": "2022-12-15", "value": 4.50,  "title": "美联储加息 50bp 至 4.25%-4.50%",              "impact": "high"},
    {"date": "2023-02-02", "value": 4.75,  "title": "美联储加息 25bp 至 4.50%-4.75%",              "impact": "medium"},
    {"date": "2023-03-23", "value": 5.00,  "title": "美联储加息 25bp 至 4.75%-5.00%",              "impact": "medium"},
    {"date": "2023-05-04", "value": 5.25,  "title": "美联储加息 25bp 至 5.00%-5.25%",              "impact": "medium"},
    {"date": "2023-06-15", "value": 5.25,  "title": "美联储暂停加息：维持 5.00%-5.25%",            "impact": "high"},
    {"date": "2023-07-27", "value": 5.50,  "title": "美联储加息 25bp 至 5.25%-5.50%",              "impact": "high"},
    {"date": "2023-09-21", "value": 5.50,  "title": "美联储暂停加息：维持 5.25%-5.50%",            "impact": "medium"},
    {"date": "2023-11-02", "value": 5.50,  "title": "美联储暂停加息：维持 5.25%-5.50%",            "impact": "medium"},
    {"date": "2023-12-14", "value": 5.50,  "title": "美联储暂停加息：维持 5.25%-5.50%",            "impact": "medium"},
    {"date": "2024-01-31", "value": 5.50,  "title": "美联储维持利率不变：5.25%-5.50%",              "impact": "medium"},
    {"date": "2024-03-21", "value": 5.50,  "title": "美联储维持利率不变：5.25%-5.50%",              "impact": "medium"},
    {"date": "2024-05-02", "value": 5.50,  "title": "美联储维持利率不变：5.25%-5.50%",              "impact": "medium"},
    {"date": "2024-06-13", "value": 5.50,  "title": "美联储维持利率不变：5.25%-5.50%",              "impact": "medium"},
    {"date": "2024-07-31", "value": 5.50,  "title": "美联储维持利率不变：5.25%-5.50%",              "impact": "medium"},
    {"date": "2024-09-19", "value": 5.00,  "title": "美联储降息 50bp 至 4.75%-5.00%",              "impact": "high"},
    {"date": "2024-11-08", "value": 4.75,  "title": "美联储降息 25bp 至 4.50%-4.75%",              "impact": "medium"},
    {"date": "2024-12-19", "value": 4.50,  "title": "美联储降息 25bp 至 4.25%-4.50%",              "impact": "medium"},
    {"date": "2025-01-30", "value": 4.50,  "title": "美联储暂停降息：维持 4.25%-4.50%",            "impact": "medium"},
    {"date": "2025-03-20", "value": 4.25,  "title": "美联储降息 25bp 至 4.00%-4.25%",              "impact": "medium"},
    {"date": "2025-05-08", "value": 4.00,  "title": "美联储降息 25bp 至 3.75%-4.00%",              "impact": "high"},
    {"date": "2025-06-19", "value": 3.75,  "title": "美联储降息 25bp 至 3.50%-3.75%",              "impact": "high"},
    {"date": "2025-07-31", "value": 3.50,  "title": "美联储降息 25bp 至 3.25%-3.50%",              "impact": "medium"},
    {"date": "2025-09-18", "value": 3.25,  "title": "美联储降息 25bp 至 3.00%-3.25%",              "impact": "medium"},
    {"date": "2025-11-06", "value": 3.00,  "title": "美联储降息 25bp 至 2.75%-3.00%",              "impact": "medium"},
    {"date": "2026-01-29", "value": 2.75,  "title": "美联储降息 25bp 至 2.50%-2.75%",              "impact": "medium"},
    {"date": "2026-03-19", "value": 2.50,  "title": "美联储降息 25bp 至 2.25%-2.50%",              "impact": "medium"},
    {"date": "2026-04-30", "value": 3.50,  "title": "美联储利率决议：上调至 3.25%-3.50%（沃什鹰派转向）", "impact": "high"},
]


def _mock_to_macro_events(mock_data: list[dict[str, Any]]) -> list[MacroEvent]:
    """将 Mock 数据转换为标准 MacroEvent 列表。"""
    events: list[MacroEvent] = []
    for idx, row in enumerate(mock_data):
        try:
            dt = datetime.strptime(row["date"], "%Y-%m-%d")
            ts = int(dt.timestamp())
            val = float(row["value"])
            events.append(MacroEvent(
                id=f"fred-{idx + 1:03d}",
                timestamp=ts,
                date_str=row["date"],
                category=EventCategory.Macro,
                title=row["title"],
                impact_level=ImpactLevel(row["impact"]),
                actual_value=val,
                unit="%",
                description=f"Federal Funds Effective Rate: {val}% on {row['date']}. "
                            f"Data reflects the FOMC monetary policy decision impact.",
                source_name="FRED (Mock)",
                source_url="https://fred.stlouisfed.org/series/DFF",
            ))
        except (ValueError, KeyError) as exc:
            logger.warning("Skip malformed mock row %s: %s", row, exc)
            continue
    return events


# ──────────────────────────────
# 真实 FRED API 调用
# ──────────────────────────────

def _get_api_key() -> str | None:
    """从环境变量读取 FRED API Key。"""
    key = os.environ.get("FRED_API_KEY", "")
    if not key or key == "your_fred_api_key_here":
        return None
    return key


async def _fetch_from_fred(
    series_id: str = _FRED_SERIES_ID,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """通过 FRED REST API 获取原始数据。

    Args:
        series_id: FRED 数据序列 ID。
        limit: 返回条数上限。

    Returns:
        FRED 返回的 observation 列表，每个元素为 {"date": "YYYY-MM-DD", "value": "X.XX"}。

    Raises:
        FREDAPIKeyMissing: API Key 未配置。
        FREDRequestError: HTTP 请求失败。
        FREDAPIError: FRED 返回错误。
    """
    api_key = _get_api_key()
    if not api_key:
        raise FREDAPIKeyMissing(
            "FRED_API_KEY not configured. "
            "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html"
        )

    # 计算时间范围（最近 N 年的数据）
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=limit * 30)).strftime("%Y-%m-%d")

    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start_date,
        "observation_end": end_date,
        "sort_order": "desc",
        "limit": str(limit),
    }

    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        try:
            resp = await client.get(_FRED_API_URL, params=params)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise FREDRequestError(f"FRED HTTP {exc.response.status_code}: {exc.response.text[:200]}") from exc
        except httpx.RequestError as exc:
            raise FREDRequestError(f"Network error: {exc}") from exc

        try:
            payload = resp.json()
        except Exception as exc:
            raise FREDRequestError(f"Invalid JSON: {exc}") from exc

    if "observations" not in payload:
        error_info = payload.get("error_message", "Unknown error")
        raise FREDAPIError(payload.get("error_code", -1), str(error_info))

    return payload["observations"]


def _fred_obs_to_macro_events(
    observations: list[dict[str, Any]],
    series_id: str = _FRED_SERIES_ID,
) -> list[MacroEvent]:
    """将 FRED observation 列表转换为标准 MacroEvent 列表。

    核心逻辑：
        1. 筛选有效数值（跳过 '.' 等缺失标记）。
        2. 仅保留数值发生变化的记录（即利率调整日）。
        3. 根据变化幅度自动标注影响级别：
           - 变化 >= 75bp → high
           - 变化 >= 25bp → medium
           - 变化 < 25bp  → low
        4. 生成描述性 title。
    """
    events: list[MacroEvent] = []
    prev_value: float | None = None
    idx = 0

    # 按日期升序处理
    sorted_obs = sorted(observations, key=lambda x: x.get("date", ""))

    for obs in sorted_obs:
        date_str = obs.get("date", "")
        val_str = obs.get("value", ".")

        # 跳过缺失值
        if val_str in (".", "", None):
            continue

        try:
            val = float(val_str)
        except (ValueError, TypeError):
            continue

        # 仅保留变化点
        if prev_value is not None and abs(val - prev_value) < 0.001:
            continue

        # 计算变化幅度
        change = (val - prev_value) if prev_value is not None else 0.0
        change_bp = change * 100  # 转换为基点

        # 自动标注影响级别
        if abs(change_bp) >= 75:
            impact = ImpactLevel.High
        elif abs(change_bp) >= 25:
            impact = ImpactLevel.Medium
        else:
            impact = ImpactLevel.Low

        # 生成 title
        if change > 0:
            title = f"美联储加息：+{change:.2f}% 至 {val:.2f}%"
        elif change < 0:
            title = f"美联储降息：{change:.2f}% 至 {val:.2f}%"
        else:
            title = f"美联储利率决议：维持 {val:.2f}%"

        # 生成 timestamp
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            ts = int(dt.timestamp())
        except ValueError:
            continue

        events.append(MacroEvent(
            id=f"fred-{idx + 1:03d}",
            timestamp=ts,
            date_str=date_str,
            category=EventCategory.Macro,
            title=title,
            impact_level=impact,
            actual_value=val,
            unit="%",
            description=f"Federal Funds Effective Rate: {val}% on {date_str}. "
                        f"Change: {change:+.2f}% ({change_bp:+.0f}bp). "
                        f"Source: FRED series {series_id}.",
            source_name="FRED",
            source_url=f"https://fred.stlouisfed.org/series/{series_id}",
        ))

        prev_value = val
        idx += 1

    return events


# ──────────────────────────────
# 对外暴露的主函数
# ──────────────────────────────

async def get_fed_rates(
    use_mock: bool = False,
    limit: int = 50,
) -> list[MacroEvent]:
    """获取美联储联邦基金利率历史数据。

    策略：
        1. 优先尝试真实 FRED API（需配置 FRED_API_KEY）。
        2. 若 API Key 缺失或请求失败 → 自动回退到 Mock 数据。
        3. 返回标准化的 MacroEvent 列表。

    Args:
        use_mock: 强制使用 Mock 数据（用于测试）。
        limit: 返回条数上限。

    Returns:
        MacroEvent 列表，按时间升序排列。
    """
    if use_mock or _get_api_key() is None:
        if not use_mock:
            logger.info("FRED_API_KEY not set, falling back to mock data. "
                        "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html")
        return _mock_to_macro_events(_MOCK_FED_RATES)

    try:
        observations = await _fetch_from_fred(limit=limit)
        if not observations:
            logger.warning("FRED returned empty data, falling back to mock.")
            return _mock_to_macro_events(_MOCK_FED_RATES)
        return _fred_obs_to_macro_events(observations)
    except (FREDClientError, Exception) as exc:
        logger.error("FRED fetch failed (%s), falling back to mock data.", type(exc).__name__)
        return _mock_to_macro_events(_MOCK_FED_RATES)