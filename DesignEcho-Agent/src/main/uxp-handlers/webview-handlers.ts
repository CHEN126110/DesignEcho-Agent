/**
 * WebView 消息转发相关 UXP Handlers
 */

import { clipboard, nativeImage } from 'electron';
import type { UXPContext } from './types';

// 剪贴板参考图最长边上限：够模型看清画面，同时控制 WS 消息体积
const CLIPBOARD_IMAGE_MAX_EDGE = 1600;

/**
 * 把带透明通道的图合成到白底。
 * JPEG 没有透明通道，NativeImage.toJPEG 会把透明区丢成黑色；
 * 与 webview 粘贴路径的白底行为保持一致，避免同一素材两条入口产出黑底/白底两种参考图。
 * toBitmap 返回预乘 BGRA，白底合成即每通道加 (255 - alpha)。
 */
function flattenImageToWhite(image: Electron.NativeImage): Electron.NativeImage {
    const size = image.getSize();
    if (!size.width || !size.height) return image;
    const bitmap = Buffer.from(image.toBitmap());
    let hasTransparency = false;
    for (let i = 0; i < bitmap.length; i += 4) {
        const alpha = bitmap[i + 3];
        if (alpha === 255) continue;
        hasTransparency = true;
        const inverse = 255 - alpha;
        bitmap[i] = Math.min(255, bitmap[i] + inverse);
        bitmap[i + 1] = Math.min(255, bitmap[i + 1] + inverse);
        bitmap[i + 2] = Math.min(255, bitmap[i + 2] + inverse);
        bitmap[i + 3] = 255;
    }
    if (!hasTransparency) return image;
    return nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height });
}

/**
 * 注册 WebView 相关 handlers
 */
export function registerWebViewHandlers(context: UXPContext): void {
    const { wsServer, mainWindow, logService } = context;

    // WebView 消息转发
    // UXP sendNotification('webview.message', messageObj) 中 messageObj 直接作为 params
    wsServer.registerHandler('webview.message', async (params: any) => {
        if (mainWindow && params && typeof params === 'object') {
            mainWindow.webContents.send('uxp:webview-message', params);
            console.log('[Agent] 转发 WebView 消息:', params?.type || 'unknown');
        }
        return { success: true };
    });

    // 读取系统剪贴板中的图片（截图/复制的图片位图）。
    // UXP WebView 里 Ctrl+V 可能被 Photoshop 抢走焦点，这是面板按钮的兜底通道；
    // UXP 自身的 clipboard API 只支持文本，图片必须由 Agent(Electron) 主进程代读。
    wsServer.registerHandler('read-clipboard-image', async () => {
        try {
            const image = clipboard.readImage();
            if (!image || image.isEmpty()) {
                return {
                    success: false,
                    error: '剪贴板中没有图片内容。请先用截图工具截图或复制图片本身；如果复制的是图片文件，请改用"本地图片"上传。'
                };
            }

            const size = image.getSize();
            let normalized = flattenImageToWhite(image);
            const maxEdge = Math.max(size.width || 0, size.height || 0);
            if (maxEdge > CLIPBOARD_IMAGE_MAX_EDGE) {
                const scale = CLIPBOARD_IMAGE_MAX_EDGE / maxEdge;
                normalized = normalized.resize({
                    width: Math.max(1, Math.round(size.width * scale)),
                    height: Math.max(1, Math.round(size.height * scale))
                });
            }

            const buffer = normalized.toJPEG(85);
            const outSize = normalized.getSize();
            logService?.logAgent('info', `[UXP Handler] 剪贴板图片已读取 ${size.width}x${size.height} -> ${outSize.width}x${outSize.height}`);
            return {
                success: true,
                base64: buffer.toString('base64'),
                mimeType: 'image/jpeg',
                width: outSize.width,
                height: outSize.height
            };
        } catch (error: any) {
            return {
                success: false,
                error: `读取剪贴板图片失败：${error?.message || '未知错误'}`
            };
        }
    });
}
