/**
 * 浏览器扩展桥 IPC Handlers
 *
 * 供 renderer 的 Agent 工具执行器调用：
 * - browserBridge:call   转发浏览器方法（browser.listTabs / browser.readPage / ...）到扩展
 * - browserBridge:status 查询桥与扩展连接状态
 *
 * 返回统一形状 { success, ...result } / { success:false, error }，
 * 与 web-page-handlers 的错误处理约定一致（不抛异常到 IPC 边界）。
 */

import { ipcMain } from 'electron';
import { getBrowserBridgeService } from '../services/browser-bridge-service';

/** 允许经 IPC 转发的扩展方法白名单（协议见 docs/browser-extension-bridge.md） */
const ALLOWED_BRIDGE_METHODS = new Set([
    'browser.listTabs',
    'browser.readPage',
    'browser.capture',
    'browser.navigate',
    'browser.interact'
]);

export function registerBrowserBridgeHandlers(): void {
    ipcMain.handle('browserBridge:call', async (_event, payload: { method: string; params?: any }) => {
        const method = String(payload?.method || '').trim();
        if (!ALLOWED_BRIDGE_METHODS.has(method)) {
            return {
                success: false,
                error: `不支持的浏览器桥方法: ${method || '(空)'}，可用方法: ${Array.from(ALLOWED_BRIDGE_METHODS).join(', ')}`
            };
        }
        const service = getBrowserBridgeService();
        if (!service) {
            return { success: false, error: '浏览器桥服务未初始化（主进程启动异常），请重启应用后重试。' };
        }
        try {
            const result = await service.call(method, payload?.params || {});
            return { success: true, ...(result && typeof result === 'object' ? result : { result }) };
        } catch (error: any) {
            return { success: false, error: error?.message || `浏览器桥调用失败（${method}）` };
        }
    });

    ipcMain.handle('browserBridge:status', async () => {
        const service = getBrowserBridgeService();
        if (!service) {
            return { success: false, error: '浏览器桥服务未初始化' };
        }
        return { success: true, ...service.getStatus() };
    });

    console.log('[BrowserBridgeHandlers] ✅ 注册完成 (browserBridge:call / browserBridge:status)');
}
