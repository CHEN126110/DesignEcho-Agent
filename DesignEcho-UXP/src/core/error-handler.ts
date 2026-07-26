/**
 * Photoshop 错误处理器
 * 
 * 捕获和格式化 Photoshop API 错误，提供详细的调试信息
 */

const app = require('photoshop').app;
const { action } = require('photoshop');

export interface PhotoshopError {
    type: 'batchPlay' | 'api' | 'modal' | 'unknown';
    code?: number;
    message: string;
    details?: string;
    context: {
        documentName?: string;
        documentId?: number;
        activeLayerId?: number;
        activeLayerName?: string;
        activeLayerKind?: string;
        historyState?: string;
        operation?: string;
        params?: any;
    };
    stack?: string;
    timestamp: string;
}

/**
 * 获取当前 Photoshop 上下文
 */
export function getPhotoshopContext(operation?: string, params?: any): PhotoshopError['context'] {
    const context: PhotoshopError['context'] = {
        operation,
        params
    };

    try {
        const doc = app.activeDocument;
        if (doc) {
            context.documentName = doc.name;
            context.documentId = doc.id;
            
            const activeLayers = doc.activeLayers;
            if (activeLayers && activeLayers.length > 0) {
                const layer = activeLayers[0];
                context.activeLayerId = layer.id;
                context.activeLayerName = layer.name;
                context.activeLayerKind = layer.kind?.toString() || 'unknown';
            }
            
            // 尝试获取当前历史状态
            try {
                // @ts-ignore - activeHistoryState may not be in type definitions but exists at runtime
                context.historyState = doc.activeHistoryState?.name;
            } catch (e) {
                // 忽略
            }
        }
    } catch (e) {
        console.warn('[ErrorHandler] 获取上下文失败:', e);
    }

    return context;
}

/**
 * 格式化 batchPlay 错误
 */
export function formatBatchPlayError(error: any, descriptor?: any): string {
    let details = '';
    
    if (error.message) {
        details += `错误信息: ${error.message}\n`;
    }
    
    if (error.code !== undefined) {
        details += `错误代码: ${error.code}\n`;
    }
    
    // 尝试解析常见的 Photoshop 错误
    const errorPatterns: Record<string, string> = {
        'The command "Set" is not currently available': '命令"设置"当前不可用 - 可能是图层被锁定、文档模式不支持、或需要先选中目标',
        'The command "Move" is not currently available': '命令"移动"当前不可用 - 图层可能被锁定',
        'The command "Select" is not currently available': '命令"选择"当前不可用',
        'Layer is locked': '图层已锁定，无法修改',
        'Could not complete': '操作无法完成 - 检查图层状态和文档模式',
        'Object reference not set': '对象引用无效 - 目标图层可能不存在',
        'Unable to set': '无法设置属性 - 检查参数格式',
    };

    const errorMsg = error.message || String(error);
    for (const [pattern, explanation] of Object.entries(errorPatterns)) {
        if (errorMsg.includes(pattern)) {
            details += `\n诊断: ${explanation}\n`;
            break;
        }
    }

    if (descriptor) {
        details += `\nbatchPlay 描述符:\n${JSON.stringify(descriptor, null, 2)}\n`;
    }

    return details;
}

/**
 * 封装错误为标准格式
 */
export function wrapError(
    error: any,
    operation: string,
    params?: any,
    batchPlayDescriptor?: any
): PhotoshopError {
    const context = getPhotoshopContext(operation, params);
    
    let type: PhotoshopError['type'] = 'unknown';
    let details = '';

    if (error.message?.includes('batchPlay') || batchPlayDescriptor) {
        type = 'batchPlay';
        details = formatBatchPlayError(error, batchPlayDescriptor);
    } else if (error.message?.includes('modal') || error.message?.includes('Modal')) {
        type = 'modal';
        details = 'Modal 操作失败 - 可能与其他操作冲突';
    } else if (error.message?.includes('API') || error.name === 'PhotoshopError') {
        type = 'api';
    }

    const wrappedError: PhotoshopError = {
        type,
        code: error.code,
        message: error.message || String(error),
        details,
        context,
        stack: error.stack,
        timestamp: new Date().toISOString()
    };

    return wrappedError;
}

