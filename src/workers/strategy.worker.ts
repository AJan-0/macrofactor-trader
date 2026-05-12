// 策略计算 Web Worker —— 将重计算 offload 到后台线程
// 用法: new Worker(new URL('./strategy.worker.ts', import.meta.url), { type: 'module' })

import { strategyRegistry } from "../services/strategyEngine";
import type { KlineData } from "../services/cryptoCompare";
import type { StrategyOutput } from "../services/strategyEngine";

// 注册所有策略（worker 中 registry 是独立的实例）
import { vwapStrategy } from "../strategies/vwapStrategy";
import { ictStructureStrategy } from "../strategies/ictStructureStrategy";
import { ictAdvancedStrategy } from "../strategies/ictAdvancedStrategy";

strategyRegistry.register(vwapStrategy);
strategyRegistry.register(ictStructureStrategy);
strategyRegistry.register(ictAdvancedStrategy);

export interface StrategyWorkerRequest {
  id: string;
  strategyId: string;
  klines: KlineData[];
  params: Record<string, number | boolean | string>;
}

export interface StrategyWorkerResponse {
  id: string;
  strategyId: string;
  output: StrategyOutput | null;
  error?: string;
}

self.onmessage = (event: MessageEvent<StrategyWorkerRequest | { type: "ping"; id: string }>) => {
  const data = event.data;

  // Ping-pong 握手
  if ((data as { type?: string }).type === "ping") {
    self.postMessage({ type: "pong", id: (data as { id?: string }).id });
    return;
  }

  const { id, strategyId, klines, params } = data as StrategyWorkerRequest;

  try {
    const strategy = strategyRegistry.get(strategyId);
    if (!strategy) {
      self.postMessage({ id, strategyId, output: null, error: `Strategy ${strategyId} not found` } satisfies StrategyWorkerResponse);
      return;
    }

    const output = strategy.calculate({ klines, params });
    self.postMessage({ id, strategyId, output } satisfies StrategyWorkerResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, strategyId, output: null, error: msg } satisfies StrategyWorkerResponse);
  }
};
