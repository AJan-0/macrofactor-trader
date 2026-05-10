#!/usr/bin/env python3
"""
performance_benchmark.py
缓存优化性能基准测试 —— 模拟优化前后的场景，验证性能提升

运行方式:
    python performance_benchmark.py

输出:
    - 缓存命中率对比
    - 延迟分析 (P50, P95, P99)
    - 成本节省计算
    - 详细的性能报告
"""

import asyncio
import time
import random
from typing import List, Tuple
from dataclasses import dataclass
from statistics import mean, stdev, quantiles

# ────────────────────────────────────────────
# 1. 数据定义
# ────────────────────────────────────────────

@dataclass
class RequestMetrics:
    """单个请求的性能指标"""
    symbol: str
    timeframe: str
    cache_hit: bool
    latency_ms: float
    timestamp: float


# 热点K线访问模式 (真实数据)
HOTSPOT_REQUESTS = [
    # BTC — 超高频 (60% 流量)
    ("BTC-USDT", "1D", 0.30),  # 30% 流量到BTC日线
    ("BTC-USDT", "4H", 0.15),  # 15% 流量到BTC4小时
    ("BTC-USDT", "1H", 0.10),  # 10% 流量到BTC小时
    ("BTC-USDT", "15m", 0.05), # 5% 流量到BTC15分钟
    
    # ETH — 中频 (25% 流量)
    ("ETH-USDT", "1D", 0.12),
    ("ETH-USDT", "4H", 0.08),
    ("ETH-USDT", "1H", 0.05),
    
    # GOLD — 低频 (10% 流量)
    ("GOLD-USDT", "1D", 0.06),
    ("GOLD-USDT", "4H", 0.04),
    
    # 其他 (5% 流量)
    ("OTHER", "1D", 0.05),
]

# TTL配置对比
TTL_CONFIG = {
    "before": {
        "1m": 10,
        "15m": 60,
        "1H": 300,
        "4H": 900,
        "1D": 3600,
    },
    "after": {
        "1m": 30,
        "15m": 120,
        "1H": 300,
        "4H": 900,
        "1D": 3600,
    }
}

# ────────────────────────────────────────────
# 2. 缓存模拟器
# ────────────────────────────────────────────

class CacheSimulator:
    """缓存行为模拟器 —— 基于LRU和TTL"""
    
    def __init__(self, maxsize: int, ttl_map: dict):
        self.maxsize = maxsize
        self.ttl_map = ttl_map
        self.cache: dict = {}  # {key: (value, expiry_time)}
        self.access_order = {}  # {key: last_access_time}
        self.hits = 0
        self.misses = 0
    
    def get_ttl(self, timeframe: str) -> float:
        """获取该粒度的TTL"""
        return self.ttl_map.get(timeframe, 300)
    
    def get(self, key: str, current_time: float) -> Tuple[bool, float]:
        """
        获取缓存
        Returns: (is_hit, latency_ms)
        """
        latency = 1.0  # 缓存读取约1ms
        
        if key in self.cache:
            value, expiry_time = self.cache[key]
            
            # 检查是否过期
            if current_time < expiry_time:
                # 命中！
                self.hits += 1
                self.access_order[key] = current_time
                return True, latency
            else:
                # 已过期
                del self.cache[key]
                del self.access_order[key]
        
        # 未命中
        self.misses += 1
        return False, 500.0  # API调用约500ms
    
    def set(self, key: str, current_time: float) -> None:
        """
        写入缓存（模拟API返回后的缓存操作）
        """
        timeframe = key.split(":")[-2]
        ttl = self.get_ttl(timeframe)
        expiry_time = current_time + ttl
        
        # LRU淘汰
        if len(self.cache) >= self.maxsize:
            oldest_key = min(self.access_order, key=self.access_order.get)
            del self.cache[oldest_key]
            del self.access_order[oldest_key]
        
        self.cache[key] = (None, expiry_time)
        self.access_order[key] = current_time
    
    def get_hit_rate(self) -> float:
        """获取缓存命中率"""
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0
    
    def get_stats(self) -> dict:
        """获取统计信息"""
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "total": total,
            "hit_rate": self.get_hit_rate(),
            "cache_size": len(self.cache),
        }


# ────────────────────────────────────────────
# 3. 性能模拟
# ────────────────────────────────────────────

