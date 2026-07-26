import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';

/**
 * 全局致命错误兜底层。
 *
 * ErrorBoundary 只能捕获 React 子树**渲染期**的错误；而桌面端反复黑屏的相当一部分诱因
 * 发生在 React 挂载**之前/之外**——模块导入副作用、zustand persist 同步水合（sendSync）、
 * 懒加载 chunk 预载失败。这些错误若无人接住，React 整树就不挂载，#root 永久为空，
 * splash 消失后露出与背景同色（#0d0d14）的纯黑屏，且无任何提示、无日志。
 *
 * 这里在 window 层统一兜底：把致命错误可视化（可读、可重载）并写 console，杜绝"静默黑屏"。
 */
function showFatalOverlay(title: string, detail: string): void {
    try {
        if (document.getElementById('fatal-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'fatal-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:99999',
            'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
            'gap:16px', 'padding:32px', 'box-sizing:border-box',
            'background:#1a1a24', 'color:#e8e8f0',
            'font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif', 'text-align:center'
        ].join(';');
        const safeDetail = String(detail || '').replace(/[<>&]/g, (c) =>
            c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'
        );
        overlay.innerHTML =
            '<div style="font-size:18px;font-weight:600">' + title + '</div>' +
            '<pre style="max-width:680px;max-height:240px;overflow:auto;white-space:pre-wrap;' +
            'font-size:12px;color:#a0a0b8;background:#0d0d14;padding:12px 16px;border-radius:8px;margin:0">' +
            safeDetail + '</pre>' +
            '<button id="fatal-reload" style="padding:8px 20px;font-size:14px;border:none;border-radius:6px;' +
            'background:#4f7cff;color:#fff;cursor:pointer">重新加载</button>';
        document.body.appendChild(overlay);
        document.getElementById('fatal-reload')?.addEventListener('click', () => window.location.reload());
    } catch {
        // 兜底层自身失败也不能再抛，否则陷入循环
    }
}

/** React 尚未挂载时（#root 空）才弹兜底；挂载后的渲染错误交给 ErrorBoundary，避免重复/误报。 */
function isBeforeMount(): boolean {
    const root = document.getElementById('root');
    return !root || root.children.length === 0;
}

window.addEventListener('error', (event) => {
    console.error('[Global] 未捕获错误:', event.error || event.message);
    if (isBeforeMount()) {
        showFatalOverlay('界面启动失败', String(event.error?.stack || event.message || event));
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[Global] 未处理的 Promise 拒绝:', event.reason);
    if (isBeforeMount()) {
        const reason: any = event.reason;
        showFatalOverlay('界面启动失败', String((reason && reason.stack) || reason || '未知异步错误'));
    }
});

// 懒加载 chunk 预载失败（缺文件/网络抖动）：自动重载一次自愈，避免永久黑屏。
// sessionStorage 标记防无限重载循环。
window.addEventListener('vite:preloadError', (event) => {
    console.error('[Global] 资源块加载失败:', event);
    if (!sessionStorage.getItem('de-preload-reloaded')) {
        sessionStorage.setItem('de-preload-reloaded', '1');
        window.location.reload();
    } else {
        showFatalOverlay('资源加载失败', '部分界面资源无法加载，请关闭后重新打开应用。');
    }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
    showFatalOverlay('初始化失败', '找不到根容器 #root');
} else {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>
    );
}
