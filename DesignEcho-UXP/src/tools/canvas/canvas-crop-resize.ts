/**
 * 画布裁切 / 画布大小 / 图像大小工具
 *
 * 电商高频操作：主图按平台尺寸裁边、改画布留白、整图缩放。
 * 三者都直接改文档几何（破坏性），写前必须先读文档（执行点 preflight 强制），
 * 写后统一读回真实尺寸作为结果，不信任参数回显。
 * 所有写操作都带 dialogOptions:'dontDisplay'，避免命令不可用时 Photoshop 弹出原生模态框。
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

interface GeometryResult {
    success: boolean;
    documentId?: number;
    width?: number;
    height?: number;
    clamped?: boolean;
    message?: string;
    error?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function pixels(value: number): { _unit: string; _value: number } {
    return { _unit: 'pixelsUnit', _value: value };
}

const CANVAS_ANCHORS: Record<string, { horizontal: string; vertical: string }> = {
    center: { horizontal: 'center', vertical: 'center' },
    topLeft: { horizontal: 'left', vertical: 'top' },
    top: { horizontal: 'center', vertical: 'top' },
    topRight: { horizontal: 'right', vertical: 'top' },
    left: { horizontal: 'left', vertical: 'center' },
    right: { horizontal: 'right', vertical: 'center' },
    bottomLeft: { horizontal: 'left', vertical: 'bottom' },
    bottom: { horizontal: 'center', vertical: 'bottom' },
    bottomRight: { horizontal: 'right', vertical: 'bottom' }
};

/** 裁切文档画布到指定矩形（单位像素，文档左上角为原点）。 */
export class CropDocumentTool implements Tool {
    name = 'cropDocument';

    schema = {
        name: 'cropDocument',
        description: '把当前文档画布裁切到指定矩形（像素，破坏性：矩形外的像素与画布区域被移除）。适合主图按平台比例裁边；改画布留白请用 resizeCanvas。',
        parameters: {
            type: 'object' as const,
            properties: {
                top: { type: 'number', description: '裁切矩形上边界（像素，相对文档左上角）' },
                left: { type: 'number', description: '裁切矩形左边界（像素）' },
                bottom: { type: 'number', description: '裁切矩形下边界（像素）' },
                right: { type: 'number', description: '裁切矩形右边界（像素）' }
            },
            required: ['top', 'left', 'bottom', 'right']
        }
    };