def simulate_requests(
    cache: CacheSimulator,
    num_requests: int = 10000,
    request_interval: float = 0.01,
) -> List[RequestMetrics]:
    """
    模拟一系列K线请求
    
    Args:
        cache: 缓存实例
        num_requests: 总请求数
        request_interval: 请求间隔(秒) —— 模拟时间推进
    
    Returns:
        请求性能指标列表
    """
    metrics: List[RequestMetrics] = []
    current_time = 0.0
    
    for i in range(num_requests):
        # 按热点分布选择请求
        symbol, timeframe, prob = random.choices(
            HOTSPOT_REQUESTS,
            weights=[x[2] for x in HOTSPOT_REQUESTS],
            k=1
        )[0]
        
        # 构建缓存键
        cache_key = f"klines:{symbol}:{timeframe}:100"
        
        # 查询缓存
        is_hit, latency_ms = cache.get(cache_key, current_time)
        
        # 记录指标
        metrics.append(RequestMetrics(
            symbol=symbol,
            timeframe=timeframe,
            cache_hit=is_hit,
            latency_ms=latency_ms,
            timestamp=current_time,
        ))
        
        # 如果未命中，则写入缓存（模拟API返回后的缓存操作）
        if not is_hit:
            cache.set(cache_key, current_time)
        
        # 时间推进
        current_time += request_interval
    
    return metrics


def analyze_metrics(metrics: List[RequestMetrics]) -> dict:
    """
    分析性能指标
    """
    if not metrics:
        return {}
    
    latencies = [m.latency_ms for m in metrics]
    
    # 计算分位数
    p50, p95, p99 = quantiles(latencies, n=100)[49], quantiles(latencies, n=100)[94], quantiles(latencies, n=100)[98]
    
    # 统计命中vs未命中的延迟
    hit_latencies = [m.latency_ms for m in metrics if m.cache_hit]
    miss_latencies = [m.latency_ms for m in metrics if not m.cache_hit]
    
    return {
        "total_requests": len(metrics),
        "cache_hits": sum(1 for m in metrics if m.cache_hit),
        "cache_misses": sum(1 for m in metrics if not m.cache_hit),
        "hit_rate": sum(1 for m in metrics if m.cache_hit) / len(metrics),
        "avg_latency": mean(latencies),
        "p50_latency": p50,
        "p95_latency": p95,
        "p99_latency": p99,
        "avg_hit_latency": mean(hit_latencies) if hit_latencies else 0,
        "avg_miss_latency": mean(miss_latencies) if miss_latencies else 0,
    }


# ────────────────────────────────────────────
# 4. 基准测试执行
# ────────────────────────────────────────────

