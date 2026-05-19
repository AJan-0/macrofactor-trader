// TradingView 风格移动端交易面板
import { useState } from "react";

interface Props {
  price: number | null;
  symbol: string;
  onBuy?: () => void;
  onSell?: () => void;
}

export default function MobileTradingPanel({ price, symbol, onBuy, onSell }: Props) {
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");

  if (!price) return null;

  return (
    <div className="lg:hidden bg-[#0a0e1a] border-t border-[#1e293b] p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      {/* 订单类型切换 */}
      <div className="flex gap-1 mb-3">
        {(["market", "limit"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={`flex-1 py-1.5 text-xs rounded font-medium transition-colors ${
              orderType === type
                ? "bg-[#1a2236] text-[#e2e8f0] border border-[#2d3a52]"
                : "text-[#475569]"
            }`}
          >
            {type === "market" ? "市价" : "限价"}
          </button>
        ))}
      </div>

      {/* 价格和数量输入 */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <div className="text-[10px] text-[#475569] mb-1">价格</div>
          <div className="bg-[#1a2236] border border-[#2d3a52] rounded px-3 py-2 text-sm text-[#e2e8f0]">
            {price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[10px] text-[#475569] mb-1">数量</div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-[#1a2236] border border-[#2d3a52] rounded px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#475569] outline-none focus:border-[#3b82f6]"
          />
        </div>
      </div>

      {/* 买卖按钮 */}
      <div className="flex gap-2">
        <button
          onClick={onBuy}
          className="flex-1 py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold rounded-lg text-sm active:scale-[0.98] transition-transform"
        >
          买入 {symbol}
        </button>
        <button
          onClick={onSell}
          className="flex-1 py-3 bg-[#ef4444] hover:bg-[#dc2626] text-white font-bold rounded-lg text-sm active:scale-[0.98] transition-transform"
        >
          卖出 {symbol}
        </button>
      </div>
    </div>
  );
}
