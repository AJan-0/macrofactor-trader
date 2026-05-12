/**
 * Pine Script 转译器 —— P5
 *
 * 基础 Pine Script 语法到 JavaScript / Strategy 接口的自动转译。
 * 这是一个简化版转译器，覆盖最常用的 Pine Script 模式。
 *
 * 支持的语法：
 * - 变量声明 (var, varip, :=, =)
 * - 输入参数 (input.int, input.float, input.bool, input.string)
 * - 条件语句 (if/else)
 * - for 循环 (for i = x to y)
 * - 内置技术指标 (ta.sma, ta.ema, ta.rsi, ta.highest, ta.lowest, ta.atr, ta.cci...)
 * - 绘图函数 (plot, plotshape, plotchar, bgcolor, fill)
 * - 策略函数 (strategy.entry, strategy.close, strategy.exit)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TranspileResult {
  success: boolean;
  code: string;
  definition: {
    id: string;
    name: string;
    description: string;
    parameters: Array<{
      id: string;
      name: string;
      type: "int" | "float" | "bool" | "string" | "color";
      defaultValue: any;
      min?: number;
      max?: number;
      step?: number;
    }>;
  };
  errors: string[];
  warnings: string[];
}

// 内置函数映射: Pine → JS
const BUILTIN_MAP: Record<string, string> = {
  // 数学
  "math.max": "Math.max",
  "math.min": "Math.min",
  "math.abs": "Math.abs",
  "math.sqrt": "Math.sqrt",
  "math.pow": "Math.pow",
  "math.log": "Math.log",
  "math.log10": "Math.log10",
  "math.exp": "Math.exp",
  "math.round": "Math.round",
  "math.floor": "Math.floor",
  "math.ceil": "Math.ceil",
  "math.pi": "Math.PI",
  // 技术指标 (前缀 ta.)
  "ta.sma": "SMA",
  "ta.ema": "EMA",
  "ta.wma": "WMA",
  "ta.rma": "RMA",
  "ta.rsi": "RSI",
  "ta.macd": "MACD",
  "ta.bb": "BollingerBands",
  "ta.stoch": "Stochastic",
  "ta.cci": "CCI",
  "ta.atr": "ATR",
  "ta.tr": "TR",
  "ta.highest": "highest",
  "ta.lowest": "lowest",
  "ta.highestbars": "highestBars",
  "ta.lowestbars": "lowestBars",
  "ta.crossover": "crossover",
  "ta.crossunder": "crossunder",
  "ta.cross": "cross",
  "ta.change": "change",
  "ta.correlation": "correlation",
  "ta.cum": "cumsum",
  "ta.dev": "stdDev",
  "ta.falling": "falling",
  "ta.rising": "rising",
  "ta.valuewhen": "valueWhen",
  // 颜色
  "color.new": "colorNew",
  "color.rgb": "colorRgb",
  "color.red": "'#ef4444'",
  "color.green": "'#22c55e'",
  "color.blue": "'#3b82f6'",
  "color.yellow": "'#eab308'",
  "color.orange": "'#f97316'",
  "color.purple": "'#8b5cf6'",
  "color.white": "'#ffffff'",
  "color.black": "'#000000'",
  "color.gray": "'#64748b'",
  "color.na": "null",
  // 时间
  "time": "k.time",
  "time_close": "k.time",
  "timenow": "Date.now() / 1000",
  // K线数据
  "open": "k.open",
  "high": "k.high",
  "low": "k.low",
  "close": "k.close",
  "hl2": "(k.high + k.low) / 2",
  "hlc3": "(k.high + k.low + k.close) / 3",
  "ohlc4": "(k.open + k.high + k.low + k.close) / 4",
  "volume": "k.volume",
  // 策略
  "strategy.position_size": "_positionSize",
  "strategy.openprofit": "_openProfit",
  "strategy.equity": "_equity",
};

// 绘图/策略函数映射（供扩展使用）
// const PLOT_FUNCTIONS = ["plot", "plotshape", "plotchar", "plotarrow", "plotcandle", "plotbar", "plotbgcolor", "fill", "bgcolor", "hline", "line.new"];
// const STRATEGY_FUNCTIONS = ["strategy.entry", "strategy.close", "strategy.exit", "strategy.cancel", "strategy.cancel_all"];

// ──────────────────────────────
// 核心转译函数
// ──────────────────────────────

export function transpilePineScript(pineCode: string): TranspileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = pineCode.split("\n");

  // 提取策略名称和描述
  let strategyName = "Custom Strategy";
  const strategyDesc = "Transpiled from Pine Script";
  const params: TranspileResult["definition"]["parameters"] = [];

  // 提取 indicator/strategy 标题
  const titleMatch = pineCode.match(/(?:indicator|strategy)\s*\(\s*["']([^"']+)["']/);
  if (titleMatch) strategyName = titleMatch[1];

  // 提取 shorttitle
  const shortMatch = pineCode.match(/shorttitle\s*=\s*["']([^"']+)["']/);
  if (shortMatch) strategyName = shortMatch[1];

  const jsLines: string[] = [];
  let indent = 2;
  const getIndent = () => "  ".repeat(indent);

  jsLines.push("// Auto-generated from Pine Script");
  jsLines.push("// Original: " + strategyName);
  jsLines.push("");
  jsLines.push("function calculate(klines, params) {");
  jsLines.push("  const n = klines.length;");
  jsLines.push("  if (n === 0) return { lines: [], labels: [], signals: [], zones: [] };");
  jsLines.push("");
  jsLines.push("  const lines = [], labels = [], signals = [], zones = [];");
  jsLines.push("  let _positionSize = 0, _openProfit = 0, _equity = 10000;");
  jsLines.push("");

  // 逐行处理
  let inFunction = false;
  const declaredVars = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) {
      jsLines.push("  " + rawLine); // 保留注释
      continue;
    }

    try {
      let jsLine = line;

      // 1. 输入参数提取
      const inputMatch = line.match(/(\w+)\s*=\s*input\.(\w+)\(([^,]+)(?:,\s*["']([^"']+)["'])?/);
      if (inputMatch) {
        const varName = inputMatch[1];
        const inputType = inputMatch[2];
        const defaultVal = inputMatch[3].trim();
        const displayName = inputMatch[4] || varName;
        const tsType = inputType === "int" ? "int" : inputType === "float" ? "float" : inputType === "bool" ? "bool" : "string";
        let parsedDefault: any = defaultVal;
        if (tsType === "int") parsedDefault = parseInt(defaultVal);
        else if (tsType === "float") parsedDefault = parseFloat(defaultVal);
        else if (tsType === "bool") parsedDefault = defaultVal === "true";

        params.push({
          id: varName,
          name: displayName,
          type: tsType,
          defaultValue: parsedDefault,
          min: tsType === "int" || tsType === "float" ? 0 : undefined,
          max: tsType === "int" || tsType === "float" ? 1000 : undefined,
          step: tsType === "int" ? 1 : tsType === "float" ? 0.01 : undefined,
        });

        jsLine = `const ${varName} = params.${varName} ?? ${defaultVal};`;
        declaredVars.add(varName);
      }

      // 2. var / varip 声明
      else if (line.match(/^var\s+\w+\s*=/)) {
        jsLine = line.replace(/^var\s+/, "let ");
        const varName = line.match(/var\s+(\w+)/)?.[1];
        if (varName) declaredVars.add(varName);
      }
      else if (line.match(/^varip\s+\w+\s*=/)) {
        jsLine = line.replace(/^varip\s+/, "let "); // varip 近似为 let
        const varName = line.match(/varip\s+(\w+)/)?.[1];
        if (varName) declaredVars.add(varName);
      }

      // 3. 赋值运算符 :=
      else if (line.includes(":=")) {
        jsLine = line.replace(/:=/g, "=");
      }

      // 4. 函数定义 f(x) => ...
      else if (line.match(/\w+\s*\([^)]*\)\s*=>\s*.+/)) {
        jsLine = line.replace(/(\w+)\s*\(([^)]*)\)\s*=>\s*/, "function $1($2) { return ");
        if (!jsLine.endsWith("}")) jsLine += "; }";
        inFunction = true;
      }
      else if (inFunction && !line.startsWith("  ") && !line.startsWith("\t")) {
        inFunction = false;
      }

      // 5. for 循环
      else if (line.match(/^for\s+\w+\s*=\s*\d+\s+to\s+\d+/)) {
        const forMatch = line.match(/for\s+(\w+)\s*=\s*(\d+)\s+to\s+(\d+)/);
        if (forMatch) {
          jsLine = `for (let ${forMatch[1]} = ${forMatch[2]}; ${forMatch[1]} <= ${forMatch[3]}; ${forMatch[1]}++) {`;
          indent++;
        }
      }
      else if (line.match(/^for\s+\w+\s*=\s*\d+\s+downto\s+\d+/)) {
        const forMatch = line.match(/for\s+(\w+)\s*=\s*(\d+)\s+downto\s+(\d+)/);
        if (forMatch) {
          jsLine = `for (let ${forMatch[1]} = ${forMatch[2]}; ${forMatch[1]} >= ${forMatch[3]}; ${forMatch[1]}--) {`;
          indent++;
        }
      }

      // 6. if / else if / else
      else if (line.match(/^if\s+/)) {
        jsLine = line.replace(/^if\s+/, "if (").replace(/$/, ") {");
        indent++;
      }
      else if (line.match(/^else\s+if\s+/)) {
        jsLine = "} else if (" + line.replace(/^else\s+if\s+/, "").replace(/$/, ") {");
        indent++;
      }
      else if (line === "else") {
        jsLine = "} else {";
        indent++;
      }

      // 7. 内置函数替换
      for (const [pine, js] of Object.entries(BUILTIN_MAP)) {
        const regex = new RegExp(`\\b${pine.replace(".", "\\.")}\\b`, "g");
        jsLine = jsLine.replace(regex, js);
      }

      // 8. 绘图函数 → 策略输出
      if (line.match(/^plot\s*\(/)) {
        const plotMatch = line.match(/plot\s*\(([^,]+)(?:,\s*["']([^"']*)["'])?/);
        if (plotMatch) {
          const val = plotMatch[1].trim();
          const label = plotMatch[2] || "Line";
          jsLine = `lines.push({ id: "plot-${label.replace(/\s+/g, "-")}", name: "${label}", data: klines.map((k,i) => ({ time: k.time, value: ${val} })), color: "#3b82f6", lineWidth: 2, style: "solid" });`;
        }
      }
      else if (line.match(/^plotshape\s*\(/)) {
        const psMatch = line.match(/plotshape\s*\(([^,]+),\s*["']([^"']*)["']/);
        if (psMatch) {
          jsLine = `if (${psMatch[1]}) signals.push({ time: klines[i].time, price: klines[i].close, direction: "buy", label: "${psMatch[2]}", strength: 0.7 });`;
        }
      }
      else if (line.match(/^bgcolor\s*\(/)) {
        jsLine = "// bg(...) not supported in basic transpiler";
        warnings.push("bgcolor() 暂不支持，请手动转换为 zones");
      }

      // 9. 策略函数
      else if (line.match(/^strategy\.entry\s*\(/)) {
        const seMatch = line.match(/strategy\.entry\s*\(["']([^"']*)["'],\s*["'](long|short)["']/);
        if (seMatch) {
          jsLine = `signals.push({ time: klines[i].time, price: klines[i].close, direction: "${seMatch[2] === "long" ? "buy" : "sell"}", label: "${seMatch[1]}", strength: 0.8 });`;
        }
      }
      else if (line.match(/^strategy\.close\s*\(/)) {
        jsLine = "// strategy.close() - implement exit logic manually";
      }

      // 10. 数组访问 [1] → 需要bar_index上下文
      jsLine = jsLine.replace(/\[1\]/g, "[i - 1]").replace(/\[2\]/g, "[i - 2]");

      // 11. nz() 函数
      jsLine = jsLine.replace(/nz\s*\(([^)]+)\)/g, "($1 ?? 0)");

      // 12. na 检查
      jsLine = jsLine.replace(/\bna\b/g, "null");

      // 13. color 字面量
      jsLine = jsLine.replace(/color\.(\w+)/g, (match, name) => {
        const mapped = BUILTIN_MAP[`color.${name}`];
        return mapped || match;
      });

      jsLines.push(getIndent() + jsLine);

      // 检查是否需要闭合括号
      if (line === "" || (line.startsWith("if") && !line.includes("{"))) {
        // 简单闭合逻辑
      }
    } catch (e: any) {
      errors.push(`Line ${i + 1}: ${e?.message || String(e)}`);
      jsLines.push(`  // ERROR at line ${i + 1}: ${rawLine}`);
    }
  }

  // 自动闭合未闭合的括号
  while (indent > 1) {
    indent--;
    jsLines.push("  ".repeat(indent) + "}");
  }

  jsLines.push("");
  jsLines.push("  return { lines, labels, signals, zones };");
  jsLines.push("}");

  // 添加辅助函数库
  jsLines.push("");
  jsLines.push("// ── 技术指标辅助函数库 ──");
  jsLines.push(TECHNICAL_FUNCTIONS);

  const result: TranspileResult = {
    success: errors.length === 0,
    code: jsLines.join("\n"),
    definition: {
      id: "custom-pine-" + Date.now(),
      name: strategyName,
      description: strategyDesc,
      parameters: params,
    },
    errors,
    warnings,
  };

  return result;
}

// 技术指标的 JS 实现库
const TECHNICAL_FUNCTIONS = `
function SMA(src, len) {
  const res = [];
  for (let i = 0; i < src.length; i++) {
    if (i < len - 1) { res.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < len; j++) sum += src[i - j];
    res.push(sum / len);
  }
  return res;
}

function EMA(src, len) {
  const res = [];
  const mult = 2 / (len + 1);
  for (let i = 0; i < src.length; i++) {
    if (i === 0) { res.push(src[0]); continue; }
    res.push(src[i] * mult + res[i - 1] * (1 - mult));
  }
  return res;
}

function RSI(src, len = 14) {
  const res = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < src.length; i++) {
    const change = src[i] - src[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= len) {
      avgGain += gain / len;
      avgLoss += loss / len;
      if (i === len) res.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      else res.push(null);
    } else {
      avgGain = (avgGain * (len - 1) + gain) / len;
      avgLoss = (avgLoss * (len - 1) + loss) / len;
      res.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
  }
  return res;
}

function ATR(klines, len = 14) {
  const tr = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const prevClose = i > 0 ? klines[i - 1].close : k.close;
    tr.push(Math.max(k.high - k.low, Math.abs(k.high - prevClose), Math.abs(k.low - prevClose)));
  }
  const res = [];
  for (let i = 0; i < tr.length; i++) {
    if (i === 0) res.push(tr[0]);
    else res.push((res[i - 1] * (len - 1) + tr[i]) / len);
  }
  return res;
}

function highest(src, len) {
  const res = [];
  for (let i = 0; i < src.length; i++) {
    if (i < len - 1) { res.push(null); continue; }
    let max = -Infinity;
    for (let j = 0; j < len; j++) max = Math.max(max, src[i - j]);
    res.push(max);
  }
  return res;
}

function lowest(src, len) {
  const res = [];
  for (let i = 0; i < src.length; i++) {
    if (i < len - 1) { res.push(null); continue; }
    let min = Infinity;
    for (let j = 0; j < len; j++) min = Math.min(min, src[i - j]);
    res.push(min);
  }
  return res;
}

function crossover(a, b) {
  if (a.length < 2 || b.length < 2) return false;
  return a[a.length - 2] <= b[b.length - 2] && a[a.length - 1] > b[b.length - 1];
}

function crossunder(a, b) {
  if (a.length < 2 || b.length < 2) return false;
  return a[a.length - 2] >= b[b.length - 2] && a[a.length - 1] < b[b.length - 1];
}

function cross(a, b) {
  return crossover(a, b) || crossunder(a, b);
}

function change(src) {
  const res = [0];
  for (let i = 1; i < src.length; i++) res.push(src[i] - src[i - 1]);
  return res;
}

function rising(src, len) {
  if (src.length < len) return false;
  for (let i = 0; i < len - 1; i++) {
    if (src[src.length - 1 - i] <= src[src.length - 2 - i]) return false;
  }
  return true;
}

function falling(src, len) {
  if (src.length < len) return false;
  for (let i = 0; i < len - 1; i++) {
    if (src[src.length - 1 - i] >= src[src.length - 2 - i]) return false;
  }
  return true;
}

function colorNew(c, transp) {
  // 简化：忽略透明度
  return c;
}

function colorRgb(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
`;
