#!/usr/bin/env python3
"""
realistic_benchmark.py
更真实的缓存性能基准测试 —— 包括冷启动、过期、非热点数据等场景

运行方式:
    python realistic_benchmark.py
"""

import random
import time
from typing import List, Dict, Tuple
from collections import defaultdict

# ────────────────────────────────────────────
# 1. 真实访问模式定义
# ────────────────────────────────────────────

class RealWorldAccessPattern:
    """模拟真实交易员的K线访问模式"""
    
    # 热点: BTC/ETH/GOLD + 多粒度
    HOTSPOT_ASSETS = {
        "BTC-USDT": 0.45,  # 45% 流量
        "ETH-USDT": 0.35,  # 35% 流量
        "GOLD-USDT": 0.15, # 15% 流量
        "OTHER": 0.05,     # 5% 流量 (其他币种)
    }
    
    TIMEFRAMES = {
        "1m": 0.10,   # 10% 请求
        "5m": 0.08,
        "15m": 0.12,
        "1H": 0.20,   # 1小时线比较热
        "4H": 0.25,   # 4小时线最热
        "1D": 0.25,   # 日线也很热
    }
    
    def get_next_request(self) -> Tuple[str, str]:
        """生成下一个请求"""
        asset = random.choices(
            list(self.HOTSPOT_ASSETS.keys()),
            weights=list(self.HOTSPOT_ASSETS.values()),
            k=1
        )[0]
        
        timeframe = random.choices(
            list(self.TIMEFRAMES.keys()),
            weights=list(self.TIMEFRAMES.values()),
            k=1
        )[0]
        
        return asset, timeframe


class SimpleCacheModel:
    """简化的缓存模型 —— 模拟真实缓存行为"""
    
    def __init__(self, maxsize: int, ttl_config: Dict[str, int]):
        self.maxsize = maxsize
        self.ttl_config = ttl_config
        self.cache = {}  # {key: expiry_time}
        self.access_times = {}  # {key: last_access_time}
        self.stats = {
            "hits": 0,
            "misses": 0,
            "api_calls": 0,
            "total_latency": 0.0,
        }
    
    def get_or_fetch(
        self,
        asset: str,
        timeframe: str,
        current_time: float,
    ) -> Tuple[bool, float]:
        """
        获取或获取K线数据
        Returns: (is_cache_hit, latency_ms)
        """
        key = f"{asset}:{timeframe}"
        
        # 检查缓存
        if key in self.cache and current_time < self.cache[key]:
            # 缓存命中
            self.stats["hits"] += 1
            self.access_times[key] = current_time
            return True, 1.0  # 缓存延迟: 1ms
        
        # 缓存未命中或已过期
        self.stats["misses"] += 1
        self.stats["api_calls"] += 1
        
        # 写入缓存
        ttl = self.ttl_config.get(timeframe, 300)
        expiry_time = current_time + ttl
        
        # LRU淘汰
        if len(self.cache) >= self.maxsize:
            oldest_key = min(
                self.access_times,
                key=self.access_times.get,
                default=None
            )
            if oldest_key:
                del self.cache[oldest_key]
                del self.access_times[oldest_key]
        
        self.cache[key] = expiry_time
        self.access_times[key] = current_time
        
        return False, 500.0  # API延迟: 500ms
    
    def get_hit_rate(self) -> float:
        total = self.stats["hits"] + self.stats["misses"]
        return self.stats["hits"] / total if total > 0 else 0.0


