import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';

import {
    buildControlledPhotoshopTextStyleBatchPlan,
    buildControlledPhotoshopTextStyleBenchmarkReport,
    buildControlledPhotoshopTextStyleToolCallPlan,
    executeControlledPhotoshopTextStyleToolCallPlan,
    type ControlledPhotoshopTextStyleExecutionResult,
    type ControlledPhotoshopTextStyleExecutionPlan,
    type ControlledPhotoshopTextStyleTarget,
    type ControlledPhotoshopTextStyleToolCallPlan
} from '../../../shared/photoshop-controlled-text-style-execution';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

type TextLayerRecord = {
    id: number;
    name: string;
    bounds?: unknown;
    boundsNoEffects?: unknown;
    style?: {
        fontName?: string;
        fontSize?: number;
        tracking?: number;
        leading?: number;
    };
};

type TextLayerRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
};

type TextLayoutImpactSeverity = 'warning' | 'error';

type TextLayoutImpactIssue = {
    layerId: number;
    layerName: string;
    kind: 'fontSizeChanged' | 'trackingChanged' | 'leadingChanged' | 'boundsChanged' | 'boundsUnavailable';
    severity: TextLayoutImpactSeverity;
    before: number | TextLayerRect | null;
    after: number | TextLayerRect | null;
    message: string;
};

type TextLayoutImpactReview = {
    status: 'passed' | 'needs_layout_review' | 'failed_style_drift';
    checkedLayerCount: number;
    issues: TextLayoutImpactIssue[];
    canClaimTypographyLayoutPreserved: boolean;
    summary: string;
    recommendations: string[];
    primaryRecommendation?: string;
};

interface ControlledTextStyleBatchRun {
    plan: ControlledPhotoshopTextStyleExecutionPlan;
    toolCallPlan: ControlledPhotoshopTextStyleToolCallPlan;
    execution?: ControlledPhotoshopTextStyleExecutionResult;
    benchmark?: ReturnType<typeof buildControlledPhotoshopTextStyleBenchmarkReport>;
}

function normalizeFontToken(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_/]+/g, '')
        .replace(/[()（）]/g, '');
}

function fontMatchesTarget(actualValue: string, targetValues: string[]): boolean {
    const actual = normalizeFontToken(actualValue);
    if (!actual) return false;
    return targetValues.some((candidate) => normalizeFontToken(candidate) === actual);
}

function buildControlledTargets(layers: TextLayerRecord[]): ControlledPhotoshopTextStyleTarget[] {
    return layers.map((layer) => ({
        layerId: Number(layer.id),
        layerName: String(layer.name || layer.id),
        kind: 'text',
        style: {
            fontName: layer.style?.fontName
        }
    }));
}

function buildControlledBatchRun(
    input: {
        userIntent: string;
        targetLayers: TextLayerRecord[];
        requestedFont: string;
        resolvedFontCandidates: string[];
    }
): ControlledTextStyleBatchRun {
    const plan = buildControlledPhotoshopTextStyleBatchPlan({
        kind: 'text-style-batch',
        userIntent: input.userIntent,
        targets: buildControlledTargets(input.targetLayers),
        style: {
            fontName: input.requestedFont,
            acceptedFontNames: input.resolvedFontCandidates
        }
    });
    const toolCallPlan = buildControlledPhotoshopTextStyleToolCallPlan(plan);
    return {
        plan,
        toolCallPlan,
        benchmark: buildControlledPhotoshopTextStyleBenchmarkReport(plan, toolCallPlan)
    };
}

function appendResolvedFontCandidates(current: string[], requestedFont: string, resolvedFont: any): string[] {
    return Array.from(new Set([
        requestedFont,
        ...current,
        resolvedFont?.postScriptName,
        resolvedFont?.family,
        resolvedFont?.name
    ].filter(Boolean)));
}

function finiteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBounds(value: unknown): TextLayerRect | null {
    if (!value) return null;
    const raw = value as any;
    const left = finiteNumber(raw.left ?? raw[0]?.value ?? raw[0]);
    const top = finiteNumber(raw.top ?? raw[1]?.value ?? raw[1]);
    const right = finiteNumber(raw.right ?? raw[2]?.value ?? raw[2]);
    const bottom = finiteNumber(raw.bottom ?? raw[3]?.value ?? raw[3]);
    if (left === null || top === null || right === null || bottom === null) return null;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    return { left, top, right, bottom, width, height };
}

