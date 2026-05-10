/**
 * Pine Script 转译器面板 —— P5
 *
 * 用户粘贴 TradingView Pine Script 代码，自动转译为符合 Strategy 接口的 JS。
 */

import { useState } from "react";
import { transpilePineScript, type TranspileResult } from "@/services/pineTranspiler";

const EXAMPLE_PINE = `// My Custom Strategy
strategy("Golden Cross", overlay=true)

fastLength = input.int(12, "Fast MA")
slowLength = input.int(26, "Slow MA")

fastMA = ta.ema(close, fastLength)
slowMA = ta.ema(close, slowLength)

plot(fastMA, "Fast EMA")
plot(slowMA, "Slow EMA")

if ta.crossover(fastMA, slowMA)
    strategy.entry("Long", strategy.long)

if ta.crossunder(fastMA, slowMA)
    strategy.entry("Short", strategy.short)`;

export default function PineTranspilerPanel() {
  const [input, setInput] = useState(EXAMPLE_PINE);
  const [result, setResult] = useState<TranspileResult | null>(null);

  const handleTranspile = () => {
    const res = transpilePineScript(input);
    setResult(res);
  };

  return (
    <div className="space-y-2">
      <div className="text-[8px] text-[#94a3b8] mb-1">
        粘贴 TradingView Pine Script 代码，自动转译为 JavaScript 策略。
        <span className="text-[#475569]"> 支持：变量、输入、if/for、ta.*、plot、strategy.entry</span>
      </div>

      {/* 输入区 */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        className="w-full h-[140px] bg-[#111827] border border-[#1e293b] rounded p-2 text-[9px] text-[#e2e8f0] font-mono resize-none outline-none focus:border-[#3b82f6]"
        spellCheck={false}
      />

      {/* 操作按钮 */}
      <div className="flex gap-1">
        <button
          onClick={handleTranspile}
          className="flex-1 text-[9px] py-1 rounded bg-[#3b82f6] text-white font-bold hover:bg-[#2563eb] transition-colors"
        >
          ⚡ 转译为 JS
        </button>
        <button
          onClick={() => setInput("")}
          className="text-[8px] px-2 py-1 rounded border border-[#1e293b] text-[#475569] hover:text-[#e2e8f0] transition-colors"
        >
          清空
        </button>
        <button
          onClick={() => setInput(EXAMPLE_PINE)}
          className="text-[8px] px-2 py-1 rounded border border-[#1e293b] text-[#475569] hover:text-[#e2e8f0] transition-colors"
        >
          示例
        </button>
      </div>

      {/* 结果 */}
      {result && (
        <div className="space-y-1">
          {/* 状态 */}
          <div className="flex items-center gap-2">
            {result.success ? (
              <span className="text-[8px] text-[#22c55e] font-bold">✓ 转译成功</span>
            ) : (
              <span className="text-[8px] text-[#ef4444] font-bold">✗ 有错误</span>
            )}
            {result.warnings.length > 0 && (
              <span className="text-[8px] text-[#eab308]">⚠ {result.warnings.length} 个警告</span>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="p-1.5 rounded bg-[#ef444410] border border-[#ef444430]">
              {result.errors.map((e, i) => (
                <div key={i} className="text-[7px] text-[#ef4444]">{e}</div>
              ))}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="p-1.5 rounded bg-[#eab30810] border border-[#eab30830]">
              {result.warnings.map((w, i) => (
                <div key={i} className="text-[7px] text-[#eab308]">{w}</div>
              ))}
            </div>
          )}

          {/* 生成的代码 */}
          {result.success && (
            <>
              <div className="text-[8px] text-[#94a3b8]">生成的策略代码：</div>
              <div className="relative">
                <textarea
                  readOnly
                  value={result.code}
                  className="w-full h-[160px] bg-[#0a0f1c] border border-[#1e293b] rounded p-2 text-[8px] text-[#22c55e] font-mono resize-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.code);
                  }}
                  className="absolute top-1 right-1 text-[7px] px-1.5 py-0.5 rounded bg-[#1e293b] text-[#94a3b8] hover:text-[#e2e8f0]"
                >
                  复制
                </button>
              </div>

              {/* 参数预览 */}
              {result.definition.parameters.length > 0 && (
                <div>
                  <div className="text-[8px] text-[#94a3b8] mb-0.5">检测到的参数：</div>
                  <div className="space-y-0.5">
                    {result.definition.parameters.map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-[7px] p-1 rounded bg-[#111827]">
                        <span className="text-[#3b82f6] font-mono">{p.id}</span>
                        <span className="text-[#94a3b8]">{p.name}</span>
                        <span className="text-[#475569]">{typeof p.defaultValue} = {String(p.defaultValue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[7px] text-[#475569] p-1.5 rounded bg-[#111827] border border-[#1e293b]">
                <strong className="text-[#94a3b8]">如何使用：</strong><br />
                1. 复制生成的代码<br />
                2. 在 src/strategies/ 下创建新文件<br />
                3. 按照现有策略格式包装（导出 strategy 对象）<br />
                4. 在 src/strategies/index.ts 中注册
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
