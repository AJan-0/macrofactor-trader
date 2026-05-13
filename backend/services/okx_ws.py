"""
OKX WebSocket Public Channel Client
Connects to OKX WebSocket API v5 for real-time K-line (candle) data.

Usage:
    client = OKXWebSocketClient(on_candle_update=my_handler)
    asyncio.create_task(client.start())
    await client.subscribe("BTC-USDT", "1H")
"""

import asyncio
import json
import logging
from typing import Any, Callable, Optional, Set

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
    _HAS_WEBSOCKETS = True
except ImportError:
    _HAS_WEBSOCKETS = False
    websockets = None
    WebSocketClientProtocol = None

logger = logging.getLogger(__name__)

# OKX WebSocket URLs (public channel, no auth needed)
_OKX_WS_URLS = [
    "wss://ws.okx.com:8443/ws/v5/public",
    "wss://ws.okx.com:10443/ws/v5/public",
    "wss://wspap.okx.com:8443/ws/v5/public?brokerId=9999",
]

# Map our timeframe format to OKX channel names
TIMEFRAME_CHANNEL_MAP = {
    "1m":   "candles1m",
    "3m":   "candles3m",
    "5m":   "candles5m",
    "15m":  "candles15m",
    "30m":  "candles30m",
    "1H":   "candles1H",
    "2H":   "candles2H",
    "4H":   "candles4H",
    "6H":   "candles6H",
    "1D":   "candles1D",
    "1W":   "candles1W",
    "1M":   "candles1M",
}

# Reverse map: OKX channel suffix -> our timeframe
_CHANNEL_TO_TIMEFRAME = {v: k for k, v in TIMEFRAME_CHANNEL_MAP.items()}

# 生产级配置
_MAX_RECONNECT_ATTEMPTS = 20  # 最大重连次数
_RECONNECT_BASE = 1.0
_RECONNECT_MAX = 30.0
_PING_INTERVAL = 25.0  # OKX 要求 30s 内发送 ping
_PONG_TIMEOUT = 10.0