function buildTypographyPreservingTextStyleParams(
    callParams: Record<string, any>,
    currentStyle: TextLayerRecord['style'] | undefined
): Record<string, any> {
    const nextParams = { ...callParams };
    const preservedMetricKeys: Array<'fontSize' | 'tracking' | 'leading'> = ['fontSize', 'tracking', 'leading'];

    for (const key of preservedMetricKeys) {
        if (nextParams[key] !== undefined) continue;
        const currentValue = finiteNumber(currentStyle?.[key]);
        if (currentValue === null) continue;
        nextParams[key] = currentValue;
    }

    return nextParams;
}

function rectCenter(rect: TextLayerRect): { x: number; y: number } {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

function metricChanged(before: unknown, after: unknown, tolerance: number): boolean {
    const beforeValue = finiteNumber(before);
    const afterValue = finiteNumber(after);
    if (beforeValue === null || afterValue === null) return false;
    return Math.abs(beforeValue - afterValue) > tolerance;
}

function buildTextLayoutImpactReview(
    beforeLayers: TextLayerRecord[],
    afterLayers: TextLayerRecord[]
): TextLayoutImpactReview {
    const beforeById = new Map(beforeLayers.map((layer) => [Number(layer.id), layer]));
    const issues: TextLayoutImpactIssue[] = [];

    for (const afterLayer of afterLayers) {
        const layerId = Number(afterLayer.id);
        const beforeLayer = beforeById.get(layerId);
        if (!beforeLayer) continue;

        const layerName = String(afterLayer.name || beforeLayer.name || layerId);
        const stylePairs: Array<{
            key: 'fontSizeChanged' | 'trackingChanged' | 'leadingChanged';
            label: string;
            tolerance: number;
            before: unknown;
            after: unknown;
        }> = [
            { key: 'fontSizeChanged', label: '字号', tolerance: 0.5, before: beforeLayer.style?.fontSize, after: afterLayer.style?.fontSize },
            { key: 'trackingChanged', label: '字距', tolerance: 1, before: beforeLayer.style?.tracking, after: afterLayer.style?.tracking },
            { key: 'leadingChanged', label: '行距', tolerance: 0.5, before: beforeLayer.style?.leading, after: afterLayer.style?.leading }
        ];

        for (const pair of stylePairs) {
            if (!metricChanged(pair.before, pair.after, pair.tolerance)) continue;
            issues.push({
                layerId,
                layerName,
                kind: pair.key,
                severity: 'error',
                before: Number(pair.before),
                after: Number(pair.after),
                message: `${layerName} 的${pair.label}发生非预期变化。`
            });
        }

        const beforeBounds = normalizeBounds(beforeLayer.boundsNoEffects || beforeLayer.bounds);
        const afterBounds = normalizeBounds(afterLayer.boundsNoEffects || afterLayer.bounds);
        if (!beforeBounds || !afterBounds) {
            issues.push({
                layerId,
                layerName,
                kind: 'boundsUnavailable',
                severity: 'warning',
                before: beforeBounds,
                after: afterBounds,
                message: `${layerName} 缺少字体替换前后的文本边界，无法判断是否挤压版面。`
            });
        } else {
            const widthRatio = afterBounds.width / beforeBounds.width;
            const heightRatio = afterBounds.height / beforeBounds.height;
            const beforeCenter = rectCenter(beforeBounds);
            const afterCenter = rectCenter(afterBounds);
            const centerShift = Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y);
            if (widthRatio < 0.92 || widthRatio > 1.12 || heightRatio < 0.92 || heightRatio > 1.12 || centerShift > 6) {
                issues.push({
                    layerId,
                    layerName,
                    kind: 'boundsChanged',
                    severity: 'warning',
                    before: beforeBounds,
                    after: afterBounds,
                    message: `${layerName} 的文本边界变化较明显，需要复核是否影响排版。`
                });
            }
        }
    }

    const hasStyleDrift = issues.some((issue) => issue.severity === 'error');
    const hasBoundsWarning = issues.some((issue) => issue.severity === 'warning');
    const status = hasStyleDrift
        ? 'failed_style_drift'
        : hasBoundsWarning
            ? 'needs_layout_review'
            : 'passed';
    const recommendations = buildTextLayoutImpactRecommendations(issues);
    return {
        status,
        checkedLayerCount: afterLayers.length,
        issues,
        canClaimTypographyLayoutPreserved: status === 'passed',
        summary: status === 'passed'
            ? '字体写入后没有发现字号、字距、行距或文本边界的明显异常。'
            : status === 'failed_style_drift'
                ? '字体写入后发现字号、字距或行距发生非预期变化。'
                : '字体写入后文本边界有明显变化，需要复核版面。',
        recommendations,
        primaryRecommendation: recommendations[0]
    };
}

