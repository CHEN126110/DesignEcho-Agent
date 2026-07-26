/**
 * Layout analysis UXP handlers.
 */

import type { UXPContext } from './types';

/**
 * Register layout analysis handlers.
 */
export function registerLayoutHandlers(context: UXPContext): void {
    const { wsServer, taskOrchestrator, logService } = context;

    const layoutAnalyzeHandler = async (params: { documentInfo?: any }) => {
        logService?.logAgent('info', '[UXP Handler] Received analyze-layout request');

        try {
            let docInfo = params.documentInfo;

            if (!docInfo && wsServer.isPluginConnected()) {
                docInfo = await wsServer.sendRequest('getDocumentInfo', {});
            }

            if (!docInfo) {
                return {
                    success: false,
                    error: 'Unable to read the active Photoshop document.'
                };
            }

            let textLayers: any[] = [];
            if (wsServer.isPluginConnected()) {
                textLayers = await wsServer.sendRequest('getAllTextLayers', {});
            }

            const result = await taskOrchestrator!.execute('layout-analysis', {
                documentInfo: docInfo,
                textLayers
            });

            return {
                success: true,
                data: result
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] analyze-layout failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    };

    wsServer.registerHandler('analyze-layout', layoutAnalyzeHandler);
}
