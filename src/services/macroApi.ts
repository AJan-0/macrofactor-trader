// 宏观数据 API 服务层 —— FRED (Federal Reserve) + 本地 factors.json 兜底
// 使用方式：设置 localStorage "fred_api_key" 或修改下方常量

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MacroEvent } from "@/store/appStore";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FRED_API_KEY = localStorage.getItem("fred_api_key") || "";

// 关注的 FRED 数据序列
const FRED_SERIES: Record<string, { title: string; unit: string; category: string; impact: "high" | "medium" | "low" }> = {
  CPIAUCSL: { title: "CPI (Consumer Price Index)", unit: "Index", category: "Macro", impact: "high" },
  FEDFUNDS: { title: "Federal Funds Rate", unit: "%", category: "Macro", impact: "high" },
  UNRATE: { title: "Unemployment Rate", unit: "%", category: "Macro", impact: "high" },
  GDP: { title: "Gross Domestic Product", unit: "Bil. $", category: "Macro", impact: "medium" },
  PAYEMS: { title: "Nonfarm Payrolls", unit: "Thous.", category: "Macro", impact: "high" },
  PCEPI: { title: "PCE Price Index", unit: "Index", category: "Macro", impact: "medium" },
};

interface FRERDObservation {
  date: string; // "2024-01-01"
  value: string;
}

function parseFREDValue(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fredToMacroEvent(
  seriesId: string,
  meta: (typeof FRED_SERIES)[string],
  obs: FRERDObservation,
  prevObs?: FRERDObservation
): MacroEvent {
  const ts = Math.floor(new Date(obs.date).getTime() / 1000);
  const actual = parseFREDValue(obs.value);
  const previous = prevObs ? parseFREDValue(prevObs.value) : null;
  const change = actual !== null && previous !== null ? actual - previous : null;

  return {
    id: `fred-${seriesId}-${obs.date}`,
    timestamp: ts,
    date_str: obs.date,
    category: meta.category as any,
    subcategory: seriesId === "CPIAUCSL" ? "CPI" : seriesId === "FEDFUNDS" ? "FOMC" : "Other",
    title: meta.title,
    impact_level: meta.impact,
    expected: null,
    previous,
    actual_value: actual,
    change,
    deviation: null,
    unit: meta.unit,
    description: `${meta.title}: ${actual?.toFixed(2) ?? "N/A"} ${meta.unit}`,
    source_name: "FRED",
    source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
    is_forecast: false,
    btc_impact_1d: null,
    btc_impact_3d: null,
    btc_impact_7d: null,
  };
}

async function fetchFREDLastObservations(seriesId: string): Promise<FRERDObservation[]> {
  if (!FRED_API_KEY) throw new Error("FRED API key not configured");
  const url = `${FRED_BASE}/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.observations || []) as FRERDObservation[];
}

export async function fetchRealMacroEvents(): Promise<MacroEvent[]> {
  if (!FRED_API_KEY) {
    console.log("[MacroAPI] FRED API key not set, skipping real macro fetch. Set localStorage 'fred_api_key' to enable.");
    return [];
  }

  const all: MacroEvent[] = [];
  for (const [seriesId, meta] of Object.entries(FRED_SERIES)) {
    try {
      const obs = await fetchFREDLastObservations(seriesId);
      if (obs.length === 0) continue;
      // 取最近一条作为事件
      const latest = fredToMacroEvent(seriesId, meta, obs[0], obs[1]);
      all.push(latest);
    } catch (err) {
      console.warn(`[MacroAPI] Failed to fetch ${seriesId}:`, err);
    }
  }

  console.log(`[MacroAPI] Fetched ${all.length} real macro events from FRED`);
  return all;
}

export function isFREDConfigured(): boolean {
  return !!FRED_API_KEY;
}
