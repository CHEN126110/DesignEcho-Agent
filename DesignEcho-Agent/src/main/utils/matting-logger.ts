/**
 * 智能抠图日志工具
 * 
 * 提供统一的日志格式和错误处理
 */

import { getLogService } from '../services/log-service';

// 错误码定义
export const MattingErrorCodes = {
    // 初始化错误 (1xxx)
    SERVICE_NOT_INITIALIZED: { code: 1001, message: '抠图服务未初始化', suggestion: '请重启 Agent 应用' },
    NO_MODELS_AVAILABLE: { code: 1002, message: '没有可用的抠图模型', suggestion: '请在设置中下载 BiRefNet 模型' },
    
    // 图像获取错误 (2xxx)
    IMAGE_EXPORT_FAILED: { code: 2001, message: '获取图层图像失败', suggestion: '请确保选中了有效的图层' },
    IMAGE_EXPORT_TIMEOUT: { code: 2002, message: '图像导出超时', suggestion: '图像过大，请尝试缩小画布或分块处理' },
    BINARY_TRANSFER_TIMEOUT: { code: 2003, message: '二进制传输超时', suggestion: '请重试或检查网络连接' },
    INVALID_IMAGE_DATA: { code: 2004, message: '图像数据无效', suggestion: '请检查图层是否为空或被锁定' },
    
    // 检测错误 (3xxx)
    DETECTION_FAILED: { code: 3001, message: '目标检测失败', suggestion: '尝试更换描述词或使用更清晰的图像' },
    NO_TARGET_FOUND: { code: 3002, message: '未检测到目标', suggestion: '请检查目标描述是否准确，或目标是否在图像中' },
    
    // 分割错误 (4xxx)
    SEGMENTATION_FAILED: { code: 4001, message: '图像分割失败', suggestion: '请检查模型是否已下载' },
    MASK_GENERATION_FAILED: { code: 4002, message: '蒙版生成失败', suggestion: '请尝试其他分割模型' },
    
    // 边缘处理错误 (5xxx)
    EDGE_REFINE_FAILED: { code: 5001, message: '边缘细化失败', suggestion: '边缘处理已跳过，使用原始蒙版' },
    
    // 应用错误 (6xxx)
    APPLY_MASK_FAILED: { code: 6001, message: '应用蒙版失败', suggestion: '请检查 Photoshop 连接状态' },
    APPLY_TIMEOUT: { code: 6002, message: '应用结果超时', suggestion: '请检查 Photoshop 是否响应' },
    
    // 未知错误 (9xxx)
    UNKNOWN_ERROR: { code: 9001, message: '未知错误', suggestion: '请查看日志了解详情' }
} as const;

export type MattingErrorCode = keyof typeof MattingErrorCodes;

/**
 * 智能抠图日志工具类
 */
export class MattingLogger {
    private static instance: MattingLogger;
    private sessionId: string = '';
    private startTime: number = 0;
    
    static getInstance(): MattingLogger {
        if (!this.instance) {
            this.instance = new MattingLogger();
        }
        return this.instance;
    }
    
    /**
     * 开始新的抠图会话
     */
    startSession(mode: 'single' | 'multi', targets: string[]): void {
        this.sessionId = Date.now().toString(36);
        this.startTime = Date.now();
        
        const logService = getLogService();
        const modeLabel = mode === 'single' ? '单目标' : '多目标';
        const targetList = targets.join(', ');
        
        logService?.logAgent('info', `┌─────────────────────────────────────────────────────────────┐`);
        logService?.logAgent('info', `│ 💡 智能抠图 [${this.sessionId}] - ${modeLabel}模式                       │`);
        logService?.logAgent('info', `├─────────────────────────────────────────────────────────────┤`);
        logService?.logAgent('info', `│ 目标: ${targetList.substring(0, 50).padEnd(52)} │`);
        logService?.logAgent('info', `│ 模型: YOLO-World → BiRefNet → ViTMatte                     │`);
        logService?.logAgent('info', `└─────────────────────────────────────────────────────────────┘`);
    }
    
    /**
     * 结束抠图会话
     */
    endSession(success: boolean, details?: string): void {
        const logService = getLogService();
        const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const status = success ? '✅ 成功' : '❌ 失败';
        
        logService?.logAgent('info', `┌─────────────────────────────────────────────────────────────┐`);
        logService?.logAgent('info', `│ 🏁 会话结束 [${this.sessionId}] ${status.padEnd(35)} │`);
        logService?.logAgent('info', `│ 耗时: ${duration}s ${details ? `| ${details.substring(0, 40)}` : ''}`.padEnd(60) + `│`);
        logService?.logAgent('info', `└─────────────────────────────────────────────────────────────┘`);
    }
    
