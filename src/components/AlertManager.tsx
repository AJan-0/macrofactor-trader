/**
 * AlertManager 预警管理中心 (v0.4.0)
 *
 * 功能:
 *  - 预警列表 (类型标签 + 交易对 + 参数摘要 + 启用/禁用开关 + 删除)
 *  - 创建预警表单 (类型选择 -> 按类型显示条件参数)
 *  - 实时预警 WebSocket -> sonner toast 弹窗
 *  - 本地 IndexedDB 历史记录
 */

import {
  useState, useEffect, useCallback, useRef, useMemo,
} from "react";
import { toast } from "sonner";
import { useAppStore, type AssetSymbol } from "@/store/appStore";
import { useAlertStream, type AlertEvent } from "@/hooks/useAlertStream";
import {
  fetchAlerts, createAlert as apiCreate, updateAlert as apiUpdate, deleteAlert as apiDel,
  type AlertConfig, type AlertCreatePayload,
} from "@/services/alertApi";
import { saveLocalAlert } from "@/hooks/useIndexedDB";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Plus, Trash2, ArrowLeft, ArrowUpDown, CandlestickChart, Layers,
} from "lucide-react";

// ── 全局打开方法 (供 Toolbar 等外部组件使用) ──
let _openDialog: (() => void) | null = null;
export function openAlertManager(): void {
  _openDialog?.();
}

// ── 常量 ──

const ALERT_TYPES = [
  { value: "price_cross", label: "价格穿越", icon: ArrowUpDown, color: "#3b82f6",
    desc: "价格穿越指定水平位 (向上/向下)" },
  { value: "reversal",    label: "反转形态", icon: CandlestickChart, color: "#f59e0b",
    desc: "K线反转形态 (锤子/十字星/吞没等)" },
  { value: "multi_tf",    label: "多TF共振", icon: Layers, color: "#8b5cf6",
    desc: "多时间框架 SMA 同向共振" },
] as const;

const REVERSAL_PATTERNS = [
  { value: "doji", label: "十字星 (Doji)" },
  { value: "hammer", label: "锤子 (Hammer)" },
  { value: "shooting_star", label: "射击之星 (ShootingStar)" },
  { value: "engulfing_bullish", label: "看涨吞没 (BullishEngulf)" },
  { value: "engulfing_bearish", label: "看跌吞没 (BearishEngulf)" },
];

const TF_OPTIONS = [
  { value: "5m", label: "5分钟" },
  { value: "15m", label: "15分钟" },
  { value: "1H", label: "1小时" },
  { value: "4H", label: "4小时" },
  { value: "1D", label: "日线" },
];

const SYMBOL_OPTIONS: { value: AssetSymbol; label: string }[] = [
  { value: "BTC-USDT", label: "BTC-USDT" },
  { value: "ETH-USDT", label: "ETH-USDT" },
  { value: "GC=F", label: "GC=F" },
];

// ── 辅助 ──

function paramsSummary(a: AlertConfig): string {
  switch (a.alert_type) {
    case "price_cross":
      return `${a.params?.direction === "below" ? "↓" : "↑"} $${Number(a.params?.level).toLocaleString()} · ${a.params?.timeframe ?? "-"}`;
    case "reversal":
      return `${(a.params?.pattern ?? "").replace(/_/g, " ")} · ${a.params?.timeframe ?? "-"}`;
    case "multi_tf":
      return `${(a.params?.timeframes as string[] ?? []).join("/")} ≥${a.params?.required_count ?? 0}`;
    default:
      return "-";
  }
}

// ── 主组件 ──

