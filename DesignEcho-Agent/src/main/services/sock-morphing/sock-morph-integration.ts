/**
 * 袜子形态统一集成服务
 *
 * 优先验证并执行 Photoshop 原生 Puppet Warp。
 * 若原生路径不可用，则回退到 Agent 整图变形 + applyMorphedImage。
 */

import { SockMorphEngine, SockMorphRequest, SockMorphResult } from './sock-morph-engine';
import { Point } from './skeleton-alignment';
import { Bounds } from './coordinate-transform';
import { getEnhancedMorphExecutor } from '../morphing/enhanced-morph-executor';

export interface IntegrationConfig {
    autoConvertToSmartObject: boolean;
    preserveOriginal: boolean;
    debug: boolean;
}

const DEFAULT_CONFIG: IntegrationConfig = {
    autoConvertToSmartObject: true,
    preserveOriginal: true,
    debug: true
};

export interface WorkflowState {
    step: 'idle' | 'extracting' | 'analyzing' | 'generating' | 'executing' | 'complete' | 'error';
    progress: number;
    message: string;
    details?: any;
}

export interface NativeWarpSupportReport {
    freeTransformWarpSupported: boolean;
    puppetWarpSupported: boolean;
    usedSmartObject: boolean;
    notes: string[];
    errors: string[];
    recommendedMethod: 'native-puppet' | 'native-warp' | 'unavailable' | string;
}

export interface VisualMethodScore {
    naturalness: number;
    patternPreservation: number;
    cuffIntegrity: number;
    repeatability: number;
    reasons: string[];
}

export interface VisualQualityComparison {
    recommendedMethod: 'native-puppet' | 'apply-morphed-image-fallback' | 'optimized-displacement';
    nativePuppet: VisualMethodScore;
    optimizedDisplacement: VisualMethodScore;
    applyMorphedImageFallback: VisualMethodScore;
    summary: string[];
}

export interface IntegrationExecutionDetails {
    requestedMethod: 'native-puppet';
    actualMethod: 'native-puppet' | 'apply-morphed-image-fallback' | 'unavailable';
    fallbackUsed: boolean;
    fallbackReason?: string;
    outputLayerId?: number;
    outputLayerName?: string;
    nativeSupport?: NativeWarpSupportReport;
}

export class SockMorphIntegration {
    private engine: SockMorphEngine;
    private config: IntegrationConfig;
    private state: WorkflowState = { step: 'idle', progress: 0, message: '' };
    private stateCallback?: (state: WorkflowState) => void;

    constructor(config: Partial<IntegrationConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.engine = new SockMorphEngine(this.config.debug);
    }

    onStateChange(callback: (state: WorkflowState) => void): void {
        this.stateCallback = callback;
    }

    private updateState(state: Partial<WorkflowState>): void {
        this.state = { ...this.state, ...state };
        if (this.stateCallback) {
            this.stateCallback(this.state);
        }
        if (this.config.debug) {
            console.log(`[SockMorphIntegration] ${this.state.step}: ${this.state.message} (${this.state.progress}%)`);
        }
    }

