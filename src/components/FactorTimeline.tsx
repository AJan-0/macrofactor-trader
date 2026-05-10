import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";

/**
 * 底部宏观因子时间轴
 * 按月份/季度显示因子密度和类型分布
 */

interface MonthBlock {
  year: number;
  month: number;
  label: string;
  events: Array<{
    id: string;
    title: string;
    category: string;
    impact_level: string;
    is_forecast: boolean;
    btc_impact_1d: number | null;
  }>;
  hasForecast: boolean;
}

const CAT_DOT: Record<string, string> = {
  Macro: "#22c55e",
  GeoPolitics: "#8b5cf6",
  CryptoNative: "#f7931a",
};

export default function FactorTimeline() {
  const events = useAppStore((s) => s.events);
  const activeTimestamp = useAppStore((s) => s.activeTimestamp);
  const selectEvent = useAppStore((s) => s.selectEvent);

  // 按月分组
  const months = useMemo(() => {
    const map = new Map<string, MonthBlock>();

    for (const ev of events) {
      const d = new Date(ev.timestamp * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, {
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          events: [],
          hasForecast: false,
        });
      }
      const block = map.get(key)!;
      block.events.push({
        id: ev.id,
        title: ev.title,
        category: ev.category,
        impact_level: ev.impact_level,
        is_forecast: ev.is_forecast,
        btc_impact_1d: ev.btc_impact_1d,
      });
      if (ev.is_forecast) block.hasForecast = true;
    }

    // 排序
    return Array.from(map.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [events]);

  if (months.length === 0) return null;

  return (
    <div style={{ height: 120, background: '#0a0e1a', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px', gap: 8, borderBottom: '1px solid #1e293b30' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#e2e8f0', letterSpacing: 1 }}>FACTOR TIMELINE</span>
        <span style={{ fontSize: 8, color: '#475569' }}>{events.filter(e => e.is_forecast).length} upcoming</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {Object.entries(CAT_DOT).map(([cat, color]) => (
            <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#475569' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} /> {cat}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#475569' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6' }} /> Forecast
          </span>
        </div>
      </div>

      {/* 时间轴 */}
      <div style={{ flex: 1, display: 'flex', overflowX: 'auto', padding: '8px 12px', gap: 6, alignItems: 'flex-start' }}>
        {months.map((block) => {
          const isActiveMonth = activeTimestamp && (() => {
            const d = new Date(activeTimestamp * 1000);
            return d.getFullYear() === block.year && d.getMonth() + 1 === block.month;
          })();

          return (
            <div key={block.label}
              style={{
                minWidth: 70, padding: '4px 6px', borderRadius: 4,
                background: isActiveMonth ? '#1a2236' : 'transparent',
                border: isActiveMonth ? '1px solid #3b82f640' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
              {/* 月份标签 */}
              <div style={{ fontSize: 8, color: '#475569', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>
                {block.label}
              </div>

              {/* 事件点 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {block.events.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => {
                      const event = events.find(e => e.id === ev.id);
                      if (event) selectEvent(event.id, event.timestamp);
                    }}
                    title={ev.title}
                    style={{
                      width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: ev.is_forecast ? '#3b82f6' : (CAT_DOT[ev.category] || '#475569'),
                      opacity: ev.is_forecast ? 0.6 : 1,
                      boxShadow: ev.impact_level === 'high' ? `0 0 4px ${CAT_DOT[ev.category] || '#475569'}` : 'none',
                    }}
                  />
                ))}
              </div>

              {/* 计数 */}
              <div style={{ fontSize: 7, color: '#475569', marginTop: 2, textAlign: 'right' }}>
                {block.events.length} {block.hasForecast && <span style={{ color: '#3b82f6' }}>(f)</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
