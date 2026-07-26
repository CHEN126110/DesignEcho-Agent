import { ipcMain } from 'electron';
import { InpaintingService } from '../services/inpainting-service';
import type { IPCContext } from './types';

let inpaintingService: InpaintingService | null = null;

export function registerInpaintingHandlers(_context: IPCContext) {
    if (!inpaintingService) {
        inpaintingService = new InpaintingService();
    }

    ipcMain.handle('inpainting:updateConfig', async () => ({ success: true }));

    ipcMain.handle('inpainting:generate', async (_event, params) => {
        try {
            console.log('[InpaintingHandler] Received inpainting request:', {
                prompt: params?.prompt,
                model: params?.model || 'flux-fill'
            });

            return await inpaintingService!.inpaint({
                image: params.image,
                mask: params.mask,
                prompt: params.prompt,
                model: params.model,
                imageFormat: params.imageFormat,
                imageChannels: params.imageChannels,
                maskFormat: params.maskFormat,
                maskChannels: params.maskChannels,
                imageWidth: params.imageWidth,
                imageHeight: params.imageHeight,
                selectionBounds: params.selectionBounds,
                documentMeta: params.documentMeta
            });
        } catch (error: any) {
            console.error('[InpaintingHandler] Failed:', error);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('inpainting:apply', async () => ({ success: true }));
}
