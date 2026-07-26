import { getVisualAnnotationService } from '../services/visual-annotation-service';
import { BinaryMessageType, createBinaryImageData, type BinaryImageData } from '../../shared/binary-protocol';
import {
    assertRawMaskGeometry,
    resolveMattingEdgeRefineMode,
    resolveMattingOutputGeometry
} from '../../shared/matting-application-contract';
import type { UXPContext } from './types';

function generateSimpleMapping(layers: any[]): string {
    const lines = ['Layer Mapping:', ''];

    for (const layer of layers) {
        let line = `[${layer.index}] ${layer.name} (${layer.kind})`;
        if (layer.textContent) {
            const preview = layer.textContent.length > 20
                ? `${layer.textContent.substring(0, 20)}...`
                : layer.textContent;
            line += ` "${preview}"`;
        }
        lines.push(line);
    }

    return lines.join('\n');
}

export function registerVisualHandlers(context: UXPContext): void {
    const { wsServer, logService, mattingService, binaryImageStore } = context;
    const MATTING_EXPORT_MAX_SIZE = 1024;
    let nextMattingBinaryResponseId = 1000000000;

    const normalizeMattingQuality = (quality?: string): 'fast' | 'balanced' | 'quality' => {
        const normalized = String(quality || '').trim().toLowerCase();
        if (normalized === 'fast' || normalized === 'quality') {
            return normalized;
        }
        return 'balanced';
    };

    const resolveMattingExportMaxSize = (quality?: string): number => {
        const normalizedQuality = normalizeMattingQuality(quality);
        if (normalizedQuality === 'fast') {
            return 896;
        }
        if (normalizedQuality === 'quality') {
            return 1280;
        }
        return MATTING_EXPORT_MAX_SIZE;
    };

    const resolveMattingImageInput = async (exportResult: any): Promise<string | BinaryImageData | null> => {
        if (typeof exportResult?.imageData === 'string' && exportResult.imageData.length >= 100) {
            return exportResult.imageData;
        }

        if (exportResult?.useBinaryTransfer && exportResult?.binaryRequestId) {
            const binaryResult = await wsServer.waitForBinaryData(exportResult.binaryRequestId, 10000);
            if (binaryResult) {
                // 二进制先于 JSON 到达时，WebSocket cache 与 legacy shared store 都会短暂持有它。
                // 本 handler 已取得唯一输入后立即清理 legacy 副本，避免大图在内存中保留 5 分钟。
                binaryImageStore.delete(Number(exportResult.binaryRequestId));
                const binaryImage = createBinaryImageData(
                    binaryResult.header.type,
                    binaryResult.imageData,
                    binaryResult.header.width,
                    binaryResult.header.height
                );
                logService?.logAgent(
                    'info',
                    `[UXP Handler] Loaded binary image from cache: ${binaryImage.format} ${binaryImage.width}x${binaryImage.height}, ${(binaryResult.imageData.length / 1024).toFixed(0)}KB`
                );
                return binaryImage;
            }
        }

        return null;
    };

    const describeMattingInput = (imageInput: string | BinaryImageData): string => {
        if (typeof imageInput === 'string') {
            return `base64 ${(imageInput.length / 1024).toFixed(0)}KB`;
        }

        return `${imageInput.format} ${imageInput.width}x${imageInput.height}, ${(imageInput.buffer.length / 1024).toFixed(0)}KB`;
    };

    const sendMattingProgress = (progress: number, message: string, stage?: string) => {
        wsServer.sendProgress('remove-background', progress, message, stage);
        logService?.logAgent(
            'info',
            `[UXP Handler] Matting progress ${progress}%${stage ? ` (${stage})` : ''}: ${message}`
        );
    };

    const mapInferenceProgress = (progress: number): number => {
        const clamped = Math.max(0, Math.min(100, progress));
        const start = 18;
        const end = 92;
        return Math.round(start + (clamped / 100) * (end - start));
    };

    const resolveMattingTargetDimensions = (exportResult: any): {
        originalWidth?: number;
        originalHeight?: number;
        originalLeft?: number;
        originalTop?: number;
        docWidth?: number;
        docHeight?: number;
    } => {
        const outputGeometry = resolveMattingOutputGeometry(
            exportResult?.originalWidth,
            exportResult?.originalHeight
        );
        const originalLeft = Number(exportResult?.originalLeft);
        const originalTop = Number(exportResult?.originalTop);
        const docWidth = Number(exportResult?.docWidth) || 0;
        const docHeight = Number(exportResult?.docHeight) || 0;

        const targetDimensions: {
            originalWidth?: number;
            originalHeight?: number;
            originalLeft?: number;
            originalTop?: number;
            docWidth?: number;
            docHeight?: number;
        } = {};

        if (outputGeometry) {
            targetDimensions.originalWidth = outputGeometry.width;
            targetDimensions.originalHeight = outputGeometry.height;
            logService?.logAgent(
                'info',
                `[UXP Handler] Full-size mask target: ${outputGeometry.width}x${outputGeometry.height} (${(outputGeometry.pixelCount / 1000000).toFixed(2)}MP)`
            );
        }

        if (Number.isFinite(originalLeft)) {
            targetDimensions.originalLeft = originalLeft;
        }

        if (Number.isFinite(originalTop)) {
            targetDimensions.originalTop = originalTop;
        }

        if (docWidth > 0 && docHeight > 0) {
            targetDimensions.docWidth = docWidth;
            targetDimensions.docHeight = docHeight;
        }

        return targetDimensions;
    };

    const buildMattingApplyPayload = (mattingResult: any, exportResult?: any) => {
        if (
            Buffer.isBuffer(mattingResult?.maskBuffer) &&
            typeof mattingResult?.maskWidth === 'number' &&
            typeof mattingResult?.maskHeight === 'number'
        ) {
            assertRawMaskGeometry(
                mattingResult.maskBuffer.length,
                mattingResult.maskWidth,
                mattingResult.maskHeight
            );
            const binaryRequestId = nextMattingBinaryResponseId++;
            if (nextMattingBinaryResponseId >= 0xffffffff) {
                nextMattingBinaryResponseId = 1000000000;
            }

            wsServer.sendBinaryData(
                BinaryMessageType.RAW_MASK,
                binaryRequestId,
                mattingResult.maskWidth,
                mattingResult.maskHeight,
                mattingResult.maskBuffer
            );

            logService?.logAgent(
                'info',
                `[UXP Handler] Sent binary RAW_MASK: requestId=${binaryRequestId}, ${mattingResult.maskWidth}x${mattingResult.maskHeight}, ${(mattingResult.maskBuffer.length / 1024).toFixed(0)}KB`
            );

            return {
                useBinaryMask: true,
                binaryRequestId,
                maskWidth: mattingResult.maskWidth,
                maskHeight: mattingResult.maskHeight,
                originalLeft: exportResult?.originalLeft,
                originalTop: exportResult?.originalTop,
                docWidth: exportResult?.docWidth,
                docHeight: exportResult?.docHeight
            };
        }

        return {
            originalLeft: exportResult?.originalLeft,
            originalTop: exportResult?.originalTop,
            docWidth: exportResult?.docWidth,
            docHeight: exportResult?.docHeight,
            maskImageBase64: mattingResult?.maskImage
        };
    };

    wsServer.registerHandler('get-visual-context', async (params: {
        maxSize?: number;
        includeHidden?: boolean;
        layerFilter?: 'all' | 'visual' | 'text';
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received visual context request');

        try {
            if (!wsServer.isPluginConnected()) {
                return { success: false, error: 'Photoshop plugin is not connected' };
            }

            const snapshotResult = await wsServer.sendRequest('getCanvasSnapshot', {
                maxSize: params.maxSize || 1200,
                format: 'jpeg',
                quality: 90
            });

            if (!snapshotResult?.success || !snapshotResult?.snapshot?.base64) {
                return {
                    success: false,
                    error: snapshotResult?.error
                        || snapshotResult?.message
                        || 'Photoshop 没有返回可用的画布快照。'
                };
            }

            const mappingResult = await wsServer.sendRequest('getElementMapping', {
                includeHidden: params.includeHidden || false,
                includeGroups: true,
                sortBy: 'position'
            });

            if (!mappingResult?.success || !mappingResult?.elements) {
                return { success: false, error: 'Failed to get element mapping' };
            }

            const snapshotWidth = snapshotResult.snapshot.width || 1;
            const snapshotHeight = snapshotResult.snapshot.height || 1;
            const documentWidth = snapshotResult.documentInfo?.width || 1;
            const documentHeight = snapshotResult.documentInfo?.height || 1;
            const widthScale = snapshotWidth / documentWidth;
            const heightScale = snapshotHeight / documentHeight;

            const layers = mappingResult.elements.map((el: any, idx: number) => ({
                id: el.id,
                index: idx + 1,
                name: el.name,
                kind: el.type,
                visible: el.visible,
                bounds: {
                    left: Math.round(el.bounds.left * widthScale),
                    top: Math.round(el.bounds.top * heightScale),
                    right: Math.round(el.bounds.right * widthScale),
                    bottom: Math.round(el.bounds.bottom * heightScale),
                    width: Math.round(el.bounds.width * widthScale),
                    height: Math.round(el.bounds.height * heightScale)
                },
                textContent: el.textContent
            }));

            const annotationService = getVisualAnnotationService();
            const annotationResult = await annotationService.annotateSnapshot(
                snapshotResult.snapshot.base64,
                layers
            );

            if (!annotationResult.success) {
                logService?.logAgent('warn', `[UXP Handler] Visual annotation failed: ${annotationResult.error}`);
                return {
                    success: true,
                    snapshot: snapshotResult.snapshot.base64,
                    layers,
                    layerMapping: generateSimpleMapping(layers),
                    documentInfo: snapshotResult.documentInfo,
                    summary: mappingResult.summary,
                    annotated: false
                };
            }

            logService?.logAgent('info', `[UXP Handler] Visual context ready with ${layers.length} layers`);

            return {
                success: true,
                snapshot: annotationResult.annotatedImage,
                layers,
                layerMapping: annotationResult.layerMapping,
                documentInfo: snapshotResult.documentInfo,
                summary: mappingResult.summary,
                annotated: true
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] Visual context failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    wsServer.registerHandler('get-matting-config', async () => {
        try {
            const serviceStatus = await mattingService?.getPythonBackendStatus();

            return {
                success: true,
                modelNameMap: {
                    birefnet: 'BiRefNet',
                    'yolo-world': 'YOLO-World'
                },
                availableModels: serviceStatus?.models || [],
                stages: [
                    { id: 'detection', name: 'Object Detection', icon: '[DET]' },
                    { id: 'segmentation', name: 'Precise Segmentation', icon: '[SEG]' }
                ],
                localOnnx: serviceStatus?.available || false
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    wsServer.registerHandler('remove-background', async (params: {
        mode?: string;
        useMask?: boolean;
        outputFormat?: string;
        quality?: string;
        targetPrompt?: string;
        enableHairRefine?: boolean;
        enableFabricRefine?: boolean;
        usePythonBackend?: boolean;
        sampleAllLayers?: boolean;
        layerId?: number;
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received panel matting request');

        if (!mattingService) {
            return { success: false, error: '抠图服务未初始化。请在设置 → 图像处理中检查本地模型状态后重试。' };
        }

        if (!wsServer.isPluginConnected()) {
            return { success: false, error: 'Photoshop 插件未连接，请先在面板完成连接。' };
        }

        const targetPrompt = params.targetPrompt || '';
        const outputFormat = params.outputFormat || 'mask';
        const sampleAllLayers = params.sampleAllLayers === true;
        const normalizedQuality = normalizeMattingQuality(params.quality);
        const exportMaxSize = resolveMattingExportMaxSize(params.quality);

        try {
            sendMattingProgress(3, '正在导出图层图像', 'prepare-export');

            logService?.logAgent('info', `[UXP Handler] Step 1: exporting layer image (sampleAllLayers=${sampleAllLayers})`);
            const exportResult = await wsServer.sendRequest('removeBackground', {
                mode: 'ai',
                layerId: params.layerId,
                targetPrompt,
                maxSize: exportMaxSize,
                // 对所有图层取样：导出图层边界内的复合图像，让模型看到完整上下文
                sampleAllLayers
            }, 60000);

            if (!exportResult?.success) {
                return {
                    success: false,
                    error: exportResult?.error || exportResult?.message || '导出图层图像失败：请确认已在 Photoshop 中选中目标图层。'
                };
            }

            const layerId = exportResult.layerId;
            const imageInput = await resolveMattingImageInput(exportResult);
            const targetDimensions = resolveMattingTargetDimensions(exportResult);

            if (!imageInput) {
                return { success: false, error: '未能获取图层图像数据：图层可能为空、被隐藏或边界无效。' };
            }

            logService?.logAgent('info', `[UXP Handler] Step 1 complete: ${describeMattingInput(imageInput)}, layerId=${layerId}`);
            sendMattingProgress(15, '图层图像就绪', 'export-ready');

            logService?.logAgent('info', '[UXP Handler] Step 2: running BiRefNet');
            const mattingResult = await mattingService.removeBackground(imageInput, {
                targetPrompt,
                quality: normalizedQuality,
                returnMask: true,
                binaryMaskOutput: true,
                edgeRefine: resolveMattingEdgeRefineMode(params, 'product-hard'),
                ...targetDimensions,
                onProgress: (progress, stage, message) => {
                    sendMattingProgress(
                        mapInferenceProgress(progress),
                        message || '正在运行分割模型',
                        stage
                    );
                }
            });

            if (!mattingResult?.success || (!mattingResult?.maskImage && !mattingResult?.maskBuffer)) {
                return {
                    success: false,
                    error: mattingResult?.error || '分割模型推理失败：未生成有效蒙版，请重试或更换抠取目标描述。'
                };
            }

            logService?.logAgent('info', `[UXP Handler] Step 2 complete: model=${mattingResult.usedModel}, duration=${mattingResult.processingTime}ms`);
            sendMattingProgress(96, '正在应用抠图结果', 'apply-mask');

            const applyPayload = buildMattingApplyPayload(mattingResult, exportResult);
            const applyResult = await wsServer.sendRequest('applyMattingResult', {
                originalLayerId: layerId,
                outputFormat,
                createNewLayer: false,
                ...applyPayload
            }, 60000);

            if (!applyResult?.success) {
                return {
                    success: false,
                    error: applyResult?.error || applyResult?.message || `应用抠图结果失败：无法在图层上创建${outputFormat === 'selection' ? '选区' : '蒙版'}。`
                };
            }

            sendMattingProgress(100, '抠图完成', 'complete');
            logService?.logAgent('info', `[UXP Handler] Matting complete: layerId=${layerId}, outputFormat=${outputFormat}`);

            return {
                success: true,
                message: '抠图完成',
                layerId,
                processingTime: mattingResult.processingTime,
                usedModel: mattingResult.usedModel
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] Matting failed: ${error.message}`);
            return { success: false, error: error.message || '抠图失败：发生未知错误，请查看日志。' };
        }
    });

    wsServer.registerHandler('remove-background-by-selection', async (params: {
        outputFormat?: string;
        targetPrompt?: string;
        bbox?: [number, number, number, number];
        box?: [number, number, number, number];
        layerId?: number;
        quality?: string;
        refineEdges?: boolean;
        enableHairRefine?: boolean;
        enableFabricRefine?: boolean;
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received selection matting request');

        if (!mattingService) {
            return { success: false, error: 'Matting service is not initialized' };
        }

        if (!wsServer.isPluginConnected()) {
            return { success: false, error: 'Photoshop plugin is not connected' };
        }

        try {
            sendMattingProgress(3, 'Preparing layer export', 'prepare-export');
            const normalizedQuality = normalizeMattingQuality(params.quality);
            const exportMaxSize = resolveMattingExportMaxSize(params.quality);

            const exportResult = await wsServer.sendRequest('removeBackground', {
                mode: 'ai',
                layerId: params.layerId,
                targetPrompt: params.targetPrompt || '',
                maxSize: exportMaxSize
            }, 60000);

            if (!exportResult?.success) {
                return { success: false, error: exportResult?.error || 'Failed to export layer image' };
            }

            const imageInput = await resolveMattingImageInput(exportResult);
            const targetDimensions = resolveMattingTargetDimensions(exportResult);
            if (!imageInput) {
                return { success: false, error: 'Failed to get layer image data' };
            }

            sendMattingProgress(15, 'Layer image is ready', 'export-ready');

            const rawSelectionBox = params.bbox || params.box;
            let selectionBox: { x1: number; y1: number; x2: number; y2: number } | undefined;
            if (
                Array.isArray(rawSelectionBox) &&
                rawSelectionBox.length === 4 &&
                Number.isFinite(exportResult?.originalLeft) &&
                Number.isFinite(exportResult?.originalTop)
            ) {
                const [left, top, right, bottom] = rawSelectionBox.map(value => Number(value));
                selectionBox = {
                    x1: left - Number(exportResult.originalLeft),
                    y1: top - Number(exportResult.originalTop),
                    x2: right - Number(exportResult.originalLeft),
                    y2: bottom - Number(exportResult.originalTop)
                };
            }

            const mattingResult = await mattingService.removeBackground(imageInput, {
                targetPrompt: params.targetPrompt || '',
                quality: normalizedQuality,
                returnMask: true,
                binaryMaskOutput: true,
                edgeRefine: resolveMattingEdgeRefineMode(params, 'standard'),
                selectionBox,
                selectionBoxSpaceWidth: Number(exportResult?.originalWidth) || undefined,
                selectionBoxSpaceHeight: Number(exportResult?.originalHeight) || undefined,
                ...targetDimensions,
                onProgress: (progress, stage, message) => {
                    sendMattingProgress(
                        mapInferenceProgress(progress),
                        message || 'Running matting model',
                        stage
                    );
                }
            });

            if (!mattingResult?.success || (!mattingResult?.maskImage && !mattingResult?.maskBuffer)) {
                return { success: false, error: mattingResult?.error || 'Segmentation inference failed' };
            }

            sendMattingProgress(96, 'Applying matting result', 'apply-mask');
            const applyPayload = buildMattingApplyPayload(mattingResult, exportResult);
            const applyResult = await wsServer.sendRequest('applyMattingResult', {
                originalLayerId: exportResult.layerId,
                outputFormat: params.outputFormat || 'mask',
                createNewLayer: false,
                ...applyPayload
            }, 60000);

            if (!applyResult?.success) {
                return { success: false, error: applyResult?.error || 'Failed to apply mask' };
            }

            sendMattingProgress(100, 'Matting completed', 'complete');

            return {
                success: true,
                message: 'Selection matting completed',
                layerId: exportResult.layerId,
                processingTime: mattingResult.processingTime
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] Selection matting failed: ${error.message}`);
            return { success: false, error: error.message || 'Selection matting failed' };
        }
    });
}
