/**
 * klineDataManager.ts
 * 前端K线数据管理系统 - 本地缓存 + 智能预加载 + 实时同步
 * 
 * 特点：
 * 1. IndexedDB本地存储（支持离线）
 * 2. 内存LRU缓存（快速访问）
 * 3. 智能预加载和预热
 * 4. 时间戳切换无缝过渡
 * 5. 实时更新与缓存同步
 * 6. 自动数据验证和修复
 */

export interface KlineData {
  timestamp: number
  symbol: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteAssetVolume: number
  numberOfTrades: number
  takerBuyBaseAssetVolume: number
  takerBuyQuoteAssetVolume: number
}

export interface CacheMetrics {
  l1Hits: number
  l1Misses: number
  l2Hits: number
  l2Misses: number
  sourceRequests: number
  cacheHitRate: number
  avgLoadTimeMs: number
}

export interface LoadProgress {
  phase: 'idle' | 'loading' | 'validating' | 'complete' | 'error'
  progress: number
  message: string
  loadedCount: number
  totalCount: number
}

/**
 * L1内存LRU缓存
 */
class L1MemoryCache {
  private cache = new Map<string, KlineData[]>()
  private accessOrder: string[] = []
  private maxEntries = 100
  private metrics = { hits: 0, misses: 0 }

  get(key: string): KlineData[] | null {
    const data = this.cache.get(key)
    if (data) {
      this.metrics.hits++
      this.updateAccessOrder(key)
      return data
    }
    this.metrics.misses++
    return null
  }

  set(key: string, data: KlineData[]): void {
    this.cache.set(key, data)
    this.updateAccessOrder(key)

    // LRU淘汰
    if (this.cache.size > this.maxEntries) {
      const oldest = this.accessOrder.shift()
      if (oldest) {
        this.cache.delete(oldest)
      }
    }
  }

  private updateAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key)
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1)
    }
    this.accessOrder.push(key)
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  getMetrics() {
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: this.metrics.hits / (this.metrics.hits + this.metrics.misses),
    }
  }
}

/**
 * L2 IndexedDB持久化存储
 */
class L2IndexedDBCache {
  private dbName = 'macrofactor-klines'
  private storeName = 'klines'
  private db: IDBDatabase | null = null
  private metrics = { hits: 0, misses: 0 }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('expiry', 'expiry', { unique: false })
        }
      }
    })
  }

  async get(key: string): Promise<KlineData[] | null> {
    if (!this.db) return null

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(key)

      request.onsuccess = () => {
        const item = request.result
        if (item && item.expiry > Date.now()) {
          this.metrics.hits++
          resolve(item.data)
        } else {
          if (item && item.expiry <= Date.now()) {
            // 清理过期数据
            this.delete(key)
          }
          this.metrics.misses++
          resolve(null)
        }
      }

      request.onerror = () => {
        this.metrics.misses++
        resolve(null)
      }
    })
  }

  async set(key: string, data: KlineData[], ttlHours: number = 72): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put({
        key,
        data,
        timestamp: Date.now(),
        expiry: Date.now() + ttlHours * 3600000,
      })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async delete(key: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      store.delete(key)
      transaction.oncomplete = () => resolve()
    })
  }

  async clear(): Promise<void> {
    if (!this.db) return

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      store.clear()
      transaction.oncomplete = () => resolve()
    })
  }

  getMetrics() {
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: this.metrics.hits / (this.metrics.hits + this.metrics.misses),
    }
  }
}

/**
 * K线数据验证器
 */