function buildTextLayoutImpactRecommendations(issues: TextLayoutImpactIssue[]): string[] {
    if (issues.length === 0) {
        return ['字体替换后的字号、字距、行距和文本边界都在安全范围内，可以继续后续设计。'];
    }

    const styleIssues = issues.filter((issue) => issue.severity === 'error');
    if (styleIssues.length > 0) {
        const layerNames = uniqueLayerNames(styleIssues).slice(0, 3).join('、');
        return [
            `${layerNames}的字号、字距或行距被改动了；应先恢复原有文字度量，再继续检查版面。`,
            '不要直接宣称字体替换完成，先确认 setTextStyle 只改字体名称，没有覆盖字号、字距或行距。'
        ];
    }

    const boundsUnavailableIssues = issues.filter((issue) => issue.kind === 'boundsUnavailable');
    if (boundsUnavailableIssues.length > 0) {
        const layerNames = uniqueLayerNames(boundsUnavailableIssues).slice(0, 3).join('、');
        return [
            `${layerNames}缺少文本边界读回；字体已写入，但还不能判断是否换行、溢出或挤压相邻元素。`,
            '下一步应先读回文本图层边界或在当前版面中复核文本框，再确认字体替换是否可以交付。'
        ];
    }

    const boundsIssues = issues.filter((issue) => issue.kind === 'boundsChanged');
    const layerNames = uniqueLayerNames(boundsIssues).slice(0, 3).join('、');
    return [
        `${layerNames}的文字占位发生明显变化；需要检查是否挤压相邻元素、超出安全留白或破坏标题层级。`,
        '下一步应在当前版面中复核文本框宽高、字号、字距和换行位置，必要时重新调整排版后再交付。'
    ];
}

