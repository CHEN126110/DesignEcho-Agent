/**
 * UXP Handlers 统一注册入口
 * 将原本集中在 index.ts 中的 registerUXPHandlers 逻辑按功能模块化
 */

import { registerTextHandlers } from './text-handlers';
import { registerLayoutHandlers } from './layout-handlers';
import { registerVisualHandlers } from './visual-handlers';
import { registerInpaintingHandlers } from './inpainting-handlers';
import { registerImageToImageHandlers } from './image-to-image-handlers';
import { registerBeautifyHandlers } from './beautify-handlers';
import { registerWebViewHandlers } from './webview-handlers';
import { registerTemplateLibraryHandlers } from './template-library-handlers';
import { registerSmartLayoutUXPHandlers, getSmartLayoutToolSchemas } from './smart-layout-handlers';
import { registerHarmonizationUXPHandlers, getHarmonizationToolSchemas } from './harmonization-handlers';
import { registerShapeMorphingUXPHandlers } from './shape-morphing-handlers';
import type { UXPContext } from './types';

export { UXPContext, SubjectPositionCache, SendProgressFn } from './types';
export { parseMultiTargets, generateRectContour } from './utils';
export { getSmartLayoutToolSchemas } from './smart-layout-handlers';
export { getHarmonizationToolSchemas } from './harmonization-handlers';

/**
 * 注册所有 UXP handlers
 */
export function registerUXPHandlers(context: UXPContext): void {
    // WebView 消息转发
    registerWebViewHandlers(context);

    // UXP 模板库
    registerTemplateLibraryHandlers(context);
    
// 撰写文案
    registerTextHandlers(context);
    
    // 排版分析
    registerLayoutHandlers(context);
    
    // 视觉上下文
    registerVisualHandlers(context);
    
    // 局部重绘
    registerInpaintingHandlers(context);

    // 图生图
    registerImageToImageHandlers(context);
    
    // 一键美化
    registerBeautifyHandlers(context);
    
    // 智能布局
    registerSmartLayoutUXPHandlers(context);
    
    // 图像协调
    registerHarmonizationUXPHandlers(context);

    // 形态统一
    registerShapeMorphingUXPHandlers(context);

    console.log('[UXP Handlers] 基础 handlers 注册完成');
}
