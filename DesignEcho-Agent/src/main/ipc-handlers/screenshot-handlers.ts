import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';

export function registerScreenshotHandlers(): void {
    ipcMain.handle('screenshot:captureAgentWindow', async (event) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (!win) {
                return { success: false, error: '未找到当前窗口' };
            }

            const image = await win.capturePage();
            return {
                success: true,
                imageBase64: image.toPNG().toString('base64'),
                mimeType: 'image/png',
                source: 'agent-window'
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '截取 Agent 窗口失败' };
        }
    });

    ipcMain.handle('screenshot:captureDesktop', async () => {
        try {
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.size;
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height }
            });

            let target = sources.find((s) => s.display_id === String(primary.id));
            if (!target && sources.length > 0) target = sources[0];
            if (!target) {
                return { success: false, error: '未找到可用屏幕源' };
            }

            const png = target.thumbnail.toPNG();
            return {
                success: true,
                imageBase64: png.toString('base64'),
                mimeType: 'image/png',
                source: 'desktop'
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '截取桌面失败' };
        }
    });
}

