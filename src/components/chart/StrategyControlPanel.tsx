import { useState, lazy, Suspense } from "react";
import { useI18n } from "@/i18n/context";
import type { StrategyDefinition, StrategyOutput, StrategySignal } from "@/services/strategyEngine";
import type { KlineData } from "./ChartCanvas";
import AlertPanel from "./AlertPanel";
import BacktestPanel from "../BacktestPanel";

const StrategyConsensusPanel = lazy(() => import("../StrategyConsensusPanel"));
const PineTranspilerPanel = lazy(() => import("../PineTranspilerPanel"));

interface AlertToast {
  id: string;
  strategyName: string;
  signal: StrategySignal;
  symbol: string;
}

interface StrategyControlPanelProps {
  activeStrategies: Array<{ id: string; params: Record<string, unknown> }>;
  strategyOutputs: Map<string, StrategyOutput>;
  allStrategies: StrategyDefinition[];
  addStrategy: (def: StrategyDefinition) => void;
  removeStrategy: (id: string) => void;
  updateStrategyParam: (strategyId: string, paramId: string, value: unknown) => void;
  resetStrategyParams: (strategyId: string) => void;
  clearAllStrategies: () => void;
  alertToasts: AlertToast[];
  onAlertToastsChange: (toasts: AlertToast[]) => void;
  klines: KlineData[];
}