def simulate_realistic_workload(
    cache_model: SimpleCacheModel,
    duration_seconds: float = 300.0,
    requests_per_second: float = 100.0,
) -> Dict:
    """
    模拟真实工作负载 (5分钟内100 RPS)
    """
    pattern = RealWorldAccessPattern()
    current_time = 0.0
    request_interval = 1.0 / requests_per_second
    
    request_count = 0
    latencies = []
    
    while current_time < duration_seconds:
        asset, timeframe = pattern.get_next_request()
        is_hit, latency = cache_model.get_or_fetch(asset, timeframe, current_time)
        
        latencies.append(latency)
        cache_model.stats["total_latency"] += latency
        
        current_time += request_interval
        request_count += 1
    
    # 计算统计
    hit_rate = cache_model.get_hit_rate()
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    
    # 计算分位数
    sorted_latencies = sorted(latencies)
    p50 = sorted_latencies[int(len(sorted_latencies) * 0.50)]
    p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)]
    p99 = sorted_latencies[int(len(sorted_latencies) * 0.99)]
    
    return {
        "hit_rate": hit_rate,
        "api_calls": cache_model.stats["api_calls"],
        "avg_latency": avg_latency,
        "p50_latency": p50,
        "p95_latency": p95,
        "p99_latency": p99,
        "total_requests": request_count,
        "cache_size": len(cache_model.cache),
    }


# ────────────────────────────────────────────
# 2. 基准测试主程序
# ────────────────────────────────────────────

