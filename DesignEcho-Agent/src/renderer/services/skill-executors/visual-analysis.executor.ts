import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { normalizeImageMediaType, stripImageDataUrl } from '../../../shared/design-image-input';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

export const visualAnalysisExecutor: SkillExecutor = {
    skillId: 'visual-analysis',

    async execute({ params, callbacks, context }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onProgress?.('准备视觉分析', 8);
        callbacks?.onMessage?.('正在进行视觉分析。');

        // 路由层存在 current-document/currentDocument 等历史变体，统一归一化
        const rawSourceType = String(params.sourceType || 'active_document');
        let sourceType: string;
        if (/^(current[-_]?document|active[-_]?document)$/i.test(rawSourceType)) {
            sourceType = 'active_document';
        } else if (/^(attached[-_]?image|base64)$/i.test(rawSourceType)) {
            sourceType = 'attached_image';
        } else {
            sourceType = rawSourceType;
        }
        let analysisResult;
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备视觉分析',
            detail: `数据源: ${sourceType}；分析焦点: ${params.analysisFocus || '未指定'}`,
            status: 'running',
            percent: 8
        });

        try {
            if (sourceType === 'attached_image') {
                const attachedImage = resolveAttachedImage(context);
                if (!attachedImage) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未开始',
                        detail: '本轮消息没有可读取的附件图片。',
                        status: 'error',
                        issue: 'Attached image is required for attached_image source'
                    });
                    return {
                        success: false,
                        message: '本轮消息没有可读取的附件图片。',
                        error: 'Attached image is required for attached_image source'
                    };
                }

                callbacks?.onProgress?.('读取用户上传图片', 24);
                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析用户图片',
                    detail: attachedImage.name
                        ? `附件: ${attachedImage.name}`
                        : `读取本轮第 1 张附件图片${attachedImage.total > 1 ? `（共 ${attachedImage.total} 张）` : ''}；不暴露 base64 内容。`,
                    status: 'running',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 34
                });
                const analysisHint = [
                    params.analysisFocus || 'general',
                    '分析用户本轮上传的图片，而不是 Photoshop 当前画布。',
                    '请描述画面主体、商品或物体、材质、颜色、构图、场景以及可用于后续设计判断的视觉特征。'
                ].join('\n');
                const result = await (window as any).designEcho.invoke(
                    'visual:analyzeBase64Image',
                    attachedImage.data,
                    analysisHint,
                    attachedImage.mediaType
                );

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '用户图片视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeBase64Image',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '用户图片视觉分析完成',
                    detail: attachedImage.name || '已读取本轮第 1 张附件图片',
                    status: 'success',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 82
                });
            } else if (sourceType === 'local_file') {
                const filePath = params.filePath;
                if (!filePath) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未开始',
                        detail: 'local_file 数据源缺少文件路径。',
                        status: 'error',
                        issue: 'File path is required for local_file source'
                    });
                    return { success: false, message: '缺少本地文件路径', error: 'File path is required for local_file source' };
                }

                callbacks?.onProgress?.('读取本地图片文件', 24);
                callbacks?.onMessage?.(`读取本地文件: ${filePath}`);
                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析本地图片',
                    detail: `文件: ${filePath}`,
                    status: 'running',
                    toolName: 'visual:analyzeLocalImage',
                    percent: 34
                });

                // Call IPC directly for local file analysis
                const result = await (window as any).designEcho.invoke('visual:analyzeLocalImage', filePath, params.analysisFocus);

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '本地图片视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeLocalImage',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '本地图片视觉分析完成',
                    detail: `文件: ${filePath}`,
                    status: 'success',
                    toolName: 'visual:analyzeLocalImage',
                    percent: 78
                });

            } else if (sourceType === 'layer') {
                callbacks?.onProgress?.('定位目标图层', 24);
                const targetLayerId = Number(params.layerId);
                const targetLayerName = String(params.layerName || '').trim();
                let layerRef: {
                    id: number;
                    name?: string;
                    kind?: string;
                    path?: string;
                } | null = Number.isFinite(targetLayerId) && targetLayerId > 0
                    ? { id: targetLayerId, name: targetLayerName || undefined }
                    : null;

                if (!layerRef && !targetLayerName) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未开始',
                        detail: 'layer 数据源缺少 layerId 或 layerName。',
                        status: 'error',
                        issue: 'layerId or layerName is required for layer source'
                    });
                    return {
                        success: false,
                        message: '缺少目标图层。请提供图层名称或图层 ID。',
                        error: 'layerId or layerName is required for layer source'
                    };
                }

                if (!layerRef) {
                    const docInfo = await executeObservedSkillTool(
                        callbacks,
                        'getDocumentInfo',
                        {},
                        executeToolCall,
                        '读取当前活动文档，确认图层查找范围。'
                    );
                    const currentDocumentName = extractCurrentDocumentName(docInfo);
                    emitSkillStep(callbacks, {
                        kind: 'tool_started',
                        title: '定位目标图层',
                        detail: `在当前文档${currentDocumentName ? `「${currentDocumentName}」` : ''}中按名称查找图层: ${targetLayerName}`,
                        status: 'running',
                        toolName: 'findLayers',
                        percent: 26
                    });
                    let findResult = await executeObservedSkillTool(
                        callbacks,
                        'findLayers',
                        {
                            nameEquals: targetLayerName,
                            includeBounds: true,
                            limit: 5
                        },
                        executeToolCall,
                        '按用户提供的图层名定位目标图片图层。'
                    );
                    let candidates = normalizeLayerCandidates(findResult);
                    if (candidates.length === 0) {
                        findResult = await executeObservedSkillTool(
                            callbacks,
                            'findLayers',
                            {
                                nameContains: targetLayerName,
                                includeBounds: true,
                                limit: 8
                            },
                            executeToolCall,
                            '精确匹配未命中，按名称包含继续定位目标图片图层。'
                        );
                        candidates = normalizeLayerCandidates(findResult);
                    }
                    if (candidates.length === 0) {
                        const scopeText = currentDocumentName ? `当前文档「${currentDocumentName}」中` : '当前文档中';
                        return {
                            success: false,
                            message: `${scopeText}没有找到名称包含「${targetLayerName}」的图层。`,
                            error: 'target layer not found'
                        };
                    }
                    const exact = candidates.find(layer => layer.name === targetLayerName) || candidates[0];
                    layerRef = exact;
                }

                if (!layerRef?.id) {
                    return {
                        success: false,
                        message: '目标图层缺少可用 ID，无法导出图层图像。',
                        error: 'target layer id unavailable'
                    };
                }

                const boundsResult = await executeObservedSkillTool(
                    callbacks,
                    'getLayerBounds',
                    { layerId: layerRef.id, includeEffects: true },
                    executeToolCall,
                    '读取目标图层边界，用于确认导出对象。'
                );

                const exportResult = await executeObservedSkillTool(
                    callbacks,
                    'exportLayerAsBase64',
                    {
                        layerId: layerRef.id,
                        mode: params.exportMode || 'imaging',
                        format: params.exportFormat || 'jpeg',
                        maxSize: Number(params.maxSize) || 1200
                    },
                    executeToolCall,
                    '导出目标图层图像供视觉模型分析。'
                );
                const exportedImage = extractLayerExportImage(exportResult);
                const exportError = extractLayerExportError(exportResult);
                if (!exportedImage.base64) {
                    return {
                        success: false,
                        message: `目标图层导出失败：${exportError || '导出结果没有可分析的图像数据'}`,
                        error: exportError || 'layer export missing image data'
                    };
                }
                const base64 = exportedImage.base64;
                if (!base64) {
                    return {
                        success: false,
                        message: '目标图层导出结果缺少图像数据。',
                        error: 'layer export missing base64 image data'
                    };
                }

                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '目标图层已导出',
                    detail: `图层: ${layerRef.name || layerRef.id}；尺寸: ${exportedImage.width || '未知'}x${exportedImage.height || '未知'}`,
                    status: 'success',
                    toolName: 'exportLayerAsBase64',
                    percent: 58
                });
                callbacks?.onProgress?.('调用视觉模型分析图层', 66);
                const boundsText = formatLayerBounds(boundsResult);
                const analysisHint = [
                    params.analysisFocus || 'elements',
                    `分析 Photoshop 指定图层「${layerRef.name || targetLayerName || layerRef.id}」中的图片内容。`,
                    layerRef.path ? `图层路径：${layerRef.path}` : '',
                    boundsText ? `图层边界：${boundsText}` : '',
                    '只描述该图层图像本身：主体、商品/物体、材质、颜色、画面内容和可用于设计判断的特征；不要把整张画布或其他图层当成分析对象。'
                ].filter(Boolean).join('\n');

                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析图层',
                    detail: `图层: ${layerRef.name || layerRef.id}；不在步骤中暴露 base64 图像内容。`,
                    status: 'running',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 68
                });
                const result = await (window as any).designEcho.invoke('visual:analyzeBase64Image', base64, analysisHint);

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '图层视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeBase64Image',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '图层视觉分析完成',
                    detail: `图层: ${layerRef.name || layerRef.id}`,
                    status: 'success',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 82
                });
            } else if (sourceType === 'active_document') {
                callbacks?.onProgress?.('获取标注快照', 24);
                callbacks?.onMessage?.('获取带元素标注的画布快照。');

                // 优先标注快照（元素编号+边框+坐标表）：视觉模型基于编号元素做空间
                // 与版式判断，而不是对裸截图泛泛而谈；失败时回退普通画布快照。
                let base64: string | undefined;
                let elementTable = '';
                let snapshotDetail = '';
                const annotated = await executeObservedSkillTool(
                    callbacks,
                    'getAnnotatedSnapshot',
                    { layerFilter: 'visual' },
                    executeToolCall,
                    '读取带元素编号标注的画布快照与元素坐标表，供视觉模型做空间与版式分析。'
                );
                if (annotated?.success && annotated.imageData) {
                    base64 = annotated.imageData;
                    const elements = Array.isArray(annotated.elements) ? annotated.elements : [];
                    elementTable = elements.slice(0, 40).map((e: any) =>
                        `${e.index}. ${e.name}（${e.kind}）位置(${e.bounds.left},${e.bounds.top}) 尺寸${e.bounds.width}×${e.bounds.height}`
                    ).join('\n');
                    snapshotDetail = `标注元素 ${elements.length} 个`;
                } else {
                    const snapshotResult = await executeObservedSkillTool(
                        callbacks,
                        'getCanvasSnapshot',
                        {},
                        executeToolCall,
                        '标注快照不可用，回退读取普通画布快照。'
                    );
                    if (!snapshotResult?.success) {
                        const snapshotError = extractToolFailureMessage(
                            snapshotResult,
                            'Photoshop 没有返回可用的画布快照。'
                        );
                        emitSkillStep(callbacks, {
                            kind: 'verification',
                            title: '视觉分析未完成',
                            detail: `获取画布快照失败：${snapshotError}`,
                            status: 'error',
                            toolName: 'getCanvasSnapshot',
                            issue: snapshotError
                        });
                        return {
                            success: false,
                            message: `获取画布快照失败：${snapshotError}`,
                            error: snapshotError
                        };
                    }
                    base64 = snapshotResult.snapshot?.base64
                        ?? snapshotResult.data?.base64
                        ?? (typeof snapshotResult.data === 'string' ? snapshotResult.data : undefined);
                    snapshotDetail = `快照尺寸: ${snapshotResult.snapshot?.width || '未知'}x${snapshotResult.snapshot?.height || '未知'}`;
                }

                if (!base64) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未完成',
                        detail: '快照结果缺少 base64 图像数据。',
                        status: 'error',
                        toolName: 'getCanvasSnapshot',
                        issue: 'Invalid snapshot data'
                    });
                    return { success: false, message: '快照数据无效，请确保 Photoshop 中有打开的文档', error: 'Invalid snapshot data' };
                }

                callbacks?.onProgress?.('调用视觉模型分析', 62);
                callbacks?.onMessage?.('正在调用视觉模型分析。');
                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析画布',
                    detail: `基于${elementTable ? '标注快照（编号元素）' : '画布快照'}进行视觉分析；不在步骤中暴露 base64 图像内容。`,
                    status: 'running',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 64
                });

                // 标注模式下把元素坐标表并入分析提示，让视觉结论落到具体编号元素
                const analysisHint = elementTable
                    ? [
                        params.analysisFocus || 'general',
                        '画面中的元素已用彩色边框和编号标注，编号对应以下元素表（位置为文档像素坐标）：',
                        elementTable,
                        '请基于编号元素给出具体的空间/版式结论（如「元素3 与元素1 左边缘相差 24px，建议对齐」），不要泛泛而谈。'
                    ].join('\n')
                    : params.analysisFocus;
                const result = await (window as any).designEcho.invoke('visual:analyzeBase64Image', base64, analysisHint);

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '画布视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeBase64Image',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '画布视觉分析完成',
                    detail: snapshotDetail,
                    status: 'success',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 82
                });
            } else {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '视觉分析数据源不支持',
                    detail: `不支持的数据源类型: ${sourceType}`,
                    status: 'error',
                    issue: `Unsupported source type: ${sourceType}`
                });
                return {
                    success: false,
                    message: `不支持的数据源类型: ${sourceType}`,
                    error: `Unsupported source type: ${sourceType}`
                };
            }

            const report = buildVisualAnalysisReport(analysisResult);
            const analysisFormat = analysisResult?.analysisFormat === 'text' ? '文本' : '结构化';
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '视觉分析报告已生成',
                detail: `返回格式: ${analysisFormat}；风格: ${analysisResult?.style || '未单独返回'}；元素数: ${Array.isArray(analysisResult?.elements) ? analysisResult.elements.length : 0}；建议数: ${Array.isArray(analysisResult?.suggestions) ? analysisResult.suggestions.length : 0}`,
                status: 'success',
                percent: 100
            });

            return {
                success: true,
                message: report,
                data: analysisResult
            };

        } catch (error: any) {
            console.error('[VisualAnalysis] Execution failed:', error);
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '视觉分析执行异常',
                detail: error?.message || String(error),
                status: 'error',
                issue: error?.message || String(error)
            });
            return {
                success: false,
                message: `视觉分析执行失败: ${error?.message || '未知错误'}`,
                error: error.message
            };
        }
    }
};

