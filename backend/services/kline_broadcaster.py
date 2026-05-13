"""
Client Connection Manager for Real-time K-line Broadcasting.

Manages WebSocket connections from frontend clients and relays
OKX candle updates to subscribed clients.

Architecture:
    OKX WS ──► OKXWebSocketClient ──► KlineBroadcaster ──► N x Client WS
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

# 生产级限制
_MAX_CLIENTS = 500          # 最大并发客户端数
_MAX_SUBS_PER_CLIENT = 10   # 每客户端最大订阅数
_CLIENT_PING_INTERVAL = 30.0  # 客户端心跳间隔
_CLIENT_PONG_TIMEOUT = 15.0   # 客户端 pong 超时


class ClientState:
    """Tracks one connected frontend client."""
    __slots__ = ("ws", "subscriptions", "last_pong", "ping_task")

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        # Set of "symbol|timeframe" strings this client cares about
        self.subscriptions: Set[str] = set()
        self.last_pong: float = asyncio.get_event_loop().time()
        self.ping_task: Optional[asyncio.Task] = None


class KlineBroadcaster:
    """Broadcasts OKX candle updates to connected frontend clients.

    Responsibilities:
      - Accept/remove client WebSocket connections.
      - Track per-client subscriptions.
      - Relay candle updates from OKX → subscribed clients.
      - Auto-cleanup on client disconnect.
      - Enforce connection and subscription limits.
    """

    def __init__(self) -> None:
        # We identify clients by id(hash) to avoid reference issues.
        self._clients: Dict[int, ClientState] = {}
        self._lock = asyncio.Lock()

    # ── Client lifecycle ──────────────────────────────────────────────

    async def connect(self, ws: WebSocket) -> int:
        """Accept a new client WebSocket. Returns a client-id."""
        async with self._lock:
            if len(self._clients) >= _MAX_CLIENTS:
                await ws.close(code=1013, reason="Server capacity reached")
                raise RuntimeError(f"Max clients ({_MAX_CLIENTS}) reached")

        await ws.accept()
        client = ClientState(ws)
        async with self._lock:
            self._clients[id(ws)] = client
        logger.info("Kline client connected, total=%d", len(self._clients))

        # 启动客户端心跳检测
        client.ping_task = asyncio.create_task(self._client_ping_loop(ws, client))
        return id(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        """Remove a client (e.g. after WebSocketDisconnect)."""
        async with self._lock:
            client = self._clients.pop(id(ws), None)
        if client and client.ping_task:
            client.ping_task.cancel()
            try:
                await client.ping_task
            except asyncio.CancelledError:
                pass
        logger.info("Kline client disconnected, total=%d", len(self._clients))

    async def update_subscriptions(self, ws: WebSocket, subs: List[dict]) -> None:
        """Update a client's subscriptions from a JSON subscription list.

        Each item in `subs` should look like:
            {"symbol": "BTC-USDT", "timeframe": "1H"}
        """
        async with self._lock:
            client = self._clients.get(id(ws))
            if client is None:
                return
            new_subs = {
                f"{s['symbol']}|{s['timeframe']}" for s in subs
            }
            if len(new_subs) > _MAX_SUBS_PER_CLIENT:
                logger.warning(
                    "Client %d tried to subscribe to %d topics (max %d), truncating",
                    id(ws), len(new_subs), _MAX_SUBS_PER_CLIENT,
                )
                new_subs = set(list(new_subs)[:_MAX_SUBS_PER_CLIENT])
            client.subscriptions = new_subs
            logger.info(
                "Client subscriptions updated: %s",
                sorted(client.subscriptions),
            )

    # ── Broadcasting ──────────────────────────────────────────────────

    async def broadcast_candle(self, symbol: str, timeframe: str, candle: dict) -> None:
        """Push one candle update to all clients subscribed to this symbol/timeframe."""
        sub_key = f"{symbol}|{timeframe}"

        # Build the message once
        message = {
            "type":     "candle",
            "symbol":   symbol,
            "timeframe": timeframe,
            "candle":   candle,
        }
        json_msg = json.dumps(message)

        async with self._lock:
            # Snapshot clients that want this update
            targets: List[WebSocket] = []
            for client in self._clients.values():
                if sub_key in client.subscriptions:
                    targets.append(client.ws)

        # Send outside the lock to avoid holding it during I/O
        dead_clients: List[int] = []
        for ws in targets:
            try:
                await ws.send_text(json_msg)
            except Exception:
                dead_clients.append(id(ws))

        # Clean up dead clients asynchronously
        if dead_clients:
            async with self._lock:
                for cid in dead_clients:
                    client = self._clients.pop(cid, None)
                    if client and client.ping_task:
                        client.ping_task.cancel()

    def get_subscribed_topics(self) -> Set[str]:
        """Return union of all symbol|timeframe strings any client needs.

        The OKX client calls this to know which channels must stay alive.
        """
        topics: Set[str] = set()
        for client in self._clients.values():
            topics.update(client.subscriptions)
        return topics

    async def send_error(self, ws: WebSocket, message_text: str) -> None:
        """Send an error message to a specific client."""
        try:
            await ws.send_text(json.dumps({"type": "error", "message": message_text}))
        except Exception:
            pass

    # ── Client heartbeat ──────────────────────────────────────────────

    async def _client_ping_loop(self, ws: WebSocket, client: ClientState) -> None:
        """定期 ping 前端客户端，检测僵尸连接。"""
        while True:
            try:
                await asyncio.sleep(_CLIENT_PING_INTERVAL)
                now = asyncio.get_event_loop().time()
                if now - client.last_pong > _CLIENT_PING_INTERVAL + _CLIENT_PONG_TIMEOUT:
                    logger.warning("Client %d heartbeat timeout, disconnecting", id(ws))
                    try:
                        await ws.close(code=1001, reason="Heartbeat timeout")
                    except Exception:
                        pass
                    break
                # 发送 ping
                try:
                    await ws.send_text(json.dumps({"type": "ping"}))
                except Exception:
                    break
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug("Client ping loop error: %s", exc)
                break

        # 确保清理
        async with self._lock:
            self._clients.pop(id(ws), None)
