// popup 逻辑：显示连接状态 + 端口/token 设置。
// 状态获取双保险：优先 sendMessage 问活着的 service worker（顺带把它唤醒），
// SW 未响应时退回读 chrome.storage.session 里的最近快照。

const DEFAULT_PORT = 8769;

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusPort = document.getElementById('status-port');
const requestCount = document.getElementById('request-count');
const lastErrorBox = document.getElementById('last-error');
const versionLabel = document.getElementById('version');
const portInput = document.getElementById('port-input');
const tokenInput = document.getElementById('token-input');
const saveButton = document.getElementById('save-button');
const reconnectButton = document.getElementById('reconnect-button');
const saveHint = document.getElementById('save-hint');

const STATE_LABELS = {
  connected: '已连接 DesignEcho Agent',
  connecting: '正在连接…',
  disconnected: '未连接',
};

const STATE_DOT_CLASSES = {
  connected: 'dot dot-green',
  connecting: 'dot dot-gray',
  disconnected: 'dot dot-red',
};

function renderStatus(status) {
  const state = status && STATE_LABELS[status.state] ? status.state : 'disconnected';
  statusDot.className = STATE_DOT_CLASSES[state];
  statusText.textContent = STATE_LABELS[state];
  statusPort.textContent = String(status && status.port ? status.port : DEFAULT_PORT);
  requestCount.textContent = String(status && status.handledRequests ? status.handledRequests : 0);
  if (status && status.lastError && state !== 'connected') {
    lastErrorBox.textContent = status.lastError;
    lastErrorBox.classList.remove('hidden');
  } else {
    lastErrorBox.classList.add('hidden');
  }
  if (status && status.extensionVersion) {
    versionLabel.textContent = 'v' + status.extensionVersion;
  }
}

async function fetchStatus() {
  try {
    const live = await chrome.runtime.sendMessage({ type: 'getStatus' });
    if (live && live.state) {
      renderStatus(live);
      return;
    }
  } catch {
    // SW 正在唤醒或消息通道暂不可用，退回读快照。
  }
  try {
    const { bridgeStatus } = await chrome.storage.session.get('bridgeStatus');
    renderStatus(bridgeStatus || { state: 'disconnected', lastError: '服务尚未上报状态' });
  } catch {
    renderStatus({ state: 'disconnected', lastError: '无法读取连接状态' });
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get({ port: DEFAULT_PORT, token: '' });
  portInput.value = String(stored.port || DEFAULT_PORT);
  tokenInput.value = typeof stored.token === 'string' ? stored.token : '';
}

function showHint(text, isWarn) {
  saveHint.textContent = text;
  saveHint.className = isWarn ? 'hint warn' : 'hint';
}

saveButton.addEventListener('click', async () => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showHint('端口必须是 1–65535 之间的整数', true);
    return;
  }
  const token = tokenInput.value.trim();
  // service worker 侧监听 storage.onChanged，保存后会自动用新配置重连。
  await chrome.storage.local.set({ port, token });
  showHint('已保存，正在用新配置重连…', false);
  setTimeout(fetchStatus, 500);
});

reconnectButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'reconnect' });
    showHint('已触发重新连接…', false);
  } catch {
    showHint('无法唤起后台服务，请稍后重试或重新加载扩展', true);
  }
  setTimeout(fetchStatus, 500);
});

loadSettings();
fetchStatus();
versionLabel.textContent = 'v' + chrome.runtime.getManifest().version;
// popup 打开期间每秒刷新一次状态（sendMessage 同时能保持 SW 活跃）。
setInterval(fetchStatus, 1000);
