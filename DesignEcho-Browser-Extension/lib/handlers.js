// 5 个 browser.* 方法的实现。result 形状严格对齐
// DesignEcho-Agent/docs/browser-extension-bridge.md 的 method 表：
// - textChunks ≤ 1400 字符/块、≤ 40 块（分块逻辑在 page-scripts.js）
// - 截图结果顶层必须有 base64 + format 字段（进模型视觉通道的候选形状）
// - fill 只写值 + 派发 input/change 事件，绝不回车、绝不提交表单
// 本文件运行在 service worker 环境（没有 window/document）。

import { readPageScript, clickScript, fillScript, scrollScript } from './page-scripts.js';

const PAGE_LOAD_TIMEOUT_MS = 45000;
const CAPTURE_SETTLE_MS = 300; // 切前台后等渲染稳定再截图
const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_SCROLL_DELTA = 800;
const DEFAULT_MAX_CHARS = 56000; // 1400 × 40

// 无法注入脚本的浏览器内部页面 / 商店页（商店页是 https 但 Chrome 禁止扩展注入）。
const INTERNAL_URL_PREFIXES = [
  'chrome://',
  'edge://',
  'about:',
  'chrome-extension://',
  'edge-extension://',
  'extension://',
  'devtools://',
  'view-source:',
  'chrome-search://',
  'chrome-untrusted://',
];
const STORE_URL_HINTS = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
  'microsoftedge.microsoft.com/addons',
];

export const handlers = {
  'browser.listTabs': listTabs,
  'browser.readPage': readPage,
  'browser.capture': capture,
  'browser.navigate': navigate,
  'browser.interact': interact,
};

// ---------- 通用辅助 ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function isInternalUrl(url) {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (INTERNAL_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  return STORE_URL_HINTS.some((hint) => lower.includes(hint));
}

function assertInjectable(tab, actionLabel) {
  if (isInternalUrl(tab.url || '')) {
    throw new Error(
      `该页面是浏览器内部页面，无法${actionLabel}：${tab.url || '(未知地址)'}。` +
        '请换一个普通网页标签页（http/https）。'
    );
  }
}