    async execute(params: { top?: number; left?: number; bottom?: number; right?: number }): Promise<GeometryResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法裁切画布。', params });
        }

        const docWidth = Number(doc.width) || 0;
        const docHeight = Number(doc.height) || 0;
        let left = clampInt(params.left, 0, docWidth, NaN);
        let top = clampInt(params.top, 0, docHeight, NaN);
        let right = clampInt(params.right, 0, docWidth, NaN);
        let bottom = clampInt(params.bottom, 0, docHeight, NaN);
        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
            return createToolFailureResult({
                toolName: this.name,
                error: `裁切矩形参数无效：top/left/bottom/right 都必须是数字。收到 ${JSON.stringify(params)}`,
                params
            });
        }
        const clamped = left !== Math.round(Number(params.left))
            || top !== Math.round(Number(params.top))
            || right !== Math.round(Number(params.right))
            || bottom !== Math.round(Number(params.bottom));
        if (right - left < 1 || bottom - top < 1) {
            return createToolFailureResult({
                toolName: this.name,
                error: `裁切矩形为空：right-left 与 bottom-top 都必须 ≥1 像素。当前文档 ${docWidth}x${docHeight}，收到 [${left},${top}]-[${right},${bottom}]。`,
                params
            });
        }

        try {
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'crop',
                        to: {
                            _obj: 'rectangle',
                            top: pixels(top),
                            left: pixels(left),
                            bottom: pixels(bottom),
                            right: pixels(right)
                        },
                        angle: { _unit: 'angleUnit', _value: 0 },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 裁切画布' });

            return {
                success: true,
                documentId: doc.id,
                width: Number(doc.width),
                height: Number(doc.height),
                clamped,
                message: `已把画布裁切为 ${Number(doc.width)}x${Number(doc.height)}。${clamped ? '（矩形超出文档边界的部分已自动收敛到文档内。）' : ''}可用 getDocumentSnapshot 复核构图。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

/** 修改画布大小（不动图像像素缩放，边缘锚点决定留白/裁掉的方向）。 */
export class ResizeCanvasTool implements Tool {
    name = 'resizeCanvas';

    schema = {
        name: 'resizeCanvas',
        description: '修改当前文档画布大小（像素）：放大=按锚点方向留白，缩小=按锚点反方向裁掉边缘内容（破坏性）。要缩放整图像素请用 resizeImage。',
        parameters: {
            type: 'object' as const,
            properties: {
                width: { type: 'number', description: '目标画布宽度（像素）' },
                height: { type: 'number', description: '目标画布高度（像素）' },
                anchor: {
                    type: 'string',
                    enum: ['center', 'topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'],
                    description: '原内容锚点位置，默认 center。例如 topLeft 表示原内容固定在左上，新增留白出现在右下。'
                }
            },
            required: ['width', 'height']
        }
    };

    async execute(params: { width?: number; height?: number; anchor?: string }): Promise<GeometryResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法修改画布大小。', params });
        }

        const width = clampInt(params.width, 1, 300000, NaN);
        const height = clampInt(params.height, 1, 300000, NaN);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return createToolFailureResult({
                toolName: this.name,
                error: `画布尺寸参数无效：width/height 都必须是正整数像素。收到 ${JSON.stringify(params)}`,
                params
            });
        }
        const anchor = CANVAS_ANCHORS[String(params.anchor || 'center')] || CANVAS_ANCHORS.center;

        try {
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'canvasSize',
                        width: pixels(width),
                        height: pixels(height),
                        horizontal: { _enum: 'horizontalLocation', _value: anchor.horizontal },
                        vertical: { _enum: 'verticalLocation', _value: anchor.vertical },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 修改画布大小' });

            return {
                success: true,
                documentId: doc.id,
                width: Number(doc.width),
                height: Number(doc.height),
                message: `画布已调整为 ${Number(doc.width)}x${Number(doc.height)}（锚点 ${params.anchor || 'center'}）。缩小画布会裁掉锚点反方向的边缘内容，可用 getDocumentSnapshot 复核。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

/** 缩放整图像素（图像大小）。 */
export class ResizeImageTool implements Tool {
    name = 'resizeImage';

    schema = {
        name: 'resizeImage',
        description: '缩放当前文档的整图像素（图像大小，破坏性重采样）。只给宽或高时按比例自动换算；要改画布留白/裁边请用 resizeCanvas / cropDocument。',
        parameters: {
            type: 'object' as const,
            properties: {
                width: { type: 'number', description: '目标宽度（像素），与 height 至少给一个' },
                height: { type: 'number', description: '目标高度（像素），与 width 至少给一个' },
                resample: {
                    type: 'string',
                    enum: ['auto', 'bicubic', 'bicubicSmoother', 'bicubicSharper', 'bilinear', 'nearestNeighbor'],
                    description: '重采样算法，默认 auto。放大建议 bicubicSmoother，缩小建议 bicubicSharper。'
                }
            }
        }
    };

    async execute(params: { width?: number; height?: number; resample?: string }): Promise<GeometryResult> {
        const doc = app.activeDocument as any;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档，无法缩放图像。', params });
        }

        const oldWidth = Number(doc.width) || 0;
        const oldHeight = Number(doc.height) || 0;
        const hasWidth = Number.isFinite(Number(params.width)) && Number(params.width) >= 1;
        const hasHeight = Number.isFinite(Number(params.height)) && Number(params.height) >= 1;
        if (!hasWidth && !hasHeight) {
            return createToolFailureResult({
                toolName: this.name,
                error: `缩放参数无效：width/height 至少给一个正整数像素。收到 ${JSON.stringify(params)}`,
                params
            });
        }
        const width = hasWidth ? Math.round(Number(params.width)) : Math.max(1, Math.round(oldWidth * (Number(params.height) / oldHeight)));
        const height = hasHeight ? Math.round(Number(params.height)) : Math.max(1, Math.round(oldHeight * (Number(params.width) / oldWidth)));

        const { constants } = require('photoshop');
        const resampleMap: Record<string, unknown> = {
            auto: constants.ResampleMethod.AUTOMATIC,
            bicubic: constants.ResampleMethod.BICUBIC,
            bicubicSmoother: constants.ResampleMethod.BICUBICSMOOTHER,
            bicubicSharper: constants.ResampleMethod.BICUBICSHARPER,
            bilinear: constants.ResampleMethod.BILINEAR,
            nearestNeighbor: constants.ResampleMethod.NEARESTNEIGHBOR
        };
        const resample = resampleMap[String(params.resample || 'auto')] || constants.ResampleMethod.AUTOMATIC;

        try {
            await core.executeAsModal(async () => {
                await doc.resizeImage(width, height, undefined, resample);
            }, { commandName: 'DesignEcho: 缩放图像' });

            return {
                success: true,
                documentId: doc.id,
                width: Number(doc.width),
                height: Number(doc.height),
                message: `整图已从 ${oldWidth}x${oldHeight} 缩放为 ${Number(doc.width)}x${Number(doc.height)}。`
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
