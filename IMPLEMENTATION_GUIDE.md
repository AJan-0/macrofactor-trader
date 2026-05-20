# K线系统实施指南

## 快速开始（5分钟）

### 第1步: 安装依赖

```bash
cd backend
pip install -r requirements.txt

# 添加新依赖
pip install httpx websockets redis
```

### 第2步: 配置环境变量

```bash
# backend/.env
DATABASE_URL=sqlite+aiosqlite:///./klines.db
# 或者使用PostgreSQL
# DATABASE_URL=postgresql+asyncpg://user:password@localhost/klines_db

REDIS_URL=redis://localhost:6379/0
CACHE_BACKEND=hybrid  # 支持: memory, redis, hybrid

LOG_LEVEL=INFO
```

### 第3步: 启动应用

```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 第4步: 前端集成

```typescript
// src/hooks/useKlineData.ts
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export const useKlineData = (symbol: string, timeframe: string) => {
  return useQuery({
    queryKey: ['klines', symbol, timeframe],
    queryFn: async () => {
      const response = await axios.get('/api/klines', {
        params: { symbol, timeframe, limit: 500 }
      })
      return response.data.data
    },
    staleTime: 60000,
  })
}
```

## 详细配置

### Redis配置（用于分布式缓存）

#### 开发环境
```bash
# 安装Redis
docker run -d -p 6379:6379 redis:7-alpine

# 验证连接
redis-cli ping
# 应该返回: PONG
```

#### 生产环境
```bash
# 使用云Redis服务
REDIS_URL=redis://:password@host:6379/0
```

### 数据库配置

#### SQLite（开发）
```python
DATABASE_URL = "sqlite+aiosqlite:///./klines.db"
# 优点: 零依赖，开发快速
# 缺点: 单进程，不支持并发写入
```

#### PostgreSQL（生产推荐）
```python
DATABASE_URL = "postgresql+asyncpg://user:password@localhost:5432/klines"

# 安装PostgreSQL
docker run -d \
  -e POSTGRES_USER=trader \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=klines \
  -p 5432:5432 \
  postgres:15-alpine

# 初始化数据库
alembic upgrade head
```

## 文件集成步骤

### 第1步: 复制后端文件

```bash
# 确保这些文件存在:
backend/services/
├── kline_manager.py           # ✓ K线管理器
├── advanced_cache.py          # ✓ 缓存系统
├── kline_sync_engine.py       # ✓ 同步引擎
└── integration_guide.py       # ✓ 集成指南
```

### 第2步: 更新 main.py

在 `backend/main.py` 中集成新系统:

```python
# 添加到导入
from services.integration_guide import lifespan, get_kline_system

# 使用lifespan管理
app = FastAPI(
    title="Macrofactor Trader",
    lifespan=lifespan  # ← 添加这行
)

# 在routes中添加新的端点
@app.get("/api/klines")
async def get_klines(
    symbol: str = Query(...),
    timeframe: str = Query(...),
    limit: int = Query(500),
):
    system = get_kline_system()
    klines = await system.kline_manager.get_klines(
        symbol=symbol,
        timeframe=timeframe,
        limit=limit,
    )
    return {"code": 0, "data": klines}
```

### 第3步: 复制前端文件

```bash
# 确保这些文件存在:
src/services/
└── klineDataManager.ts        # ✓ 前端数据管理器

src/components/
└── ChartManagerComponent.tsx  # ✓ 示例组件
```

### 第4步: 前端使用示例

在你的图表组件中使用:

```typescript
import ChartManagerComponent from '@/components/ChartManagerComponent'

export function TradingPage() {
  return (
    <ChartManagerComponent
      symbol="BTC-USDT"
      initialTimeframe="1H"
      onKlinesLoaded={(klines) => {
        // 将K线数据传给TradingView或其他图表库
        updateChart(klines)
      }}
      onMetricsUpdate={(metrics) => {
        console.log('缓存命中率:', metrics.cacheHitRate)
      }}
    />
  )
}
```

## 性能调优

### 1. 缓存大小调整

```python
# backend/services/integration_guide.py
system.cache = HybridCache(
    l1=LRUMemoryCache(max_size_mb=1024),  # 增加L1大小
    l2=RedisCache("redis://localhost:6379/0")
)
```

根据可用内存调整:
- 8GB机器: L1=512MB
- 16GB机器: L1=1024MB
- 32GB机器: L1=2048MB

### 2. 预热热交易对

```python
# 启动时预热
await system.cache_prewarmer.preheat_symbols(
    symbols=["BTC-USDT", "ETH-USDT", "SOL-USDT"],
    timeframes=["1H", "4H", "1D"],
    fetch_func=system.kline_manager.get_klines
)
```

### 3. 调整同步引擎参数

```python
# backend/services/integration_guide.py
sync_engine = KlineSyncEngine(
    max_buffer_size=10000,      # 增加缓冲区
    validation_enabled=True,
    deduplication_enabled=True,
)
```

### 4. WebSocket预加载

```typescript
// 在连接时预加载相邻时间帧
manager.preloadAdjacentTimeframes(symbol, currentTimeframe)
```

## 故障排查

### 问题1: Redis连接失败

**症状**: 日志中出现 "Redis connection failed"

**解决方案**:
```bash
# 检查Redis是否运行
redis-cli ping

