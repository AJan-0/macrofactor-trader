import { useI18n } from "@/i18n/context";
import { ChartIcon, FactorsIcon, NewsIcon, DataIcon } from "@/components/icons";

export type MobileTab = "chart" | "factors" | "news" | "data";

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const TABS: { key: MobileTab; icon: React.FC<{ className?: string; size?: number }>; labelZh: string; labelEn: string }[] = [
  { key: "chart", icon: ChartIcon, labelZh: "图表", labelEn: "Chart" },
  { key: "factors", icon: FactorsIcon, labelZh: "因子", labelEn: "Factors" },
  { key: "news", icon: NewsIcon, labelZh: "新闻", labelEn: "News" },
  { key: "data", icon: DataIcon, labelZh: "数据", labelEn: "Data" },
];

export default function MobileNav({ active, onChange }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0e1a]/95 backdrop-blur-md border-t border-[#1e293b]/60 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-[52px]">
        {TABS.map(tab => {
          const isActive = active === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full active:opacity-70 transition-opacity"
            >
              <Icon 
                size={18} 
                className={`transition-colors ${isActive ? "text-[#3b82f6]" : "text-[#475569]"}`} 
              />
              <span
                className={`text-[10px] leading-none font-medium transition-colors ${
                  isActive ? "text-[#3b82f6]" : "text-[#475569]"
                }`}
              >
                {isZh ? tab.labelZh : tab.labelEn}
              </span>
              {isActive && (
                <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-10 h-[2px] bg-[#3b82f6] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
