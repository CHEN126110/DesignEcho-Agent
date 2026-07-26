/**
 * 获取文档信息工具
 */

import { Tool, ToolSchema, DocumentInfo } from '../types';
import {
    observeActiveDocumentAtHistoryState,
    PhotoshopDocumentObservationError
} from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';

export class GetDocumentInfoTool implements Tool {
    name = 'getDocumentInfo';

    schema: ToolSchema = {
        name: 'getDocumentInfo',
        description: '获取当前文档的基本信息和当前活动图层',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(_params: {}): Promise<{
        success: boolean;
        observedAt: string;
        documentState: 'present' | 'absent' | 'unknown';
        document?: DocumentInfo;
        historyStateRef?: PhotoshopHistoryStateRef;
        errorCode?: 'no_active_document'
            | 'history_state_unavailable'
            | 'document_changed_during_observation'
            | 'get_document_info_failed';
        /** 瞬时故障（PS 正忙/模态/超时）时为 true，提示上游可稍后重试而不是判定无文档。 */
        retryable?: boolean;
        error?: string;
    }> {
        try {
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 读取文档信息',
                unavailableMessage: '无法读取 Photoshop 文档历史版本，请重新读取当前文档。',
                changedMessage: '读取文档信息期间 Photoshop 文档发生变化，请重新读取当前文档。'
            }, (doc) => {
                let layerCount = 0;
                this.countLayers(doc, (count) => { layerCount = count; });
                const activeLayer = doc.activeLayers?.[0];
                const documentInfo: DocumentInfo = {
                    id: doc.id,
                    name: doc.name,
                    width: doc.width,
                    height: doc.height,
                    resolution: doc.resolution,
                    colorMode: this.getColorModeName(doc.mode),
                    layerCount,
                    ...(activeLayer ? {
                        activeLayerId: activeLayer.id,
                        activeLayerName: activeLayer.name
                    } : {})
                };
                return documentInfo;
            });

            return {
                success: true,
                // Host 观察时间戳：Renderer 不能把排队/传输结束时间伪装成 Photoshop 观察时间。
                observedAt: new Date().toISOString(),
                documentState: 'present',
                document: observation.value,
                historyStateRef: observation.historyStateRef
            };

        } catch (error) {
            console.error('[GetDocumentInfo] Error:', error);
            const observationCode = error instanceof PhotoshopDocumentObservationError
                ? error.code
                : undefined;
            const rawMessage = error instanceof Error ? error.message : '获取文档信息失败';
            // executeAsModal 拒绝（PS 正忙、原生弹窗、超时）是瞬时故障：透出可重试语义，
            // 文案不得包含「没有打开的文档」字样——上游会按该字样判定无文档并禁止复核。
            const busyLike = !observationCode
                && /modal|模态|正在处理其他命令|host is busy|timed? ?out|超时|busy/i.test(String(rawMessage));
            return {
                success: false,
                observedAt: new Date().toISOString(),
                documentState: observationCode === 'no_active_document' ? 'absent' : 'unknown',
                errorCode: observationCode || 'get_document_info_failed',
                error: busyLike
                    ? `Photoshop 正忙或处于模态状态，暂时无法读取文档信息；这不代表文档不存在，请稍后重试。原始信息：${rawMessage}`
                    : rawMessage,
                ...(busyLike ? { retryable: true } : {})
            };
        }
    }

    /**
     * 递归统计图层数量
     */
    private countLayers(container: any, callback: (count: number) => void): number {
        let count = 0;
        for (const layer of container.layers) {
            count++;
            if (layer.layers) {
                count += this.countLayers(layer, () => {});
            }
        }
        callback(count);
        return count;
    }

    /**
     * 获取颜色模式名称
     */
    private getColorModeName(mode: any): string {
        const modeMap: Record<string, string> = {
            'RGBColorMode': 'RGB',
            'CMYKColorMode': 'CMYK',
            'grayscaleMode': '灰度',
            'bitmapMode': '位图',
            'labColorMode': 'Lab',
            'indexedColorMode': '索引颜色',
            'duotoneMode': '双色调'
        };
        return modeMap[mode] || mode?.toString() || '未知';
    }
}