    /**
     * 记录阶段开始
     */
    stageStart(stage: 'image' | 'detection' | 'segmentation' | 'refine' | 'apply', detail?: string): void {
        const logService = getLogService();
        const stageIcons: Record<string, string> = {
            image: '📷',
            detection: '🎯',
            segmentation: '✂️',
            refine: '💎',
            apply: '📋'
        };
        const stageNames: Record<string, string> = {
            image: '图像获取',
            detection: '目标检测',
            segmentation: '精确分割',
            refine: '边缘细化',
            apply: '应用结果'
        };
        
        const icon = stageIcons[stage] || '▶';
        const name = stageNames[stage] || stage;
        const detailStr = detail ? ` (${detail})` : '';
        
        logService?.logAgent('info', `│ ${icon} ${name}${detailStr}`);
    }
    
    /**
     * 记录阶段完成
     */
    stageComplete(stage: string, success: boolean, info?: string): void {
        const logService = getLogService();
        const status = success ? '✓' : '✗';
        const infoStr = info ? `: ${info}` : '';
        
        logService?.logAgent('info', `│   ${status} ${stage}完成${infoStr}`);
    }
    
    /**
     * 记录进度
     */
    progress(message: string): void {
        const logService = getLogService();
        logService?.logAgent('info', `│   → ${message}`);
    }
    
    /**
     * 记录警告
     */
    warn(message: string): void {
        const logService = getLogService();
        logService?.logAgent('warn', `│   ⚠ ${message}`);
    }
    
    /**
     * 记录错误
     */
    error(errorCode: MattingErrorCode, detail?: string): { code: number; error: string; suggestion: string } {
        const logService = getLogService();
        const errorDef = MattingErrorCodes[errorCode];
        const detailStr = detail ? `: ${detail}` : '';
        
        logService?.logAgent('error', `│   ❌ [E${errorDef.code}] ${errorDef.message}${detailStr}`);
        logService?.logAgent('error', `│   💡 ${errorDef.suggestion}`);
        
        return {
            code: errorDef.code,
            error: `${errorDef.message}${detailStr}`,
            suggestion: errorDef.suggestion
        };
    }
    
    /**
     * 记录模型使用情况
     */
    logModelUsage(models: { detection?: string; segmentation?: string; refine?: string }): void {
        const logService = getLogService();
        logService?.logAgent('info', `├─────────────────────────────────────────────────────────────┤`);
        if (models.detection) {
            logService?.logAgent('info', `│ 检测模型: ${models.detection.padEnd(47)} │`);
        }
        if (models.segmentation) {
            logService?.logAgent('info', `│ 分割模型: ${models.segmentation.padEnd(47)} │`);
        }
        if (models.refine) {
            logService?.logAgent('info', `│ 细化模型: ${models.refine.padEnd(47)} │`);
        }
        logService?.logAgent('info', `├─────────────────────────────────────────────────────────────┤`);
    }
    
    /**
     * 记录数据传输信息
     */
    logTransfer(type: 'image' | 'mask', size: number, method: 'binary' | 'base64'): void {
        const logService = getLogService();
        const sizeKB = (size / 1024).toFixed(0);
        const typeLabel = type === 'image' ? '图像' : '蒙版';
        const methodLabel = method === 'binary' ? '二进制' : 'Base64';
        const savingInfo = method === 'binary' ? ' (节省 33%)' : '';
        
        logService?.logAgent('info', `│   📦 ${typeLabel}传输: ${sizeKB}KB (${methodLabel}${savingInfo})`);
    }
    
    /**
     * 记录目标检测结果
     */
    logDetectionResult(target: string, found: boolean, confidence?: number): void {
        const logService = getLogService();
        if (found) {
            const confStr = confidence !== undefined ? ` (${(confidence * 100).toFixed(0)}%)` : '';
            logService?.logAgent('info', `│   ✓ "${target}" 已定位${confStr}`);
        } else {
            logService?.logAgent('info', `│   ○ "${target}" 未检测到，使用全图分割`);
        }
    }
    
    /**
     * 记录分割结果
     */
    logSegmentationResult(target: string, success: boolean, info?: string): void {
        const logService = getLogService();
        if (success) {
            logService?.logAgent('info', `│   ✓ "${target}" 分割成功${info ? ` (${info})` : ''}`);
        } else {
            logService?.logAgent('warn', `│   ✗ "${target}" 分割失败${info ? `: ${info}` : ''}`);
        }
    }
}

// 导出单例实例
export const mattingLogger = MattingLogger.getInstance();