function assertHttpUrl(rawUrl, context) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${context} 收到无效的 url：${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${context} 只允许 http/https 地址，收到：${rawUrl}`);
  }
  return parsed.toString();
}

async function getTabById(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    throw new Error(
      `找不到 tabId=${tabId} 的标签页（可能已被关闭）。` +
        `请先用 browser.listTabs 获取最新标签页列表。原始错误：${errorText(error)}`
    );
  }
}

async function getActiveTab() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab) {
    throw new Error('找不到当前活动标签页：请显式指定 tabId，或先在浏览器中打开一个普通网页。');
  }
  return tab;
}

async function resolveTargetTab(tabId, methodName) {
  if (tabId !== undefined && tabId !== null) {
    if (!Number.isInteger(tabId)) {
      throw new Error(`${methodName} 的 tabId 参数必须是整数，收到：${JSON.stringify(tabId)}`);
    }
    return getTabById(tabId);
  }
  return getActiveTab();
}

// 等待标签页加载到 complete；超时返回 'timeout'（调用方继续读已有内容）。
function waitForTabComplete(tabId, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(value);
      }
    };
    const fail = (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish('complete');
      }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        fail(new Error(`标签页 tabId=${tabId} 在加载完成前被关闭。`));
      }
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }
    // 先挂监听再查当前状态，避免「查到 loading 之后、挂监听之前」漏掉 complete 事件。
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') {
          finish('complete');
        }
      })
      .catch(() => fail(new Error(`标签页 tabId=${tabId} 不存在或已关闭，无法等待其加载完成。`)));
  });
}

// 注入 page-scripts.js 里的纯函数并取回结果；页面脚本以 {error:'中文原因'} 表达失败。
async function runPageScript(tab, func, args, actionLabel) {
  assertInjectable(tab, actionLabel);
  let injection;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args,
    });
  } catch (error) {
    throw new Error(
      `向标签页 tabId=${tab.id}（${tab.url || '未知地址'}）注入脚本失败：${errorText(error)}。` +
        '该页面可能禁止扩展注入（浏览器内部页面/商店页），或标签页已被休眠回收。'
    );
  }
  if (!injection || injection.result === undefined || injection.result === null) {
    throw new Error(
      `标签页 tabId=${tab.id} 的页面脚本没有返回结果（页面可能正在跳转或已被关闭）。`
    );
  }
  if (injection.result.error) {
    throw new Error(injection.result.error);
  }
  return injection.result;
}

function arrayBufferToBase64(buffer) {
  // service worker 里没有 FileReader，手动分片转 base64（避免超长参数栈溢出）。
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// 只缩不放：宽度超过 maxWidth 才用 OffscreenCanvas 缩放重编码，否则直接复用原图。
async function scaleJpegDataUrl(dataUrl, maxWidth) {
  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    if (bitmap.width <= maxWidth) {
      const commaIndex = dataUrl.indexOf(',');
      return { base64: dataUrl.slice(commaIndex + 1), width: bitmap.width, height: bitmap.height };
    }
    const width = maxWidth;
    const height = Math.max(1, Math.round(bitmap.height * (maxWidth / bitmap.width)));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const buffer = await blob.arrayBuffer();
    return { base64: arrayBufferToBase64(buffer), width, height };
  } finally {
    bitmap.close();
  }
}

// ---------- browser.listTabs ----------

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  let activeTabId = null;
  try {
    const active = await getActiveTab();
    activeTabId = active.id ?? null;
  } catch {
    activeTabId = null; // 没有活动标签页（如只剩 DevTools 窗口）不算错误
  }
  const userAgent = navigator.userAgent;
  const browserName = userAgent.includes('Edg/') ? 'Edge' : 'Chrome';
  return {
    browserName,
    extensionVersion: chrome.runtime.getManifest().version,
    activeTabId,
    tabs: tabs.map((tab) => ({
      tabId: tab.id,
      windowId: tab.windowId,
      active: tab.active === true,
      title: tab.title || '',
      url: tab.url || '',
      pinned: tab.pinned === true,
    })),
  };
}

// ---------- browser.readPage ----------

async function readPage(params) {
  const includeElements = params.includeElements === true;
  const keepOpen = params.keepOpen === true;
  const maxChars =
    Number.isInteger(params.maxChars) && params.maxChars > 0 ? params.maxChars : DEFAULT_MAX_CHARS;

  let tab;
  let loadStatus = null;
  // 给了 url 就为本次读取新开一个后台标签页；默认读完即关，避免每次检索都在用户浏览器
  // 里留下一个后台标签页累积（资源泄漏）。需要之后在该页交互/截图时传 keepOpen=true 保留。
  let createdTabId = null;
  if (typeof params.url === 'string' && params.url.trim()) {
    const url = assertHttpUrl(params.url.trim(), 'browser.readPage');
    tab = await chrome.tabs.create({ url, active: false });
    createdTabId = tab.id;
    loadStatus = await waitForTabComplete(tab.id);
    tab = await getTabById(tab.id); // 重新取一次，拿重定向后的最终地址
  } else {
    tab = await resolveTargetTab(params.tabId, 'browser.readPage');
  }

  try {
    const pageData = await runPageScript(tab, readPageScript, [maxChars, includeElements], '读取');

    const closed = createdTabId !== null && !keepOpen;
    const result = {
      // 临时标签页读完即关：返回 tabId=null，避免模型拿一个已关闭的 id 去后续操作
      tabId: closed ? null : tab.id,
      url: pageData.url || tab.url || '',
      title: pageData.title || tab.title || '',
      description: pageData.description || '',
      textChunks: Array.isArray(pageData.textChunks) ? pageData.textChunks : [],
      links: Array.isArray(pageData.links) ? pageData.links : [],
      truncated: pageData.truncated === true,
      totalChars: typeof pageData.totalChars === 'number' ? pageData.totalChars : 0,
    };
    if (includeElements) {
      result.elements = Array.isArray(pageData.elements) ? pageData.elements : [];
    }
    if (loadStatus) {
      result.loadStatus = loadStatus; // 仅在给了 url 新开标签页时附带
    }
    if (createdTabId !== null) {
      result.ephemeralTabClosed = closed; // 告知模型该临时标签页是否已被关闭
      if (closed) {
        result.note = '已读取并关闭临时标签页；若需在该页继续交互或截图，请用 keepOpen=true 重新读取或改用 navigateBrowserTab(newTab=true)。';
      }
    }
    return result;
  } finally {
    // 无论读取成功或抛错，只要是本次为读取而新建的临时标签页且未要求保留，就关闭它
    if (createdTabId !== null && !keepOpen) {
      try {
        await chrome.tabs.remove(createdTabId);
      } catch {
        /* 标签页可能已被用户手动关闭，忽略 */
      }
    }
  }
}

// ---------- browser.capture ----------

async function capture(params) {
  const maxWidth =
    Number.isInteger(params.maxWidth) && params.maxWidth > 0 ? params.maxWidth : DEFAULT_MAX_WIDTH;
  const tab = await resolveTargetTab(params.tabId, 'browser.capture');

  // captureVisibleTab 只能截「窗口当前可见」的标签页，目标不在前台就临时切过去。
  if (!tab.active) {
    try {
      await chrome.tabs.update(tab.id, { active: true });
    } catch (error) {
      throw new Error(`把标签页 tabId=${tab.id} 切到前台失败：${errorText(error)}`);
    }
  }
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // 窗口聚焦失败不直接阻塞（若窗口确实不可见，下面 captureVisibleTab 会给出明确错误）。
  }
  await sleep(CAPTURE_SETTLE_MS);

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
  } catch (error) {
    throw new Error(
      `截取标签页 tabId=${tab.id}（${tab.url || '未知地址'}）失败：${errorText(error)}。` +
        '浏览器内部页面/商店页无法截图；若窗口处于最小化状态，请先还原窗口。'
    );
  }

  const { base64, width, height } = await scaleJpegDataUrl(dataUrl, maxWidth);
  const finalTab = await getTabById(tab.id);
  // base64 与 format 必须在结果顶层（Agent 侧按此形状把图片送进模型视觉通道）。
  return {
    tabId: tab.id,
    url: finalTab.url || '',
    title: finalTab.title || '',
    base64,
    format: 'jpeg',
    width,
    height,
  };
}

// ---------- browser.navigate ----------

async function navigate(params) {
  if (typeof params.url !== 'string' || !params.url.trim()) {
    throw new Error('browser.navigate 缺少 url 参数（要打开的 http/https 地址）。');
  }
  const url = assertHttpUrl(params.url.trim(), 'browser.navigate');

  let tab;
  if (params.newTab === true) {
    tab = await chrome.tabs.create({ url, active: params.background !== true });
  } else {
    const target = await resolveTargetTab(params.tabId, 'browser.navigate');
    try {
      tab = await chrome.tabs.update(target.id, { url });
    } catch (error) {
      throw new Error(`导航标签页 tabId=${target.id} 到 ${url} 失败：${errorText(error)}`);
    }
  }

  const loadStatus = await waitForTabComplete(tab.id);
  const finalTab = await getTabById(tab.id);
  return {
    tabId: finalTab.id,
    url: finalTab.url || url,
    title: finalTab.title || '',
    loadStatus,
  };
}

// ---------- browser.interact ----------

async function interact(params) {
  if (!Number.isInteger(params.tabId)) {
    throw new Error(
      'browser.interact 必须提供整数 tabId（交互不作用于隐式“当前标签页”）。' +
        '请先用 browser.listTabs 或 browser.readPage 确认目标标签页。'
    );
  }
  const action = params.action;
  const tab = await getTabById(params.tabId);

  if (action === 'click') {
    requireLocator(params, 'click');
    const outcome = await runPageScript(
      tab,
      clickScript,
      [normalizeRef(params.elementRef), params.selector ?? null],
      '交互'
    );
    return interactResult(tab.id, 'click', outcome.detail);
  }

  if (action === 'fill') {
    requireLocator(params, 'fill');
    if (typeof params.value !== 'string') {
      throw new Error('browser.interact 的 fill 动作需要字符串 value 参数（要填入的文本）。');
    }
    const outcome = await runPageScript(
      tab,
      fillScript,
      [normalizeRef(params.elementRef), params.selector ?? null, params.value],
      '交互'
    );
    return interactResult(tab.id, 'fill', outcome.detail);
  }

  if (action === 'scroll') {
    const deltaY =
      typeof params.deltaY === 'number' && Number.isFinite(params.deltaY)
        ? params.deltaY
        : DEFAULT_SCROLL_DELTA;
    const outcome = await runPageScript(
      tab,
      scrollScript,
      [params.selector ?? null, deltaY],
      '交互'
    );
    const base = await interactResult(tab.id, 'scroll', outcome.detail);
    return {
      ...base,
      scrollY: outcome.scrollY,
      scrollHeight: outcome.scrollHeight,
      atBottom: outcome.atBottom,
    };
  }

  throw new Error(
    `browser.interact 不支持的 action：${JSON.stringify(action)}。支持 click / fill / scroll。`
  );
}

function normalizeRef(elementRef) {
  if (elementRef === undefined || elementRef === null) {
    return null;
  }
  return String(elementRef);
}

function requireLocator(params, action) {
  const hasRef = params.elementRef !== undefined && params.elementRef !== null;
  const hasSelector = typeof params.selector === 'string' && params.selector.trim() !== '';
  if (!hasRef && !hasSelector) {
    throw new Error(
      `browser.interact 的 ${action} 动作需要 elementRef 或 selector 之一来定位元素。` +
        '请先用 readBrowserPage(includeElements:true) 获取元素清单（ref 编号 + selector）。'
    );
  }
}

async function interactResult(tabId, action, detail) {
  let url = '';
  let title = '';
  try {
    const tab = await getTabById(tabId);
    url = tab.url || '';
    title = tab.title || '';
  } catch {
    // 点击可能触发标签页关闭；动作本身已完成，url/title 留空并在 detail 里说明。
    detail = `${detail}（注意：交互后该标签页已不存在，可能被页面脚本关闭）`;
  }
  return { action, detail, url, title };
}
