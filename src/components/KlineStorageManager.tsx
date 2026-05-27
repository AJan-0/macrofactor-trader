/**
 * K线存储管理面板
 * 
 * 功能：
 *   - 显示各symbol/timeframe的存储统计
 *   - 手动触发数据同步
 *   - 清理过期数据
 *   - 导出数据
 *   - 存储空间监控
 */

import { useState, useEffect, useCallback } from 'react';
import type { AssetSymbol, Timeframe } from '@/store/appStore';
import {
  getStorageStats,
  cleanupExpiredData,
  checkStorageHealth,
  exportToCSV,
  STORAGE_TARGET_YEARS,
} from '@/services/klineStorage';

interface StorageItem {
  symbol: string;
  timeframe: string;
  totalBars: number;
  totalChunks: number;
  dateRange: { start: Date; end: Date };
  storageSizeMB: number;
}

const SYMBOLS: AssetSymbol[] = ["BTC-USDT", "ETH-USDT", "GC=F"];
const TIMEFRAMES: Timeframe[] = ["1m", "3m", "5m", "15m", "1H", "4H", "1D"];

export default function KlineStorageManager() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deletedChunks: number; freedMB: number } | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    healthy: boolean;
    issues: string[];
    stats: { totalSymbols: number; totalTimeframes: number; totalBars: number };
  } | null>(null);
  const [selectedExport, setSelectedExport] = useState<{ symbol: string; timeframe: string } | null>(null);

  // 加载所有存储统计
  const loadStats = useCallback(async () => {
    setIsLoading(true);
    const results: StorageItem[] = [];
    
    for (const symbol of SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const stats = await getStorageStats(symbol, timeframe);
        if (stats && stats.totalBars > 0) {
          results.push({
            symbol: stats.symbol,
            timeframe: stats.timeframe,
            totalBars: stats.totalBars,
            totalChunks: stats.totalChunks,
            dateRange: stats.dateRange,
            storageSizeMB: stats.storageSizeMB,
          });
        }
      }
    }
    
    setItems(results);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStats();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);

  // 清理过期数据
  const handleCleanup = async () => {
    setIsLoading(true);
    const result = await cleanupExpiredData();
    setCleanupResult(result);
    await loadStats();
    setIsLoading(false);
  };

  // 健康检查
  const handleHealthCheck = async () => {
    setIsLoading(true);
    const health = await checkStorageHealth();
    setHealthStatus(health);
    setIsLoading(false);
  };

  // 导出数据
  const handleExport = async (symbol: string, timeframe: string) => {
    setSelectedExport({ symbol, timeframe });
    const csv = await exportToCSV(symbol as AssetSymbol, timeframe as Timeframe);
    
    // 下载文件
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${symbol}_${timeframe}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    setSelectedExport(null);
  };

  // 计算总存储
  const totalStorageMB = items.reduce((sum, item) => sum + item.storageSizeMB, 0);
  const totalBars = items.reduce((sum, item) => sum + item.totalBars, 0);

  return (
    <div className="p-4 bg-[#0f172a] text-[#e2e8f0] rounded-lg">
      <h2 className="text-lg font-bold mb-4">K线数据存储管理</h2>
      
      {/* 总览 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#1e293b] p-3 rounded">
          <div className="text-sm text-[#475569]">总存储</div>
          <div className="text-xl font-mono">{totalStorageMB.toFixed(2)} MB</div>
        </div>
        <div className="bg-[#1e293b] p-3 rounded">
          <div className="text-sm text-[#475569]">总K线数</div>
          <div className="text-xl font-mono">{totalBars.toLocaleString()}</div>
        </div>
        <div className="bg-[#1e293b] p-3 rounded">
          <div className="text-sm text-[#475569]">目标保留</div>
          <div className="text-xl font-mono">{STORAGE_TARGET_YEARS} 年</div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={loadStats}
          disabled={isLoading}
          className="px-3 py-1.5 bg-[#3b82f6] text-white rounded text-sm hover:bg-[#2563eb] disabled:opacity-50"
        >
          {isLoading ? '刷新中...' : '刷新统计'}
        </button>
        <button
          onClick={handleCleanup}
          disabled={isLoading}
          className="px-3 py-1.5 bg-[#ef4444] text-white rounded text-sm hover:bg-[#dc2626] disabled:opacity-50"
        >
          清理过期数据
        </button>
        <button
          onClick={handleHealthCheck}
          disabled={isLoading}
          className="px-3 py-1.5 bg-[#10b981] text-white rounded text-sm hover:bg-[#059669] disabled:opacity-50"
        >
          健康检查
        </button>
      </div>

      {/* 清理结果 */}
      {cleanupResult && (
        <div className="mb-4 p-3 bg-[#1e293b] rounded">
          <div className="text-sm font-medium mb-1">清理完成</div>
          <div className="text-sm text-[#475569]">
            删除 {cleanupResult.deletedChunks} 个数据块，释放 {cleanupResult.freedMB} MB
          </div>
        </div>
      )}

      {/* 健康状态 */}
      {healthStatus && (
        <div className={`mb-4 p-3 rounded ${healthStatus.healthy ? 'bg-[#10b98120]' : 'bg-[#ef444420]'}`}>
          <div className="text-sm font-medium mb-1">
            健康状态: {healthStatus.healthy ? '✅ 正常' : '⚠️ 有问题'}
          </div>
          <div className="text-sm text-[#475569]">
            Symbols: {healthStatus.stats.totalSymbols} | 
            Timeframes: {healthStatus.stats.totalTimeframes} | 
            Total Bars: {healthStatus.stats.totalBars.toLocaleString()}
          </div>
          {healthStatus.issues.length > 0 && (
            <div className="mt-2 text-sm text-[#ef4444]">
              {healthStatus.issues.map((issue, i) => (
                <div key={i}>• {issue}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 详细列表 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[#475569] border-b border-[#1e293b]">
              <th className="pb-2">Symbol</th>
              <th className="pb-2">Timeframe</th>
              <th className="pb-2">Bars</th>
              <th className="pb-2">Chunks</th>
              <th className="pb-2">Date Range</th>
              <th className="pb-2">Size</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.symbol}-${item.timeframe}`} className="border-b border-[#1e293b]">
                <td className="py-2 font-mono">{item.symbol}</td>
                <td className="py-2">{item.timeframe}</td>
                <td className="py-2 font-mono">{item.totalBars.toLocaleString()}</td>
                <td className="py-2">{item.totalChunks}</td>
                <td className="py-2 text-xs">
                  {item.dateRange.start.toLocaleDateString()} ~ {item.dateRange.end.toLocaleDateString()}
                </td>
                <td className="py-2 font-mono">{item.storageSizeMB.toFixed(2)} MB</td>
                <td className="py-2">
                  <button
                    onClick={() => handleExport(item.symbol, item.timeframe)}
                    disabled={selectedExport?.symbol === item.symbol && selectedExport?.timeframe === item.timeframe}
                    className="px-2 py-0.5 bg-[#3b82f620] text-[#3b82f6] rounded text-xs hover:bg-[#3b82f640] disabled:opacity-50"
                  >
                    {selectedExport?.symbol === item.symbol && selectedExport?.timeframe === item.timeframe
                      ? '导出中...'
                      : '导出 CSV'}
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-[#475569]">
                  暂无存储数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