function resolveAttachedImage(context: SkillExecuteParams['context']): {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    name?: string;
    total: number;
} | null {
    const images = Array.isArray(context?.attachedImages)
        ? context.attachedImages.filter((image) => String(image?.data || '').trim())
        : [];
    if (images.length > 0) {
        const first = images[0];
        const parsed = stripImageDataUrl(first.data);
        if (!parsed.data) return null;
        return {
            data: parsed.data,
            mediaType: normalizeImageMediaType(parsed.mediaType || first.mediaType),
            name: first.name,
            total: images.length
        };
    }

    const legacyData = String(context?.attachedImageData || '').trim();
    if (!legacyData) return null;
    const parsed = stripImageDataUrl(legacyData);
    return parsed.data
        ? {
            data: parsed.data,
            mediaType: normalizeImageMediaType(parsed.mediaType),
            total: 1
        }
        : null;
}

function extractToolFailureMessage(result: any, fallback: string): string {
    const candidates = [
        result?.error,
        result?.message,
        result?.data?.error,
        result?.data?.message,
        result?.result?.error,
        result?.result?.message
    ];
    for (const candidate of candidates) {
        const message = String(candidate || '').trim();
        if (message) return message;
    }
    return fallback;
}

function buildVisualAnalysisReport(analysisResult: any): string {
    const rawAnalysis = String(analysisResult?.rawAnalysis || '').trim();
    if (analysisResult?.analysisFormat === 'text' && rawAnalysis) {
        return `### 🎨 视觉分析报告\n\n${rawAnalysis}`;
    }

    const style = String(analysisResult?.style || '').trim() || '未返回';
    const composition = String(analysisResult?.composition || '').trim() || '未返回';
    const colorPalette = normalizeReportItems(analysisResult?.colorPalette);
    const elements = normalizeReportItems(analysisResult?.elements);
    const suggestions = normalizeReportItems(analysisResult?.suggestions);
    return `### 🎨 视觉分析报告

**风格**: ${style}
**构图**: ${composition}

**配色方案**:
${formatReportItems(colorPalette, true)}

**关键元素**:
${formatReportItems(elements)}

**💡 改进建议**:
${formatReportItems(suggestions)}
`;
}