/**
 * 安全执行 batchPlay 并捕获详细错误
 */
export async function safeBatchPlay(
    descriptors: any[],
    options: any = {},
    operation: string = 'batchPlay'
): Promise<{ success: boolean; result?: any; error?: PhotoshopError }> {
    try {
        console.log(`[SafeBatchPlay] 执行: ${operation}`);
        console.log(`[SafeBatchPlay] 描述符:`, JSON.stringify(descriptors, null, 2));
        
        const result = await action.batchPlay(descriptors, options);
        
        console.log(`[SafeBatchPlay] 结果:`, JSON.stringify(result, null, 2));
        
        // 检查结果中是否有错误
        if (Array.isArray(result)) {
            for (const r of result) {
                if (r && r.message && r.message.includes('Error')) {
                    return {
                        success: false,
                        error: wrapError({ message: r.message }, operation, undefined, descriptors)
                    };
                }
            }
        }
        
        return { success: true, result };
    } catch (error: any) {
        console.error(`[SafeBatchPlay] 错误:`, error);
        
        const wrappedError = wrapError(error, operation, undefined, descriptors);
        
        // 发送详细错误日志
        console.error(`[PS Error] 操作: ${operation}`);
        console.error(`[PS Error] 类型: ${wrappedError.type}`);
        console.error(`[PS Error] 消息: ${wrappedError.message}`);
        if (wrappedError.details) {
            console.error(`[PS Error] 详情:\n${wrappedError.details}`);
        }
        console.error(`[PS Error] 上下文:`, JSON.stringify(wrappedError.context, null, 2));
        
        return { success: false, error: wrappedError };
    }
}

/**
 * 诊断工具 - 检查当前 Photoshop 状态
 */
export async function diagnosePhotoshopState(): Promise<{
    hasDocument: boolean;
    documentInfo?: {
        name: string;
        id: number;
        mode: string;
        width: number;
        height: number;
    };
    hasSelection: boolean;
    selectedLayers?: {
        id: number;
        name: string;
        kind: string;
        locked: boolean;
        visible: boolean;
    }[];
    issues: string[];
}> {
    const issues: string[] = [];
    
    try {
        const doc = app.activeDocument;
        
        if (!doc) {
            return {
                hasDocument: false,
                hasSelection: false,
                issues: ['没有打开的文档']
            };
        }

        const documentInfo = {
            name: doc.name,
            id: doc.id,
            mode: doc.mode?.toString() || 'unknown',
            width: doc.width,
            height: doc.height
        };

        const activeLayers = doc.activeLayers;
        const hasSelection = activeLayers && activeLayers.length > 0;
        
        const selectedLayers = hasSelection ? activeLayers.map((layer: any) => {
            const info = {
                id: layer.id,
                name: layer.name,
                kind: layer.kind?.toString() || 'unknown',
                locked: layer.locked || false,
                visible: layer.visible
            };
            
            // 检查常见问题
            if (layer.locked) {
                issues.push(`图层 "${layer.name}" (ID: ${layer.id}) 已锁定`);
            }
            if (!layer.visible) {
                issues.push(`图层 "${layer.name}" (ID: ${layer.id}) 不可见`);
            }
            
            return info;
        }) : undefined;

        if (!hasSelection) {
            issues.push('没有选中任何图层');
        }

        return {
            hasDocument: true,
            documentInfo,
            hasSelection,
            selectedLayers,
            issues
        };
    } catch (error: any) {
        return {
            hasDocument: false,
            hasSelection: false,
            issues: [`诊断失败: ${error.message}`]
        };
    }
}