function uniqueLayerNames(issues: TextLayoutImpactIssue[]): string[] {
    const names: string[] = [];
    for (const issue of issues) {
        const name = String(issue.layerName || issue.layerId).trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names.length > 0 ? names : ['相关文本图层'];
}

export const textFontReplaceExecutor: SkillExecutor = {
    skillId: 'text-font-replace',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];
        const requestedFont = String(params.fontName || '').trim();
        const includeHidden = params.includeHidden === true;
        const userIntent = String(context?.userInput || params.userIntent || '').trim();
        const explicitLayerIds = Array.isArray(params.layerIds)
            ? params.layerIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item))
            : [];

        if (!requestedFont) {
            return {
                success: false,
                message: '缺少目标字体名称。',
                error: 'fontName is required'
            };
        }

        const callTool = (toolName: string, toolParams: Record<string, any>, detail?: string) => {
            return executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, detail);
        };

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备批量字体替换',
            detail: explicitLayerIds.length > 0
                ? `目标字体：${requestedFont}，指定图层数：${explicitLayerIds.length}`
                : `目标字体：${requestedFont}，范围：全部文本图层`,
            status: 'running'
        });
        callbacks?.onProgress?.('读取文本图层', 0.08);
        callbacks?.onStatus?.('正在读取当前文档中的文本图层。');

        const textLayersResult = await callTool('getAllTextLayers', { includeHidden }, '读取可修改的文本图层。');
        results.push({ toolName: 'getAllTextLayers', result: textLayersResult });

        const allTextLayers: TextLayerRecord[] = Array.isArray(textLayersResult?.layers)
            ? textLayersResult.layers
            : [];

        if (!textLayersResult?.success) {
            return {
                success: false,
                message: '读取文本图层失败，请确认 Photoshop 文档状态后再重试。',
                error: textLayersResult?.error || 'getAllTextLayers failed',
                toolResults: results
            };
        }

        const targetLayers = explicitLayerIds.length > 0
            ? allTextLayers.filter((layer) => explicitLayerIds.includes(Number(layer.id)))
            : allTextLayers;

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '文本图层范围已确认',
            detail: `候选文本图层 ${allTextLayers.length} 个，实际目标 ${targetLayers.length} 个。`,
            status: targetLayers.length > 0 ? 'success' : 'error'
        });

        if (targetLayers.length === 0) {
            return {
                success: false,
                message: '当前文档中没有可修改的文本图层。',
                error: 'no text layers',
                toolResults: results
            };
        }

        const successes: Array<{ layerId: number; layerName: string; verifiedFont?: string }> = [];
        const failures: Array<{ layerId: number; layerName: string; error: string }> = [];

        let resolvedFontCandidates: string[] = [requestedFont];
        const controlledTextStyleBatch = buildControlledBatchRun({
            userIntent,
            targetLayers,
            requestedFont,
            resolvedFontCandidates
        });

        if (controlledTextStyleBatch.plan.status !== 'ready_dry_run'
            || controlledTextStyleBatch.toolCallPlan.status !== 'ready_tool_call_plan') {
            return {
                success: false,
                message: '字体替换暂时不能执行，当前文档或目标字体条件还不完整。',
                error: controlledTextStyleBatch.plan.blockers[0]
                    || controlledTextStyleBatch.toolCallPlan.blockers[0]
                    || 'controlled text style plan is not ready',
                toolResults: results,
                data: {
                    requestedFont,
                    controlledTextStyleBatch
                }
            };
        }

        let controlledCallIndex = 0;
        const controlledExecution = await executeControlledPhotoshopTextStyleToolCallPlan(
            controlledTextStyleBatch.toolCallPlan,
            {
                runToolCall: async (call) => {
                    controlledCallIndex += 1;
                    const layer = targetLayers.find((item) => Number(item.id) === Number(call.params.layerId));
                    const layerName = String(layer?.name || call.params.layerId);

                    callbacks?.onProgress?.(
                        `修改字体 ${controlledCallIndex}/${targetLayers.length}`,
                        0.15 + ((controlledCallIndex - 1) / Math.max(1, targetLayers.length)) * 0.65
                    );
                    callbacks?.onStatus?.(`正在修改字体：${layerName}`);

                    if (signal?.aborted) {
                        return {
                            success: false,
                            error: 'font replacement cancelled'
                        };
                    }

                    const styleParams = buildTypographyPreservingTextStyleParams(call.params, layer?.style);
                    const styleResult = await callTool(
                        'setTextStyle',
                        styleParams,
                        `图层：${layerName}，目标字体：${String(styleParams.fontName || requestedFont)}`
                    );
                    results.push({ toolName: `setTextStyle[${call.params.layerId}]`, result: styleResult });

                    if (!styleResult?.success) {
                        const error = String(styleResult?.error || 'setTextStyle failed');
                        failures.push({
                            layerId: Number(call.params.layerId),
                            layerName,
                            error
                        });
                        return {
                            success: false,
                            error,
                            data: styleResult
                        };
                    }

                    resolvedFontCandidates = appendResolvedFontCandidates(
                        resolvedFontCandidates,
                        requestedFont,
                        styleResult?.resolvedFont
                    );

                    const verifiedFont = String(styleResult?.verifiedFont || '').trim();
                    if (!fontMatchesTarget(verifiedFont, resolvedFontCandidates)) {
                        const error = `字体写入未验证通过，实际字体：${verifiedFont || '未知'}`;
                        failures.push({
                            layerId: Number(call.params.layerId),
                            layerName,
                            error
                        });
                        return {
                            success: false,
                            error,
                            data: styleResult
                        };
                    }

                    successes.push({
                        layerId: Number(call.params.layerId),
                        layerName,
                        verifiedFont
                    });
                    return {
                        success: true,
                        data: styleResult
                    };
                }
            },
            {
                liveExecutionApproved: true,
                executionTarget: 'user-approved-document',
                continueOnToolFailure: true
            }
        );
        controlledTextStyleBatch.execution = controlledExecution;
        controlledTextStyleBatch.benchmark = buildControlledPhotoshopTextStyleBenchmarkReport(
            controlledTextStyleBatch.plan,
            controlledTextStyleBatch.toolCallPlan,
            controlledExecution
        );

        if (signal?.aborted) {
            return {
                success: false,
                cancelled: true,
                message: '批量字体替换已取消。',
                toolResults: results,
                data: {
                    requestedFont,
                    completed: successes.length,
                    failed: failures,
                    controlledTextStyleBatch
                }
            };
        }

        if (controlledExecution.status === 'failed_tool_call'
            && controlledExecution.executedToolCount < controlledTextStyleBatch.toolCallPlan.toolCalls.length) {
            return {
                success: false,
                message: '字体替换执行失败，已停止并保留执行详情。',
                error: failures[0]?.error || controlledExecution.blockers[0] || 'controlled text style execution failed',
                toolResults: results,
                data: {
                    requestedFont,
                    resolvedFontCandidates,
                    totalLayers: targetLayers.length,
                    successes,
                    failures,
                    controlledTextStyleBatch
                }
            };
        }

        callbacks?.onProgress?.('复核字体结果', 0.9);
        callbacks?.onStatus?.('正在复核所有文本图层的字体结果。');

        const verificationResult = await callTool('getAllTextLayers', { includeHidden }, '复核字体写入后的文本图层状态。');
        results.push({ toolName: 'getAllTextLayers[verify]', result: verificationResult });

        if (!verificationResult?.success) {
            return {
                success: false,
                message: '字体修改后复核失败，请确认文档状态后再重试。',
                error: verificationResult?.error || 'verification failed',
                toolResults: results,
                data: {
                    requestedFont,
                    successes,
                    failures,
                    controlledTextStyleBatch
                }
            };
        }

        const verifiedLayers: TextLayerRecord[] = Array.isArray(verificationResult?.layers)
            ? verificationResult.layers
            : [];
        const verifyTargets = explicitLayerIds.length > 0
            ? verifiedLayers.filter((layer) => explicitLayerIds.includes(Number(layer.id)))
            : verifiedLayers;

        const mismatched = verifyTargets.filter((layer) => {
            const actualFont = String(layer?.style?.fontName || '').trim();
            return !fontMatchesTarget(actualFont, resolvedFontCandidates);
        });

        const finalFailures = [
            ...failures,
            ...mismatched
                .filter((layer) => !failures.some((item) => item.layerId === Number(layer.id)))
                .map((layer) => ({
                    layerId: Number(layer.id),
                    layerName: String(layer.name || layer.id),
                    error: `最终复核不匹配，当前字体：${String(layer?.style?.fontName || '').trim() || '未知'}`
                }))
        ];
        const layoutImpactReview = buildTextLayoutImpactReview(targetLayers, verifyTargets);

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '字体替换复核完成',
            detail: finalFailures.length > 0
                ? `通过 ${successes.length}/${targetLayers.length}，失败 ${finalFailures.length}。`
                : `通过 ${targetLayers.length}/${targetLayers.length}。`,
            status: finalFailures.length > 0 ? 'error' : 'success'
        });

        if (finalFailures.length > 0
            || layoutImpactReview.status === 'failed_style_drift'
            || layoutImpactReview.status === 'needs_layout_review') {
            const primaryFailureKind = finalFailures.length > 0
                ? 'font_verification_failed'
                : layoutImpactReview.status;
            return {
                success: false,
                message: primaryFailureKind === 'font_verification_failed'
                    ? `字体替换未完全成功：${successes.length}/${targetLayers.length} 个文本图层通过验证。`
                    : primaryFailureKind === 'failed_style_drift'
                        ? `字体已写入，但版面复核发现字号、字距或行距发生非预期变化；${successes.length}/${targetLayers.length} 个文本图层通过字体验证。`
                        : `字体已写入，但文本边界变化明显，需要复核或继续调整排版后才能算完成。${layoutImpactReview.primaryRecommendation || ''}`,
                error: primaryFailureKind === 'font_verification_failed'
                    ? 'font replacement verification failed'
                    : primaryFailureKind === 'failed_style_drift'
                        ? 'font replacement changed typography metrics'
                        : 'font replacement needs layout review',
                toolResults: results,
                data: {
                    requestedFont,
                    resolvedFontCandidates,
                    totalLayers: targetLayers.length,
                    successes,
                    failures: finalFailures,
                    layoutImpactReview,
                    controlledTextStyleBatch,
                    requiresManualReview: layoutImpactReview.status === 'needs_layout_review'
                }
            };
        }

        const effectiveFont = resolvedFontCandidates[1] || requestedFont;
        return {
            success: true,
            message: `已将 ${targetLayers.length} 个文本图层的字体改为 ${requestedFont}。`,
            toolResults: results,
            data: {
                requestedFont,
                effectiveFont,
                totalLayers: targetLayers.length,
                successes,
                layoutImpactReview,
                controlledTextStyleBatch
            }
        };
    }
};