# 检查连接字符串
# 应该是 redis://host:6379/0 格式

# 临时降级到内存缓存
# 编辑 .env: CACHE_BACKEND=memory
```

### 问题2: K线数据缺失

**症状**: 数据不完整或有间隙

**解决方案**:
```bash
# 查看验证结果
curl http://localhost:8000/api/klines/validate?symbol=BTC-USDT&timeframe=1H

# 如果报告有缺口，清空缓存重新加载
curl -X POST http://localhost:8000/api/admin/cache/clear

# 重新加载数据
curl http://localhost:8000/api/klines?symbol=BTC-USDT&timeframe=1H&force_refresh=true
```

### 问题3: 加载缓慢

**症状**: 切换时间帧时有延迟

**解决方案**:
```python
# 启用更激进的预加载
await manager.preload_adjacent_timeframes(symbol, current_tf)

# 或者增加缓存大小
cache = HybridCache(
    l1=LRUMemoryCache(max_size_mb=2048)
)
```

### 问题4: 内存占用过高

**症状**: 应用内存不断增长

**解决方案**:
```python
# 减少L1缓存大小
l1=LRUMemoryCache(max_size_mb=256)

# 或者启用L2 Redis降级
cache = HybridCache(
    l1=LRUMemoryCache(max_size_mb=256),
    l2=RedisCache("redis://localhost:6379/0")
)

# 定期清理过期数据
# 在 integration_guide.py 中添加清理任务
```

## 监控

### 1. 查看实时指标

```bash
# 系统指标
curl http://localhost:8000/api/metrics | jq

# 输出示例:
# {
#   "cache": {
#     "L1": {
#       "hit_count": 1250,
#       "hit_rate": 0.875
#     }
#   },
#   "sync_engine": {
#     "messages_processed": 45220,
#     "success_rate": 0.9998
#   }
# }
```

### 2. 日志分析

```bash
# 监听日志
tail -f logs/app.log | grep -i "kline\|cache\|sync"

# 统计命中率
grep "cache hit" logs/app.log | wc -l
```

### 3. 性能基准

运行基准测试:
```bash
python backend/services/test_kline_system.py
```

预期输出:
```
L1 Memory Cache: ~100,000 ops/s
Sync Engine: >1000 msg/s
Cache Hit Rate: 85%+
Average Load Time: <500ms
```

## 部署检查清单

- [ ] 安装所有依赖
- [ ] 配置环境变量
- [ ] 数据库初始化（alembic migrate）
- [ ] Redis连接测试
- [ ] 启动后端服务
- [ ] 验证API端点（/api/klines）
- [ ] 验证WebSocket连接（/ws/klines）
- [ ] 前端集成并测试
- [ ] 性能基准测试
- [ ] 监控和日志设置
- [ ] 故障转移测试（Redis不可用）

## 测试和验证

### 单元测试

```bash
# 运行所有测试
pytest backend/services/test_kline_system.py -v

# 运行特定测试
pytest backend/services/test_kline_system.py::test_cache_performance -v
```

### 集成测试

```bash
# 测试完整流程
python -c "
import asyncio
from services.integration_guide import create_app

app = asyncio.run(create_app())
print('App created successfully')
"
```

### 性能测试

```bash
# 性能基准
ab -n 1000 -c 10 http://localhost:8000/api/klines?symbol=BTC-USDT&timeframe=1H

# WebSocket负载测试
wscat -c ws://localhost:8000/ws/klines
> {"action": "subscribe", "symbol": "BTC-USDT", "timeframe": "1H"}
```

## 升级指南

### 从原系统升级

1. **备份数据**
   ```bash
   sqlite3 klines.db ".backup backup.db"
   ```

2. **部署新代码**
   ```bash
   git pull
   pip install -r requirements.txt
   ```

3. **运行迁移**
   ```bash
   alembic upgrade head
   ```

4. **预热缓存**
   ```bash
   curl -X POST http://localhost:8000/api/admin/cache/preheat
   ```

5. **验证功能**
   - 测试数据加载
   - 测试时间帧切换
   - 测试WebSocket推送
   - 检查指标

## 常见问题

**Q: 能否离线使用？**
A: 可以。前端有IndexedDB本地存储，可以缓存数据用于离线。

**Q: 支持哪些交易所？**
A: 代码以OKX为例，但架构支持任何交易所。修改okx_client.py和okx_ws.py即可。

**Q: 如何处理市场休市期间？**
A: 同步引擎和缓存会自动处理。无新数据时，使用缓存数据。

**Q: 能否用于多个Symbol/Timeframe？**
A: 完全支持。系统支持无限多个Symbol和Timeframe组合。

**Q: 如何处理极限行情？**
A: 验证器会检测异常数据。WebSocket限流配置见integration_guide.py。

## 安全建议

1. **API认证**: 添加JWT或API Key认证
2. **速率限制**: 启用slowapi进行限流
3. **输入验证**: 所有输入都会被验证
4. **日志审计**: 记录所有API调用
5. **Redis密码**: 生产环境必须设置密码

## 下一步

1. ✅ 集成系统
2. ✅ 运行测试
3. ✅ 性能调优
4. ✅ 部署到生产
5. ⏳ 监控和维护

问题或建议? 检查docs/KLINE_SYSTEM_GUIDE.md了解更多信息。