function normalizeReportItems(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(item => String(item || '').trim()).filter(Boolean)
        : [];
}

function formatReportItems(items: string[], code = false): string {
    if (items.length === 0) return '- 未返回';
    return items
        .map(item => code ? `- \`${item}\`` : `- ${item}`)
        .join('\n');
}

function normalizeLayerCandidates(result: any): Array<{ id: number; name?: string; kind?: string; path?: string }> {
    const raw = Array.isArray(result?.layers)
        ? result.layers
        : Array.isArray(result?.data?.layers)
            ? result.data.layers
            : Array.isArray(result?.matches)
                ? result.matches
                : [];
    return raw
        .map((item: any) => ({
            id: Number(item?.id ?? item?.layerId),
            name: typeof item?.name === 'string' ? item.name : undefined,
            kind: typeof item?.kind === 'string' ? item.kind : typeof item?.type === 'string' ? item.type : undefined,
            path: typeof item?.path === 'string' ? item.path : Array.isArray(item?.path) ? item.path.join('/') : undefined
        }))
        .filter((item: { id: number }) => Number.isFinite(item.id) && item.id > 0);
}

function extractCurrentDocumentName(result: any): string {
    const data = result?.data && typeof result.data === 'object' ? result.data : undefined;
    return String(
        result?.documentName
        || result?.name
        || result?.document?.name
        || result?.documentInfo?.name
        || data?.documentName
        || data?.name
        || data?.document?.name
        || data?.documentInfo?.name
        || ''
    ).trim();
}

