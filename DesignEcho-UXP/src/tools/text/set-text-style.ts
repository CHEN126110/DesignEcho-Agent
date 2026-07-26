/**
 * 设置文本样式工具
 */

import { Tool, ToolSchema, TextStyle } from '../types';
import { safeBatchPlay, diagnosePhotoshopState, wrapError } from '../../core/error-handler';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    FontSuggestion,
    ResolvedFontInfo,
    fontMatchesResolvedFont,
    resolveFont
} from './font-resolver';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { LayerKind } = require('photoshop').constants;

export class SetTextStyleTool implements Tool {
    name = 'setTextStyle';

    schema: ToolSchema = {
        name: 'setTextStyle',
        description: '设置文本图层的样式（字号、字间距、行高等）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则修改当前选中的文本图层'
                },
                fontSize: {
                    type: 'number',
                    description: '字号 (pt)'
                },
                tracking: {
                    type: 'number',
                    description: '字间距 (tracking, 单位: 千分之一em)'
                },
                leading: {
                    type: 'number',
                    description: '行高 (leading, 单位: pt)'
                },
                fontName: {
                    type: 'string',
                    description: '字体名称'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
        fontSize?: number;
        tracking?: number;
        leading?: number;
        fontName?: string;
    }): Promise<{
        success: boolean;
        layerId?: number;
        appliedStyles?: Partial<TextStyle>;
        resolvedFont?: ResolvedFontInfo;
        verifiedFont?: string;
        fontSuggestions?: FontSuggestion[];
        error?: string;
        errorDetails?: any;
    }> {
        console.log('[SetTextStyle] 开始执行, 参数:', JSON.stringify(params));
        
        try {
            // 先诊断当前状态
            const diagnosis = await diagnosePhotoshopState();
            console.log('[SetTextStyle] Photoshop 状态:', JSON.stringify(diagnosis, null, 2));
            
            if (!diagnosis.hasDocument) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }

            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }
            
            let layer;
            
            if (params.layerId) {
                layer = this.findLayerById(doc, params.layerId);
                if (!layer) {
                    console.error(`[SetTextStyle] 未找到图层 ID: ${params.layerId}`);
                    return createToolFailureResult({
                        toolName: this.name,
                        error: `未找到图层 ID: ${params.layerId}`,
                        params
                    });
                }
            } else {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return createToolFailureResult({ toolName: this.name, error: '请先选中一个文本图层', params });
                }
                layer = activeLayers[0];
            }

            console.log(`[SetTextStyle] 目标图层: ID=${layer.id}, Name="${layer.name}", Kind=${layer.kind}`);

            if (layer.kind !== LayerKind.TEXT) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `选中的不是文本图层 (当前类型: ${layer.kind})`,
                    params
                });
            }

            // 检查图层是否锁定
            if (layer.locked) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `图层 "${layer.name}" 已锁定，无法修改`,
                    params
                });
            }

            const appliedStyles: Partial<TextStyle> = {};
            let batchPlayError: any = null;
            let resolvedFont: ResolvedFontInfo | null = null;
            let fontSuggestions: FontSuggestion[] = [];

            if (params.fontName !== undefined) {
                const fontResolution = resolveFont(params.fontName);
                resolvedFont = fontResolution.resolved;
                fontSuggestions = fontResolution.suggestions;
                if (!resolvedFont) {
                    return {
                        success: false,
                        layerId: layer.id,
                        error: `未找到可用字体：${params.fontName}`,
                        fontSuggestions,
                        errorDetails: {
                            requestedFont: params.fontName,
                            suggestions: fontSuggestions
                        }
                    };
                }
            }

            // 使用 executeAsModal 执行操作
            await core.executeAsModal(async () => {
                const textStyleDescriptor: any = {};

                if (params.fontSize !== undefined) {
                    textStyleDescriptor.size = {
                        _unit: 'pointsUnit',
                        _value: params.fontSize
                    };
                    appliedStyles.fontSize = params.fontSize;
                }

                if (params.tracking !== undefined) {
                    textStyleDescriptor.tracking = params.tracking;
                    appliedStyles.tracking = params.tracking;
                }

                if (params.leading !== undefined) {
                    textStyleDescriptor.leading = {
                        _unit: 'pointsUnit',
                        _value: params.leading
                    };
                    textStyleDescriptor.autoLeading = false;
                    appliedStyles.leading = params.leading;
                }

                if (params.fontName !== undefined) {
                    textStyleDescriptor.fontPostScriptName = resolvedFont?.postScriptName || params.fontName;
                    appliedStyles.fontName = resolvedFont?.postScriptName || params.fontName;
                }

                if (Object.keys(textStyleDescriptor).length === 0) {
                    console.log('[SetTextStyle] 没有样式需要设置');
                    return;
                }

                // 步骤1: 选中目标图层
                console.log('[SetTextStyle] 步骤1: 选中图层', layer.id);
                const selectDescriptor = {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                };
                
                const selectResult = await safeBatchPlay([selectDescriptor], {}, '选中图层');
                if (!selectResult.success) {
                    batchPlayError = selectResult.error;
                    return;
                }

                // 步骤2: 设置文本样式
                console.log('[SetTextStyle] 步骤2: 设置文本样式', textStyleDescriptor);
                const textContents = layer.textItem?.contents || '';
                const setDescriptor = {
                    _obj: 'set',
                    _target: [{ _ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum' }],
                    to: {
                        _obj: 'textLayer',
                        textStyleRange: [
                            {
                                _obj: 'textStyleRange',
                                from: 0,
                                to: textContents.length || 9999,
                                textStyle: {
                                    _obj: 'textStyle',
                                    ...textStyleDescriptor
                                }
                            }
                        ]
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                };
                
                const setResult = await safeBatchPlay([setDescriptor], {}, '设置文本样式');
                if (!setResult.success) {
                    batchPlayError = setResult.error;
                    return;
                }
                
                console.log('[SetTextStyle] 样式设置成功');
            }, { commandName: 'DesignEcho: 设置文本样式' });

            if (batchPlayError) {
                const failure = createToolFailureResult({ toolName: this.name, error: batchPlayError, params });
                return {
                    ...failure,
                    layerId: layer.id,
                    resolvedFont: resolvedFont || undefined,
                    fontSuggestions: fontSuggestions.length > 0 ? fontSuggestions : undefined
                };
            }

            let verifiedFont: string | undefined;
            if (params.fontName !== undefined) {
                try {
                    const refreshedLayer = this.findLayerById(doc, layer.id) || layer;
                    verifiedFont = String(refreshedLayer?.textItem?.characterStyle?.font || '').trim() || undefined;
                    if (!verifiedFont || !resolvedFont || !fontMatchesResolvedFont(verifiedFont, resolvedFont)) {
                        return {
                            success: false,
                            layerId: layer.id,
                            appliedStyles,
                            resolvedFont: resolvedFont || undefined,
                            verifiedFont,
                            fontSuggestions: fontSuggestions.length > 0 ? fontSuggestions : undefined,
                            error: `字体写入未生效：期望 ${resolvedFont?.postScriptName || params.fontName}，实际 ${verifiedFont || '未知'}`,
                            errorDetails: {
                                requestedFont: params.fontName,
                                resolvedFont,
                                verifiedFont
                            }
                        };
                    }
                } catch (verifyError: any) {
                    return {
                        success: false,
                        layerId: layer.id,
                        appliedStyles,
                        resolvedFont: resolvedFont || undefined,
                        fontSuggestions: fontSuggestions.length > 0 ? fontSuggestions : undefined,
                        error: verifyError?.message || '字体验证失败',
                        errorDetails: verifyError
                    };
                }
            }

            return {
                success: true,
                layerId: layer.id,
                appliedStyles,
                resolvedFont: resolvedFont || undefined,
                verifiedFont,
                fontSuggestions: fontSuggestions.length > 0 ? fontSuggestions : undefined
            };

        } catch (error: any) {
            console.error('[SetTextStyle] 捕获异常:', error);
            
            const wrappedError = wrapError(error, 'setTextStyle', params);
            console.error('[SetTextStyle] 错误详情:', JSON.stringify(wrappedError, null, 2));
            
            return createToolFailureResult({ toolName: this.name, error: error.message || wrappedError, params });
        }
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}
