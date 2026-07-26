/**
 * 形态统一 UXP 处理器
 *
 * 面向 UXP 面板的内部 operation。
 * 当前只接通面板主链，不暴露为普通用户聊天 skill。
 */

import { getLayoutRulesService } from '../services/layout-rules-service';
import { createSockMorphIntegration } from '../services/sock-morphing';
import {
    ShapeMorphingOrchestrator,
    type ShapeMorphingParams,
    type ShapeMorphingResult
} from '../services/shape-morphing-orchestrator';
import type { UXPContext } from './types';
import type { WebSocketServer } from '../websocket/server';

type SupportedShapeMorphStep = 'align' | 'morph' | 'all';

function normalizeSockStyle(sockStyle: unknown): string {
    switch (String(sockStyle ?? '').trim()) {
        case 'boat':
            return 'no-show';
        default:
            return typeof sockStyle === 'string' && sockStyle.trim() ? sockStyle : 'crew';
    }
}

function normalizeCuffType(cuffType: unknown): string {
    switch (String(cuffType ?? '').trim()) {
        case 'double-welt':
            return 'double';
        case 'fold':
            return 'folded';
        default:
            return typeof cuffType === 'string' && cuffType.trim() ? cuffType : 'plain';
    }
}

function normalizeSelectedRegions(regions: unknown): string[] {
    if (!Array.isArray(regions)) {
        return [];
    }

    return Array.from(
        new Set(
            regions
                .map((region) => String(region))
                .map((region) => region === 'foot' ? 'body' : region)
                .filter(Boolean)
        )
    );
}

function normalizePreferredExecution(value: unknown): ShapeMorphingParams['preferredExecution'] {
    const normalized = String(value ?? '').trim();
    if (normalized === 'native-puppet' || normalized === 'auto') {
        return normalized;
    }
    return 'optimized-displacement';
}

function normalizeNativeFallback(value: unknown): ShapeMorphingParams['nativeFallback'] {
    const normalized = String(value ?? '').trim();
    if (normalized === 'optimized-displacement' || normalized === 'none') {
        return normalized;
    }
    return 'apply-morphed-image';
}

function normalizeShapeMorphingParams(params: Partial<ShapeMorphingParams> & {
    step?: string;
    qualityPreset?: 'fast' | 'balanced' | 'high';
}): ShapeMorphingParams {
    const referenceShapeId = Number(params.referenceShapeId);
    const productLayerIds = Array.isArray(params.productLayerIds)
        ? params.productLayerIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : [];

    const step = typeof params.step === 'string' ? params.step : 'morph';

    return {
        referenceShapeId,
        productLayerIds,
        step: step as ShapeMorphingParams['step'],
        preAlign: params.preAlign !== false,
        shapeMatch: params.shapeMatch !== false,
        edgeStrength: typeof params.edgeStrength === 'number' ? params.edgeStrength : 70,
        contentProtection: typeof params.contentProtection === 'number' ? params.contentProtection : 80,
        smoothness: typeof params.smoothness === 'number' ? params.smoothness : 50,
        selectedRegions: normalizeSelectedRegions(params.selectedRegions),
        sockStyle: normalizeSockStyle(params.sockStyle),
        cuffType: normalizeCuffType(params.cuffType),
        cuffProtected: params.cuffProtected === true,
        quality: params.qualityPreset ?? params.quality ?? 'balanced',
        useAdvancedDetection: params.useAdvancedDetection,
        useOptimizedMorphing: params.useOptimizedMorphing,
        forceRedetect: params.forceRedetect,
        preferredExecution: normalizePreferredExecution((params as any).preferredExecution),
        nativeFallback: normalizeNativeFallback((params as any).nativeFallback),
        intensity: params.intensity
    };
}

function isSupportedStep(step: string): step is SupportedShapeMorphStep {
    return step === 'align' || step === 'morph' || step === 'all';
}

function summarizeResult(result: ShapeMorphingResult, totalLayers: number, step: SupportedShapeMorphStep) {
    const successCount = result.results.filter((item) => item.success).length;
    return {
        ...result,
        step,
        totalLayers,
        successCount
    };
}

