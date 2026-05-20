/**
 * ChartManagerComponent.tsx
 * 展示如何使用KlineDataManager的完整示例组件
 * 
 * 功能：
 * 1. 智能数据加载（多层缓存）
 * 2. 时间帧无缝切换
 * 3. 实时K线更新
 * 4. 性能指标展示
 * 5. 加载进度显示
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { KlineDataManager, type KlineData, type LoadProgress, type CacheMetrics } from '@/services/klineDataManager'

interface ChartManagerProps {
  symbol?: string
  initialTimeframe?: string
  onKlinesLoaded?: (klines: KlineData[]) => void
  onMetricsUpdate?: (metrics: CacheMetrics) => void
}

export const ChartManagerComponent: React.FC<ChartManagerProps> = ({
  symbol = 'BTC-USDT',
  initialTimeframe = '1H',
  onKlinesLoaded,
  onMetricsUpdate,
}) => {
  const [currentSymbol, setCurrentSymbol] = useState(symbol)
  const [currentTimeframe, setCurrentTimeframe] = useState(initialTimeframe)
  const [klines, setKlines] = useState<KlineData[]>([])
  const [progress, setProgress] = useState<LoadProgress>({
    phase: 'idle',
    progress: 0,
    message: '',
    loadedCount: 0,
    totalCount: 0,
  })
  const [metrics, setMetrics] = useState<CacheMetrics>({
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    sourceRequests: 0,
    cacheHitRate: 0,
    avgLoadTimeMs: 0,
  })

  // 数据管理器实例
  const managerRef = useRef<KlineDataManager | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // 初始化数据管理器
  useEffect(() => {
    if (!managerRef.current) {
      const apiClient = axios.create({
        baseURL: 'http://localhost:8000',
        timeout: 10000,
      })

      managerRef.current = new KlineDataManager(apiClient)
      managerRef.current.init()
    }

    return () => {
      // 清理资源
      if (managerRef.current) {
        managerRef.current.clear()
      }
    }
  }, [])

  // 监听进度
  useEffect(() => {
    const manager = managerRef.current
    if (!manager) return

    const unsubscribe = manager.onProgress((newProgress) => {
      setProgress(newProgress)
    })

    return unsubscribe
  }, [])

  // 监听指标更新
  useEffect(() => {
    const interval = setInterval(() => {
      const manager = managerRef.current
      if (manager) {
        const newMetrics = manager.getMetrics()
        setMetrics(newMetrics)
        onMetricsUpdate?.(newMetrics)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [onMetricsUpdate])

  // 加载K线数据
  const loadKlines = useCallback(async () => {
    const manager = managerRef.current
    if (!manager) return

    try {
      setProgress({
        phase: 'loading',
        progress: 0,
        message: `Loading ${currentSymbol} ${currentTimeframe}`,
        loadedCount: 0,
        totalCount: 500,
      })

      const data = await manager.getKlines(currentSymbol, currentTimeframe, {
        limit: 500,
      })

      setKlines(data)
      onKlinesLoaded?.(data)

      setProgress({
        phase: 'complete',
        progress: 100,
        message: 'Done',
        loadedCount: data.length,
        totalCount: data.length,
      })
    } catch (error) {
      console.error('Error loading klines:', error)
      setProgress({
        phase: 'error',
        progress: 0,
        message: String(error),
        loadedCount: 0,
        totalCount: 0,
      })
    }
  }, [currentSymbol, currentTimeframe, onKlinesLoaded])

  // 切换时间帧
  const handleTimeframeChange = useCallback(
    async (newTimeframe: string) => {
      setCurrentTimeframe(newTimeframe)

      // 立即尝试切换到缓存数据（如果有）
      const manager = managerRef.current
      if (manager) {
        const cachedData = await manager.switchTimeframe(currentSymbol, newTimeframe)
        if (cachedData.length > 0) {
          setKlines(cachedData)
          onKlinesLoaded?.(cachedData)
        } else {
          // 在后台加载新数据
          loadKlines()
        }
      }
    },
    [currentSymbol, loadKlines, onKlinesLoaded]
  )

  // 初始加载
  useEffect(() => {
    loadKlines()
  }, [currentSymbol, currentTimeframe, loadKlines])

  // 连接WebSocket实时更新
  useEffect(() => {
    const manager = managerRef.current
    if (!manager) return

    // 订阅数据更新事件
    const unsubscribe = manager.onDataReady(
      currentSymbol,
      currentTimeframe,
      (newData) => {
        setKlines(newData)
        onKlinesLoaded?.(newData)
      }
    )

    // 连接WebSocket
    const connectWebSocket = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      try {
        wsRef.current = new WebSocket('ws://localhost:8000/ws/klines')

        wsRef.current.onopen = () => {
          console.log('WebSocket connected')
          // 订阅当前交易对
          wsRef.current?.send(
            JSON.stringify({
              action: 'subscribe',
              symbol: currentSymbol,
              timeframe: currentTimeframe,
            })
          )
        }

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'update') {
              // 更新实时K线
              manager.updateRealtimeKline(
                data.symbol,
                data.timeframe,
                data.candle
              )
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error)
          }
        }

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error)
        }

        wsRef.current.onclose = () => {
          console.log('WebSocket disconnected')
          // 自动重连
          setTimeout(connectWebSocket, 3000)
        }
      } catch (error) {
        console.error('Failed to connect WebSocket:', error)
      }
    }

    connectWebSocket()

    return () => {
      unsubscribe()
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [currentSymbol, currentTimeframe, onKlinesLoaded])

  // 时间帧选项
  const timeframeOptions = ['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D', '1W']

  return (
    <div className="w-full h-full flex flex-col gap-4 p-4">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between gap-4 bg-slate-900 rounded-lg p-4">
        {/* 交易对选择 */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-300">Symbol:</label>
          <select
            value={currentSymbol}
            onChange={(e) => setCurrentSymbol(e.target.value)}
            className="bg-slate-800 text-white rounded px-3 py-1 text-sm"
          >
            <option>BTC-USDT</option>
            <option>ETH-USDT</option>
            <option>SOL-USDT</option>
            <option>XRP-USDT</option>
          </select>
        </div>

        {/* 时间帧选择 */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-300">Timeframe:</label>
          <div className="flex gap-1">
            {timeframeOptions.map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  currentTimeframe === tf
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* 刷新按钮 */}
        <button
          onClick={() => loadKlines()}
          className="px-4 py-1 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* 加载进度条 */}
      {progress.phase !== 'idle' && (
        <div className="bg-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-300">{progress.message}</span>
            <span className="text-xs text-slate-400">
              {progress.loadedCount}/{progress.totalCount}
            </span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 性能指标面板 */}
      <div className="grid grid-cols-4 gap-2 bg-slate-800 rounded-lg p-3">
        <MetricCard
          label="L1 Hit Rate"
          value={`${(metrics.l1Hits / (metrics.l1Hits + metrics.l1Misses) || 0) * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="L2 Hit Rate"
          value={`${(metrics.l2Hits / (metrics.l2Hits + metrics.l2Misses) || 0) * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Cache Hit Rate"
          value={`${(metrics.cacheHitRate * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Avg Load Time"
          value={`${metrics.avgLoadTimeMs.toFixed(0)}ms`}
        />
      </div>

      {/* K线数据网格 */}
      <div className="flex-1 bg-slate-800 rounded-lg p-4 overflow-auto">
        <div className="text-xs font-mono text-slate-300">
          <div className="grid grid-cols-6 gap-2 mb-2 font-bold">
            <div>Time</div>
            <div>Open</div>
            <div>High</div>
            <div>Low</div>
            <div>Close</div>
            <div>Volume</div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {klines.slice().reverse().map((kline) => (
              <div key={kline.timestamp} className="grid grid-cols-6 gap-2 py-1 border-b border-slate-700">
                <div className="text-slate-400">
                  {new Date(kline.timestamp).toLocaleString()}
                </div>
                <div className="text-slate-300">{kline.open.toFixed(2)}</div>
                <div className="text-green-400">{kline.high.toFixed(2)}</div>
                <div className="text-red-400">{kline.low.toFixed(2)}</div>
                <div
                  className={
                    kline.close >= kline.open ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {kline.close.toFixed(2)}
                </div>
                <div className="text-slate-400">{(kline.volume / 1000000).toFixed(2)}M</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 底部信息栏 */}
      <div className="bg-slate-800 rounded-lg p-3 text-xs text-slate-400">
        <div className="grid grid-cols-4 gap-4">
          <div>Total Klines: {klines.length}</div>
          <div>Source Requests: {metrics.sourceRequests}</div>
          <div>L1 Hits: {metrics.l1Hits}</div>
          <div>L2 Hits: {metrics.l2Hits}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * 指标卡片组件
 */
interface MetricCardProps {
  label: string
  value: string | number
  unit?: string
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit = '' }) => (
  <div className="bg-slate-700 rounded p-2">
    <div className="text-xs text-slate-400">{label}</div>
    <div className="text-lg font-bold text-slate-100">
      {value}
      {unit}
    </div>
  </div>
)

export default ChartManagerComponent
