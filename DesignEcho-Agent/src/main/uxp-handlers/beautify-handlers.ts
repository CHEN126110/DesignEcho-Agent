/**
 * 一键美化相关 UXP Handlers
 */

import type { UXPContext, SendProgressFn } from './types';

/**
 * 注册一键美化相关 handlers
 */
export function registerBeautifyHandlers(context: UXPContext): void {
    const { wsServer, logService } = context;

    // 一键美化
    wsServer.registerHandler('one-click-beautify', async () => {
        logService?.logAgent('info', '[UXP Handler] 收到一键美化请求');
        
        const sendProgress: SendProgressFn = (progress, message) => {
            wsServer.sendProgress('one-click-beautify', progress, message);
            logService?.logAgent('info', `[一键美化] ${progress}% - ${message}`);
        };
        
        try {
            sendProgress(10, '正在获取文档信息...');
            
            const docResult = await wsServer.sendRequest('getDocumentInfo', {});
            if (!docResult?.success) {
                return { success: false, error: '无法获取文档信息' };
            }
            
            sendProgress(20, '正在分析图层结构...');
            
            const layersResult = await wsServer.sendRequest('getLayerHierarchy', {});
            if (!layersResult?.success) {
                return { success: false, error: '无法获取图层信息' };
            }
            
            sendProgress(40, '正在分析布局问题...');
            
            const layoutResult = await wsServer.sendRequest('analyzeLayout', {});
            
            sendProgress(60, '正在执行优化...');
            
            const issues: string[] = [];
            let fixCount = 0;
            
            if (layoutResult?.data?.layers && layoutResult.data.layers.length > 0) {
                const docWidth = docResult.data?.width || 1000;
                const docHeight = docResult.data?.height || 1000;
                
                for (const layer of layoutResult.data.layers) {
                    if (layer.bounds) {
                        const layerCenterX = (layer.bounds.left + layer.bounds.right) / 2;
                        const layerCenterY = (layer.bounds.top + layer.bounds.bottom) / 2;
                        const canvasCenterX = docWidth / 2;
                        const canvasCenterY = docHeight / 2;
                        
                        if (Math.abs(layerCenterX - canvasCenterX) > 50) {
                            issues.push(`图层 "${layer.name}" 水平偏离中心`);
                        }
                        if (Math.abs(layerCenterY - canvasCenterY) > 50) {
                            issues.push(`图层 "${layer.name}" 垂直偏离中心`);
                        }
                    }
                }
            }
            
            sendProgress(80, '正在生成分析报告...');
            sendProgress(100, '分析完成');
            
            if (issues.length === 0) {
                return {
                    success: true,
                    message: '画布布局良好，无需调整',
                    fixedCount: 0,
                    issues: []
                };
            } else {
                return {
                    success: true,
                    message: `发现 ${issues.length} 个布局问题`,
                    fixedCount: fixCount,
                    issues: issues.slice(0, 5)
                };
            }
            
        } catch (error: any) {
            logService?.logAgent('error', `[一键美化] 失败: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    });
}