class KlineValidator {
  static validate(klines: KlineData[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!Array.isArray(klines)) {
      return { isValid: false, errors: ['Not an array'] }
    }

    for (let i = 0; i < klines.length; i++) {
      const kline = klines[i]
      const idx = i

      // 检查必需字段
      if (!kline.timestamp || !kline.close) {
        errors.push(`Missing fields at index ${idx}`)
        continue
      }

      // 检查OHLC关系
      if (!(kline.low <= kline.close <= kline.high &&
            kline.low <= kline.open <= kline.high)) {
        errors.push(`Invalid OHLC at ${idx}: L=${kline.low} O=${kline.open} H=${kline.high} C=${kline.close}`)
      }

      // 检查时间序列
      if (i > 0) {
        const prev = klines[i - 1]
        if (kline.timestamp <= prev.timestamp) {
          errors.push(`Timestamp not increasing at index ${idx}`)
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  static fillMissing(klines: KlineData[], intervalMs: number): KlineData[] {
    if (klines.length < 2) return klines

    const filled: KlineData[] = []
    const sorted = [...klines].sort((a, b) => a.timestamp - b.timestamp)

    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = sorted[i - 1]
        const curr = sorted[i]
        const gap = curr.timestamp - prev.timestamp

        if (gap > intervalMs * 1.5) {
          console.warn(
            `Gap detected: ${prev.timestamp} to ${curr.timestamp} (${gap}ms)`
          )
        }
      }
      filled.push(sorted[i])
    }

    return filled
  }
}

/**
 * 主K线数据管理器
 */
export class KlineDataManager {
  private l1Cache: L1MemoryCache
  private l2Cache: L2IndexedDBCache
  private apiClient: any // axios instance
  private progressCallbacks: Array<(progress: LoadProgress) => void> = []
  private metrics: CacheMetrics = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    sourceRequests: 0,
    cacheHitRate: 0,
    avgLoadTimeMs: 0,
  }

  private preloadingTasks = new Map<string, Promise<KlineData[]>>()
  private realTimeBuffer = new Map<string, Map<string, KlineData[]>>()

  constructor(apiClient: any) {
    this.l1Cache = new L1MemoryCache()
    this.l2Cache = new L2IndexedDBCache()
    this.apiClient = apiClient
  }

  async init(): Promise<void> {
    await this.l2Cache.init()
    console.log('KlineDataManager initialized')
  }

  /**
   * 获取K线数据 - 多层缓存查询
   */
  async getKlines(
    symbol: string,
    timeframe: string,
    options: {
      endTime?: number
      limit?: number
      forceRefresh?: boolean
    } = {}
  ): Promise<KlineData[]> {
    const startTime = performance.now()
    const { endTime, limit = 500, forceRefresh = false } = options

    const cacheKey = `${symbol}:${timeframe}`
    this.emitProgress({
      phase: 'loading',
      progress: 0,
      message: `Loading ${symbol} ${timeframe}`,
      loadedCount: 0,
      totalCount: limit,
    })

    // L1查询
    if (!forceRefresh) {
      const l1Data = this.l1Cache.get(cacheKey)
      if (l1Data) {
        this.metrics.l1Hits++
        this.emitProgress({
          phase: 'complete',
          progress: 100,
          message: 'Loaded from L1 cache',
          loadedCount: l1Data.length,
          totalCount: l1Data.length,
        })
        this.updateMetrics(startTime)
        return this.filterByTime(l1Data, endTime, limit)
      }
      this.metrics.l1Misses++

      // L2查询
      const l2Data = await this.l2Cache.get(cacheKey)
      if (l2Data) {
        this.metrics.l2Hits++
        // 促进到L1
        this.l1Cache.set(cacheKey, l2Data)
        this.emitProgress({
          phase: 'complete',
          progress: 100,
          message: 'Loaded from L2 cache',
          loadedCount: l2Data.length,
          totalCount: l2Data.length,
        })
        this.updateMetrics(startTime)
        return this.filterByTime(l2Data, endTime, limit)
      }
      this.metrics.l2Misses++
    }

    // 源查询
    this.metrics.sourceRequests++
    this.emitProgress({
      phase: 'loading',
      progress: 50,
      message: 'Fetching from server',
      loadedCount: 0,
      totalCount: limit,
    })

    const sourceData = await this.fetchFromServer(symbol, timeframe, endTime, limit)

    // 验证
    this.emitProgress({
      phase: 'validating',
      progress: 75,
      message: 'Validating data',
      loadedCount: sourceData.length,
      totalCount: limit,
    })

    const { isValid, errors } = KlineValidator.validate(sourceData)
    if (!isValid) {
      console.warn('Validation errors:', errors)
    }

    // 缓存保存
    this.l1Cache.set(cacheKey, sourceData)
    await this.l2Cache.set(cacheKey, sourceData)

    this.emitProgress({
      phase: 'complete',
      progress: 100,
      message: 'Done',
      loadedCount: sourceData.length,
      totalCount: sourceData.length,
    })

    this.updateMetrics(startTime)
    return sourceData
  }

  /**
   * 从服务器获取数据
   */
  private async fetchFromServer(
    symbol: string,
    timeframe: string,
    endTime?: number,
    limit: number = 500
  ): Promise<KlineData[]> {
    const params = {
      symbol,
      timeframe,
      limit,
      ...(endTime && { endTime }),
    }

    const response = await this.apiClient.get('/api/klines', { params })
    return response.data.data || []
  }

  /**
   * 实时更新处理
   */
  async updateRealtimeKline(
    symbol: string,
    timeframe: string,
    candle: any
  ): Promise<void> {
    // 保存到缓冲区
    if (!this.realTimeBuffer.has(symbol)) {
      this.realTimeBuffer.set(symbol, new Map())
    }

    const buffer = this.realTimeBuffer.get(symbol)!
    if (!buffer.has(timeframe)) {
      buffer.set(timeframe, [])
    }

    const klines = buffer.get(timeframe)!
    const newKline: KlineData = {
      timestamp: parseInt(candle.ts),
      symbol,
      open: parseFloat(candle.o),
      high: parseFloat(candle.h),
      low: parseFloat(candle.l),
      close: parseFloat(candle.c),
      volume: parseFloat(candle.vol),
      quoteAssetVolume: parseFloat(candle.volCcyQuote),
      numberOfTrades: 0,
      takerBuyBaseAssetVolume: 0,
      takerBuyQuoteAssetVolume: 0,
    }

    // 去重
    const idx = klines.findIndex(k => k.timestamp === newKline.timestamp)
    if (idx !== -1) {
      klines[idx] = newKline
    } else {
      klines.push(newKline)
    }

    // 排序并保持限制
    klines.sort((a, b) => a.timestamp - b.timestamp)
    if (klines.length > 1000) {
      klines.splice(0, klines.length - 1000)
    }

    // 更新缓存
    const cacheKey = `${symbol}:${timeframe}`
    this.l1Cache.set(cacheKey, klines)
    await this.l2Cache.set(cacheKey, klines)
  }

  /**
   * 预加载相邻时间帧
   */
  async preloadAdjacentTimeframes(
    symbol: string,
    currentTimeframe: string,
    endTime?: number
  ): Promise<void> {
    const timeframes = ['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D', '1W']
    const currentIdx = timeframes.indexOf(currentTimeframe)

    if (currentIdx === -1) return

    const adjacent = []
    if (currentIdx > 0) adjacent.push(timeframes[currentIdx - 1])
    if (currentIdx < timeframes.length - 1) adjacent.push(timeframes[currentIdx + 1])

    for (const tf of adjacent) {
      const taskKey = `${symbol}:${tf}`
      if (this.preloadingTasks.has(taskKey)) continue

      const task = this.getKlines(symbol, tf, { endTime, limit: 500 })
        .catch(err => {
          console.error(`Preload failed for ${taskKey}:`, err)
          return []
        })

      this.preloadingTasks.set(taskKey, task)

      // 清理完成的任务
      task.finally(() => {
        this.preloadingTasks.delete(taskKey)
      })
    }
  }

  /**
   * 时间戳切换时的无缝加载
   */
  async switchTimeframe(
    symbol: string,
    newTimeframe: string,
    endTime?: number
  ): Promise<KlineData[]> {
    // 立即返回缓存数据或空数组
    const cacheKey = `${symbol}:${newTimeframe}`
    const cached = this.l1Cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // 在后台加载，返回空数组以立即更新UI
    this.getKlines(symbol, newTimeframe, { endTime })
      .then(data => {
        // 通知订阅者新数据已准备好
        this.notifyDataReady(symbol, newTimeframe, data)
      })
      .catch(err => {
        console.error(`Failed to load ${symbol} ${newTimeframe}:`, err)
      })

    // 预加载相邻的
    this.preloadAdjacentTimeframes(symbol, newTimeframe, endTime)

    return []
  }

  /**
   * 订阅数据更新
   */
  private subscribers = new Map<string, Set<(data: KlineData[]) => void>>()

  onDataReady(
    symbol: string,
    timeframe: string,
    callback: (data: KlineData[]) => void
  ): () => void {
    const key = `${symbol}:${timeframe}`
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }

    this.subscribers.get(key)!.add(callback)

    // 返回取消订阅函数
    return () => {
      this.subscribers.get(key)?.delete(callback)
    }
  }