export default function StrategyControlPanel({
  activeStrategies,
  strategyOutputs,
  allStrategies,
  addStrategy,
  removeStrategy,
  updateStrategyParam,
  resetStrategyParams,
  clearAllStrategies,
  alertToasts,
  onAlertToastsChange,
  klines,
}: StrategyControlPanelProps) {
  const { t } = useI18n();
  const [showPanel, setShowPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<"list" | "consensus" | "pine">("list");
  const [strategyTabs, setStrategyTabs] = useState<Record<string, "params" | "backtest">>({});

  return (
    <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="text-[11px] px-2.5 py-1 rounded bg-[#1a2236] text-[#94a3b8] hover:text-[#e2e8f0] border border-[#1e293b] font-bold transition-colors"
      >
        📈 {t("chart.strategy")} ({activeStrategies.length})
      </button>

      {showPanel && (
        <div className="bg-[#1a2236] border border-[#1e293b] rounded-lg p-2.5 shadow-xl w-[280px] max-h-[420px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-bold text-[#e2e8f0] tracking-wider">
              STRATEGIES
            </div>
            <AlertPanel toasts={alertToasts} onToastsChange={onAlertToastsChange} />
          </div>

          {/* Panel Tabs */}
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setPanelTab("list")}
              className={`flex-1 text-[10px] py-1 rounded ${
                panelTab === "list"
                  ? "bg-[#3b82f620] text-[#3b82f6]"
                  : "text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              策略列表
            </button>
            <button
              onClick={() => setPanelTab("consensus")}
              className={`flex-1 text-[10px] py-1 rounded ${
                panelTab === "consensus"
                  ? "bg-[#8b5cf620] text-[#8b5cf6]"
                  : "text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              ⚡ 共识
            </button>
            <button
              onClick={() => setPanelTab("pine")}
              className={`flex-1 text-[10px] py-1 rounded ${
                panelTab === "pine"
                  ? "bg-[#10b98120] text-[#10b981]"
                  : "text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              🌲 Pine
            </button>
          </div>

          {panelTab === "consensus" ? (
            <Suspense fallback={<Fallback />}>
              <StrategyConsensusPanel strategyOutputs={strategyOutputs} />
            </Suspense>
          ) : panelTab === "pine" ? (
            <Suspense fallback={<Fallback />}>
              <PineTranspilerPanel />
            </Suspense>
          ) : (
            <StrategyListTab
              activeStrategies={activeStrategies}
              strategyOutputs={strategyOutputs}
              allStrategies={allStrategies}
              addStrategy={addStrategy}
              removeStrategy={removeStrategy}
              updateStrategyParam={updateStrategyParam}
              resetStrategyParams={resetStrategyParams}
              clearAllStrategies={clearAllStrategies}
              strategyTabs={strategyTabs}
              setStrategyTabs={setStrategyTabs}
              klines={klines}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Fallback() {
  return (
    <div className="text-[10px] text-[#475569] py-4 text-center">Loading...</div>
  );
}

interface StrategyListTabProps {
  activeStrategies: Array<{ id: string; params: Record<string, unknown> }>;
  strategyOutputs: Map<string, StrategyOutput>;
  allStrategies: StrategyDefinition[];
  addStrategy: (def: StrategyDefinition) => void;
  removeStrategy: (id: string) => void;
  updateStrategyParam: (strategyId: string, paramId: string, value: unknown) => void;
  resetStrategyParams: (strategyId: string) => void;
  clearAllStrategies: () => void;
  strategyTabs: Record<string, "params" | "backtest">;
  setStrategyTabs: React.Dispatch<React.SetStateAction<Record<string, "params" | "backtest">>>;
  klines: KlineData[];
}

function StrategyListTab({
  activeStrategies,
  strategyOutputs,
  allStrategies,
  addStrategy,
  removeStrategy,
  updateStrategyParam,
  resetStrategyParams,
  clearAllStrategies,
  strategyTabs,
  setStrategyTabs,
  klines,
}: StrategyListTabProps) {
  const { t } = useI18n();
  return (
    <>
      {/* Add Strategy */}
      <div className="mb-2">
        <select
          className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1.5 text-[11px] text-[#e2e8f0] outline-none"
          onChange={(e) => {
            const def = allStrategies.find((d) => d.id === e.target.value);
            if (def) addStrategy(def);
            e.target.value = "";
          }}
          value=""
        >
          <option value="">+ {t("chart.addStrategy")}</option>
          {allStrategies.map((def) => (
            <option key={def.id} value={def.id}>
              {def.name}
            </option>
          ))}
        </select>
      </div>

      {/* Active Strategies List */}
      {activeStrategies.map((as) => {
        const def = allStrategies.find((d) => d.id === as.id);
        if (!def) return null;
        const output = strategyOutputs.get(as.id);
        return (
          <div
            key={as.id}
            className="mb-2 p-2 rounded bg-[#111827] border border-[#1e293b]/50"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-[#e2e8f0]">
                {def.name}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => resetStrategyParams(as.id)}
                  className="text-[10px] text-[#475569] hover:text-[#3b82f6]"
                  title="重置参数"
                >
                  ↺
                </button>
                <button
                  onClick={() => removeStrategy(as.id)}
                  className="text-[10px] text-[#475569] hover:text-[#ef4444]"
                >
                  ✕
                </button>
              </div>
            </div>

            {output && (
              <div className="text-[9px] text-[#475569] mb-1">
                {output.signals.length} signals | {output.lines.length} lines
              </div>
            )}

            {/* Params / Backtest Tabs */}
            <div className="flex gap-1 mb-1.5">
              <button
                onClick={() =>
                  setStrategyTabs((prev) => ({ ...prev, [as.id]: "params" }))
                }
                className={`text-[9px] px-2 py-0.5 rounded ${
                  strategyTabs[as.id] !== "backtest"
                    ? "bg-[#3b82f620] text-[#3b82f6]"
                    : "text-[#475569] hover:text-[#94a3b8]"
                }`}
              >
                参数
              </button>
              <button
                onClick={() =>
                  setStrategyTabs((prev) => ({ ...prev, [as.id]: "backtest" }))
                }
                className={`text-[9px] px-2 py-0.5 rounded ${
                  strategyTabs[as.id] === "backtest"
                    ? "bg-[#eab30820] text-[#eab308]"
                    : "text-[#475569] hover:text-[#94a3b8]"
                }`}
              >
                📊 回测
              </button>
            </div>

            {strategyTabs[as.id] === "backtest" ? (
              <BacktestPanel
                strategyName={def.name}
                signals={output?.signals ?? []}
                klines={klines}
              />
            ) : (
              <div className="space-y-1.5">
                {def.parameters.map((param) => (
                  <div key={param.id} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#94a3b8] w-20 truncate">
                      {param.name}
                    </span>
                    {param.type === "bool" ? (
                      <button
                        onClick={() => {
                          const current = as.params[param.id];
                          const next = typeof current === 'boolean' ? !current : current === 'true' ? false : true;
                          (updateStrategyParam as (id: string, pid: string, v: unknown) => void)(as.id, param.id, next);
                        }}
                        className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                          as.params[param.id]
                            ? "bg-[#22c55e20] text-[#22c55e]"
                            : "bg-[#1e293b] text-[#475569]"
                        }`}
                      >
                        {as.params[param.id] ? "ON" : "OFF"}
                      </button>
                    ) : param.type === "int" || param.type === "float" ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="range"
                          min={param.min}
                          max={param.max}
                          step={param.step || 1}
                          value={as.params[param.id] as number}
                          onChange={(e) => {
                            const val = param.type === "int" ? parseInt(e.target.value) : parseFloat(e.target.value);
                            (updateStrategyParam as (id: string, pid: string, v: unknown) => void)(as.id, param.id, val);
                          }}
                          className="flex-1 h-1.5 accent-[#3b82f6]"
                        />
                        <span className="text-[9px] font-mono text-[#e2e8f0] w-6">
                          {as.params[param.id]}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {activeStrategies.length > 0 && (
        <button
          onClick={clearAllStrategies}
          className="w-full text-[10px] py-1.5 rounded border border-[#ef444430] text-[#ef4444] hover:bg-[#ef444410] transition-colors"
        >
          清空所有策略
        </button>
      )}
      {activeStrategies.length === 0 && (
        <div className="text-[10px] text-[#475569] text-center py-2">
          暂无策略，从上方选择添加
        </div>
      )}
    </>
  );
}
