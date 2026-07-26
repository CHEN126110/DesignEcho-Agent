/**
 * 诊断 Photoshop 状态工具
 * 
 * 获取当前 Photoshop 的详细状态信息，用于调试
 */

import { Tool, ToolSchema } from '../types';
import { diagnosePhotoshopState } from '../../core/error-handler';
import { getPhotoshopRuntimeBuildInfo } from '../../core/runtime-build-info';

const app = require('photoshop').app;

export class DiagnoseStateTool implements Tool {
    name = 'diagnoseState';

    schema: ToolSchema = {
        name: 'diagnoseState',
        description: '获取当前 Photoshop 的详细状态信息，用于诊断问题',
        parameters: {
            type: 'object',
            properties: {
                verbose: {
                    type: 'boolean',
                    description: '是否输出详细信息'
                }
            }
        }
    };

    async execute(params: {
        verbose?: boolean;
    }): Promise<{
        success: boolean;
        state?: {
            runtime: {
                buildId: string;
                loadedAt: string;
                features: string[];
            };
            hasDocument: boolean;
            documentInfo?: {
                name: string;
                id: number;
                mode: string;
                width: number;
                height: number;
                layerCount: number;
            };
            hasSelection: boolean;
            selectedLayers?: {
                id: number;
                name: string;
                kind: string;
                locked: boolean;
                visible: boolean;
                bounds?: { left: number; top: number; right: number; bottom: number };
            }[];
            allLayers?: {
                id: number;
                name: string;
                kind: string;
            }[];
            issues: string[];
        };
        error?: string;
    }> {
        console.log('[DiagnoseState] 开始诊断...');
        
        try {
            // 使用错误处理模块的诊断功能
            const basicDiagnosis = await diagnosePhotoshopState();
            
            // 扩展诊断信息
            const state: any = {
                runtime: getPhotoshopRuntimeBuildInfo(),
                hasDocument: basicDiagnosis.hasDocument,
                hasSelection: basicDiagnosis.hasSelection,
                issues: basicDiagnosis.issues || []
            };

            if (basicDiagnosis.hasDocument) {
                const doc = app.activeDocument;
                
                if (doc) {
                    state.documentInfo = {
                        name: doc.name,
                        id: doc.id,
                        mode: doc.mode?.toString() || 'unknown',
                        width: doc.width,
                        height: doc.height,
                        layerCount: this.countLayers(doc)
                    };

                    if (basicDiagnosis.hasSelection && basicDiagnosis.selectedLayers) {
                        state.selectedLayers = basicDiagnosis.selectedLayers.map((layer: any) => {
                            const layerObj = this.findLayerById(doc, layer.id);
                            return {
                                ...layer,
                                bounds: layerObj ? {
                                    left: layerObj.bounds.left,
                                    top: layerObj.bounds.top,
                                    right: layerObj.bounds.right,
                                    bottom: layerObj.bounds.bottom
                                } : undefined
                            };
                        });
                    }

                    // 如果需要详细信息，列出所有图层
                    if (params.verbose) {
                        state.allLayers = this.getAllLayers(doc);
                    }
                }
            }

            console.log('[DiagnoseState] 诊断完成:', JSON.stringify(state, null, 2));

            return {
                success: true,
                state
            };

        } catch (error: any) {
            console.error('[DiagnoseState] 诊断失败:', error);
            return {
                success: false,
                error: error.message || '诊断失败'
            };
        }
    }

    private countLayers(container: any): number {
        let count = 0;
        for (const layer of container.layers || []) {
            count++;
            if (layer.layers) {
                count += this.countLayers(layer);
            }
        }
        return count;
    }

    private getAllLayers(container: any, depth: number = 0): any[] {
        const layers: any[] = [];
        for (const layer of container.layers || []) {
            layers.push({
                id: layer.id,
                name: layer.name,
                kind: layer.kind?.toString() || 'unknown',
                depth
            });
            if (layer.layers) {
                layers.push(...this.getAllLayers(layer, depth + 1));
            }
        }
        return layers;
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers || []) {
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