function extractLayerExportImage(result: any): { base64?: string; width?: number; height?: number } {
    const payloads = collectLayerExportPayloads(result);
    for (const payload of payloads) {
        const base64 = payload?.base64
            ?? payload?.imageData
            ?? (typeof payload?.data === 'string' ? payload.data : undefined);
        if (typeof base64 === 'string' && base64.trim()) {
            return {
                base64,
                width: Number(payload?.width) || undefined,
                height: Number(payload?.height) || undefined
            };
        }
    }
    return {};
}

function extractLayerExportError(result: any): string {
    const payloads = collectLayerExportPayloads(result);
    for (const payload of payloads) {
        const error = typeof payload?.error === 'string' ? payload.error.trim() : '';
        if (error) return error;
        const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
        if (payload?.success === false && message) return message;
    }
    return '';
}

function collectLayerExportPayloads(result: any): any[] {
    const payloads: any[] = [];
    const seen = new Set<any>();

    function visit(value: any, depth: number): void {
        if (depth > 5 || value === null || value === undefined) return;
        if (typeof value === 'string') {
            const parsed = parseLayerExportJsonPayload(value);
            if (parsed) visit(parsed, depth + 1);
            return;
        }
        if (typeof value !== 'object') return;
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item, depth + 1);
            }
            return;
        }
        if (seen.has(value)) return;
        seen.add(value);
        payloads.push(value);

        if (Array.isArray(value.content)) {
            for (const item of value.content) {
                visit(item, depth + 1);
                if (typeof item?.text === 'string') visit(item.text, depth + 1);
            }
        }
        if (typeof value.text === 'string') visit(value.text, depth + 1);
        if (value.data !== undefined) visit(value.data, depth + 1);
        if (value.result !== undefined) visit(value.result, depth + 1);
        if (value.payload !== undefined) visit(value.payload, depth + 1);
    }

    visit(result, 0);
    return payloads;
}

function parseLayerExportJsonPayload(text: string): any | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function formatLayerBounds(result: any): string {
    const bounds = result?.bounds || result?.data?.bounds || result?.boundsNoEffects || result?.data?.boundsNoEffects;
    if (!bounds || typeof bounds !== 'object') return '';
    const left = Number(bounds.left ?? bounds.x);
    const top = Number(bounds.top ?? bounds.y);
    const width = Number(bounds.width ?? (Number(bounds.right) - left));
    const height = Number(bounds.height ?? (Number(bounds.bottom) - top));
    if (![left, top, width, height].every(Number.isFinite)) return '';
    return `x=${Math.round(left)}，y=${Math.round(top)}，宽=${Math.round(width)}，高=${Math.round(height)}`;
}
