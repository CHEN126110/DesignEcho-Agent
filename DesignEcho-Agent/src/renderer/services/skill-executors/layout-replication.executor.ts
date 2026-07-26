import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import {
    applyTemplateBlueprintToDocument
} from './layout-replication-apply';
import { autoFillAppliedTemplate } from './layout-replication-autofill';
import {
    executeLayoutMatchPlan,
    requestLayoutMatchPlan
} from './layout-replication-match';
import {
    formatLayoutReplicationUserReport,
    summarizeLayoutMatchCompletion,
    summarizeTemplateApplyCompletion
} from './layout-replication-completion';
import {
    buildLayoutMatchCoverageReport,
    buildTemplateApplyCoverageReport
} from './layout-replication-coverage';
import {
    buildReferenceReplicationQaReport,
    buildVisualQaItemsFromGeneratedScreens
} from './layout-replication-qa';
import {
    buildReferenceReplicationVisualQaReport,
    type ReferenceReplicationVisualQaReport,
    type ReferenceReplicationVisualQaVerificationReport
} from '../../../shared/reference-replication-visual-qa';
import { useAppStore } from '../../stores/app.store';
import { getModelById } from '../../../shared/config/models.config';
import { getPrimaryModelForPreferenceBucket } from '../../../shared/model-selection';
import {
    buildMinimalDesignRepresentation,
    buildReferenceParsePrompt,
    normalizeReferenceParseResult,
    parseJsonObject,
    type MinimalDesignRepresentation
} from '../../../shared/reference-replication';
import {
    buildReferenceReplicationDesignAgentOsRecord
} from '../../../shared/design-agent-os-contracts';
import {
    buildPlannerExecutionPreflightGate,
    buildReferenceReplicationPlannerContext,
    comparePlannerExecutionPlanToExecutor
} from './design-planner-context';
import {
    buildReferenceReplicationBlueprint
} from '../../../shared/reference-replication-blueprint';
import {
    resolveReferenceReplicationOutputIntent
} from '../../../shared/reference-replication-output-intent';
import {
    buildRuntimeDeliveryReceipt
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import { readPhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    resolveLayoutReplicationAutoCanvasSize
} from './layout-replication-canvas';
import { emitSkillStep } from './skill-step-events';

const REFERENCE_PARSE_TARGET_MAX_TOKENS = 12000;

function layoutReplicationToNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * 将聚合 Skill 的最终目标文档身份提升到 workflow 外层结果。Runtime 只会把这些
 * 标准字段转换成不透明指纹，用来把本次写入与后续读回绑定；不会记录名称或路径。
 */
function buildLayoutReplicationTargetContext(documentInfo: any): {
    documentId?: number | string;
    documentName?: string;
} {
    const rawId = documentInfo?.documentId ?? documentInfo?.docId ?? documentInfo?.id;
    const documentId = typeof rawId === 'number' && Number.isFinite(rawId)
        ? rawId
        : (typeof rawId === 'string' && rawId.trim() ? rawId.trim() : undefined);
    const rawName = documentInfo?.documentName ?? documentInfo?.name;
    const documentName = typeof rawName === 'string' && rawName.trim()
        ? rawName.trim()
        : undefined;
    return {
        ...(documentId !== undefined ? { documentId } : {}),
        ...(documentName ? { documentName } : {})
    };
}

function buildLayoutReplicationDeliveryResult(success: boolean, finalDocumentInfo?: any): {
    runtimeDeliveryReceipt?: ReturnType<typeof buildRuntimeDeliveryReceipt>;
} {
    if (!success) return {};
    const sourceHistoryStateRef = readPhotoshopHistoryStateRef(finalDocumentInfo);
    return {
        runtimeDeliveryReceipt: buildRuntimeDeliveryReceipt({
            status: 'ready',
            outputs: ['editable_design_document', 'replication_report'],
            resultRefs: [
                'workflow:layout-replication:document-change',
                'workflow:layout-replication:replication-report'
            ],
            sourceHistoryStateRef
        })
    };
}

function resolveReferenceParseMaxTokens(modelId: string): number {
    const configuredMax = Number(getModelById(modelId)?.maxTokens || 0);
    const providerMax = Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : REFERENCE_PARSE_TARGET_MAX_TOKENS;
    return Math.max(4096, Math.min(providerMax, REFERENCE_PARSE_TARGET_MAX_TOKENS));
}

async function readReferenceImageSize(base64OrDataUrl: string, mediaType = 'image/jpeg'): Promise<{ width: number; height: number } | null> {
    const source = String(base64OrDataUrl || '').trim();
    if (!source || typeof Image === 'undefined') return null;
    const dataUrl = source.startsWith('data:')
        ? source
        : `data:${mediaType};base64,${source}`;

    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const width = Math.round(image.naturalWidth || image.width || 0);
            const height = Math.round(image.naturalHeight || image.height || 0);
            resolve(width > 0 && height > 0 ? { width, height } : null);
        };
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

type ReferenceOverlayCapture = {
    result?: any;
    visualQa?: ReferenceReplicationVisualQaReport;
};

type RedactedOverlaySnapshotResult = {
    success: boolean;
    error?: string;
    errors?: Array<{
        screenId?: number;
        screenName?: string;
        screenIndex?: number;
        error?: string;
    }>;
    summaryText: string;
    snapshotCount: number;
    overlayCount: number;
    redacted: true;
    verificationReport?: ReferenceReplicationVisualQaVerificationReport;
    snapshots: Array<{
        screenId?: number;
        screenName?: string;
        screenIndex?: number;
        width?: number;
        height?: number;
        base64Bytes?: number;
        base64Hidden: true;
    }>;
};

function shouldCaptureReferenceOverlaySnapshots(params: Record<string, any>): boolean {
    if (params.includeOverlaySnapshots === true || params.includeScreenSnapshotsWithOverlay === true) return true;
    const visualValidation = String(params.visualValidation || '').trim().toLowerCase();
    return visualValidation === 'overlay'
        || visualValidation === 'overlays'
        || visualValidation === 'deep'
        || visualValidation === 'screenshot'
        || visualValidation === 'screenshots';
}

function pixelBoxToOverlayRect(box?: { left: number; top: number; width: number; height: number }): { left: number; top: number; right: number; bottom: number } | undefined {
    if (!box) return undefined;
    const left = Number(box.left);
    const top = Number(box.top);
    const width = Number(box.width);
    const height = Number(box.height);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(left + width),
        bottom: Math.round(top + height)
    };
}

