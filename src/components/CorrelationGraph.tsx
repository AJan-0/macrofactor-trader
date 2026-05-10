/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import { useI18n } from "@/i18n/context";
import type { FactorItem } from "@/services/factorEngine";
import { analyzeFactors } from "@/services/factorEngine";
import { MOCK_NEWS } from "@/data/mockNews";

interface GraphNode {
  id: string;
  name: string;
  category: string;
  type: "factor" | "news" | "category";
  sentiment?: "bullish" | "bearish" | "neutral";
  weight?: number;
  enabled?: boolean;
  relevance?: number;
}

interface GraphLink {
  source: string;
  target: string;
  strength: number;
  type: "category" | "correlation" | "causal";
}

interface Props {
  factors: FactorItem[];
  onToggleFactor?: (id: string) => void;
}

const CAT_COLOR: Record<string, string> = {
  Monetary: "#3b82f6", Inflation: "#f59e0b", Geopolitics: "#8b5cf6",
  Regulation: "#ec4899", CryptoNative: "#f7931a", Sentiment: "#06b6d4", Political: "#ef4444",
};

function buildGraphData(factors: FactorItem[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  const categories = ["Monetary", "Inflation", "Geopolitics", "Regulation", "CryptoNative", "Sentiment", "Political"];
  for (const cat of categories) {
    nodes.push({ id: `cat-${cat}`, name: cat, category: cat, type: "category" });
    nodeIds.add(`cat-${cat}`);
  }

  for (const f of factors) {
    const nodeId = `factor-${f.id}`;
    if (nodeIds.has(nodeId)) continue;
    const dir = f.directionOverride || (f.probability > 0.55 ? "bullish" : f.probability < 0.45 ? "bearish" : "neutral");
    nodes.push({
      id: nodeId,
      name: f.name.length > 30 ? f.name.slice(0, 28) + "..." : f.name,
      category: f.category,
      type: "factor",
      sentiment: dir,
      weight: f.weight ?? 1.0,
      enabled: f.enabled,
      relevance: f.relevance_score,
    });
    nodeIds.add(nodeId);
    links.push({ source: nodeId, target: `cat-${f.category}`, strength: 0.5, type: "category" });
    for (const other of factors) {
      if (other.id === f.id) continue;
      if (other.category === f.category) {
        const otherId = `factor-${other.id}`;
        const exists = links.some(l => (l.source === nodeId && l.target === otherId) || (l.source === otherId && l.target === nodeId));
        if (!exists) links.push({ source: nodeId, target: otherId, strength: 0.2, type: "correlation" });
      }
    }
  }

  const recentNews = [...MOCK_NEWS].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  for (const n of recentNews) {
    const nodeId = `news-${n.id}`;
    if (nodeIds.has(nodeId)) continue;
    nodes.push({ id: nodeId, name: n.title.length > 30 ? n.title.slice(0, 28) + "..." : n.title, category: n.category, type: "news", sentiment: n.sentiment });
    nodeIds.add(nodeId);
    links.push({ source: nodeId, target: `cat-${n.category}`, strength: 0.4, type: "causal" });
    for (const f of factors) {
      if (!f.enabled || f.category !== n.category) continue;
      links.push({ source: nodeId, target: `factor-${f.id}`, strength: 0.3, type: "causal" });
    }
  }

  return { nodes, links };
}

export default function CorrelationGraph({ factors, onToggleFactor }: Props) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const combo = useMemo(() => analyzeFactors(factors), [factors]);
  const { nodes, links } = useMemo(() => buildGraphData(factors), [factors]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const simulation = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(links as any).id((d: any) => d.id)
        .distance((d: any) => (d.type === "category" ? 60 : d.type === "causal" ? 80 : 100))
        .strength((d: any) => d.strength))
      .force("charge", d3.forceManyBody().strength((d: any) => (d.type === "category" ? -300 : -150)))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d: any) => (d.type === "category" ? 35 : 20)).iterations(2));

    const linkGroup = svg.append("g").attr("class", "links");
    const linkElements = linkGroup.selectAll("line").data(links).join("line")
      .attr("stroke", (d: any) => d.type === "causal" ? "#8b5cf660" : d.type === "correlation" ? "#3b82f640" : "#47556930")
      .attr("stroke-width", (d: any) => (d.type === "causal" ? 2 : d.type === "correlation" ? 1.5 : 1))
      .attr("stroke-dasharray", (d: any) => (d.type === "causal" ? "4,2" : "none"));

    const nodeGroup = svg.append("g").attr("class", "nodes");
    const nodeElements = nodeGroup.selectAll("g").data(nodes).join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<any, any>()
        .on("start", (event: any, d: any) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (event: any, d: any) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event: any, d: any) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }) as any);

    nodeElements.append("circle")
      .attr("r", (d: any) => d.type === "category" ? 28 : d.type === "news" ? 14 : 10 + (d.weight ?? 1.0) * 4)
      .attr("fill", (d: any) => d.type === "category" ? `${CAT_COLOR[d.category] || "#475569"}20` : d.type === "news" ? "#1a2236" : d.enabled ? "#0a0e1a" : "#1e293b")
      .attr("stroke", (d: any) => { if (d.type === "category") return CAT_COLOR[d.category] || "#475569"; if (!d.enabled && d.type === "factor") return "#334155"; if (d.sentiment === "bullish") return "#22c55e"; if (d.sentiment === "bearish") return "#ef4444"; return "#94a3b8"; })
      .attr("stroke-width", (d: any) => (d.type === "category" ? 2 : d.enabled ? 2 : 1))
      .attr("stroke-dasharray", (d: any) => (d.type === "news" ? "3,2" : d.enabled === false ? "2,2" : "none"))
      .attr("opacity", (d: any) => (d.enabled === false && d.type === "factor" ? 0.4 : 1));

    nodeElements.filter((d: any) => d.type === "factor" && d.enabled)
      .append("text").text("✓").attr("font-size", 8).attr("fill", "#22c55e").attr("text-anchor", "middle").attr("dy", -12)
      .style("pointer-events", "none").style("font-weight", "bold");

    nodeElements.append("text")
      .text((d: any) => d.name)
      .attr("font-size", (d: any) => (d.type === "category" ? 9 : 7))
      .attr("font-family", "'JetBrains Mono', monospace")
      .attr("fill", (d: any) => (d.type === "category" ? CAT_COLOR[d.category] || "#e2e8f0" : d.enabled === false ? "#475569" : "#94a3b8"))
      .attr("text-anchor", "middle")
      .attr("dy", (d: any) => (d.type === "category" ? 4 : d.type === "news" ? 22 : 18))
      .style("pointer-events", "none")
      .style("user-select", "none")
      .each(function (d: any) { if (d.type !== "category") { const self = d3.select(this); const text = self.text(); if (text.length > 14) self.text(text.slice(0, 12) + "..."); } });

    nodeElements.filter((d: any) => d.type === "category")
      .append("text").text((d: any) => d.name.slice(0, 2).toUpperCase())
      .attr("font-size", 10).attr("font-weight", "bold")
      .attr("fill", (d: any) => CAT_COLOR[d.category] || "#e2e8f0")
      .attr("text-anchor", "middle").attr("dy", 3).style("pointer-events", "none");

    nodeElements
      .on("mouseenter", (_event: any, d: any) => {
        setHoveredNode(d.id);
        const connected = new Set<string>(); connected.add(d.id);
        links.forEach((l: any) => { if (l.source.id === d.id) connected.add(l.target.id); if (l.target.id === d.id) connected.add(l.source.id); });
        nodeElements.selectAll("circle").attr("opacity", (n: any) => (connected.has(n.id) ? 1 : 0.15));
        linkElements.attr("opacity", (l: any) => (l.source.id === d.id || l.target.id === d.id ? 1 : 0.05));
        nodeElements.selectAll("text").attr("opacity", (n: any) => (connected.has(n.id) ? 1 : 0.15));
      })
      .on("mouseleave", () => {
        setHoveredNode(null);
        nodeElements.selectAll("circle").attr("opacity", (n: any) => (n.enabled === false && n.type === "factor" ? 0.4 : 1));
        linkElements.attr("opacity", 1);
        nodeElements.selectAll("text").attr("opacity", 1);
      })
      .on("click", (_event: any, d: any) => { if (d.type === "factor" && onToggleFactor) onToggleFactor(d.id.replace("factor-", "")); });

    simulation.on("tick", () => {
      linkElements.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y).attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      nodeElements.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [nodes, links, onToggleFactor]);

  const dColor = combo.combinedDirection === "bullish" ? "#22c55e" : combo.combinedDirection === "bearish" ? "#ef4444" : "#eab308";

  return (
    <div className="h-full flex flex-col bg-[#111827] overflow-hidden">
      <div className="p-2.5 border-b border-[#1e293b] bg-[#0a0e1a]">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-bold text-[#e2e8f0] tracking-wider">{t("graph.title") || "CORRELATION GRAPH"}</h3>
          <span className="text-[9px] text-[#475569]">{nodes.filter(n => n.type === "factor" && n.enabled).length} active / {nodes.filter(n => n.type === "factor").length} factors</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden mb-1">
          <div style={{ width: `${combo.bullishProbability * 100}%`, background: "#22c55e" }} />
          <div style={{ width: `${combo.neutralProbability * 100}%`, background: "#334155" }} />
          <div style={{ width: `${combo.bearishProbability * 100}%`, background: "#ef4444" }} />
        </div>
        <div className="flex justify-between text-[8px] font-mono">
          <span style={{ color: "#22c55e" }}>▲ {Math.round(combo.bullishProbability * 100)}%</span>
          <span style={{ color: dColor, fontWeight: 700 }}>
            {combo.combinedDirection === "bullish" ? "▲ BULLISH" : combo.combinedDirection === "bearish" ? "▼ BEARISH" : "◆ NEUTRAL"} {combo.overallConfidence}% conf
          </span>
          <span style={{ color: "#ef4444" }}>▼ {Math.round(combo.bearishProbability * 100)}%</span>
        </div>
        <div className="text-[7px] text-[#475569] mt-1">点击因子节点可启用/禁用，实时查看组合效果</div>
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" style={{ background: "#111827" }} />
        {hoveredNode && <div className="absolute top-2 right-2 text-[8px] text-[#94a3b8] bg-[#1a2236] px-2 py-1 rounded border border-[#1e293b]">{hoveredNode}</div>}
      </div>
      <div className="p-2 border-t border-[#1e293b] bg-[#0a0e1a]">
        <div className="flex gap-2 overflow-x-auto">
          {combo.activeFactors.slice(0, 5).map(s => (
            <div key={s.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px]" style={{ background: `${CAT_COLOR[s.category] || "#475569"}15` }}>
              <span style={{ color: CAT_COLOR[s.category] || "#475569" }} className="font-bold">{s.category.slice(0, 3).toUpperCase()}</span>
              <span style={{ color: s.direction === "bullish" ? "#22c55e" : "#ef4444" }}>{s.direction === "bullish" ? "▲" : "▼"} {(s.strength * 100).toFixed(0)}%</span>
            </div>
          ))}
          {combo.activeFactors.length === 0 && <span className="text-[7px] text-[#475569]">未选择任何因子</span>}
        </div>
      </div>
    </div>
  );
}
