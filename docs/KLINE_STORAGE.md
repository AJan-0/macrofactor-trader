# K线数据长期存储系统

## 概述

本系统支持存储和管理 **5年+** 的K线历史数据，覆盖多个时间周期（1m ~ 1D），采用 IndexedDB 分区存储策略，确保大数据量下的高效查询和更新。

## 存储架构

```
IndexedDB: macrofactor-trader-v2
├── kline_chunks (ObjectStore)     - 按年月分区的K线数据块
│   └── key: "<SYMBOL>|<TF>|<YYYY-MM>"
│   └── value: { bars, firstTime, lastTime, count, checksum }
├── kline_meta (ObjectStore)       - 元数据索引
│   └── key: "<SYMBOL>|<TF>"
│   └── value: { totalBars, firstTime, lastTime, chunkKeys[] }
└── kline_daily (ObjectStore)      - 日线汇总（用于快速统计）
    └── key: "<SYMBOL>|<YYYY-MM-DD>"
```

## 数据保留策略

| 时间周期 | 保留天数 | 适用场景 |
|---------|---------|---------|
| 1m      | 90天    | 短期高频分析 |
| 3m      | 180天   | 中短期交易 |
| 5m      | 365天   | 日内交易 |
| 15m     | 730天   | 波段交易 |
| 1H      | 1825天  | **5年长期趋势** |
| 4H      | 1825天  | **5年长期趋势** |
| 1D      | 1825天  | **5年长期趋势** |

## 核心 API

### 存储数据

```typescript
import { storeKlines } from '@/services/klineStorage';

await storeKlines('BTC-USDT', '1D', [
  { time: 1609459200, open: 29000, high: 29500, low: 28800, close: 29300, volume: 15000 },
  // ...
]);
```

### 查询数据

```typescript
import { queryKlines } from '@/services/klineStorage';

// 查询指定时间范围
const bars = await queryKlines('BTC-USDT', '1D', {
  startTime: 1609459200,  // 2021-01-01
  endTime: 1640995200,    // 2022-01-01
  limit: 1000,
});

// 获取最新100条
const latest = await getLatestKlines('BTC-USDT', '1D', 100);
```

### 获取统计信息

```typescript
import { getStorageStats } from '@/services/klineStorage';

const stats = await getStorageStats('BTC-USDT', '1D');
console.log(stats);
// {
//   symbol: 'BTC-USDT',
//   timeframe: '1D',
//   totalBars: 1825,
//   totalChunks: 61,
//   dateRange: { start: Date('2021-01-01'), end: Date('2025-12-31') },
//   storageSizeMB: 2.5
// }
```

## React Hook

### useKlineData (增强版)

```typescript
import { useKlineData } from '@/hooks/useKlineData';

function ChartComponent() {
  const { 
    klinesRef,      // K线数据引用
    dataVersion,    // 数据版本号（变化时触发重渲染）
    isLoading,      // 加载状态
    error,          // 错误信息
    storageStats,   // 存储统计
  } = useKlineData('BTC-USDT', '1D');
  
  useEffect(() => {
    console.log('Klines:', klinesRef.current);
  }, [dataVersion]);
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return <Chart data={klinesRef.current} />;
}
```

### useKlineStorage (高级管理)

```typescript
import { useKlineStorage } from '@/hooks/useKlineStorage';

function StorageDemo() {
  const {
    klines,
    isLoading,
    hasMore,
    storageStats,
    loadMore,      // 加载更多历史数据
    refresh,       // 刷新数据
    exportData,    // 导出CSV
    clearStorage,  // 清空存储
  } = useKlineStorage('BTC-USDT', '1D');
  
  return (
    <div>
      <button onClick={loadMore} disabled={!hasMore}>
        加载更多
      </button>
      <button onClick={refresh}>刷新</button>
      <button onClick={exportData}>导出CSV</button>
    </div>
  );
}
```

## 存储管理面板

```typescript
import KlineStorageManager from '@/components/KlineStorageManager';

function SettingsPage() {
  return <KlineStorageManager />;
}
```

功能包括：
- 查看各 symbol/timeframe 的存储统计
- 手动触发数据同步
- 清理过期数据
- 导出CSV文件
- 存储健康检查

## 数据导入导出

### 导出CSV

```typescript
import { exportToCSV } from '@/services/klineStorage';

const csv = await exportToCSV('BTC-USDT', '1D', {
  startTime: 1609459200,
  endTime: 1640995200,
});

// 下载文件
const blob = new Blob([csv], { type: 'text/csv' });
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'BTC-USDT_1D_2021-2022.csv';
link.click();
```

### 批量导入

```typescript
import { bulkImportKlines } from '@/services/klineStorage';

const bars = await fetchExternalData(); // 从外部API获取

await bulkImportKlines('BTC-USDT', '1D', bars, (current, total) => {
  console.log(`导入进度: ${current}/${total}`);
});
```

## 降采样工具

```typescript
import { resampleKlines, autoSelectTimeframe } from '@/services/klineStorage';

// 将1H数据降采样为4H
const fourHourBars = resampleKlines(hourlyBars, 4 * 3600);

// 根据时间范围自动选择最佳周期
const { timeframe, needResample } = autoSelectTimeframe(
  1609459200,  // 开始时间
  1640995200   // 结束时间
);
// timeframe = '1D', needResample = false
```

## 健康检查

```typescript
import { checkStorageHealth } from '@/services/klineStorage';

const health = await checkStorageHealth();
console.log(health);
// {
//   healthy: true,
//   issues: [],
//   stats: { totalSymbols: 3, totalTimeframes: 7, totalBars: 150000 }
// }
```

## 性能优化建议

1. **内存管理**: Hook 自动限制内存中的数据量（最多5000条），避免大数据集导致卡顿
2. **增量更新**: 只获取新数据，避免重复加载完整历史
3. **分区查询**: 按年月分区，只读取相关时间段的数据块
4. **后台更新**: 数据更新在后台进行，不阻塞UI

## 存储空间估算

| 时间周期 | 5年数据量 | 存储大小(估算) |
|---------|----------|--------------|
| 1D      | ~1825条  | ~2-3 MB      |
| 4H      | ~10950条 | ~8-12 MB     |
| 1H      | ~43800条 | ~30-40 MB    |
| 15m     | ~175200条| ~120-150 MB  |

**总计**: 3个symbol × 7个timeframe ≈ **200-500 MB**

## 故障排除

### 存储空间不足

```typescript
// 清理过期数据
const result = await cleanupExpiredData();
console.log(`释放 ${result.freedMB} MB`);
```

### 数据损坏

```typescript
// 运行健康检查
const health = await checkStorageHealth();
if (!health.healthy) {
  console.error('Issues:', health.issues);
  // 可选择清空重建
  await clearStorage();
}
```

### 从v1迁移

系统自动处理：打开新数据库时会自动检测并迁移v1数据。