function summarizeOverlaySnapshotResult(result: any, overlayCount: number): RedactedOverlaySnapshotResult {
    const rawSnapshots = Array.isArray(result?.snapshots)
        ? result.snapshots
        : Array.isArray(result?.screens)
            ? result.screens
            : Array.isArray(result?.images)
                ? result.images
                : [];
    const snapshots = rawSnapshots.map((snapshot: any) => {
        const base64 = typeof snapshot?.base64 === 'string'
            ? snapshot.base64
            : typeof snapshot?.imageData === 'string'
                ? snapshot.imageData
                : '';
        return {
            screenId: snapshot?.screenId,
            screenName: snapshot?.screenName,
            screenIndex: snapshot?.screenIndex,
            width: Number.isFinite(Number(snapshot?.width)) ? Number(snapshot.width) : undefined,
            height: Number.isFinite(Number(snapshot?.height)) ? Number(snapshot.height) : undefined,
            base64Bytes: base64 ? Math.round(base64.length * 0.75) : undefined,
            base64Hidden: true as const
        };
    });
    const snapshotCount = snapshots.length;
    const success = result?.success !== false && snapshotCount > 0;
    const errors = Array.isArray(result?.errors)
        ? result.errors.map((item: any) => ({
            screenId: item?.screenId,
            screenName: item?.screenName,
            screenIndex: item?.screenIndex,
            error: item?.error
        }))
        : undefined;
    return {
        success,
        error: result?.error || (snapshotCount === 0 ? 'Overlay tool returned no snapshots.' : undefined),
        errors,
        summaryText: !success
            ? `Overlay 截图采集失败：${result?.error || '未返回任何截图'}`
            : `Overlay 截图采集完成：${snapshotCount} 张截图，${overlayCount} 项标注。截图 base64 已从普通消息结果中隐藏。`,
        snapshotCount,
        overlayCount,
        redacted: true,
        snapshots
    };
}

async function captureReferenceOverlaySnapshotsIfRequested(
    generatedScreens: Awaited<ReturnType<typeof applyTemplateBlueprintToDocument>>['generatedScreens'],
    params: Record<string, any>,
    callbacks: SkillExecuteParams['callbacks']
): Promise<ReferenceOverlayCapture> {
    const visualQaItems = buildVisualQaItemsFromGeneratedScreens(generatedScreens);
    if (!shouldCaptureReferenceOverlaySnapshots(params)) {
        return {};
    }

    const screens = (generatedScreens || [])
        .filter((screen) => screen.bounds && screen.bounds.width > 0 && screen.bounds.height > 0)
        .map((screen) => ({
            id: screen.id,
            name: screen.name,
            index: screen.index,
            bounds: screen.bounds
        }));

    const placements = (generatedScreens || []).flatMap((screen) => ([
        ...(screen.copyPlaceholders || []).map((placeholder) => ({
            screenId: screen.id,
            placeholderLayerId: placeholder.layerId,
            placeholderLayerName: placeholder.layerName,
            actualLayerId: placeholder.layerId,
            actualLayerName: placeholder.layerName,
            targetBounds: pixelBoxToOverlayRect(placeholder.bounds),
            actualBounds: pixelBoxToOverlayRect(placeholder.actualBounds)
        })),
        ...(screen.imagePlaceholders || []).map((placeholder) => ({
            screenId: screen.id,
            placeholderLayerId: placeholder.layerId,
            placeholderLayerName: placeholder.layerName,
            actualLayerId: placeholder.layerId,
            actualLayerName: placeholder.layerName,
            targetBounds: pixelBoxToOverlayRect(placeholder.bounds),
            actualBounds: pixelBoxToOverlayRect(placeholder.actualBounds || placeholder.bounds)
        }))
    ])).filter((placement) => placement.targetBounds || placement.actualBounds);

    if (screens.length === 0) {
        return {
            visualQa: buildReferenceReplicationVisualQaReport({
                items: visualQaItems,
                snapshotObservation: {
                    source: 'getScreenSnapshotsWithOverlay',
                    snapshotCount: 0,
                    overlayCount: placements.length,
                    notes: ['overlay skipped: no generated screen bounds available']
                }
            })
        };
    }

    callbacks?.onMessage?.('正在采集参考图复刻 overlay 截图检查...');
    callbacks?.onToolStart?.('getScreenSnapshotsWithOverlay');
    try {
        const result = await executeToolCall('getScreenSnapshotsWithOverlay', {
            screens,
            placements,
            maxWidth: layoutReplicationToNumber(params.overlayMaxWidth, 1200)
        });
        const redactedResult = summarizeOverlaySnapshotResult(result, placements.length);
        const snapshotCount = Array.isArray(result?.snapshots)
            ? result.snapshots.length
            : Array.isArray(result?.screens)
                ? result.screens.length
                : 0;
        const overlayNotes: string[] = [];
        if (result?.success === false) {
            overlayNotes.push(`overlay capture failed: ${result.error || 'unknown error'}`);
        }
        if (snapshotCount === 0) {
            overlayNotes.push('overlay capture returned no snapshots');
        }
        const visualQa = buildReferenceReplicationVisualQaReport({
            items: visualQaItems,
            snapshotObservation: {
                source: 'getScreenSnapshotsWithOverlay',
                snapshotCount,
                overlayCount: placements.length,
                notes: overlayNotes.length > 0 ? overlayNotes : undefined
            }
        });
        callbacks?.onToolComplete?.('getScreenSnapshotsWithOverlay', {
            ...redactedResult,
            verificationReport: visualQa.verificationReport
        });
        return {
            result: {
                ...redactedResult,
                verificationReport: visualQa.verificationReport
            },
            visualQa
        };
    } catch (error: any) {
        const message = error?.message || String(error);
        const visualQa = buildReferenceReplicationVisualQaReport({
            items: visualQaItems,
            snapshotObservation: {
                source: 'getScreenSnapshotsWithOverlay',
                snapshotCount: 0,
                overlayCount: placements.length,
                notes: [`overlay capture failed: ${message}`]
            }
        });
        callbacks?.onToolComplete?.('getScreenSnapshotsWithOverlay', {
            ...summarizeOverlaySnapshotResult({ success: false, error: message }, placements.length),
            verificationReport: visualQa.verificationReport
        });
        return {
            visualQa
        };
    }
}