export default function AlertManager() {
  const symbol = useAppStore((s) => s.currentSymbol);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState<"list" | "create">("list");
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [loading, setLoading] = useState(false);

  // 注册全局打开方法
  useEffect(() => {
    _openDialog = () => setDialogOpen(true);
    return () => { _openDialog = null; };
  }, []);

  // ── form state ──
  const [formType, setFormType] = useState<string>("price_cross");
  const [formSymbol, setFormSymbol] = useState<AssetSymbol>("BTC-USDT");
  const [formParams, setFormParams] = useState<Record<string, any>>({});
  const [formCooldown, setFormCooldown] = useState(30);

  const activeCount = useMemo(() => alerts.filter((a) => a.enabled).length, [alerts]);

  // ── 加载预警列表 ──
  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts();
      setAlerts(data);
    } catch (err: any) {
      console.warn("[AlertManager] loadAlerts:", err?.message ?? err);
    }
  }, []);
  useEffect(() => { if (dialogOpen) loadAlerts(); }, [dialogOpen, loadAlerts]);

  // ── 启用/禁用 ──
  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    try { await apiUpdate(id, { enabled }); } catch { loadAlerts(); }
  }, [loadAlerts]);

  // ── 删除 ──
  const handleDelete = useCallback(async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try { await apiDel(id); } catch { loadAlerts(); }
  }, [loadAlerts]);

  // ── 打开创建表单 ──
  const openCreate = useCallback(() => {
    setFormType("price_cross");
    setFormSymbol(symbol);
    setFormParams({});
    setFormCooldown(30);
    setPage("create");
  }, [symbol]);

  // ── 提交创建 ──
  const handleSubmit = useCallback(async () => {
    if (!formSymbol) { toast.error("请选择交易对"); return; }
    let error = "";
    switch (formType) {
      case "price_cross": if (!formParams.level) error = "请输入价格水平"; break;
      case "reversal":    if (!formParams.pattern) error = "请选择反转形态"; break;
      case "multi_tf":    if (!formParams.timeframes?.length) error = "请输入至少一个时间框架"; break;
    }
    if (error) { toast.error(error); return; }

    setLoading(true);
    try {
      const payload: AlertCreatePayload = {
        symbol: formSymbol,
        alert_type: formType as AlertCreatePayload["alert_type"],
        params: { ...formParams },
        cooldown_minutes: formCooldown,
      };
      await apiCreate(payload);
      toast.success("预警创建成功");
      setPage("list");
      await loadAlerts();
    } catch (err: any) {
      toast.error(`创建失败: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, [formSymbol, formType, formParams, formCooldown, loadAlerts]);

  // ── 实时预警流 ──
  const dedupRef = useRef(new Map<string, number>());
  useAlertStream((event: AlertEvent) => {
    const dedupKey = `${event.alert_id}-${event.time}`;
    const now = Date.now();
    const last = dedupRef.current.get(dedupKey);
    if (last && now - last < 60_000) return;
    dedupRef.current.set(dedupKey, now);
    if (dedupRef.current.size > 300) {
      const entries = [...dedupRef.current.entries()];
      dedupRef.current = new Map(entries.slice(-150));
    }

    saveLocalAlert({
      alertId: event.alert_id,
      symbol: event.symbol,
      alertType: event.alert_type,
      message: event.message,
      price: event.price,
      triggeredAt: event.time * 1000,
    }).catch(() => {});

    const typeIcon =
      event.alert_type === "price_cross" ? "📊"
      : event.alert_type === "reversal" ? "🕯️" : "🔗";
    toast(`${typeIcon} ${event.message}`, {
      description: `${event.symbol} · ${event.timeframe ?? ""} @ $${
        event.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      }`,
      duration: 8_000,
      action: { label: "查看", onClick: () => setDialogOpen(true) },
    });
  });

  // ── 渲染：表单 (page=create) ──
  const renderForm = () => {
    const paramsBlock = (() => {
      switch (formType) {
        case "price_cross":
          return (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">价格水平 ($)</Label>
                <Input type="number" placeholder="e.g. 100000"
                  className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"
                  value={formParams.level ?? ""}
                  onChange={(e) => setFormParams((p) => ({
                    ...p, level: parseFloat(e.target.value) || undefined,
                  }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">穿越方向</Label>
                <Select value={formParams.direction ?? "above"}
                  onValueChange={(v) => setFormParams((p) => ({ ...p, direction: v }))}>
                  <SelectTrigger className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-[#1e293b] text-[12px]">
                    <SelectItem value="above">向上穿越 (突破阻力)</SelectItem>
                    <SelectItem value="below">向下穿越 (跌破支撑)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">检测时间框架</Label>
                <Select value={formParams.timeframe ?? "15m"}
                  onValueChange={(v) => setFormParams((p) => ({ ...p, timeframe: v }))}>
                  <SelectTrigger className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-[#1e293b] text-[12px]">
                    {TF_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          );
        case "reversal":
          return (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">反转形态</Label>
                <Select value={formParams.pattern ?? "hammer"}
                  onValueChange={(v) => setFormParams((p) => ({ ...p, pattern: v }))}>
                  <SelectTrigger className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-[#1e293b] text-[12px]">
                    {REVERSAL_PATTERNS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">检测时间框架</Label>
                <Select value={formParams.timeframe ?? "1H"}
                  onValueChange={(v) => setFormParams((p) => ({ ...p, timeframe: v }))}>
                  <SelectTrigger className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-[#1e293b] text-[12px]">
                    {TF_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          );
        case "multi_tf":
          return (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">检测时间框架 (逗号分隔)</Label>
                <Input placeholder="15m,1H,4H"
                  className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"
                  value={(formParams.timeframes as string[] ?? []).join(", ")}
                  onChange={(e) => setFormParams((p) => ({
                    ...p,
                    timeframes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-[#94a3b8]">最少共振数量</Label>
                <Input type="number" min={2} max={5}
                  className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"
                  value={formParams.required_count ?? 2}
                  onChange={(e) => setFormParams((p) => ({
                    ...p, required_count: Math.max(2, Math.min(5, parseInt(e.target.value) || 2)),
                  }))} />
              </div>
            </>
          );
      }
    })();

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e293b] bg-[#0a0e1a]">
          <Button size="sm" variant="ghost" className="h-7 px-1 text-[11px] text-[#94a3b8]"
            onClick={() => setPage("list")}><ArrowLeft className="h-3 w-3 mr-1" /> 返回</Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {/* Type selector */}
            <div className="space-y-1">
              <Label className="text-[11px] text-[#94a3b8]">预警类型</Label>
              <div className="grid grid-cols-3 gap-2">
                {ALERT_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.value}
                      onClick={() => { setFormType(t.value); setFormParams({}); }}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[11px] transition-all ${
                        formType === t.value
                          ? "border-current"
                          : "border-[#1e293b] text-[#475569] hover:text-[#94a3b8] hover:border-[#2d3a52]"
                      }`}
                      style={formType === t.value ? { borderColor: t.color, color: t.color, backgroundColor: t.color + "10" } : {}}>
                      <Icon className="h-4 w-4" /> {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Symbol */}
            <div className="space-y-1">
              <Label className="text-[11px] text-[#94a3b8]">交易对</Label>
              <Select value={formSymbol} onValueChange={(v) => setFormSymbol(v as AssetSymbol)}>
                <SelectTrigger className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#111827] border-[#1e293b] text-[12px]">
                  {SYMBOL_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Type-specific params */}
            {paramsBlock}

            {/* Cooldown */}
            <div className="space-y-1">
              <Label className="text-[11px] text-[#94a3b8]">冷却时间 (分钟)</Label>
              <Input type="number" min={1} max={1440}
                className="h-8 text-[12px] bg-[#0a0e1a] border-[#1e293b]"
                value={formCooldown}
                onChange={(e) => setFormCooldown(Math.max(1, parseInt(e.target.value) || 30))} />
            </div>
          </div>
        </ScrollArea>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e293b] bg-[#0a0e1a]">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPage("list")}>
            取消
          </Button>
          <Button size="sm" className="h-7 text-[11px] bg-[#3b82f6] hover:bg-[#2563eb]"
            onClick={handleSubmit} disabled={loading}>
            {loading ? "创建中..." : "创建预警"}
          </Button>
        </div>
      </div>
    );
  };

  // ── 渲染：列表 (page=list) ──
  const renderList = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#0a0e1a]">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#3b82f6]" />
          <span className="text-[13px] font-bold" style={{ color: "#e2e8f0" }}>
            预警中心
          </span>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-[#3b82f610] text-[#3b82f6] border-[#3b82f630]">
              {activeCount} 活跃
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline"
          className="h-7 text-[11px] bg-[#1a2236] border-[#2d3a52] hover:bg-[#1e293b]"
          onClick={openCreate} style={{ color: "#e2e8f0" }}>
          <Plus className="h-3 w-3 mr-1" /> 新建
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {alerts.length === 0 ? (
            <div className="text-center py-10">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-[12px] text-[#475569]">暂无预警配置</p>
              <p className="text-[10px] text-[#334155] mt-1">
                点击「新建」创建第一条预警规则
              </p>
            </div>
          ) : (
            alerts.map((alert) => {
              const tc = ALERT_TYPES.find((t) => t.value === alert.alert_type) ?? ALERT_TYPES[0];
              const Icon = tc.icon;
              return (
                <Card key={alert.id}
                  className={`p-2.5 bg-[#0a0e1a] border-[#1e293b] transition-opacity ${!alert.enabled ? "opacity-55" : ""}`}>
                  <div className="flex items-center gap-2.5">
                    {/* Type badge */}
                    <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{ backgroundColor: tc.color + "20", color: tc.color }}>
                      <Icon className="h-3 w-3" /> {tc.label}
                    </span>
                    {/* Symbol */}
                    <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 border-[#2d3a52] text-[#94a3b8]">
                      {alert.symbol}
                    </Badge>
                    {/* Summary */}
                    <span className="flex-1 text-[11px] text-[#94a3b8] truncate min-w-0">
                      {paramsSummary(alert)}
                    </span>
                    {/* Cooldown */}
                    <span className="shrink-0 text-[10px] text-[#475569] hidden sm:inline">
                      {alert.cooldown_minutes}min
                    </span>
                    {/* Controls */}
                    <div className="shrink-0 flex items-center gap-0.5">
                      <Switch checked={alert.enabled}
                        onCheckedChange={(v) => handleToggle(alert.id, v)}
                        className="scale-[0.7]" />
                      <button onClick={() => handleDelete(alert.id)}
                        className="p-1 rounded hover:bg-[#ef444412] transition-colors"
                        title="删除预警">
                        <Trash2 className="h-3 w-3 text-[#475569] hover:text-[#ef4444]" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#1e293b] bg-[#0a0e1a] flex items-center justify-between text-[10px] text-[#475569]">
        <span>共 {alerts.length} 条规则</span>
        <span>活跃 {activeCount} · 停用 {alerts.length - activeCount}</span>
      </div>
    </div>
  );

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent
        className="bg-[#111827] border-[#2d3a52] text-[#e2e8f0] max-w-lg max-h-[80vh] p-0 overflow-hidden"
        style={{ fontSize: 12 }}>
        {page === "list" ? renderList() : renderForm()}
      </DialogContent>
    </Dialog>
  );
}

// ── 提醒铃铛按钮（供 Toolbar 使用）──

export function AlertBell({
  onClick, activeCount,
}: { onClick: () => void; activeCount: number }) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#111827] border border-[#2d3a52] hover:border-[#475569] transition-all"
      title="预警中心">
      <Bell className="h-4 w-4 text-[#94a3b8]" />
      {activeCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 text-[9px] font-bold text-white bg-[#ef4444] rounded-full">
          {activeCount > 99 ? "99+" : activeCount}
        </span>
      )}
      <span className="text-[11px] text-[#94a3b8] hidden lg:inline">预警</span>
    </button>
  );
}
