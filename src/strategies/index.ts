import { strategyRegistry } from "@/services/strategyEngine";
import { vwapStrategy } from "./vwapStrategy";
import { ictStructureStrategy } from "./ictStructureStrategy";
import { ictAdvancedStrategy } from "./ictAdvancedStrategy";
// 导入 TradingView 热门指标（自动注册）
import "@/services/indicators";

// 注册所有策略
strategyRegistry.register(vwapStrategy);
strategyRegistry.register(ictStructureStrategy);
strategyRegistry.register(ictAdvancedStrategy);

export { strategyRegistry };
export { vwapStrategy } from "./vwapStrategy";
export { ictStructureStrategy } from "./ictStructureStrategy";
export { ictAdvancedStrategy } from "./ictAdvancedStrategy";
