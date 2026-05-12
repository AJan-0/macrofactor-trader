import type { ReactNode } from "react";

/**
 * AppProvider — 已废弃，状态已迁移至 Zustand。
 * 保留此文件仅为了兼容性，后续可删除。
 */
export function AppProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
