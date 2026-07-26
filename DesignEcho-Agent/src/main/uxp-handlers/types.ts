/**
 * UXP Handlers 共享类型定义
 */

import type { WebSocketServer } from '../websocket/server';
import type { LogService } from '../services/log-service';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { MattingService } from '../services/matting-service';
import type { InpaintingService } from '../services/inpainting-service';
import type { SubjectDetectionService } from '../services/subject-detection-service';
import type { ContourService } from '../services/contour-service';
import type { SAMService } from '../services/sam-service';

/**
 * 二进制图像缓存条目（UXP 通过 ws binary frame 发来的原始像素 / 编码图像）
 */
export interface BinaryImageCacheEntry {
    /** BinaryMessageType 数值（JPEG/PNG/RAW_RGB/RAW_RGBA 等） */
    type: number;
    width: number;
    height: number;
    data: Buffer;
    timestamp: number;
}

/**
 * UXP Handler 上下文 - 包含所有可能需要的服务引用
 */
export interface UXPContext {
    wsServer: WebSocketServer;
    logService: LogService | null;
    taskOrchestrator: TaskOrchestrator | null;
    mattingService: MattingService | null;
    inpaintingService: InpaintingService | null;
    subjectDetectionService: SubjectDetectionService | null;
    contourService: ContourService | null;
    samService: SAMService | null;
    mainWindow: Electron.BrowserWindow | null;
    /**
     * 共享的二进制图像缓存（由 main/index.ts 的 setBinaryHandler 维护）。
     * UXP 通过 binary ws frame 发送原始像素 / 编码图像后，handlers 通过 requestId 拉取。
     */
    binaryImageStore: Map<number, BinaryImageCacheEntry>;
}

/**
 * UXP Handler 注册函数类型
 */
export type UXPHandlerRegistrar = (context: UXPContext) => void;

/**
 * 主体位置缓存接口
 */
export interface SubjectPositionCache {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
    timestamp: number;
}

/**
 * 发送进度通知的辅助函数类型
 */
export type SendProgressFn = (progress: number, message: string) => void;