class OKXWebSocketClient:
    """Manages OKX WebSocket connection and dispatches candle updates.

    Flow:
        1. Call `start()` → connects to OKX, listens for messages.
        2. Call `subscribe(symbol, tf)` → sends subscribe msg, adds to active set.
        3. On candle data → calls `self.on_candle_update(symbol, tf, candle_dict)`.
        4. On disconnect → auto-reconnects with exponential backoff (最多 20 次).
    """

    def __init__(self, on_candle_update: Callable[[str, str, dict], Any]) -> None:
        if not _HAS_WEBSOCKETS:
            raise RuntimeError(
                "websockets package not installed. "
                "Run: pip install websockets"
            )
        self.on_candle_update = on_candle_update
        self._ws: Optional[WebSocketClientProtocol] = None
        self._subscriptions: Set[str] = set()  # "{symbol}|{timeframe}"
        self._running = False
        self._reconnect_delay: float = _RECONNECT_BASE
        self._reconnect_attempts: int = 0
        self._task: Optional[asyncio.Task] = None
        self._url_index: int = 0
        self._ping_task: Optional[asyncio.Task] = None
        self._last_pong_time: float = 0.0

    async def start(self) -> None:
        """Start the connection loop (runs forever until `stop()` is called)."""
        self._running = True
        while self._running:
            try:
                await self._connect_and_listen()
            except Exception as exc:
                if not self._running:
                    break
                self._reconnect_attempts += 1
                if self._reconnect_attempts > _MAX_RECONNECT_ATTEMPTS:
                    logger.error(
                        "OKX WS: max reconnect attempts (%d) reached. Giving up.",
                        _MAX_RECONNECT_ATTEMPTS,
                    )
                    self._running = False
                    break
                logger.error("OKX WS connection error: %s", exc)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, _RECONNECT_MAX)
                logger.info(
                    "OKX WS: reconnecting in %.1fs... (attempt %d/%d)",
                    self._reconnect_delay,
                    self._reconnect_attempts,
                    _MAX_RECONNECT_ATTEMPTS,
                )

    def _get_next_url(self) -> str:
        url = _OKX_WS_URLS[self._url_index % len(_OKX_WS_URLS)]
        self._url_index += 1
        return url

    async def _connect_and_listen(self) -> None:
        """Single connection lifecycle."""
        ws_url = self._get_next_url()
        logger.info("OKX WS: connecting to %s", ws_url)

        async with websockets.connect(ws_url) as ws:  # type: ignore[union-attr]
            self._ws = ws
            self._reconnect_delay = _RECONNECT_BASE
            self._reconnect_attempts = 0
            self._last_pong_time = asyncio.get_event_loop().time()
            logger.info("OKX WS: connected")

            # 启动心跳
            self._ping_task = asyncio.create_task(self._ping_loop(ws))

            # Re-subscribe to all active subscriptions after reconnect
            for sub_key in list(self._subscriptions):
                symbol, timeframe = sub_key.split("|", 1)
                await self._send_subscribe(ws, symbol, timeframe)

            # Listen for messages until disconnect
            async for raw in ws:
                await self._handle_message(raw)

    async def _ping_loop(self, ws: WebSocketClientProtocol) -> None:
        """定期发送 ping，检测连接健康。"""
        while self._running and self._ws is ws:
            try:
                await asyncio.sleep(_PING_INTERVAL)
                if self._ws is not ws or not ws.open:
                    break
                await ws.send(json.dumps({"op": "ping"}))
                # 检查上次 pong 时间
                now = asyncio.get_event_loop().time()
                if now - self._last_pong_time > _PING_INTERVAL + _PONG_TIMEOUT:
                    logger.warning("OKX WS: pong timeout, closing connection")
                    await ws.close()
                    break
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug("OKX WS ping error: %s", exc)
                break

    async def _handle_message(self, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("OKX WS: invalid JSON: %s", raw[:200])
            return

        # --- Heartbeat pong ---
        if payload.get("op") == "pong" or payload.get("event") == "pong":
            self._last_pong_time = asyncio.get_event_loop().time()
            return

        # --- Candle data ---
        if "data" in payload and "arg" in payload:
            arg = payload["arg"]
            channel: str = arg.get("channel", "")
            inst_id: str = arg.get("instId", "")

            if channel.startswith("candles"):
                for raw_candle in payload["data"]:
                    await self._process_candle(inst_id, channel, raw_candle)

        # --- Subscription confirmation ---
        elif payload.get("event") == "subscribe":
            logger.info("OKX WS: subscribed confirmed: %s", payload.get("arg"))
        elif payload.get("event") == "unsubscribe":
            logger.info("OKX WS: unsubscribed: %s", payload.get("arg"))
        elif payload.get("event") == "error":
            logger.error("OKX WS: error from server: %s", payload)

    async def _process_candle(self, inst_id: str, channel: str, raw: list) -> None:
        """Parse one raw candle row and dispatch to callback.

        OKX candle format:
            [timestamp_ms, open, high, low, close, volume_base,
             volume_quote, confirm_flag, ts_of_candle?]
        confirm_flag: "1" = bar closed, "0" = still open
        """
        if not isinstance(raw, list) or len(raw) < 9:
            return

        timeframe = _CHANNEL_TO_TIMEFRAME.get(channel, channel.replace("candles", ""))

        candle_dict = {
            "symbol":     inst_id,
            "timeframe":   timeframe,
            "time":        int(raw[0]) // 1000,   # ms → seconds
            "open":        float(raw[1]),
            "high":        float(raw[2]),
            "low":         float(raw[3]),
            "close":       float(raw[4]),
            "volume":      float(raw[5]),
            "confirm":     str(raw[8]) == "1",   # bar closed?
        }
        # "is_new" = this is the first tick of a new bar
        candle_dict["is_new"] = not candle_dict["confirm"]

        try:
            await self.on_candle_update(inst_id, timeframe, candle_dict)
        except Exception as exc:
            logger.warning("on_candle_update callback failed: %s", exc)

    async def subscribe(self, symbol: str, timeframe: str) -> None:
        """Subscribe to real-time candle updates for one symbol/timeframe."""
        sub_key = f"{symbol}|{timeframe}"
        if sub_key in self._subscriptions:
            return  # already subscribed
        self._subscriptions.add(sub_key)

        if self._ws is not None and self._ws.open:
            await self._send_subscribe(self._ws, symbol, timeframe)
            logger.info("OKX WS: subscribed %s %s", symbol, timeframe)

    async def _send_subscribe(self, ws: WebSocketClientProtocol, symbol: str, timeframe: str) -> None:
        channel = TIMEFRAME_CHANNEL_MAP.get(timeframe)
        if not channel:
            logger.warning("OKX WS: unknown timeframe '%s', skipping", timeframe)
            return
        msg = json.dumps({
            "op":   "subscribe",
            "args": [{"channel": channel, "instId": symbol}],
        })
        await ws.send(msg)

    async def unsubscribe(self, symbol: str, timeframe: str) -> None:
        """Unsubscribe from candle updates (no-op if not subscribed)."""
        sub_key = f"{symbol}|{timeframe}"
        if sub_key not in self._subscriptions:
            return
        self._subscriptions.discard(sub_key)

        if self._ws is not None and self._ws.open:
            channel = TIMEFRAME_CHANNEL_MAP.get(timeframe)
            if channel:
                msg = json.dumps({
                    "op":   "unsubscribe",
                    "args": [{"channel": channel, "instId": symbol}],
                })
                await self._ws.send(msg)
                logger.info("OKX WS: unsubscribed %s %s", symbol, timeframe)

    async def stop(self) -> None:
        """Gracefully stop and close the WebSocket."""
        self._running = False
        if self._ping_task is not None:
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass
            self._ping_task = None
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        logger.info("OKX WS: stopped")

    def is_connected(self) -> bool:
        """Check if the WebSocket is currently open."""
        return self._ws is not None and self._ws.open