export const layoutReplicationExecutor: SkillExecutor = {
    skillId: 'layout-replication',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const emitStep = (
            kind: 'observation' | 'model_request' | 'verification' | 'warning' | 'finalizing',
            title: string,
            detail?: string,
            status: 'pending' | 'running' | 'success' | 'error' = 'running'
        ) => emitSkillStep(callbacks, { kind, title, detail, status });

        emitStep(
            'observation',
            '准备参考图复刻',
            '读取参考图输入，并确认输出模式与执行路径。'
        );
        callbacks?.onMessage?.('正在分析参考图布局...');

        let refImage: string | undefined = context?.attachedImageData;
        if (!refImage && params.referenceImage) {
            let paramImage = params.referenceImage as string;
            if (paramImage.startsWith('data:')) {
                const base64Match = paramImage.match(/base64,(.+)/);
                if (base64Match) paramImage = base64Match[1];
            }
            refImage = paramImage;
        }

        if (!refImage) {
            return {
                success: false,
                message: '缺少参考图。请提供一张参考图后再执行。',
                error: 'No reference image provided'
            };
        }

        const outputMode = String(params.outputMode || '').toLowerCase();
        const templateApplyMode = outputMode === 'template_apply' || params.templateApply === true;
        const templateBlueprintOnly = outputMode === 'template_blueprint' || params.templateBlueprintOnly === true;
        const userInputForOs = String(params.userIntent || context?.userInput || '').trim();
        const outputIntent = resolveReferenceReplicationOutputIntent({
            artifactKind: params.artifactKind,
            userIntent: userInputForOs
        });

        try {
            emitStep(
                'model_request',
                '调用视觉模型解析参考图',
                '将参考图解析为结构化元素、画布和基础样式描述。'
            );
            callbacks?.onToolStart?.('analyzeReferenceLayout');
            callbacks?.onMessage?.('正在调用视觉模型分析元素结构...');

            const modelPreferences = useAppStore.getState().modelPreferences;
            const visionModel = getPrimaryModelForPreferenceBucket(modelPreferences, 'visualAnalyze', {
                mode: modelPreferences?.mode,
                includeFallback: modelPreferences?.autoFallback,
                includeCrossTaskBackups: false,
                requireVision: true
            }) || 'google-gemini-3-flash';
            const referenceImageSize = await readReferenceImageSize(refImage, 'image/jpeg');
            const referenceParseMaxTokens = resolveReferenceParseMaxTokens(visionModel);

            const analysisPrompt = buildReferenceParsePrompt();

            const analysisResponse = await window.designEcho.chat(visionModel, [
                { role: 'system', content: '你是专业电商设计布局分析助手，只输出 JSON。' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: analysisPrompt },
                        { type: 'image', image: { data: refImage, mediaType: 'image/jpeg' } }
                    ]
                }
            ], { maxTokens: referenceParseMaxTokens, temperature: 0.1 });

            const parsedAnalysis = parseJsonObject(analysisResponse?.text || '');
            if (parsedAnalysis && referenceImageSize) {
                parsedAnalysis.canvasSize = referenceImageSize;
            }
            const referenceParse = normalizeReferenceParseResult(parsedAnalysis);
            const designRepresentation = referenceParse
                ? buildMinimalDesignRepresentation(referenceParse)
                : null;
            if (!referenceParse || !designRepresentation || !Array.isArray(designRepresentation.elements) || designRepresentation.elements.length === 0) {
                emitStep(
                    'verification',
                    '参考图解析失败',
                    '视觉模型结果无法转换为可执行元素结构。',
                    'error'
                );
                callbacks?.onToolComplete?.('analyzeReferenceLayout', {
                    success: false,
                    error: 'Failed to parse layout analysis',
                    modelId: visionModel,
                    maxTokens: referenceParseMaxTokens,
                    responseTextLength: String(analysisResponse?.text || '').length,
                    thinkingChars: String(analysisResponse?.thinking || '').length,
                    usage: analysisResponse?.usage || null
                });
                return {
                    success: false,
                    message: '无法识别参考图中的有效元素。建议更清晰的参考图后重试。',
                    error: 'Failed to parse layout analysis'
                };
            }

            callbacks?.onToolComplete?.('analyzeReferenceLayout', {
                success: true,
                elementCount: designRepresentation.elements.length,
                canvasSize: designRepresentation.canvas,
                modelId: visionModel,
                maxTokens: referenceParseMaxTokens,
                responseTextLength: String(analysisResponse?.text || '').length,
                thinkingChars: String(analysisResponse?.thinking || '').length,
                usage: analysisResponse?.usage || null,
                canvasSource: referenceImageSize ? 'decoded-reference-image' : 'model-output'
            });
            emitStep(
                'verification',
                '参考图结构解析完成',
                `识别元素 ${designRepresentation.elements.length} 个，画布 ${designRepresentation.canvas.width}x${designRepresentation.canvas.height}。`,
                'success'
            );

            callbacks?.onMessage?.(`识别到 ${designRepresentation.elements.length} 个元素`);
            if (designRepresentation.layout.designIntent) {
                callbacks?.onMessage?.(`设计意图: ${designRepresentation.layout.designIntent}`);
            }

            const plannerPreflight = buildReferenceReplicationPlannerContext({
                userInput: userInputForOs,
                params,
                context,
                representation: designRepresentation,
                mode: 'reference_preflight'
            });
            const plannerPreflightAlignment = comparePlannerExecutionPlanToExecutor(plannerPreflight, [
                'readDesignContext',
                'composeDesignDsl',
                'verifyDesignResult'
            ]);
            const designPlannerPreflightGate = buildPlannerExecutionPreflightGate(plannerPreflight, {
                stage: 'reference-replication-before-blueprint'
            });
            emitStep(
                'verification',
                '参考图复刻计划已生成',
                `Planner readiness=${plannerPreflight.output.readiness}；gate=${designPlannerPreflightGate.decision}；计划步骤 ${plannerPreflight.output.executionPlan.steps.length} 个；对齐 ${plannerPreflightAlignment.status}。`,
                designPlannerPreflightGate.shouldExecute ? 'success' : 'error'
            );
            if (!designPlannerPreflightGate.shouldExecute) {
                return {
                    success: false,
                    message: [
                        designPlannerPreflightGate.decision === 'request_context'
                            ? '参考图复刻缺少必要上下文，未进入 Photoshop 执行。'
                            : '参考图复刻计划被阻断，未进入 Photoshop 执行。',
                        ...designPlannerPreflightGate.blockers,
                        ...designPlannerPreflightGate.warnings
                    ].filter(Boolean).join('\n'),
                    error: designPlannerPreflightGate.reason,
                    data: {
                        referenceParse,
                        designRepresentation,
                        layoutAnalysis: referenceParse,
                        designPlanner: plannerPreflight,
                        designPlannerPreflightGate,
                        designPlannerExecutionAlignment: plannerPreflightAlignment
                    }
                };
            }

            const templateBlueprint = buildReferenceReplicationBlueprint(
                designRepresentation,
                outputIntent
            );
            const blueprintQa = buildReferenceReplicationQaReport({
                stage: 'template-blueprint',
                representation: designRepresentation,
                blueprintScreens: templateBlueprint.screens,
                outputTopology: outputIntent.topology
            });
            emitStep(
                'verification',
                '模板蓝图已生成',
                `形成 ${templateBlueprint.screens.length} 个版面单元；QA：${blueprintQa.summary}`,
                'success'
            );

            if (templateBlueprintOnly && !templateApplyMode) {
                const screenCount = templateBlueprint.screens.length;
                const previewTypes = templateBlueprint.screens.slice(0, 6).map(s => s.type).join(' / ');
                const toolResults = [{
                    toolName: 'layout-template-blueprint',
                    result: {
                        success: true,
                        layoutType: templateBlueprint.layoutType,
                        screenCount,
                        outputIntent,
                        qaReport: blueprintQa
                    }
                }];
                const designAgentOs = buildReferenceReplicationDesignAgentOsRecord({
                    userInput: userInputForOs,
                    representation: designRepresentation,
                    qaReport: blueprintQa,
                    toolResults,
                    success: true,
                    mode: 'template_blueprint'
                });
                const designPlanner = buildReferenceReplicationPlannerContext({
                    userInput: userInputForOs,
                    params,
                    context,
                    representation: designRepresentation,
                    mode: 'template_blueprint'
                });
                const designPlannerExecutionAlignment = comparePlannerExecutionPlanToExecutor(designPlanner, [
                    'readDesignContext',
                    'composeDesignDsl',
                    'buildTemplateBlueprint',
                    'verifyDesignResult'
                ]);

                return {
                    success: true,
                    message: [
                        `${outputIntent.artifactLabel}参考结构蓝图生成完成`,
                        `识别元素: ${designRepresentation.elements.length}`,
                        `版面单元: ${screenCount}`,
                        `QA: ${blueprintQa.summary}`,
                        previewTypes ? `结构预览: ${previewTypes}` : ''
                    ].filter(Boolean).join('\n'),
                    data: {
                        referenceParse,
                        designRepresentation,
                        layoutAnalysis: referenceParse,
                        outputIntent,
                        referenceBlueprint: templateBlueprint,
                        templateBlueprint,
                        qaReport: blueprintQa,
                        designAgentOs,
                        designPlanner,
                        designPlannerPreflight: plannerPreflight,
                        designPlannerPreflightGate,
                        designPlannerExecutionAlignment
                    },
                    toolResults
                };
            }

            if (templateApplyMode) {
                emitStep(
                    'observation',
                    '准备落地模板骨架',
                    '检查当前 Photoshop 文档，必要时自动创建目标画布。'
                );
                let docInfo = await executeToolCall('getDocumentInfo', {});
                let createDocumentResult: any = null;
                if (!docInfo?.success && params.autoCreateDocument !== false) {
                    const canvasSize = resolveLayoutReplicationAutoCanvasSize({
                        params,
                        referenceCanvas: designRepresentation.canvas,
                        fallback: outputIntent.fallbackCanvas,
                        profile: outputIntent.canvasProfile
                    });
                    callbacks?.onMessage?.(`未检测到文档，自动创建${outputIntent.artifactLabel}画布 ${canvasSize.width}x${canvasSize.height}`);
                    createDocumentResult = await executeToolCall('createDocument', {
                        width: canvasSize.width,
                        height: canvasSize.height,
                        name: outputIntent.documentName,
                        backgroundColor: 'white'
                    });
                    docInfo = await executeToolCall('getDocumentInfo', {});
                }

                if (!docInfo?.success) {
                    return {
                        success: false,
                        message: '请先打开一个 Photoshop 文档，或开启 autoCreateDocument。',
                        error: 'No document for template apply'
                    };
                }

                const canvas = {
                    width: Math.max(1, Math.round(layoutReplicationToNumber(docInfo.width, outputIntent.fallbackCanvas.width))),
                    height: Math.max(1, Math.round(layoutReplicationToNumber(docInfo.height, outputIntent.fallbackCanvas.height)))
                };

                callbacks?.onMessage?.(`开始落地${outputIntent.artifactLabel}参考骨架到文档: ${docInfo.name} (${canvas.width}x${canvas.height})`);
                emitStep(
                    'observation',
                    `开始创建可编辑${outputIntent.artifactLabel}参考骨架`,
                    `目标文档：${docInfo.name}，画布 ${canvas.width}x${canvas.height}。`
                );
                const applyResult = await applyTemplateBlueprintToDocument(
                    templateBlueprint,
                    canvas,
                    callbacks,
                    signal
                );
                emitStep(
                    'verification',
                    '模板骨架创建完成',
                    `创建图层 ${applyResult.createdLayers} 个，失败操作 ${applyResult.failedOps} 个。`,
                    applyResult.success ? 'success' : 'error'
                );

                const projectPath = String(
                    params.projectPath || useAppStore.getState().currentProject?.path || ''
                ).trim();
                const autoFillAfterApply = outputIntent.autoFillStrategy === 'detail-page'
                    && params.autoFillAfterApply !== false;
                let autoFillResult: Awaited<ReturnType<typeof autoFillAppliedTemplate>> | null = null;

                if (autoFillAfterApply && applyResult.generatedScreens.length > 0) {
                    if (projectPath) {
                        emitStep(
                            'observation',
                            '开始自动选图填充',
                            `项目路径：${projectPath}`
                        );
                        callbacks?.onMessage?.(`开始自动选图填充（项目: ${projectPath}）`);
                        autoFillResult = await autoFillAppliedTemplate(
                            applyResult.generatedScreens,
                            projectPath,
                            callbacks,
                            signal,
                            {
                                minPlanScore: params.minAutoFillPlanScore,
                                minImageCoverage: params.minAutoFillImageCoverage,
                                allowLowConfidenceFill: params.allowLowConfidenceFill !== false
                            }
                        );
                        emitStep(
                            'verification',
                            '自动选图填充完成',
                            `填充屏 ${autoFillResult.filledScreens} 个，失败屏 ${autoFillResult.failedScreens} 个。`,
                            autoFillResult.failedScreens > 0 ? 'error' : 'success'
                        );
                    } else {
                        emitStep(
                            'warning',
                            '跳过自动选图填充',
                            '缺少 projectPath，无法从项目素材中自动匹配图片。',
                            'success'
                        );
                        callbacks?.onMessage?.('已跳过自动填充：缺少 projectPath（请传入或先导入项目）');
                    }
                }

                emitStep(
                    'verification',
                    '准备生成复刻验收报告',
                    '汇总覆盖率、样式 recipe、自动填充和可选 overlay 截图检查。'
                );
                const overlayCapture = await captureReferenceOverlaySnapshotsIfRequested(
                    applyResult.generatedScreens,
                    params,
                    callbacks
                );
                const coverage = buildTemplateApplyCoverageReport({
                    blueprintScreens: templateBlueprint.screens,
                    generatedScreens: applyResult.generatedScreens,
                    elementResults: applyResult.elementResults,
                    failedOps: applyResult.failedOps
                });

                const applyQa = buildReferenceReplicationQaReport({
                    stage: 'template-applied',
                    representation: designRepresentation,
                    blueprintScreens: templateBlueprint.screens,
                    outputTopology: outputIntent.topology,
                    generatedScreens: applyResult.generatedScreens,
                    applyStats: {
                        screenCount: applyResult.screenCount,
                        createdLayers: applyResult.createdLayers,
                        failedOps: applyResult.failedOps,
                        styleRecipeStats: applyResult.styleRecipeStats
                    },
                    coverage,
                    autoFillStats: autoFillResult ? {
                        filledScreens: autoFillResult.filledScreens,
                        failedScreens: autoFillResult.failedScreens,
                        guardedScreens: autoFillResult.guardedScreens,
                        filledImages: autoFillResult.filledImages
                    } : undefined,
                    visualQa: overlayCapture.visualQa
                });

                const applySummary = summarizeTemplateApplyCompletion({
                    headingSuccess: `${outputIntent.artifactLabel}可编辑复刻骨架已生成`,
                    headingReview: `${outputIntent.artifactLabel}复刻骨架部分生成，需复核`,
                    baseSuccess: applyResult.success,
                    screenCount: applyResult.screenCount,
                    createdLayers: applyResult.createdLayers,
                    rootGroupName: applyResult.rootGroupName,
                    failedOps: applyResult.failedOps,
                    styleRecipeStats: applyResult.styleRecipeStats,
                    coverage,
                    qaSummary: applyQa.summary,
                    autoFill: autoFillResult,
                    visualQa: applyQa.visualQa
                });
                emitStep(
                    'finalizing',
                    '模板复刻结果已汇总',
                    applySummary.completionContract?.summary || applySummary.heading,
                    applySummary.success ? 'success' : 'error'
                );

                const finalDocumentInfo = applySummary.success
                    ? await executeToolCall('getDocumentInfo', {})
                    : undefined;
                const deliveryDocumentInfo = finalDocumentInfo?.success !== false
                    ? finalDocumentInfo
                    : undefined;
                const toolResults = [...(createDocumentResult ? [{
                    toolName: 'createDocument',
                    result: createDocumentResult
                }] : []), {
                    toolName: 'layout-template-apply',
                    result: {
                        ...applyResult,
                        qaReport: applyQa,
                        completionContract: applySummary.completionContract
                    }
                }, ...(overlayCapture.result ? [{
                    toolName: 'getScreenSnapshotsWithOverlay',
                    result: overlayCapture.result
                }] : []), ...(autoFillResult ? [{
                    toolName: 'layout-template-autofill',
                    result: autoFillResult
                }] : []), ...(finalDocumentInfo ? [{
                    toolName: 'getDocumentInfo',
                    result: finalDocumentInfo
                }] : [])];
                const designAgentOs = buildReferenceReplicationDesignAgentOsRecord({
                    userInput: userInputForOs,
                    representation: designRepresentation,
                    qaReport: applyQa,
                    completionContract: applySummary.completionContract,
                    toolResults,
                    success: applySummary.success,
                    mode: 'template_apply'
                });
                const designPlanner = buildReferenceReplicationPlannerContext({
                    userInput: userInputForOs,
                    params,
                    context,
                    representation: designRepresentation,
                    docInfo: deliveryDocumentInfo || docInfo,
                    projectPath,
                    mode: 'template_apply'
                });
                const designPlannerExecutionAlignment = comparePlannerExecutionPlanToExecutor(designPlanner, [
                    'readDesignContext',
                    'composeDesignDsl',
                    'applyTemplateBlueprint',
                    autoFillResult ? 'selectAsset' : '',
                    autoFillResult ? 'placeAsset' : '',
                    'verifyDesignResult'
                ].filter(Boolean));

                return {
                    success: applySummary.success,
                    message: formatLayoutReplicationUserReport(applySummary.userReport, applySummary.messageLines),
                    data: {
                        ...buildLayoutReplicationTargetContext(deliveryDocumentInfo || docInfo),
                        ...buildLayoutReplicationDeliveryResult(applySummary.success, deliveryDocumentInfo),
                        referenceParse,
                        designRepresentation,
                        layoutAnalysis: referenceParse,
                        outputIntent,
                        referenceBlueprint: templateBlueprint,
                        templateBlueprint,
                        createdDocument: createDocumentResult?.success === true,
                        applyResult,
                        autoFillResult,
                        overlaySnapshotResult: overlayCapture.result,
                        projectPathUsed: projectPath || undefined,
                        qaReport: applyQa,
                        completionContract: applySummary.completionContract,
                        referenceReplicationReport: applySummary.userReport,
                        designAgentOs,
                        designPlanner,
                        designPlannerPreflight: plannerPreflight,
                        designPlannerPreflightGate,
                        designPlannerExecutionAlignment
                    },
                    toolResults
                };
            }

            if (signal?.aborted) {
                return { success: true, cancelled: true, message: '已停止' };
            }

            const docCheckResult = await executeToolCall('getDocumentInfo', {});
            if (!docCheckResult?.success) {
                if (params.autoCreateDocument !== false) {
                    emitStep(
                        'observation',
                        '没有打开文档，准备自动创建复刻骨架',
                        '根据参考图画布和输出模式创建新文档。'
                    );
                    callbacks?.onMessage?.('当前没有打开文档，先根据参考图创建可编辑骨架。');
                    const canvasSize = resolveLayoutReplicationAutoCanvasSize({
                        params,
                        referenceCanvas: designRepresentation.canvas,
                        fallback: outputIntent.fallbackCanvas,
                        profile: outputIntent.canvasProfile
                    });
                    const createDocumentResult = await executeToolCall('createDocument', {
                        width: canvasSize.width,
                        height: canvasSize.height,
                        name: outputIntent.documentName,
                        backgroundColor: 'white'
                    });
                    const createdDocInfo = await executeToolCall('getDocumentInfo', {});
                    if (!createdDocInfo?.success) {
                        return {
                            success: false,
                            message: '参考图分析完成，但自动创建文档失败。',
                            error: 'Auto create document failed'
                        };
                    }

                    const applyResult = await applyTemplateBlueprintToDocument(
                        templateBlueprint,
                        {
                            width: Math.max(1, Math.round(layoutReplicationToNumber(createdDocInfo.width, canvasSize.width))),
                            height: Math.max(1, Math.round(layoutReplicationToNumber(createdDocInfo.height, canvasSize.height)))
                        },
                        callbacks,
                        signal
                    );
                    emitStep(
                        'verification',
                        '自动创建复刻骨架完成',
                        `创建图层 ${applyResult.createdLayers} 个，失败操作 ${applyResult.failedOps} 个。`,
                        applyResult.success ? 'success' : 'error'
                    );
                    const overlayCapture = await captureReferenceOverlaySnapshotsIfRequested(
                        applyResult.generatedScreens,
                        params,
                        callbacks
                    );
                    const coverage = buildTemplateApplyCoverageReport({
                        blueprintScreens: templateBlueprint.screens,
                        generatedScreens: applyResult.generatedScreens,
                        elementResults: applyResult.elementResults,
                        failedOps: applyResult.failedOps
                    });
                    const applyQa = buildReferenceReplicationQaReport({
                        stage: 'template-applied',
                        representation: designRepresentation,
                        blueprintScreens: templateBlueprint.screens,
                        outputTopology: outputIntent.topology,
                        generatedScreens: applyResult.generatedScreens,
                        applyStats: {
                            screenCount: applyResult.screenCount,
                            createdLayers: applyResult.createdLayers,
                            failedOps: applyResult.failedOps,
                            styleRecipeStats: applyResult.styleRecipeStats
                        },
                        coverage,
                        visualQa: overlayCapture.visualQa
                    });

                    const autoCreateSummary = summarizeTemplateApplyCompletion({
                        headingSuccess: `已根据参考图创建${outputIntent.artifactLabel}可编辑复刻骨架`,
                        headingReview: `${outputIntent.artifactLabel}复刻骨架部分创建，需复核`,
                        baseSuccess: applyResult.success,
                        screenCount: applyResult.screenCount,
                        createdLayers: applyResult.createdLayers,
                        rootGroupName: applyResult.rootGroupName,
                        failedOps: applyResult.failedOps,
                        styleRecipeStats: applyResult.styleRecipeStats,
                        coverage,
                        designIntent: designRepresentation.layout.designIntent,
                        qaSummary: applyQa.summary,
                        visualQa: applyQa.visualQa
                    });
                    emitStep(
                        'finalizing',
                        '自动创建复刻结果已汇总',
                        autoCreateSummary.completionContract?.summary || autoCreateSummary.heading,
                        autoCreateSummary.success ? 'success' : 'error'
                    );

                    const finalDocumentInfo = autoCreateSummary.success
                        ? await executeToolCall('getDocumentInfo', {})
                        : undefined;
                    const deliveryDocumentInfo = finalDocumentInfo?.success !== false
                        ? finalDocumentInfo
                        : undefined;
                    const toolResults = [{
                        toolName: 'createDocument',
                        result: createDocumentResult
                    }, {
                        toolName: 'layout-template-apply',
                        result: {
                            ...applyResult,
                            qaReport: applyQa,
                            completionContract: autoCreateSummary.completionContract
                        }
                    }, ...(overlayCapture.result ? [{
                        toolName: 'getScreenSnapshotsWithOverlay',
                        result: overlayCapture.result
                    }] : []), ...(finalDocumentInfo ? [{
                        toolName: 'getDocumentInfo',
                        result: finalDocumentInfo
                    }] : [])];
                    const designAgentOs = buildReferenceReplicationDesignAgentOsRecord({
                        userInput: userInputForOs,
                        representation: designRepresentation,
                        qaReport: applyQa,
                        completionContract: autoCreateSummary.completionContract,
                        toolResults,
                        success: autoCreateSummary.success,
                        mode: 'auto_create_document'
                    });
                    const designPlanner = buildReferenceReplicationPlannerContext({
                        userInput: userInputForOs,
                        params,
                        context,
                        representation: designRepresentation,
                        docInfo: deliveryDocumentInfo || createdDocInfo,
                        mode: 'auto_create_document'
                    });
                    const designPlannerExecutionAlignment = comparePlannerExecutionPlanToExecutor(designPlanner, [
                        'readDesignContext',
                        'composeDesignDsl',
                        'createCanvas',
                        'applyTemplateBlueprint',
                        'verifyDesignResult'
                    ]);

                    return {
                        success: autoCreateSummary.success,
                        message: formatLayoutReplicationUserReport(autoCreateSummary.userReport, autoCreateSummary.messageLines),
                        data: {
                            ...buildLayoutReplicationTargetContext(deliveryDocumentInfo || createdDocInfo),
                            ...buildLayoutReplicationDeliveryResult(autoCreateSummary.success, deliveryDocumentInfo),
                            referenceParse,
                            designRepresentation,
                            layoutAnalysis: referenceParse,
                            outputIntent,
                            referenceBlueprint: templateBlueprint,
                            templateBlueprint,
                            createdDocument: createDocumentResult?.success === true,
                            applyResult,
                            overlaySnapshotResult: overlayCapture.result,
                            qaReport: applyQa,
                            completionContract: autoCreateSummary.completionContract,
                            referenceReplicationReport: autoCreateSummary.userReport,
                            designAgentOs,
                            designPlanner,
                            designPlannerPreflight: plannerPreflight,
                            designPlannerPreflightGate,
                            designPlannerExecutionAlignment
                        },
                        toolResults
                    };
                }
                return {
                    success: false,
                    message: '请先打开一个 Photoshop 文档，再执行布局复刻。',
                    error: 'No document open'
                };
            }

            const targetDoc = docCheckResult;
            callbacks?.onMessage?.(`目标文档: ${targetDoc.name} (${targetDoc.width}x${targetDoc.height})`);
            emitStep(
                'observation',
                '准备匹配当前文档图层',
                `目标文档：${targetDoc.name}，画布 ${targetDoc.width}x${targetDoc.height}。`
            );

            callbacks?.onToolStart?.('getElementMapping');
            const elementsResult = await executeToolCall('getElementMapping', {
                sortBy: 'position',
                includeHidden: false
            });
            callbacks?.onToolComplete?.('getElementMapping', elementsResult);

            if (!elementsResult?.success || !Array.isArray(elementsResult.elements) || elementsResult.elements.length === 0) {
                return {
                    success: false,
                    message: '当前文档没有可用于复刻的图层元素。',
                    error: 'No elements in document'
                };
            }

            const currentElements = elementsResult.elements;

            const matchModel = getPrimaryModelForPreferenceBucket(modelPreferences, 'layoutAnalysis', {
                mode: modelPreferences?.mode,
                includeFallback: modelPreferences?.autoFallback,
                includeCrossTaskBackups: false
            }) || 'openrouter-qwen/qwen-2.5-72b-instruct';

            emitStep(
                'model_request',
                '生成图层匹配计划',
                `当前文档元素 ${currentElements.length} 个，参考元素 ${designRepresentation.elements.length} 个。`
            );
            const matchResult = await requestLayoutMatchPlan({
                modelId: matchModel,
                designRepresentation,
                targetDoc: { width: targetDoc.width, height: targetDoc.height },
                currentElements
            });
            if (!matchResult || !Array.isArray(matchResult.matches) || matchResult.matches.length === 0) {
                emitStep(
                    'verification',
                    '没有可执行匹配计划',
                    '模型未返回可执行的图层匹配关系。',
                    'error'
                );
                const noMatchSummary = summarizeLayoutMatchCompletion({
                    hasExecutableMatches: false,
                    referenceElementCount: designRepresentation.elements.length,
                    layoutType: designRepresentation.layout.layoutType
                });
                const toolResults = [
                    { toolName: 'getElementMapping', result: elementsResult },
                    { toolName: 'layout-match-plan', result: { success: false, error: 'No executable matches' } }
                ];
                const designAgentOs = buildReferenceReplicationDesignAgentOsRecord({
                    userInput: userInputForOs,
                    representation: designRepresentation,
                    qaReport: blueprintQa,
                    completionContract: noMatchSummary.completionContract,
                    toolResults,
                    success: noMatchSummary.success,
                    mode: 'match_no_executable_plan'
                });
                const designPlanner = buildReferenceReplicationPlannerContext({
                    userInput: userInputForOs,
                    params,
                    context,
                    representation: designRepresentation,
                    docInfo: targetDoc,
                    mode: 'match_no_executable_plan'
                });
                const designPlannerExecutionAlignment = comparePlannerExecutionPlanToExecutor(designPlanner, [
                    'readDesignContext',
                    'composeDesignDsl',
                    'executeLayoutMatchPlan',
                    'verifyDesignResult'
                ]);
                return {
                    success: noMatchSummary.success,
                    message: formatLayoutReplicationUserReport(noMatchSummary.userReport, noMatchSummary.messageLines),
                    error: noMatchSummary.error,
                    data: {
                        referenceParse,
                        designRepresentation,
                        layoutAnalysis: referenceParse,
                        outputIntent,
                        referenceBlueprint: templateBlueprint,
                        templateBlueprint,
                        currentElements,
                        completionContract: noMatchSummary.completionContract,
                        referenceReplicationReport: noMatchSummary.userReport,
                        designAgentOs,
                        designPlanner,
                        designPlannerPreflight: plannerPreflight,
                        designPlannerPreflightGate,
                        designPlannerExecutionAlignment
                    }
                };
            }
            emitStep(
                'verification',
                '图层匹配计划已生成',
                `匹配项 ${matchResult.matches.length} 个。`,
                'success'
            );

            const executionResult = await executeLayoutMatchPlan({
                matchResult,
                currentElements,
                targetDoc: { width: targetDoc.width, height: targetDoc.height },
                callbacks,
                signal
            });
            if (executionResult.cancelled) {
                return { success: true, cancelled: true, message: '已停止' };
            }

            const { successCount, failCount } = executionResult;
            emitStep(
                'verification',
                '图层匹配执行完成',
                `成功 ${successCount} 个，失败 ${failCount} 个。`,
                failCount > 0 ? 'error' : 'success'
            );
            const coverage = buildLayoutMatchCoverageReport({
                representation: designRepresentation,
                matchResult,
                executionResults: executionResult.results
            });
            const matchQa = buildReferenceReplicationQaReport({
                stage: 'matched',
                representation: designRepresentation,
                blueprintScreens: templateBlueprint.screens,
                outputTopology: outputIntent.topology,
                matchResult,
                matchExecution: {
                    successCount,
                    failCount
                },
                coverage
            });

            const matchSummary = summarizeLayoutMatchCompletion({
                hasExecutableMatches: true,
                referenceElementCount: designRepresentation.elements.length,
                successCount,
                failCount,
                coverage,
                matchSummary: matchResult.summary,
                qaSummary: matchQa.summary
            });
            emitStep(
                'finalizing',
                '图层匹配结果已汇总',
                matchSummary.completionContract?.summary || matchSummary.heading,
                matchSummary.success ? 'success' : 'error'
            );

            const finalDocumentInfo = matchSummary.success
                ? await executeToolCall('getDocumentInfo', {})
                : undefined;
            const deliveryDocumentInfo = finalDocumentInfo?.success !== false
                ? finalDocumentInfo
                : undefined;
            const toolResults = [{
                toolName: 'layout-replication',
                result: { successCount, failCount, qaReport: matchQa, completionContract: matchSummary.completionContract }
            }, ...(finalDocumentInfo ? [{
                toolName: 'getDocumentInfo',
                result: finalDocumentInfo
            }] : [])];
            const designAgentOs = buildReferenceReplicationDesignAgentOsRecord({
                userInput: userInputForOs,
                representation: designRepresentation,
                qaReport: matchQa,
                completionContract: matchSummary.completionContract,
                toolResults,
                success: matchSummary.success,
                mode: 'match_existing_document'
            });
            const designPlanner = buildReferenceReplicationPlannerContext({
                userInput: userInputForOs,
                params,
                context,
                representation: designRepresentation,
                docInfo: deliveryDocumentInfo || targetDoc,
                mode: 'match_existing_document'
            });
            const designPlannerExecutionAlignment = comparePlannerExecutionPlanToExecutor(designPlanner, [
                'readDesignContext',
                'composeDesignDsl',
                'executeLayoutMatchPlan',
                'verifyDesignResult'
            ]);

            return {
                success: matchSummary.success,
                message: formatLayoutReplicationUserReport(matchSummary.userReport, matchSummary.messageLines),
                toolResults,
                data: {
                    ...buildLayoutReplicationTargetContext(deliveryDocumentInfo || targetDoc),
                    ...buildLayoutReplicationDeliveryResult(matchSummary.success, deliveryDocumentInfo),
                    referenceParse,
                    designRepresentation,
                    layoutAnalysis: referenceParse,
                    outputIntent,
                    referenceBlueprint: templateBlueprint,
                    templateBlueprint,
                    matchResult,
                    qaReport: matchQa,
                    completionContract: matchSummary.completionContract,
                    referenceReplicationReport: matchSummary.userReport,
                    designAgentOs,
                    designPlanner,
                    designPlannerPreflight: plannerPreflight,
                    designPlannerPreflightGate,
                    designPlannerExecutionAlignment
                }
            };
        } catch (replicationError: any) {
            return {
                success: false,
                message: `布局复刻失败: ${replicationError.message}`,
                error: replicationError.message
            };
        }
    }
};
