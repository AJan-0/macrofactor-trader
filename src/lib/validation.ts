/**
 * Zod Schema 校验 - 策略参数运行时类型安全
 *
 * 用途：
 * 1. 校验 localStorage 中恢复的策略配置
 * 2. 校验策略参数输入
 * 3. 提供友好的错误信息
 */

import { z } from "zod";

/** 策略参数值类型 */
const ParamValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** 单个激活策略的 Schema */
export const ActiveStrategySchema = z.object({
  id: z.string().min(1, "策略 ID 不能为空"),
  params: z.record(z.string(), ParamValueSchema),
});

/** 激活策略列表 Schema */
export const ActiveStrategiesSchema = z.array(ActiveStrategySchema);

/** 策略参数更新 Schema */
export const StrategyParamUpdateSchema = z.object({
  strategyId: z.string(),
  paramId: z.string(),
  value: ParamValueSchema,
});

/**
 * 安全解析激活策略配置
 * @param raw - localStorage 中读取的原始 JSON 字符串
 * @returns 解析后的策略列表，解析失败返回空数组
 */
export function safeParseActiveStrategies(raw: string): Array<{ id: string; params: Record<string, string | number | boolean> }> {
  try {
    const parsed = JSON.parse(raw);
    const result = ActiveStrategiesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn("[validation] 策略配置格式无效，已重置:", result.error.format());
    return [];
  } catch {
    return [];
  }
}

/**
 * 安全序列化策略配置
 * @param strategies - 策略列表
 * @returns JSON 字符串
 */
export function safeSerializeStrategies(strategies: Array<{ id: string; params: Record<string, unknown> }>): string {
  const result = ActiveStrategiesSchema.safeParse(strategies);
  if (result.success) {
    return JSON.stringify(result.data);
  }
  console.warn("[validation] 策略配置序列化失败:", result.error.format());
  return "[]";
}
