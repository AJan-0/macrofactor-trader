import { useState } from "react";
import { useI18n } from "@/i18n/context";
import type { MacroEvent } from "@/store/appStore";

interface Props {
  events: MacroEvent[];
}

export default function UpcomingCalendar({ events }: Props) {
  const { t, locale } = useI18n();
  const [now] = useState(() => Date.now() / 1000);
  const week = 7 * 86400;

  const upcoming = events
    .filter(e => e.is_forecast || e.timestamp > now)
    .filter(e => e.timestamp <= now + week)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 5);

  if (upcoming.length === 0) return null;

  return (
    <div className="px-3 py-1.5 border-b border-[#1e293b] bg-[#0a0e1a]">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        <span className="text-[8px] font-bold text-[#eab308] tracking-wider whitespace-nowrap shrink-0">{t("upcoming.title")}</span>
        {upcoming.map(ev => {
          const daysUntil = Math.ceil((ev.timestamp - now) / 86400);
          const isToday = daysUntil <= 0;
          const isTomorrow = daysUntil === 1;
          const dayLabel = isToday ? t("upcoming.today")
            : isTomorrow ? t("upcoming.tomorrow")
            : `${daysUntil}${locale === "zh" ? t("upcoming.days") : ` ${t("upcoming.days")}`}`;
          const catColor = ev.category === "Macro" ? "#22c55e"
            : ev.category === "GeoPolitics" ? "#8b5cf6"
            : "#f7931a";

          return (
            <div key={ev.id} className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded border border-[#1e293b] bg-[#111827]">
              <span className="text-[6px] px-1 rounded" style={{
                background: `${catColor}20`, color: catColor,
              }}>{ev.category.slice(0, 3).toUpperCase()}</span>
              <span className="text-[8px] font-mono text-[#475569] whitespace-nowrap">{dayLabel}</span>
              <span className="text-[9px] text-[#e2e8f0] truncate max-w-[120px]">{ev.title}</span>
              {ev.forecast_prob_hold !== undefined && (
                <span className="text-[7px] font-mono text-[#3b82f6]">
                  {(ev.forecast_prob_hold * 100).toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
