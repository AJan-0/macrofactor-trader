import { useI18n } from "@/i18n/context";
import type { FactorCombination } from "@/services/factorEngine";

interface Props {
  combo: FactorCombination | null;
  lastUpdate: string;
}

export default function NarrativeBar({ combo, lastUpdate }: Props) {
  const { t, locale } = useI18n();

  if (!combo) {
    return (
      <div className="px-4 py-2 border-b border-[#1e293b] bg-[#0a0e1a]">
        <span className="text-[10px] text-[#475569]">{t("common.loading")}</span>
      </div>
    );
  }

  const dir = combo.combinedDirection;
  const dirColor = dir === "bullish" ? "#22c55e" : dir === "bearish" ? "#ef4444" : "#eab308";
  const dirLabel = dir === "bullish" ? t("narrative.bullish") : dir === "bearish" ? t("narrative.bearish") : t("narrative.neutral");
  const dirIcon = dir === "bullish" ? "▲" : dir === "bearish" ? "▼" : "◆";

  // 构建叙事文字
  const bullCount = combo.topBullish.length;
  const bearCount = combo.topBearish.length;

  // 找Top 3关键驱动
  const topDrivers = combo.activeFactors.slice(0, 3);
  const driverNames = topDrivers.map(d => {
    // 截断名称
    const maxLen = locale === "zh" ? 12 : 20;
    return d.name.length > maxLen ? d.name.slice(0, maxLen) + "..." : d.name;
  });

  return (
    <div className="px-4 py-2 border-b border-[#1e293b] bg-[#0a0e1a] flex items-center gap-3 overflow-hidden">
      {/* 方向标签 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span style={{ color: dirColor, fontSize: 11 }}>{dirIcon}</span>
        <span style={{ color: dirColor, fontSize: 11, fontWeight: 700 }}>{dirLabel}</span>
      </div>

      {/* 叙事文字 */}
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-[#94a3b8]">
          {locale === "zh" ? (
            <>
              <span className="text-[#e2e8f0]">{combo.activeFactors.length}</span>个因子驱动，
              <span style={{ color: "#22c55e" }}>{bullCount}</span>个看多 /
              <span style={{ color: "#ef4444" }}>{bearCount}</span>个看空。
              关键驱动：{driverNames.join("、")}
            </>
          ) : (
            <>
              <span className="text-[#e2e8f0]">{combo.activeFactors.length}</span> factors driving,{" "}
              <span style={{ color: "#22c55e" }}>{bullCount}</span> bullish /{" "}
              <span style={{ color: "#ef4444" }}>{bearCount}</span> bearish.
              Key drivers: {driverNames.join(", ")}
            </>
          )}
        </span>
      </div>

      {/* 更新时间 */}
      <div className="flex-shrink-0 text-[8px] text-[#475569] font-mono">
        {lastUpdate}
      </div>
    </div>
  );
}
