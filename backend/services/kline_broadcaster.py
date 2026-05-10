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


class ClientState:
    """Tracks one connected frontend client."""
    __slots__ = ("ws", "subscriptions")

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        # Set of "symbol|timeframe" strings this client cares about
        self.subscriptions: Set[str] = set()


class KlineBroadcaster:
    """Broadcasts OKX candle updates to connected frontend clients.

    Responsibilities:
      - Accept/remove client WebSocket connections.
      - Track per-client subscriptions.
      - Relay candle updates from OKX → subscribed clients.
      - Auto-cleanup on client disconnect.
    """

    def __init__(self) -> None:
        # We identify clients by id(hash) to avoid reference issues.
        self._clients: Dict[int, ClientState] = {}
        self._lock = asyncio.Lock()

    # ── Client lifecycle ──────────────────────────────────────────────

    async def connect(self, ws: WebSocket) -> int:
        """Accept a new client WebSocket. Returns a client-id."""
        await ws.accept()
        client = ClientState(ws)
        async with self._lock:
            self._clients[id(ws)] = client
        logger.info("Kline client connected, total=%d", len(self._clients))
        return id(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        """Remove a client (e.g. after WebSocketDisconnect)."""
        async with self._lock:
            self._clients.pop(id(ws), None)
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
            client.subscriptions = {
                f"{s['symbol']}|{s['timeframe']}" for s in subs
            }
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
        for ws in targets:
            try:
                await ws.send_text(json_msg)
            except Exception:
                # Client may have disconnected; will be cleaned up on next read
                pass

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