    async execute(
        productLayerId: number,
        referenceShapeId: number,
        callTool: (toolName: string, params: any) => Promise<any>,
        settings?: Partial<SockMorphRequest['settings']>
    ): Promise<{
        success: boolean;
        result?: SockMorphResult;
        error?: string;
        execution?: IntegrationExecutionDetails;
        comparison?: VisualQualityComparison;
    }> {
        try {
            this.updateState({
                step: 'extracting',
                progress: 10,
                message: '获取产品图层信息...'
            });

            await callTool('selectLayer', { layerId: productLayerId });

            const boundsResult = await callTool('getLayerBounds', { layerId: productLayerId });
            if (!boundsResult?.success) {
                throw new Error(`无法获取产品图层边界: ${boundsResult?.error || '未知错误'}`);
            }

            const productBounds = this.toBounds(boundsResult);
            const productLayerName = boundsResult.layerName || `产品_${productLayerId}`;

            this.updateState({
                step: 'extracting',
                progress: 20,
                message: '提取产品轮廓...'
            });

            const contourResult = await callTool('getLayerContour', {
                layerId: productLayerId,
                simplify: true,
                maxPoints: 200
            });

            const productContour = this.extractContourPoints(contourResult);
            if (productContour.length === 0) {
                throw new Error(`无法提取产品轮廓: ${contourResult?.error || '轮廓数据为空'}`);
            }

            this.updateState({
                step: 'extracting',
                progress: 30,
                message: '获取参考形状...'
            });

            const refContourResult = await callTool('getLayerContour', {
                layerId: referenceShapeId,
                simplify: true,
                maxPoints: 200
            });

            const referenceContour = this.extractContourPoints(refContourResult);
            if (referenceContour.length === 0) {
                throw new Error(`无法获取参考形状轮廓: ${refContourResult?.error || '轮廓数据为空'}`);
            }

            const refLayerInfo = await callTool('getLayerBounds', { layerId: referenceShapeId });
            const refLayerName = refLayerInfo?.layerName || `参考形状_${referenceShapeId}`;

            this.updateState({
                step: 'analyzing',
                progress: 50,
                message: '执行原生 Puppet 形态分析...'
            });

            const request: SockMorphRequest = {
                productLayer: {
                    id: productLayerId,
                    name: productLayerName,
                    bounds: productBounds
                },
                referenceShape: {
                    id: referenceShapeId,
                    name: refLayerName,
                    contour: referenceContour
                },
                productContour,
                originalBounds: productBounds,
                trimmedBounds: productBounds,
                settings: {
                    cuffProtection: settings?.cuffProtection ?? true,
                    patternProtection: settings?.patternProtection ?? true,
                    matchIntensity: settings?.matchIntensity ?? 70,
                    sockType: settings?.sockType
                }
            };

            const morphResult = await this.engine.process(request);
            if (!morphResult.success) {
                throw new Error(morphResult.error || '形态分析失败');
            }

            this.updateState({
                step: 'generating',
                progress: 70,
                message: `生成原生 Puppet 命令 (${morphResult.puppetWarpConfig?.pins.length || 0} 个控制点)...`
            });

            const nativeSupport = await this.determineExecutionMethod(callTool, productLayerId);
            const comparison = this.buildVisualComparison(nativeSupport, morphResult);

            if (nativeSupport.puppetWarpSupported && morphResult.batchPlayCommands?.length) {
                this.updateState({
                    step: 'executing',
                    progress: 82,
                    message: '执行 Photoshop 原生 Puppet Warp...'
                });

                const nativeExecution = await callTool('warpExplorer', {
                    action: 'executePuppetWarp',
                    layerId: productLayerId,
                    commands: morphResult.batchPlayCommands,
                    preserveOriginal: this.config.preserveOriginal,
                    resultLayerName: `${productLayerName}_PuppetWarp`,
                    autoConvertToSmartObject: this.config.autoConvertToSmartObject
                });

                if (nativeExecution?.success) {
                    const execution: IntegrationExecutionDetails = {
                        requestedMethod: 'native-puppet',
                        actualMethod: 'native-puppet',
                        fallbackUsed: false,
                        outputLayerId: nativeExecution.outputLayerId ?? nativeExecution.data?.outputLayerId,
                        outputLayerName: nativeExecution.outputLayerName ?? nativeExecution.data?.outputLayerName,
                        nativeSupport
                    };

                    this.updateState({
                        step: 'complete',
                        progress: 100,
                        message: '原生 Puppet Warp 执行完成',
                        details: {
                            execution,
                            comparison,
                            warnings: morphResult.warnings
                        }
                    });

                    return {
                        success: true,
                        result: morphResult,
                        execution,
                        comparison
                    };
                }

                return await this.executeFallbackFlow({
                    productLayerId,
                    productLayerName,
                    productContour,
                    referenceContour,
                    nativeSupport,
                    comparison,
                    morphResult,
                    callTool,
                    fallbackReason: nativeExecution?.error || '原生 Puppet Warp 执行失败',
                    settings
                });
            }

            return await this.executeFallbackFlow({
                productLayerId,
                productLayerName,
                productContour,
                referenceContour,
                nativeSupport,
                comparison,
                morphResult,
                callTool,
                fallbackReason: nativeSupport.errors.join('; ') || '当前环境不支持原生 Puppet Warp',
                settings
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.updateState({
                step: 'error',
                progress: 0,
                message: errorMsg
            });

            return {
                success: false,
                error: errorMsg
            };
        }
    }

    private async executeFallbackFlow(input: {
        productLayerId: number;
        productLayerName: string;
        productContour: Point[];
        referenceContour: Point[];
        nativeSupport: NativeWarpSupportReport;
        comparison: VisualQualityComparison;
        morphResult: SockMorphResult;
        callTool: (toolName: string, params: any) => Promise<any>;
        fallbackReason: string;
        settings?: Partial<SockMorphRequest['settings']>;
    }): Promise<{
        success: boolean;
        result?: SockMorphResult;
        error?: string;
        execution?: IntegrationExecutionDetails;
        comparison?: VisualQualityComparison;
    }> {
        this.updateState({
            step: 'executing',
            progress: 86,
            message: '原生 Warp 不稳定，回退到整图变形写回...'
        });

        const exportResult = await input.callTool('exportLayerAsBase64', {
            layerId: input.productLayerId,
            format: 'png',
            maxSize: 2048
        });

        const sourceImageBase64 = exportResult?.data?.base64 || exportResult?.base64;
        if (!exportResult?.success || !sourceImageBase64) {
            throw new Error(`回退导出失败: ${exportResult?.error || '无法获取图层图像'}`);
        }

        const enhancedExecutor = getEnhancedMorphExecutor();
        const enhancedResult = await enhancedExecutor.execute(
            sourceImageBase64,
            input.productContour,
            input.referenceContour,
            {
                intensity: Number(input.settings?.matchIntensity ?? 70) / 100,
                contentProtection: input.settings?.patternProtection === false ? 0.2 : 0.75,
                smoothness: 0.62,
                preAlign: false,
                quality: 'high',
                debug: this.config.debug
            }
        );

        if (!enhancedResult.success || !enhancedResult.morphedImageBase64) {
            throw new Error(`整图变形回退失败: ${enhancedResult.error || '未知错误'}`);
        }

        const applyResult = await input.callTool('applyMorphedImage', {
            layerId: input.productLayerId,
            imageBase64: enhancedResult.morphedImageBase64,
            mode: 'replace',
            preserveOriginal: this.config.preserveOriginal,
            resultLayerName: `${input.productLayerName}_WarpFallback`
        });

        if (!applyResult?.success) {
            throw new Error(`回退写回失败: ${applyResult?.error || '未知错误'}`);
        }

        const execution: IntegrationExecutionDetails = {
            requestedMethod: 'native-puppet',
            actualMethod: 'apply-morphed-image-fallback',
            fallbackUsed: true,
            fallbackReason: input.fallbackReason,
            outputLayerId: applyResult.outputLayerId ?? applyResult.data?.outputLayerId,
            outputLayerName: applyResult.outputLayerName ?? applyResult.data?.outputLayerName,
            nativeSupport: input.nativeSupport
        };

        this.updateState({
            step: 'complete',
            progress: 100,
            message: '已通过整图变形回退完成形态统一',
            details: {
                execution,
                comparison: input.comparison,
                warnings: [...input.morphResult.warnings, `已回退: ${input.fallbackReason}`]
            }
        });

        return {
            success: true,
            result: input.morphResult,
            execution,
            comparison: input.comparison
        };
    }

    private async determineExecutionMethod(
        callTool: (toolName: string, params: any) => Promise<any>,
        layerId: number
    ): Promise<NativeWarpSupportReport> {
        try {
            const testResult = await callTool('warpExplorer', {
                action: 'verifyNativeWarpSupport',
                layerId,
                autoConvertToSmartObject: this.config.autoConvertToSmartObject
            });

            const data = testResult?.data || testResult;
            return {
                freeTransformWarpSupported: Boolean(data?.freeTransformWarpSupported),
                puppetWarpSupported: Boolean(data?.puppetWarpSupported),
                usedSmartObject: Boolean(data?.usedSmartObject),
                notes: Array.isArray(data?.notes) ? data.notes : [],
                errors: Array.isArray(data?.errors) ? data.errors : [],
                recommendedMethod: data?.recommendedMethod || 'unavailable'
            };
        } catch (error: any) {
            return {
                freeTransformWarpSupported: false,
                puppetWarpSupported: false,
                usedSmartObject: this.config.autoConvertToSmartObject,
                notes: [],
                errors: [error?.message || '原生 Warp 探测失败'],
                recommendedMethod: 'unavailable'
            };
        }
    }

    private buildVisualComparison(
        nativeSupport: NativeWarpSupportReport,
        morphResult: SockMorphResult
    ): VisualQualityComparison {
        const nativePuppet: VisualMethodScore = {
            naturalness: nativeSupport.puppetWarpSupported ? 0.86 : 0.4,
            patternPreservation: 0.82,
            cuffIntegrity: 0.92,
            repeatability: nativeSupport.puppetWarpSupported ? 0.72 : 0.2,
            reasons: [
                '基于静止锚点 + 移动锚点，更接近设计师手工液化的局部控制方式',
                'rigid mesh 和袜口静止锚点更有利于保持袜口完整',
                nativeSupport.puppetWarpSupported
                    ? '当前环境已探测到 Puppet Warp 指令可执行'
                    : '当前环境尚未证明 Puppet Warp 能稳定自动执行'
            ]
        };

        const optimizedDisplacement: VisualMethodScore = {
            naturalness: 0.44,
            patternPreservation: 0.52,
            cuffIntegrity: 0.6,
            repeatability: 0.88,
            reasons: [
                '当前正式主链更偏向轮廓附近的带状位移，不够接近手工液化的整体形变',
                '图案保护依赖纹理统计减权，不是语义级 logo/花型保护',
                '优势是可验证、可拒绝、可批量'
            ]
        };

        const fallbackScore = Math.max(0.55, Math.min(0.82, (morphResult.analysis.qualityScore || 60) / 100));
        const applyMorphedImageFallback: VisualMethodScore = {
            naturalness: fallbackScore,
            patternPreservation: 0.7,
            cuffIntegrity: 0.72,
            repeatability: 0.66,
            reasons: [
                '整图变形比边缘带位移更容易获得整体顺滑观感',
                '通过 replace/newLayer 写回更容易做安全回退',
                '但仍不是 Photoshop 原生 Warp，观感可能仍逊于真正的 Puppet Warp'
            ]
        };

        const recommendedMethod = nativeSupport.puppetWarpSupported
            ? 'native-puppet'
            : 'apply-morphed-image-fallback';

        return {
            recommendedMethod,
            nativePuppet,
            optimizedDisplacement,
            applyMorphedImageFallback,
            summary: nativeSupport.puppetWarpSupported
                ? [
                    '原生 Puppet Warp 已具备最小执行前提，应优先验证真实样本观感',
                    '若真实样本通过，可优先替代当前位移场主链'
                ]
                : [
                    '原生 Puppet Warp 仍不稳定或不可执行，不适合直接作为产品主线',
                    '整图变形 + applyMorphedImage 是当前更现实的第二候选'
                ]
        };
    }

    private extractContourPoints(result: any): Point[] {
        const points = result?.contour || result?.sampledPoints || result?.points || result?.data?.contour || [];
        return Array.isArray(points) ? points : [];
    }

    private toBounds(boundsResult: any): Bounds {
        const left = Number(boundsResult.left ?? boundsResult.bounds?.left ?? 0);
        const top = Number(boundsResult.top ?? boundsResult.bounds?.top ?? 0);
        const right = Number(boundsResult.right ?? boundsResult.bounds?.right ?? left);
        const bottom = Number(boundsResult.bottom ?? boundsResult.bounds?.bottom ?? top);
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top
        };
    }

    getState(): WorkflowState {
        return { ...this.state };
    }

    reset(): void {
        this.state = { step: 'idle', progress: 0, message: '' };
    }
}

export function createSockMorphIntegration(config?: Partial<IntegrationConfig>): SockMorphIntegration {
    return new SockMorphIntegration(config);
}

export default SockMorphIntegration;