async function executeNativeWarpWorkflow(
    wsServer: WebSocketServer,
    params: ShapeMorphingParams
): Promise<ShapeMorphingResult & {
    nativeComparison?: any;
    nativeExecutions?: any[];
}> {
    const integration = createSockMorphIntegration({
        autoConvertToSmartObject: true,
        preserveOriginal: true,
        debug: true
    });
    const warnings: string[] = [];
    const executions: any[] = [];
    const results: ShapeMorphingResult['results'] = [];
    let nativeComparison: any;

    for (const layerId of params.productLayerIds) {
        const integrationResult = await integration.execute(
            layerId,
            params.referenceShapeId,
            (toolName: string, toolParams: any) => wsServer.sendRequest(toolName, toolParams, 120000),
            {
                cuffProtection: params.cuffProtected !== false,
                patternProtection: (params.contentProtection ?? 80) >= 40,
                matchIntensity: params.intensity ?? params.edgeStrength ?? 70
            }
        );

        if (integrationResult.comparison && !nativeComparison) {
            nativeComparison = integrationResult.comparison;
        }

        if (integrationResult.execution) {
            executions.push(integrationResult.execution);
            if (integrationResult.execution.fallbackReason) {
                warnings.push(integrationResult.execution.fallbackReason);
            }
        }

        if (integrationResult.success) {
            results.push({
                layerId: integrationResult.execution?.outputLayerId ?? layerId,
                success: true,
                method: integrationResult.execution?.actualMethod ?? 'native-puppet'
            });
        } else {
            results.push({
                layerId,
                success: false,
                error: integrationResult.error || '原生 Warp 执行失败'
            });
        }
    }

    const successCount = results.filter((item) => item.success).length;
    return {
        success: successCount > 0,
        results,
        message: `完成: ${successCount}/${params.productLayerIds.length} 个图层完成原生 Warp/Puppet 路线处理`,
        warnings: Array.from(new Set(warnings)),
        nativeComparison,
        nativeExecutions: executions
    };
}

/**
 * 注册形态统一相关 UXP handlers
 */
export function registerShapeMorphingUXPHandlers(context: UXPContext): void {
    const { wsServer, mattingService } = context;

    if (!wsServer) {
        console.log('[ShapeMorph UXP] WebSocket 未连接，跳过注册');
        return;
    }

    console.log('[ShapeMorph UXP] 注册形态统一 handlers...');

    wsServer.registerHandler('enhanced-shape-morph', async (rawParams: Partial<ShapeMorphingParams> & {
        step?: string;
        qualityPreset?: 'fast' | 'balanced' | 'high';
    }) => {
        try {
            if (!mattingService) {
                throw new Error('MattingService 未初始化，无法执行形态统一');
            }

            const params = normalizeShapeMorphingParams(rawParams ?? {});

            if (!Number.isFinite(params.referenceShapeId) || params.referenceShapeId <= 0) {
                throw new Error('referenceShapeId 无效');
            }

            if (params.productLayerIds.length === 0) {
                throw new Error('productLayerIds 为空');
            }

            const step = params.step ?? 'morph';

            if (!isSupportedStep(step)) {
                throw new Error(`当前仅支持 align / morph / all，收到: ${String(params.step)}`);
            }

            const layoutRulesService = await getLayoutRulesService().catch(() => undefined);
            const orchestrator = new ShapeMorphingOrchestrator(
                wsServer,
                mattingService,
                layoutRulesService
            );

            const result =
                step !== 'align' && (params.preferredExecution === 'native-puppet' || params.preferredExecution === 'auto')
                    ? await executeNativeWarpWorkflow(wsServer, params)
                    : step === 'align'
                        ? await orchestrator.executeAlignment(params)
                        : await orchestrator.executeFullMorphing(params);

            return summarizeResult(result, params.productLayerIds.length, step);
        } catch (error: any) {
            console.error('[ShapeMorph UXP] 错误:', error.message);
            return {
                success: false,
                step: rawParams?.step ?? 'morph',
                totalLayers: Array.isArray(rawParams?.productLayerIds) ? rawParams.productLayerIds.length : 0,
                successCount: 0,
                results: [],
                error: error.message || '形态统一处理失败'
            };
        }
    });

    console.log('[ShapeMorph UXP] ✅ 形态统一 handlers 注册完成');
}
