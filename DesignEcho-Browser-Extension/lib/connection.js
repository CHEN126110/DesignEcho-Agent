// WebSocket 连接管理：连接 / 指数退避重连 / 心跳 / 请求分发 / 状态上报。
// 扩展是 WebSocket 客户端，连接本机 DesignEcho Agent 的浏览器桥（只连 127.0.0.1，
// 不与任何外部服务器通信）。协议见 DesignEcho-Agent/docs/browser-extension-bridge.md。
// 基线：Chrome ≥ 116。

import { handlers } from './handlers.js';

const DEFAULT_PORT = 8769;
const WS_PATH = '/designecho-browser';
// 桥侧约定：扩展每 20s 发 ping（桥超过 75s 无消息判定失活）。
// Chrome ≥ 116 中 WebSocket 收发会重置 SW 空闲计时，心跳同时兼作 SW 保活。
const HEARTBEAT_INTERVAL_MS = 20000;
// 指数退避：2s → 4s → 8s → 15s 封顶（对齐 DesignEcho UXP 客户端的 2s→15s 模式）。
const BACKOFF_STEPS_MS = [2000, 4000, 8000, 15000];
// 看门狗：SW 被回收后 setTimeout 重连定时器会一并消失，由 alarm 唤醒 SW 兜住。
// Chrome 116–119 会把 0.5 分钟钳到 1 分钟（仍然有效），Chrome ≥ 120 支持 30 秒。
const WATCHDOG_ALARM_NAME = 'designecho-bridge-watchdog';

let socket = null;
let state = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let ready = false; // 收到 hello_ack 才算 ready（state 也只在此时置 connected）
let connecting = false; // 防止并发 connect
let backoffIndex = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastError = '';
let handledRequests = 0;
let currentPort = DEFAULT_PORT;
let connectedAt = null;

async function loadConfig() {
  const stored = await chrome.storage.local.get({ port: DEFAULT_PORT, token: '' });
  let port = Number(stored.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    port = DEFAULT_PORT;
  }
  const token = typeof stored.token === 'string' ? stored.token.trim() : '';
  return { port, token };
}

export function getStatus() {
  return {
    state,
    ready,
    port: currentPort,
    lastError,
    handledRequests,
    connectedAt,
    updatedAt: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version,
  };
}

// SW 随时可能被回收，把状态快照写进 chrome.storage.session，
// popup 打开时先读快照、再向活着的 SW sendMessage 拿实时值（双保险）。
function publishStatus() {
  chrome.storage.session.set({ bridgeStatus: getStatus() }).catch(() => {
    // 状态快照写失败不影响主流程（popup 仍可经 sendMessage 拿实时状态）。
  });
}

function setState(next) {
  state = next;
  publishStatus();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ws) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    } else {
      stopHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  const delay = BACKOFF_STEPS_MS[Math.min(backoffIndex, BACKOFF_STEPS_MS.length - 1)];
  backoffIndex = Math.min(backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function connect() {
  if (connecting) {
    return;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connecting = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    connecting = false;
    lastError = `读取扩展配置失败：${error && error.message ? error.message : String(error)}`;
    setState('disconnected');
    scheduleReconnect();
    return;
  }
  currentPort = config.port;
  setState('connecting');

  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${config.port}${WS_PATH}`);
  } catch (error) {
    connecting = false;
    lastError = `创建 WebSocket 失败（端口 ${config.port}）：${error && error.message ? error.message : String(error)}`;
    setState('disconnected');
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    connecting = false;
    const hello = {
      type: 'hello',
      role: 'browser-extension',
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
    };
    if (config.token) {
      hello.token = config.token;
    }
    ws.send(JSON.stringify(hello));
    // 此时尚未收到 hello_ack，保持 connecting；hello_ack 到达才算 connected。
  };

  ws.onmessage = (event) => {
    handleMessage(ws, event.data);
  };

  ws.onerror = () => {
    // WebSocket 的 error 事件不携带具体原因，实际原因由随后的 close code 给出。
    if (state !== 'connected') {
      lastError = `连接 ws://127.0.0.1:${config.port}${WS_PATH} 出错（DesignEcho Agent 可能未启动，或端口配置不一致）`;
    }
  };

  ws.onclose = (event) => {
    if (socket === ws) {
      socket = null;
    }
    connecting = false;
    stopHeartbeat();
    ready = false;
    connectedAt = null;
    if (event.code === 4401) {
      lastError = 'token 不匹配：请在扩展弹窗中填写与 Agent 侧 DESIGNECHO_BROWSER_BRIDGE_TOKEN 一致的 token';
    } else if (event.code === 4000) {
      lastError = '连接被新的扩展客户端顶替（桥只保留一个连接）';
    } else if (event.code === 1006) {
      lastError = `无法连接 127.0.0.1:${currentPort}（Agent 未启动、端口不对或桥未就绪）`;
    } else {
      lastError = `连接已关闭（code=${event.code}${event.reason ? `，${event.reason}` : ''}）`;
    }
    setState('disconnected');
    scheduleReconnect();
  };
}

function handleMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    lastError = '收到桥发来的非 JSON 消息，已忽略';
    publishStatus();
    return;
  }
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'hello_ack') {
    ready = true;
    backoffIndex = 0;
    lastError = '';
    connectedAt = Date.now();
    setState('connected');
    startHeartbeat(ws);
    return;
  }
  if (message.type === 'pong') {
    return; // 心跳回包，无需处理
  }
  if (message.type === 'request') {
    handleRequest(ws, message);
  }
  // 其余类型静默忽略（协议向前兼容）
}

async function handleRequest(ws, message) {
  const { id, method, params } = message;
  const respond = (payload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'response', id, ...payload }));
    }
  };

  const handler = handlers[method];
  if (typeof handler !== 'function') {
    respond({
      ok: false,
      error: {
        message:
          `未知的浏览器方法：${String(method)}。扩展当前支持：${Object.keys(handlers).join('、')}。` +
          '可能是扩展版本过旧，请更新扩展目录后在 chrome://extensions 中点「重新加载」。',
      },
    });
    return;
  }

  try {
    const result = await handler(params && typeof params === 'object' ? params : {});
    handledRequests += 1;
    publishStatus();
    respond({ ok: true, result });
  } catch (error) {
    handledRequests += 1;
    publishStatus();
    const detail = error && error.message ? error.message : String(error);
    respond({ ok: false, error: { message: `${method} 执行失败：${detail}` } });
  }
}

// 立即重连：重置退避、丢弃旧连接（摘除回调避免旧 onclose 再排一次重连）。
export function reconnectNow() {
  backoffIndex = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  if (socket) {
    const ws = socket;
    socket = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(1000, 'manual reconnect');
    } catch {
      // 关闭失败无需处理，直接建新连接
    }
  }
  ready = false;
  connecting = false;
  connectedAt = null;
  setState('disconnected');
  connect();
}

export function initConnection() {
  chrome.runtime.onStartup.addListener(() => {
    connect();
  });
  chrome.runtime.onInstalled.addListener(() => {
    connect();
  });

  // 看门狗：SW 被回收后由 alarm 唤醒（唤醒即重新求值本模块并走到底部的 connect()）。
  chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG_ALARM_NAME && state !== 'connected') {
      connect();
    }
  });

  // 弹窗里改了端口 / token 后自动用新配置重连。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.port || changes.token)) {
      reconnectNow();
    }
  });

  connect();
}
