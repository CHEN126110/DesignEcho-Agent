/**
 * 获取文档截图工具
 */

import { Tool, ToolSchema } from '../types';
import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';
import {
    encodePhotoshopImageDataAsJpeg,
    toSnapshotErrorMessage
} from './snapshot-encoding';

const { imaging } = require('photoshop');

export class GetDocumentSnapshotTool implements Tool {
    name = 'getDocumentSnapshot';

    schema: ToolSchema = {
        name: 'getDocumentSnapshot',
        description: '获取当前文档的截图（缩略图），返回 base64 编码的图像数据',
        parameters: {
            type: 'object',
            properties: {
                maxWidth: {
                    type: 'number',
                    description: '最大宽度 (px)，默认 800'
                },
                maxHeight: {
                    type: 'number',
                    description: '最大高度 (px)，默认 600'
                },
                format: {
                    type: 'string',
                    description: '图像格式: "jpeg" 或 "png"，默认 "jpeg"',
                    enum: ['jpeg', 'png']
                }
            }
        }
    };

    async execute(params: {
        maxWidth?: number;
        maxHeight?: number;
        format?: 'jpeg' | 'png';
    }): Promise<{
        success: boolean;
        imageData?: string;
        width?: number;
        height?: number;
        format?: string;
        requestedFormat?: string;
        message?: string;
        historyStateRef?: PhotoshopHistoryStateRef;
        documentInfo?: {
            id: number;
            name: string;
            width: number;
            height: number;
        };
        error?: string;
    }> {
        try {
            const maxWidth = params.maxWidth || 800;
            const maxHeight = params.maxHeight || 600;
            const requestedFormat = params.format || 'jpeg';
            const outputFormat = 'jpeg';
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 获取文档截图',
                timeOut: 5,
                unavailableMessage: '无法读取 Photoshop 文档历史版本，未返回可能过期的截图。',
                changedMessage: '截图期间 Photoshop 文档发生变化，已丢弃这张不一致的截图。'
            }, async (doc) => {
                const docWidth = Number(doc.width);
                const docHeight = Number(doc.height);
                const scale = Math.min(maxWidth / docWidth, maxHeight / docHeight, 1);
                const targetWidth = Math.max(1, Math.round(docWidth * scale));
                const targetHeight = Math.max(1, Math.round(docHeight * scale));
                const pixelData = await imaging.getPixels({
                    documentID: doc.id,
                    targetSize: { width: targetWidth, height: targetHeight },
                    colorSpace: 'RGB',
                    componentSize: 8,
                    applyAlpha: true
                });

                let encoded;
                try {
                    encoded = await encodePhotoshopImageDataAsJpeg(
                        pixelData.imageData,
                        targetWidth,
                        targetHeight
                    );
                } finally {
                    pixelData.imageData.dispose();
                }

                return {
                    base64: encoded.base64,
                    outputWidth: encoded.width,
                    outputHeight: encoded.height,
                    documentInfo: {
                        id: Number(doc.id),
                        name: String(doc.name || ''),
                        width: docWidth,
                        height: docHeight
                    }
                };
            });

            return {
                success: true,
                imageData: observation.value.base64,
                width: observation.value.outputWidth,
                height: observation.value.outputHeight,
                format: outputFormat,
                requestedFormat,
                message: requestedFormat === outputFormat
                    ? undefined
                    : '已返回可预览截图，格式为 JPEG。',
                historyStateRef: observation.historyStateRef,
                documentInfo: observation.value.documentInfo
            };

        } catch (error) {
            console.error('[GetDocumentSnapshot] Error:', error);
            return {
                success: false,
                error: toSnapshotErrorMessage(error, '获取文档截图失败')
            };
        }
    }
}