def main():
    print("\n" + "=" * 90)
    print("🔬 REALISTIC CACHE PERFORMANCE BENCHMARK (5min @ 100 RPS)")
    print("=" * 90)
    
    # TTL配置
    ttl_before = {
        "1m": 10,
        "5m": 30,
        "15m": 60,
        "1H": 300,
        "4H": 900,
        "1D": 3600,
    }
    
    ttl_after = {
        "1m": 30,
        "5m": 60,
        "15m": 120,
        "1H": 300,
        "4H": 900,
        "1D": 3600,
    }
    
    # 场景1: 优化前 (maxsize=128, 保守TTL)
    print("\n[SCENARIO A] Before Optimization")
    print("  Config: maxsize=128, TTL=conservative")
    print("  Running: 5-minute workload (100 RPS)...")
    
    cache_before = SimpleCacheModel(maxsize=128, ttl_config=ttl_before)
    results_before = simulate_realistic_workload(cache_before, duration_seconds=300, requests_per_second=100)
    
    print(f"  ✅ Complete!")
    print(f"\n  Results:")
    print(f"    • Total requests: {results_before['total_requests']:,}")
    print(f"    • Cache hits: {results_before['total_requests'] - cache_before.stats['misses']:,}")
    print(f"    • API calls: {results_before['api_calls']:,}")
    print(f"    • Hit rate: {results_before['hit_rate']:.1%}")
    print(f"    • Avg latency: {results_before['avg_latency']:.1f}ms")
    print(f"    • P50 latency: {results_before['p50_latency']:.1f}ms")
    print(f"    • P95 latency: {results_before['p95_latency']:.1f}ms")
    print(f"    • P99 latency: {results_before['p99_latency']:.1f}ms")
    print(f"    • Cache size: {results_before['cache_size']}")
    
    # 场景2: 优化后 (maxsize=256, 优化TTL)
    print("\n[SCENARIO B] After Optimization (P0+P1)")
    print("  Config: maxsize=256, TTL=optimized")
    print("  Running: 5-minute workload (100 RPS)...")
    
    cache_after = SimpleCacheModel(maxsize=256, ttl_config=ttl_after)
    results_after = simulate_realistic_workload(cache_after, duration_seconds=300, requests_per_second=100)
    
    print(f"  ✅ Complete!")
    print(f"\n  Results:")
    print(f"    • Total requests: {results_after['total_requests']:,}")
    print(f"    • Cache hits: {results_after['total_requests'] - cache_after.stats['misses']:,}")
    print(f"    • API calls: {results_after['api_calls']:,}")
    print(f"    • Hit rate: {results_after['hit_rate']:.1%}")
    print(f"    • Avg latency: {results_after['avg_latency']:.1f}ms")
    print(f"    • P50 latency: {results_after['p50_latency']:.1f}ms")
    print(f"    • P95 latency: {results_after['p95_latency']:.1f}ms")
    print(f"    • P99 latency: {results_after['p99_latency']:.1f}ms")
    print(f"    • Cache size: {results_after['cache_size']}")
    
    # 对比分析
    print(f"\n" + "=" * 90)
    print("📊 DETAILED COMPARISON")
    print("=" * 90)
    
    metrics = {
        "Hit rate": (
            f"{results_before['hit_rate']:.1%}",
            f"{results_after['hit_rate']:.1%}",
            (results_after['hit_rate'] - results_before['hit_rate']) / results_before['hit_rate'] * 100 if results_before['hit_rate'] > 0 else 0,
        ),
        "API calls": (
            f"{results_before['api_calls']:,}",
            f"{results_after['api_calls']:,}",
            -(results_after['api_calls'] - results_before['api_calls']) / results_before['api_calls'] * 100 if results_before['api_calls'] > 0 else 0,
        ),
        "Avg latency": (
            f"{results_before['avg_latency']:.1f}ms",
            f"{results_after['avg_latency']:.1f}ms",
            -(results_after['avg_latency'] - results_before['avg_latency']) / results_before['avg_latency'] * 100 if results_before['avg_latency'] > 0 else 0,
        ),
        "P95 latency": (
            f"{results_before['p95_latency']:.1f}ms",
            f"{results_after['p95_latency']:.1f}ms",
            -(results_after['p95_latency'] - results_before['p95_latency']) / results_before['p95_latency'] * 100 if results_before['p95_latency'] > 0 else 0,
        ),
        "P99 latency": (
            f"{results_before['p99_latency']:.1f}ms",
            f"{results_after['p99_latency']:.1f}ms",
            -(results_after['p99_latency'] - results_before['p99_latency']) / results_before['p99_latency'] * 100 if results_before['p99_latency'] > 0 else 0,
        ),
    }
    
    print(f"\n{'Metric':<20} {'Before':<20} {'After':<20} {'Improvement':<20}")
    print("-" * 90)
    
    for metric_name, (before, after, improvement) in metrics.items():
        if improvement >= 0:
            imp_str = f"+{improvement:.1f}%"
        else:
            imp_str = f"{improvement:.1f}%"
        print(f"{metric_name:<20} {before:<20} {after:<20} {imp_str:<20}")
    
    # 成本计算
    print(f"\n" + "=" * 90)
    print("💰 OPERATIONAL COST COMPARISON")
    print("=" * 90)
    
    requests_per_day = 100_000
    
    api_calls_before = int(requests_per_day * (1 - results_before['hit_rate']))
    api_calls_after = int(requests_per_day * (1 - results_after['hit_rate']))
    api_calls_saved = api_calls_before - api_calls_after
    
    print(f"\nPer 100k requests/day:")
    print(f"  Before: {api_calls_before:,} API calls (cost: ${api_calls_before * 0.0001:.2f})")
    print(f"  After:  {api_calls_after:,} API calls (cost: ${api_calls_after * 0.0001:.2f})")
    print(f"  Saved:  {api_calls_saved:,} API calls/day ({api_calls_saved/api_calls_before*100:.1f}%)")
    
    print(f"\nAnnual impact (assuming ${0.0001}/call):")
    print(f"  Cost saved: ${api_calls_saved * 365 * 0.0001:.2f}/year")
    
    print(f"\n" + "=" * 90)
    print("✅ BENCHMARK COMPLETE")
    print("=" * 90)
    
    print(f"\n📌 Key Findings:")
    print(f"  1. Hit rate improvement: {results_before['hit_rate']:.1%} → {results_after['hit_rate']:.1%}")
    print(f"  2. API calls reduction: {(1 - results_after['api_calls']/results_before['api_calls'])*100:.1f}%")
    print(f"  3. Average latency reduction: {(1 - results_after['avg_latency']/results_before['avg_latency'])*100:.1f}%")
    print(f"  4. Cache efficiency: {results_after['cache_size']} keys (maxsize={256})")


if __name__ == "__main__":
    main()
