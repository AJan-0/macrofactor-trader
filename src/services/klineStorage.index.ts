/**
 * K线存储服务统一导出
 */

export {
  // 核心存储操作
  storeKlines,
  queryKlines,
  getLatestKlines,
  getStorageStats,
  cleanupExpiredData,
  exportToCSV,
  bulkImportKlines,
  checkStorageHealth,
  
  // 降采样工具
  resampleKlines,
  autoSelectTimeframe,
  
  // 配置常量
  TIMEFRAME_CONFIG,
  STORAGE_TARGET_YEARS,
  
  // 数据库初始化
  openKlineDB,
} from './klineStorage';

export type {
  KlineData,
  KlineChunk,
  KlineMeta,
  KlineDailySummary,
  StorageStats,
} from './klineStorage';
