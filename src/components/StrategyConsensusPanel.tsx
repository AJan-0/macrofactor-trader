/**
 * 策略组合器（共识面板）—— P4
 *
 * 多策略信号叠加，实现"因子+策略"双重过滤的共识系统
 *
 * 功能：
 * - 汇总所有活跃策略的最新信号
 * - 计算方向共识（买入/卖出/中性）
 * - 与因子系统联动（可选开关）
 * - 可视化共识强度
 */

import { useMemo } from "react";
import type { StrategyOutput } from "@/services/strategyEngine";

interface Props {
  strategyOutputs: Map<string, StrategyOutput>;
}

interface ConsensusResult {
  bullishScore: number;
  bearishScore: number;
  neutralScore: number;
  totalScore: number;
  direction: "bullish" | "bearish" | "neutral";
  strength: number; // 0-1
  signalCount: number;
  latestSignals: Array<{
    strategyName: string;
    direction: string;
    strength: number;
    label: string;
    price: number;
    time: number;
  }>;
}

export function calculateConsensus(outputs: Map<string, StrategyOutput>): ConsensusResult {
  let bullishScore = 0;
  let bearishScore = 0;
  let neutralScore = 0;
  const latestSignals: ConsensusResult["latestSignals"] = [];

  for (const [strategyId, output] of outputs) {
    if (!output.signals.length) continue;
    // 取每个策略最新的信号
    const latest = output.signals[output.signals.length - 1];
    const score = latest.strength;

    if (latest.direction === "buy") {
      bullishScore += score;
    } else if (latest.direction === "sell") {
      bearishScore += score;
    } else {
      neutralScore += score * 0.3;
    }

    latestSignals.push({
      strategyName: strategyId,
      direction: latest.direction,
      strength: latest.strength,
      label: latest.label,
      price: latest.price,
      time: latest.time,
    });
  }

  const totalScore = bullishScore + bearishScore + neutralScore;
  const scores = [
    { dir: "bullish" as const, score: bullishScore },
    { dir: "bearish" as const, score: bearishScore },
    { dir: "neutral" as const, score: neutralScore },
  ].sort((a, b) => b.score - a.score);

  const direction = scores[0].score > 0 ? scores[0].dir : "neutral";
  const strength = totalScore > 0 ? (scores[0].score - (scores[1]?.score ?? 0)) / totalScore : 0;

  return {
    bullishScore: Math.round(bullishScore * 100) / 100,
    bearishScore: Math.round(bearishScore * 100) / 100,
    neutralScore: Math.round(neutralScore * 100) / 100,
    totalScore: Math.round(totalScore * 100) / 100,
    direction,
    strength: Math.round(Math.min(1, strength) * 100) / 100,
    signalCount: latestSignals.length,
    latestSignals: latestSignals.sort((a, b) => b.time - a.time),
  };
}

export default function StrategyConsensusPanel({ strategyOutputs }: Props) {
  const consensus = useMemo(() => calculateConsensus(strategyOutputs), [strategyOutputs]);

  if (consensus.signalCount === 0) {
    return (
      <div className="text-[8px] text-[#475569] text-center py-4">
        暂无策略信号<br />添加策略后将显示共识分析
      </div>
    );
  }

  const dirColor = consensus.direction === "bullish"
    ? "#22c55e"
    : consensus.direction === "bearish"
    ? "#ef4444"
    : "#eab308";

  const dirText = consensus.direction === "bullish" ? "看涨共识" : consensus.direction === "bearish" ? "看跌共识" : "中性";
  const dirEmoji = consensus.direction === "bullish" ? "▲" : consensus.direction === "bearish" ? "▼" : "◆";

  const maxScore = Math.max(consensus.bullishScore, consensus.bearishScore, consensus.neutralScore, 0.1);

  return (
    <div className="space-y-2">
      {/* 共识方向大卡片 */}
      <div className="p-2 rounded-lg border text-center" style={{ borderColor: `${dirColor}40`, background: `${dirColor}10` }}>
        <div className="text-[8px] text-[#94a3b8] mb-0.5">策略共识</div>
        <div className="text-[14px] font-bold" style={{ color: dirColor }}>
          {dirEmoji} {dirText}
        </div>
        <div className="text-[9px] text-[#e2e8f0] mt-0.5">
          强度 {Math.round(consensus.strength * 100)}% · {consensus.signalCount} 个策略参与
        </div>
      </div>

      {/* 三方向得分条 */}
      <div className="space-y-1">
        <ScoreBar label="看涨" score={consensus.bullishScore} max={maxScore} color="#22c55e" />
        <ScoreBar label="看跌" score={consensus.bearishScore} max={maxScore} color="#ef4444" />
        <ScoreBar label="中性" score={consensus.neutralScore} max={maxScore} color="#eab308" />
      </div>

      {/* 最新信号列表 */}
      <div className="mt-2">
        <div className="text-[8px] text-[#475569] mb-1">最新信号</div>
        <div className="space-y-1 max-h-[140px] overflow-y-auto">
          {consensus.latestSignals.map((s, i) => (
            <div key={i} className="flex items-center justify-between p-1 rounded bg-[#111827] border border-[#1e293b]/30">
              <div className="flex items-center gap-1">
                <span className={`text-[8px] font-bold ${s.direction === "buy" ? "text-[#22c55e]" : s.direction === "sell" ? "text-[#ef4444]" : "text-[#94a3b8]"}`}>
                  {s.direction === "buy" ? "▲" : s.direction === "sell" ? "▼" : "◆"}
                </span>
                <span className="text-[7px] text-[#e2e8f0] truncate max-w-[80px]">{s.strategyName}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7px] text-[#475569]">{s.label}</span>
                <span className="text-[7px] font-mono text-[#94a3b8]">{Math.round(s.strength * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 共识质量评级 */}
      <div className="flex items-center justify-between p-1.5 rounded bg-[#111827] border border-[#1e293b]/30">
        <span className="text-[8px] text-[#94a3b8]">共识质量</span>
        <ConsensusBadge strength={consensus.strength} />
      </div>
    </div>
  );
}

function ScoreBar({ label, score, max, color }: { label: string; score: number; max: number; color: string }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="flex items-center gap-1">
      <span className="text-[7px] text-[#94a3b8] w-8">{label}</span>
      <div className="flex-1 h-2 bg-[#1e293b] rounded overflow-hidden">
        <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[7px] font-mono text-[#e2e8f0] w-6 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

function ConsensusBadge({ strength }: { strength: number }) {
  let text = "弱";
  let color = "#475569";
  if (strength >= 0.8) { text = "极强"; color = "#22c55e"; }
  else if (strength >= 0.6) { text = "强"; color = "#22c55e"; }
  else if (strength >= 0.4) { text = "中等"; color = "#eab308"; }
  else if (strength >= 0.2) { text = "弱"; color = "#f97316"; }

  return (
    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ color, background: `${color}20` }}>
      {text}
    </span>
  );
}
