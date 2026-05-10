import { useI18n } from "@/i18n/context";

export type MobileTab = "chart" | "factors" | "news" | "data";

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const TABS: { key: MobileTab; icon: string; labelZh: string; labelEn: string }[] = [
  { key: "chart", icon: "📈", labelZh: "图表", labelEn: "Chart" },
  { key: "factors", icon: "📊", labelZh: "因子", labelEn: "Factors" },
  { key: "news", icon: "📰", labelZh: "新闻", labelEn: "News" },
  { key: "data", icon: "📋", labelZh: "数据", labelEn: "Data" },
];

export default function MobileNav({ active, onChange }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0e1a] border-t border-[#1e293b]">
      <div className="flex items-center justify-around h-[56px]">
        {TABS.map(tab => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full"
            >
              <span className="text-[16px] leading-none">{tab.icon}</span>
              <span
                className={`text-[10px] leading-none ${
                  isActive ? "text-[#3b82f6] font-bold" : "text-[#475569]"
                }`}
              >
                {isZh ? tab.labelZh : tab.labelEn}
              </span>
              {isActive && (
                <div className="absolute bottom-0 w-8 h-[2px] bg-[#3b82f6] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
