/**
 * 自动修复引擎
 * @description 自动修复 Photoshop 图层结构问题
 */

import { app, action, core } from 'photoshop';

// ==================== 类型定义 ====================

type LayerIssueType = 
    | 'occlusion'
    | 'clipping_broken'
    | 'overflow'
    | 'hidden_content'
    | 'aspect_distortion'
    | 'effect_clipped'
    | 'empty_placeholder'
    | 'invalid_structure';

interface LayerIssue {
    type: LayerIssueType;
    severity: 'critical' | 'warning' | 'info';
    layerId: number;
    layerName: string;
    screenIndex?: number;
    description: string;
    autoFixable: boolean;
    suggestedFix?: string;
    fixParams?: Record<string, any>;
}

interface FixResult {
    issueType: LayerIssueType;
    layerId: number;
    success: boolean;
    message: string;
    changes?: string[];
}

// ==================== 配置常量 ====================

const MIN_FONT_SIZE = 10;  // 最小可读字号

// ==================== 修复器类 ====================

export class AutoFixer {
    
    /**
     * 修复所有可自动修复的问题
     */
    async fixAll(issues: LayerIssue[]): Promise<FixResult[]> {
        const results: FixResult[] = [];
        
        // 过滤可修复的问题，按优先级排序
        const fixableIssues = issues
            .filter(i => i.autoFixable)
            .sort((a, b) => this.severityOrder(a.severity) - this.severityOrder(b.severity));
        
        console.log(`[AutoFixer] 开始修复 ${fixableIssues.length} 个问题`);
        
        for (const issue of fixableIssues) {
            try {
                const result = await this.fixIssue(issue);
                results.push(result);
                console.log(`[AutoFixer] ${result.success ? '✅' : '❌'} ${issue.layerName}: ${result.message}`);
            } catch (e: any) {
                results.push({
                    issueType: issue.type,
                    layerId: issue.layerId,
                    success: false,
                    message: `修复异常: ${e.message}`
                });
                console.error(`[AutoFixer] 修复异常: ${issue.layerName}`, e);
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log(`[AutoFixer] 修复完成: ${successCount}/${fixableIssues.length} 成功`);
        
        return results;
    }
    
    /**
     * 修复单个问题
     */
    async fixIssue(issue: LayerIssue): Promise<FixResult> {
        switch (issue.type) {
            case 'clipping_broken':
                return await this.fixClippingMask(issue);
            case 'overflow':
                return await this.fixTextOverflow(issue);
            case 'aspect_distortion':
                return await this.fixAspectRatio(issue);
            case 'occlusion':
                return await this.fixOcclusion(issue);
            default:
                return {
                    issueType: issue.type,
                    layerId: issue.layerId,
                    success: false,
                    message: `不支持自动修复类型: ${issue.type}`
                };
        }
    }
    
    /**
     * 修复剪切蒙版断裂
     */
    private async fixClippingMask(issue: LayerIssue): Promise<FixResult> {
        const changes: string[] = [];
        
        try {
            await core.executeAsModal(async () => {
                const doc = app.activeDocument;
                if (!doc) throw new Error('无活动文档');
                
                const layer = this.findLayerById(doc.layers, issue.layerId);
                
                if (!layer) {
                    throw new Error('图层不存在');
                }
                
                // 如果已有剪切蒙版，先释放
                if (layer.clipped) {
                    await action.batchPlay([{
                        _obj: 'ungroup',
                        _target: [{ _ref: 'layer', _id: layer.id }]
                    }], { synchronousExecution: true });
                    changes.push('释放现有剪切蒙版');
                }
                
                // 获取基底图层 ID
                const baseLayerId = issue.fixParams?.baseLayerId;
                if (!baseLayerId) {
                    throw new Error('缺少基底图层信息');
                }
                
                // 重建剪切蒙版
                await action.batchPlay([{
                    _obj: 'groupEvent',
                    _target: [{ _ref: 'layer', _id: layer.id }]
                }], { synchronousExecution: true });
                changes.push('建立剪切蒙版');
                
            }, { commandName: '修复剪切蒙版' });
            
            return {
                issueType: 'clipping_broken',
                layerId: issue.layerId,
                success: true,
                message: '剪切蒙版已修复',
                changes
            };
        } catch (e: any) {
            return {
                issueType: 'clipping_broken',
                layerId: issue.layerId,
                success: false,
                message: `修复失败: ${e.message}`
            };
        }
    }
    
    /**
     * 修复文字溢出
     */
    private async fixTextOverflow(issue: LayerIssue): Promise<FixResult> {
        const changes: string[] = [];
        const params = issue.fixParams || {};
        
        try {
            await core.executeAsModal(async () => {
                const doc = app.activeDocument;
                if (!doc) throw new Error('无活动文档');
                
                const layer = this.findLayerById(doc.layers, issue.layerId);
                
                if (!layer || layer.kind !== 'text') {
                    throw new Error('非文本图层');
                }
                
                // 获取当前字号
                let currentSize = 16;
                try {
                    currentSize = layer.textItem?.characterStyle?.size || 16;
                } catch {
                    // 使用 batchPlay 获取
                    const result = await action.batchPlay([{
                        _obj: 'get',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                    currentSize = result[0]?.textKey?.textStyleRange?.[0]?.textStyle?.size || 16;
                }
                
                const overflowRatio = params.overflowRatio || 1.2;
                
                // 计算新字号
                const targetSize = Math.max(
                    MIN_FONT_SIZE,
                    Math.floor(currentSize / overflowRatio)
                );
                
                // 应用新字号
                await action.batchPlay([{
                    _obj: 'set',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    to: {
                        _obj: 'textLayer',
                        textStyleRange: [{
                            _obj: 'textStyleRange',
                            from: 0,
                            to: 10000,
                            textStyle: {
                                _obj: 'textStyle',
                                size: { _unit: 'pointsUnit', _value: targetSize }
                            }
                        }]
                    }
                }], { synchronousExecution: true });
                
                changes.push(`字号从 ${currentSize}pt 缩小到 ${targetSize}pt`);
                
            }, { commandName: '修复文字溢出' });
            
            return {
                issueType: 'overflow',
                layerId: issue.layerId,
                success: true,
                message: '文字溢出已修复',
                changes
            };
        } catch (e: any) {
            return {
                issueType: 'overflow',
                layerId: issue.layerId,
                success: false,
                message: `修复失败: ${e.message}`
            };
        }
    }
    
    /**
     * 修复宽高比变形
     */
    private async fixAspectRatio(issue: LayerIssue): Promise<FixResult> {
        const changes: string[] = [];
        const params = issue.fixParams || {};
        
        try {
            await core.executeAsModal(async () => {
                const doc = app.activeDocument;
                if (!doc) throw new Error('无活动文档');
                
                const layer = this.findLayerById(doc.layers, issue.layerId);
                
                if (!layer) {
                    throw new Error('图层不存在');
                }
                
                const originalRatio = params.originalRatio;
                const currentRatio = params.currentRatio;
                
                if (!originalRatio) {
                    throw new Error('缺少原始宽高比');
                }
                
                const bounds = layer.bounds;
                const currentWidth = bounds.right - bounds.left;
                const currentHeight = bounds.bottom - bounds.top;
                
                // 计算修正值 (保持宽度不变，调整高度)
                const targetHeight = currentWidth / originalRatio;
                const scaleY = (targetHeight / currentHeight) * 100;
                
                // 使用 transform 命令
                await action.batchPlay([{
                    _obj: 'transform',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    width: { _unit: 'percentUnit', _value: 100 },
                    height: { _unit: 'percentUnit', _value: scaleY },
                    interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
                }], { synchronousExecution: true });
                
                changes.push(`宽高比从 ${currentRatio.toFixed(2)} 恢复到 ${originalRatio.toFixed(2)}`);
                
            }, { commandName: '修复宽高比' });
            
            return {
                issueType: 'aspect_distortion',
                layerId: issue.layerId,
                success: true,
                message: '宽高比已修复',
                changes
            };
        } catch (e: any) {
            return {
                issueType: 'aspect_distortion',
                layerId: issue.layerId,
                success: false,
                message: `修复失败: ${e.message}`
            };
        }
    }
    
    /**
     * 修复图层遮挡
     */
    private async fixOcclusion(issue: LayerIssue): Promise<FixResult> {
        const changes: string[] = [];
        const params = issue.fixParams || {};
        
        try {
            await core.executeAsModal(async () => {
                const doc = app.activeDocument;
                if (!doc) throw new Error('无活动文档');
                
                const occludingLayerId = params.occludingLayerId;
                
                if (!occludingLayerId) {
                    throw new Error('缺少遮挡图层信息');
                }
                
                const occludingLayer = this.findLayerById(doc.layers, occludingLayerId);
                
                if (!occludingLayer) {
                    throw new Error('遮挡图层不存在');
                }
                
                // 策略: 降低遮挡图层透明度
                const currentOpacity = occludingLayer.opacity;
                if (currentOpacity > 80) {
                    occludingLayer.opacity = 80;
                    changes.push(`降低 "${occludingLayer.name}" 透明度从 ${currentOpacity}% 到 80%`);
                }
                
            }, { commandName: '修复图层遮挡' });
            
            return {
                issueType: 'occlusion',
                layerId: issue.layerId,
                success: true,
                message: '图层遮挡已处理',
                changes
            };
        } catch (e: any) {
            return {
                issueType: 'occlusion',
                layerId: issue.layerId,
                success: false,
                message: `修复失败: ${e.message}`
            };
        }
    }
    
    // ==================== 工具方法 ====================
    
    private severityOrder(severity: string): number {
        switch (severity) {
            case 'critical': return 0;
            case 'warning': return 1;
            case 'info': return 2;
            default: return 3;
        }
    }
    
    private findLayerById(layers: any, id: number): any {
        if (!layers) return null;
        
        const layerArray = Array.isArray(layers) ? layers : [layers];
        
        for (const layer of layerArray) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
}

// ==================== 工具类 ====================

export class AutoFixerTool {
    name = 'fixLayerIssues';
    
    schema = {
        name: 'fixLayerIssues',
        description: '自动修复检测到的图层问题',
        parameters: {
            type: 'object' as const,
            properties: {
                issues: {
                    type: 'array',
                    description: '要修复的问题列表',
                    items: { type: 'object' }
                }
            },
            required: ['issues'] as string[]
        }
    };
    
    async execute(params: { issues: LayerIssue[] }): Promise<FixResult[]> {
        const fixer = new AutoFixer();
        return await fixer.fixAll(params.issues);
    }
}
