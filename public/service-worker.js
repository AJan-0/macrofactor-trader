/**
 * Service Worker for PWA Push Notifications
 * 
 * 支持：
 * - 后台推送接收
 * - 通知点击处理
 * - 缓存策略
 */

const CACHE_NAME = "macrofactor-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/icon-192x192.png",
  "/icon-512x512.png",
];

// ── 安装 ──
self.addEventListener("install", (event) => {
  console.log("[SW] Service Worker installing...");
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  
  self.skipWaiting();
});

// ── 激活 ──
self.addEventListener("activate", (event) => {
  console.log("[SW] Service Worker activating...");
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  
  self.clients.claim();
});

// ── 推送接收 ──
self.addEventListener("push", (event) => {
  console.log("[SW] Push received:", event);
  
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: "MacroFactor Trader", body: event.data?.text() || "新信号" };
  }

  const title = data.title || "📈 MacroFactor Trader";
  const options = {
    body: data.body || "收到新的交易信号",
    icon: data.icon || "/icon-192x192.png",
    badge: data.badge || "/icon-192x192.png",
    tag: data.tag || "signal",
    requireInteraction: data.requireInteraction ?? true,
    vibrate: data.vibrate || [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [
      { action: "view", title: "查看图表" },
      { action: "dismiss", title: "忽略" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── 通知点击 ──
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification click:", event.action, event.notification);
  
  event.notification.close();

  const data = event.notification.data || {};
  const url = data.url || "/";

  if (event.action === "dismiss") {
    return;
  }

  // 打开或聚焦应用窗口
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 查找已有窗口
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      
      // 打开新窗口
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// ── 通知关闭 ──
self.addEventListener("notificationclose", (event) => {
  console.log("[SW] Notification closed:", event.notification);
});

// ── 后台同步（可选）──
self.addEventListener("sync", (event) => {
  if (event.tag === "signal-sync") {
    event.waitUntil(syncSignals());
  }
});

async function syncSignals() {
  // 后台同步信号数据
  console.log("[SW] Background sync triggered");
}

// ── 消息处理（来自主应用）──
self.addEventListener("message", (event) => {
  console.log("[SW] Message from client:", event.data);
  
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
