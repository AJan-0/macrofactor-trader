"""Alert Monitor — real-time alert condition checking engine (v0.4.0)

Caches alert configs in memory and checks incoming OKX WebSocket candle
updates against enabled alerts. Fires callbacks for WS broadcast and DB
persistence.

Alert types supported:
  1. price_cross   — price crosses above/below a specified level
  2. reversal      — candlestick reversal patterns (doji, hammer, engulfing)
  3. multi_tf      — confluence signals across multiple timeframes

Cooldown enforced per-alert in the in-memory cache to avoid DB round-trips.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from database import AsyncSessionLocal
from services.alert_store import AlertStore, AlertConfigDTO

logger = logging.getLogger(__name__)

_MIN_HISTORY_BARS = 3  # minimum candle history for pattern detection


class AlertMonitor:
    """Real-time alert engine.

    Usage:
        monitor = AlertMonitor(store=alert_store)
        monitor.set_on_trigger(_handle_trigger)
        await monitor.refresh_configs()

        # Register with OKX WS
        okx_ws.add_listener(monitor.on_candle)

        # WebSocket clients register for live event stream
        monitor.add_ws_client(websocket)
    """

    def __init__(self, store: AlertStore) -> None:
        self._store = store
        # In-memory config cache: alert_id → AlertConfigDTO
        self._configs: Dict[str, AlertConfigDTO] = {}
        self._lock = asyncio.Lock()
        # Connected WebSocket clients (for /ws/alerts)
        self._ws_clients: Set[Any] = set()
        # Per-symbol+timeframe candle history for pattern detection
        self._history: Dict[str, List[dict]] = {}
        # Async callback(alert_id) fired when an alert triggers
        self._on_trigger: Optional[Callable[[str], Any]] = None

    # ── Configuration ──────────────────────────────────────────────

    def set_on_trigger(self, cb: Callable[[str], Any]) -> None:
        """Register a callback that fires when an alert is triggered.

        The callback receives the alert_id and should handle DB persistence.
        """
        self._on_trigger = cb

    async def refresh_configs(self) -> None:
        """Reload all alert configs from DB into the in-memory cache."""
        async with AsyncSessionLocal() as session:
            configs = await self._store.get_all(session)
        async with self._lock:
            self._configs = {c.id: c for c in configs}
        logger.info("AlertMonitor: loaded %d configs into cache", len(self._configs))

    def get_cached_configs(self) -> List[AlertConfigDTO]:
        """Return current in-memory config list (no DB call)."""
        return list(self._configs.values())

    async def get_cached_by_id(self, alert_id: str) -> Optional[AlertConfigDTO]:
        async with self._lock:
            return self._configs.get(alert_id)

    # ── WebSocket client management ────────────────────────────────

    def add_ws_client(self, ws: Any) -> None:
        """Register a WebSocket client to receive live alert events."""
        self._ws_clients.add(ws)

    def remove_ws_client(self, ws: Any) -> None:
        """Remove a disconnected WebSocket client."""
        self._ws_clients.discard(ws)

    async def _broadcast_event(self, event: Dict[str, Any]) -> None:
        """Send an alert event to all connected /ws/alerts clients."""
        if not self._ws_clients:
            return
        json_msg = json.dumps(event)
        dead: List[Any] = []
        for ws in self._ws_clients:
            try:
                await ws.send_text(json_msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._ws_clients.discard(ws)

    # ── Candle feed (called by OKXWebSocketClient) ─────────────────

    async def on_candle(self, symbol: str, timeframe: str, candle: dict) -> None:
        """Receive one candle update from OKX WebSocket and check all alerts."""
        # --- Maintain candle history for pattern detection ---
        key = f"{symbol}|{timeframe}"
        if key not in self._history:
            self._history[key] = []
        history = self._history[key]

        if history and history[-1]["time"] == candle["time"]:
            history[-1] = candle
        else:
            history.append(candle)
            if len(history) > _MIN_HISTORY_BARS * 2:
                history[:] = history[-_MIN_HISTORY_BARS:]

        # --- Check alerts ---
        async with self._lock:
            configs = list(self._configs.values())

        now = datetime.now(timezone.utc)
        symbol_upper = symbol.upper()

        for cfg in configs:
            if cfg.symbol.upper() != symbol_upper:
                continue
            if not cfg.enabled:
                continue
            # Cooldown check (in-memory — no DB round-trip)
            if cfg.last_triggered:
                if now < cfg.last_triggered + timedelta(minutes=cfg.cooldown_minutes):
                    continue

            # Check condition for this alert type
            ok = False
            desc = ""
            match cfg.alert_type:
                case "price_cross":
                    ok = self._check_price_cross(cfg, candle, symbol, timeframe)
                    desc = f"Price crossed {cfg.params.get('direction', 'level')} {cfg.params.get('level', '')}"
                case "reversal":
                    ok = self._check_reversal(cfg, candle, symbol, timeframe)
                    desc = f"Reversal pattern: {cfg.params.get('pattern', '')}"
                case "multi_tf":
                    ok = self._check_multi_tf(cfg, candle, symbol, timeframe)
                    desc = f"Multi-TF confluence ({cfg.params.get('direction', 'any')})"

            if not ok:
                continue

            # --- Alert triggered ---
            cfg.last_triggered = now  # update cooldown in cache immediately

            event = {
                "type": "alert",
                "alert_id": cfg.id,
                "alert_type": cfg.alert_type,
                "symbol": symbol,
                "timeframe": timeframe,
                "time": candle["time"],
                "price": candle["close"],
                "message": f"[{cfg.alert_type}] {desc}",
                "params": cfg.params,
            }

            await self._broadcast_event(event)
            logger.info("Alert triggered: %s %s %s", cfg.id, cfg.alert_type, symbol)

            # Fire DB persistence callback (non-blocking)
            if self._on_trigger:
                try:
                    asyncio.create_task(self._on_trigger(cfg.id))
                except Exception as exc:
                    logger.warning("Alert on_trigger callback failed: %s", exc)

    # ── Condition Checkers ────────────────────────────────────────

    def _check_price_cross(self, cfg: AlertConfigDTO, candle: dict, symbol: str, timeframe: str) -> bool:
        p = cfg.params
        level = float(p.get("level", 0))
        direction = p.get("direction", "above")
        tf_filter = p.get("timeframe", "")
        if tf_filter and tf_filter != timeframe:
            return False
        if level <= 0:
            return False

        key = f"{symbol}|{timeframe}"
        history = self._history.get(key, [])
        if len(history) < 2:
            return False

        prev_close = float(history[-2]["close"])
        curr_close = float(candle["close"])

        if direction == "above":
            return prev_close <= level < curr_close
        elif direction == "below":
            return prev_close >= level > curr_close
        return False

    def _check_reversal(self, cfg: AlertConfigDTO, candle: dict, symbol: str, timeframe: str) -> bool:
        p = cfg.params
        pattern = p.get("pattern", "doji")
        tf_filter = p.get("timeframe", "")
        if tf_filter and tf_filter != timeframe:
            return False
        if not candle.get("confirm", False):
            return False

        o = float(candle["open"])
        h = float(candle["high"])
        l = float(candle["low"])
        c = float(candle["close"])
        body = abs(c - o)
        total_range = h - l
        if total_range == 0:
            return False

        body_ratio = body / total_range
        upper_wick = h - max(o, c)
        lower_wick = min(o, c) - l

        if pattern == "doji":
            return body_ratio < 0.08
        elif pattern == "hammer":
            return lower_wick > body * 2 and upper_wick < body * 0.6
        elif pattern == "shooting_star":
            return upper_wick > body * 2 and lower_wick < body * 0.6
        elif pattern in ("engulfing_bullish", "engulfing_bearish"):
            key = f"{symbol}|{timeframe}"
            history = self._history.get(key, [])
            if len(history) < 2:
                return False
            prev = history[-2]
            prev_o = float(prev["open"])
            prev_c = float(prev["close"])
            prev_body = abs(prev_c - prev_o)
            if prev_body == 0:
                return False
            if pattern == "engulfing_bullish":
                return (prev_c < prev_o and c > o and o < prev_c and c > prev_o)
            else:
                return (prev_c > prev_o and c < o and o > prev_c and c < prev_o)
        return False

    def _check_multi_tf(self, cfg: AlertConfigDTO, candle: dict, symbol: str, timeframe: str) -> bool:
        p = cfg.params
        req_tfs: List[str] = p.get("timeframes", [])
        direction = p.get("direction", "any")
        required_count = int(p.get("required_count", 2))
        if not req_tfs or len(req_tfs) < required_count:
            return False

        bullish_count = 0
        bearish_count = 0

        for tf in req_tfs:
            key = f"{symbol}|{tf}"
            history = self._history.get(key, [])
            if len(history) < 5:
                continue
            latest = history[-1]
            close_val = float(latest["close"])
            sma = sum(float(b["close"]) for b in history[-5:]) / 5.0

            if close_val > sma:
                bullish_count += 1
            elif close_val < sma:
                bearish_count += 1

        if direction == "bullish":
            return bullish_count >= required_count
        elif direction == "bearish":
            return bearish_count >= required_count
        else:
            return bullish_count >= required_count or bearish_count >= required_count