// DesignEcho 浏览器助手 —— MV3 service worker 入口。
// 基线：Chrome ≥ 116（该版本起 WebSocket 活动会重置 service worker 的空闲计时，
// 心跳即可保活；更早版本的 SW 会在 30 秒空闲后被回收，导致连接频繁中断）。
// 注意：service worker 环境没有 window / document，所有页面级操作
// 都通过 chrome.scripting.executeScript 注入 lib/page-scripts.js 中的纯函数执行。

import { initConnection, getStatus, reconnectNow } from './lib/connection.js';

// 事件监听必须在 service worker 首轮同步求值时注册（chrome.runtime.onStartup /
// chrome.alarms.onAlarm 等在 initConnection 内注册），否则事件无法唤醒休眠的 SW。
initConnection();

// popup 通过 chrome.runtime.sendMessage 查询实时状态 / 请求重连。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }
  if (message.type === 'getStatus') {
    sendResponse(getStatus());
    return false;
  }
  if (message.type === 'reconnect') {
    reconnectNow();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