  private notifyDataReady(
    symbol: string,
    timeframe: string,
    data: KlineData[]
  ): void {
    const key = `${symbol}:${timeframe}`
    const callbacks = this.subscribers.get(key)
    if (callbacks) {
      callbacks.forEach(cb => cb(data))
    }
  }

  /**
   * 进度监听
   */
  onProgress(callback: (progress: LoadProgress) => void): () => void {
    this.progressCallbacks.push(callback)
    return () => {
      const idx = this.progressCallbacks.indexOf(callback)
      if (idx !== -1) this.progressCallbacks.splice(idx, 1)
    }
  }

  private emitProgress(progress: LoadProgress): void {
    this.progressCallbacks.forEach(cb => cb(progress))
  }

  /**
   * 工具方法
   */
  private filterByTime(
    klines: KlineData[],
    endTime?: number,
    limit: number = 500
  ): KlineData[] {
    let filtered = [...klines]
    if (endTime) {
      filtered = filtered.filter(k => k.timestamp <= endTime)
    }
    return filtered.slice(-limit)
  }

  private updateMetrics(startTime: number): void {
    const loadTime = performance.now() - startTime
    this.metrics.avgLoadTimeMs = this.metrics.avgLoadTimeMs * 0.9 + loadTime * 0.1
    this.metrics.cacheHitRate =
      (this.metrics.l1Hits + this.metrics.l2Hits) /
      (this.metrics.l1Hits +
        this.metrics.l1Misses +
        this.metrics.l2Hits +
        this.metrics.l2Misses)
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  async clear(): Promise<void> {
    this.l1Cache.clear()
    await this.l2Cache.clear()
    this.realTimeBuffer.clear()
    this.subscribers.clear()
  }
}

export default KlineDataManager