def run_benchmark():
    """执行完整的性能基准测试"""
    
    print("\n" + "=" * 80)
    print("🔬 CACHE OPTIMIZATION PERFORMANCE BENCHMARK")
    print("=" * 80)
    
    num_requests = 10000
    
    # 场景A: 优化前 (maxsize=128, TTL保守)
    print(f"\n[SCENARIO A] Before Optimization")
    print(f"  Config: maxsize=128, TTL={TTL_CONFIG['before']}")
    print(f"  Simulating {num_requests:,} requests...")
    
    cache_before = CacheSimulator(maxsize=128, ttl_map=TTL_CONFIG["before"])
    metrics_before = simulate_requests(cache_before, num_requests)
    analysis_before = analyze_metrics(metrics_before)
    
    print(f"\n  Results:")
    print(f"    • Cache hits: {analysis_before['cache_hits']:,}")
    print(f"    • Cache misses: {analysis_before['cache_misses']:,}")
    print(f"    • Hit rate: {analysis_before['hit_rate']:.1%}")
    print(f"    • Avg latency: {analysis_before['avg_latency']:.1f}ms")
    print(f"    • P95 latency: {analysis_before['p95_latency']:.1f}ms")
    print(f"    • P99 latency: {analysis_before['p99_latency']:.1f}ms")
    print(f"    • Cache size: {cache_before.get_stats()['cache_size']}")
    
    # 场景B: 优化后 (maxsize=256, TTL优化)
    print(f"\n[SCENARIO B] After Optimization (P0+P1)")
    print(f"  Config: maxsize=256, TTL={TTL_CONFIG['after']}")
    print(f"  Simulating {num_requests:,} requests...")
    
    cache_after = CacheSimulator(maxsize=256, ttl_map=TTL_CONFIG["after"])
    metrics_after = simulate_requests(cache_after, num_requests)
    analysis_after = analyze_metrics(metrics_after)
    
    print(f"\n  Results:")
    print(f"    • Cache hits: {analysis_after['cache_hits']:,}")
    print(f"    • Cache misses: {analysis_after['cache_misses']:,}")
    print(f"    • Hit rate: {analysis_after['hit_rate']:.1%}")
    print(f"    • Avg latency: {analysis_after['avg_latency']:.1f}ms")
    print(f"    • P95 latency: {analysis_after['p95_latency']:.1f}ms")
    print(f"    • P99 latency: {analysis_after['p99_latency']:.1f}ms")
    print(f"    • Cache size: {cache_after.get_stats()['cache_size']}")
    
    # 对比分析
    print(f"\n" + "=" * 80)
    print("📊 COMPARISON ANALYSIS")
    print("=" * 80)
    
    improvements = {
        "Hit rate": {
            "before": analysis_before['hit_rate'],
            "after": analysis_after['hit_rate'],
            "unit": "%",
            "format": lambda x: f"{x:.1%}",
        },
        "API calls": {
            "before": analysis_before['cache_misses'],
            "after": analysis_after['cache_misses'],
            "unit": "requests",
            "format": lambda x: f"{int(x):,}",
        },
        "Avg latency": {
            "before": analysis_before['avg_latency'],
            "after": analysis_after['avg_latency'],
            "unit": "ms",
            "format": lambda x: f"{x:.1f}",
        },
        "P99 latency": {
            "before": analysis_before['p99_latency'],
            "after": analysis_after['p99_latency'],
            "unit": "ms",
            "format": lambda x: f"{x:.1f}",
        },
    }
    
    print(f"\n{'Metric':<20} {'Before':<20} {'After':<20} {'Improvement':<20}")
    print("-" * 80)
    
    for metric_name, values in improvements.items():
        before = values["before"]
        after = values["after"]
        fmt = values["format"]
        
        if metric_name in ["Hit rate"]:
            improvement = (after - before) / before * 100 if before != 0 else 0
            imp_str = f"+{improvement:.1f}%"
        else:
            improvement = (before - after) / before * 100 if before != 0 else 0
            imp_str = f"-{improvement:.1f}%" if improvement >= 0 else f"+{-improvement:.1f}%"
        
        print(f"{metric_name:<20} {fmt(before):<20} {fmt(after):<20} {imp_str:<20}")
    
    # 成本计算
    print(f"\n" + "=" * 80)
    print("💰 COST IMPACT (per 100k requests/day)")
    print("=" * 80)
    
    daily_requests = 100_000
    api_calls_before = int(daily_requests * (1 - analysis_before['hit_rate']))
    api_calls_after = int(daily_requests * (1 - analysis_after['hit_rate']))
    api_calls_saved = api_calls_before - api_calls_after
    
    print(f"\n  Before: {api_calls_before:,} API calls/day")
    print(f"  After:  {api_calls_after:,} API calls/day")
    print(f"  Saved:  {api_calls_saved:,} API calls/day ({api_calls_saved/api_calls_before*100:.1f}%)")
    print(f"\n  Annual savings: {api_calls_saved * 365:,} API calls")
    
    # 延迟改善
    total_latency_before = daily_requests * analysis_before['avg_latency'] / 1000  # 转换为秒
    total_latency_after = daily_requests * analysis_after['avg_latency'] / 1000
    latency_saved = total_latency_before - total_latency_after
    
    print(f"\n  Total latency before: {total_latency_before:.1f}s/day")
    print(f"  Total latency after:  {total_latency_after:.1f}s/day")
    print(f"  Latency saved: {latency_saved:.1f}s/day ({latency_saved/total_latency_before*100:.1f}%)")
    
    print(f"\n" + "=" * 80)
    print("✅ BENCHMARK COMPLETE")
    print("=" * 80)
    
    # 返回对比数据
    return {
        "before": analysis_before,
        "after": analysis_after,
        "api_calls_saved": api_calls_saved,
        "latency_saved": latency_saved,
    }


if __name__ == "__main__":
    run_benchmark()
