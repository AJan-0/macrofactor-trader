"""
services/mock_events.py
静态黑天鹅 / 地缘政治 / 加密原生事件数据源。

设计意图：
    地缘政治和黑天鹅事件没有标准化 API，初期通过本地静态数据驱动。
    事件经过人工筛选，确保时间戳准确、影响评级合理。
    每个事件均包含完整的新闻来源引用。

数据来源：
    - 路透社 (Reuters)
    - 彭博社 (Bloomberg)
    - 金十数据 (Jin10)
    - 链闻 (ChainNews)
"""

from models import MacroEvent, EventCategory, ImpactLevel


# ──────────────────────────────
# 静态事件列表
# ──────────────────────────────

_STATIC_EVENTS: list[dict] = [
    {
        "id": "evt-geo-001",
        "date_str": "2022-02-24",
        "category": EventCategory.GeoPolitics,
        "title": "俄乌冲突爆发：俄罗斯对乌克兰发动特别军事行动",
        "impact_level": ImpactLevel.High,
        "actual_value": None,
        "unit": "",
        "description": (
            "俄罗斯总统普京宣布对乌克兰发起'特别军事行动'。全球股市暴跌，"
            "BTC 日内下跌 7.5%，黄金突破 1970 美元/盎司。能源价格飙升，"
            "布伦特原油突破 100 美元。市场避险情绪达到 2020 年 3 月以来最高。"
        ),
        "source_name": "Reuters",
        "source_url": "https://www.reuters.com/world/europe/",
    },
    {
        "id": "evt-crypto-001",
        "date_str": "2023-08-29",
        "category": EventCategory.CryptoNative,
        "title": "灰度赢得 SEC 官司：GBTC 转 ETF 获法院支持",
        "impact_level": ImpactLevel.High,
        "actual_value": None,
        "unit": "",
        "description": (
            "美国哥伦比亚特区巡回上诉法院裁定 SEC 拒绝灰度将 GBTC 转换为"
            "现货比特币 ETF 的申请是'武断且随意'的。BTC 短线暴涨 5%，"
            "突破 27,500 美元。市场普遍认为现货 ETF 获批进入倒计时。"
        ),
        "source_name": "Bloomberg / 链闻",
        "source_url": "https://www.bloomberg.com/news/articles/2023-08-29/",
    },
    {
        "id": "evt-crypto-002",
        "date_str": "2024-01-10",
        "category": EventCategory.CryptoNative,
        "title": "SEC 批准 11 只现货比特币 ETF：历史性时刻",
        "impact_level": ImpactLevel.High,
        "actual_value": None,
        "unit": "",
        "description": (
            "美国 SEC 正式批准 11 只现货比特币 ETF，包括贝莱德 (IBIT)、"
            "富达 (FBTC) 等。首日交易量超 46 亿美元。BTC 从 45,000 美元"
            "飙升至 48,000 美元，ETH 跟涨 5%。标志着加密货币进入主流金融。"
        ),
        "source_name": "SEC / 金十数据",
        "source_url": "https://www.sec.gov/news/statement/",
    },
    {
        "id": "evt-macro-001",
        "date_str": "2024-04-05",
        "category": EventCategory.Macro,
        "title": "非农数据爆冷：3月新增就业 30.3 万，远超预期",
        "impact_level": ImpactLevel.Medium,
        "actual_value": 303.0,
        "unit": "千人",
        "description": (
            "美国 3 月非农就业人口增加 30.3 万人，预期 20 万人。失业率降至 3.8%。"
            "数据发布后，市场降息预期降温，美元指数跳涨 0.4%，BTC 短线下跌 2%。"
            "10Y 美债收益率升至 4.4%。"
        ),
        "source_name": "美国劳工部 (BLS) / 金十数据",
        "source_url": "https://www.bls.gov/news.release/empsit.nr0.htm",
    },
    {
        "id": "evt-geo-002",
        "date_str": "2026-05-07",
        "category": EventCategory.GeoPolitics,
        "title": "美伊核谈判重大突破：伊朗同意不拥有核武器",
        "impact_level": ImpactLevel.High,
        "actual_value": None,
        "unit": "",
        "description": (
            "特朗普宣布过去 24 小时美伊对话'非常富有成效'，伊朗已同意不拥有"
            "核武器。布伦特原油应声暴跌 7.15% 至 102 美元，BTC 突破 81,400 美元。"
            "此前霍尔木兹海峡封锁导致 1,550 艘商船滞留。"
        ),
        "source_name": "每日经济新闻 / 央视新闻",
        "source_url": "https://www.nbd.com.cn/articles/2026-05-07/",
    },
]


# ──────────────────────────────
# 转换函数
# ──────────────────────────────

def get_static_events() -> list[MacroEvent]:
    """将静态事件字典列表转换为标准 MacroEvent 对象列表。

    Returns:
        按时间升序排列的 MacroEvent 列表。
    """
    from datetime import datetime

    events: list[MacroEvent] = []
    for row in _STATIC_EVENTS:
        try:
            dt = datetime.strptime(row["date_str"], "%Y-%m-%d")
            ts = int(dt.timestamp())
        except (ValueError, KeyError):
            continue

        events.append(MacroEvent(
            id=row["id"],
            timestamp=ts,
            date_str=row["date_str"],
            category=row["category"],
            title=row["title"],
            impact_level=row["impact_level"],
            actual_value=row.get("actual_value"),
            unit=row.get("unit", ""),
            description=row["description"],
            source_name=row["source_name"],
            source_url=row["source_url"],
        ))

    # 按时间升序排列
    events.sort(key=lambda e: e.timestamp)
    return events


def get_all_events() -> list[MacroEvent]:
    """获取全部静态事件（对外暴露的统一接口）。

    Returns:
        按时间升序排列的 MacroEvent 列表。
    """
    return get_static_events()