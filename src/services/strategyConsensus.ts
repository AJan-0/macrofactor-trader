import type { StrategyOutput } from "@/services/strategyEngine";

export interface ConsensusResult {
  bullishScore: number;
  bearishScore: number;
  neutralScore: number;
  totalScore: number;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
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
