/**
 * Warp 变形探索工具
 * 
 * 用于研究 Photoshop 各种变形命令的 batchPlay 实现
 * 包括：Free Transform Warp, Puppet Warp, Liquify
 */

import { Tool, ToolResult, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

/**
 * 变形探索工具
 * 用于测试和获取各种变形命令的 descriptor
 */
export class WarpExplorerTool implements Tool {
    name = 'warpExplorer';

    schema: ToolSchema = {
        name: 'warpExplorer',
        description: '探索 Photoshop 变形命令的 batchPlay 实现',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '操作类型: openPuppetWarp, applyWarp, getWarpInfo, testTransform'
                },
                layerId: {
                    type: 'number',
                    description: '图层 ID'
                },
                warpParams: {
                    type: 'object',
                    description: '变形参数'
                },
                commands: {
                    type: 'array',
                    description: '要直接执行的 batchPlay 命令数组',
                    items: { type: 'object' }
                },
                preserveOriginal: {
                    type: 'boolean',
                    description: '是否保留原图层并在副本上执行'
                },
                resultLayerName: {
                    type: 'string',
                    description: '输出图层名称'
                },
                autoConvertToSmartObject: {
                    type: 'boolean',
                    description: '执行前是否自动转为智能对象'
                }
            },
            required: ['action']
        }
    };

    async execute(params: {
        action: string;
        layerId?: number;
        warpParams?: any;
        commands?: any[];
        preserveOriginal?: boolean;
        resultLayerName?: string;
        autoConvertToSmartObject?: boolean;
    }): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            switch (params.action) {
                case 'openPuppetWarp':
                    return await this.openPuppetWarp(params.layerId);
                
                case 'applyWarp':
                    return await this.applyFreeTransformWarp(params.layerId, params.warpParams);
                
                case 'getWarpInfo':
                    return await this.getWarpInfo(params.layerId);

                case 'verifyNativeWarpSupport':
                    return await this.verifyNativeWarpSupport(params.layerId, params.autoConvertToSmartObject !== false);

                case 'executePuppetWarp':
                    return await this.executePuppetWarp({
                        layerId: params.layerId,
                        commands: Array.isArray(params.commands) ? params.commands : [],
                        preserveOriginal: params.preserveOriginal !== false,
                        resultLayerName: params.resultLayerName,
                        autoConvertToSmartObject: params.autoConvertToSmartObject !== false
                    });
                
                case 'testTransform':
                    return await this.testWarpTransform(params.layerId);
                
                case 'listMenuCommands':
                    return await this.listPossibleMenuCommands();
                
                case 'testQuiltWarp':
                    return await this.testQuiltWarp(params.layerId);
                
                case 'recordPuppetWarp':
                    return await this.recordPuppetWarpAction();
                
                case 'testSmartObjectWarp':
                    return await this.testSmartObjectWarp(params.layerId, params.warpParams);
                
                case 'testPerspectiveWarp':
                    return await this.testPerspectiveWarp(params.layerId);
                
                default:
                    return { success: false, error: `未知操作: ${params.action}`, data: null };
            }
        } catch (error: any) {
            console.error('[WarpExplorer] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    private async verifyNativeWarpSupport(
        layerId?: number,
        autoConvertToSmartObject: boolean = true
    ): Promise<ToolResult<any>> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }
        const baseLayer = layerId ? this.findLayerById(doc, layerId) : doc.activeLayers[0];
        if (!baseLayer) {
            return { success: false, error: '未找到用于验证的图层', data: null };
        }

        let probeLayerId: number | undefined;
        let freeTransformWarpSupported = false;
        let puppetWarpSupported = false;
        let usedSmartObject = false;
        const notes: string[] = [];
        const errors: string[] = [];

        try {
            await core.executeAsModal(async () => {
                const duplicated = await baseLayer.duplicate();
                duplicated.name = `${baseLayer.name}_warp_probe`;
                probeLayerId = Number(duplicated.id);

                await this.selectLayer(probeLayerId);

                try {
                    await action.batchPlay([{
                        _obj: 'transform',
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        },
                        warp: {
                            _obj: 'warp',
                            warpStyle: {
                                _enum: 'warpStyle',
                                _value: 'warpNone'
                            },
                            warpValue: 0,
                            warpPerspective: 0,
                            warpPerspectiveOther: 0,
                            warpRotate: {
                                _enum: 'orientation',
                                _value: 'horizontal'
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                    freeTransformWarpSupported = true;
                } catch (error: any) {
                    errors.push(`Free Transform Warp 不可用: ${error.message}`);
                }

                if (autoConvertToSmartObject) {
                    const convertedLayer = await this.ensureSmartObject(probeLayerId);
                    probeLayerId = Number(convertedLayer.id);
                    usedSmartObject = true;
                    notes.push('验证时已自动转换为智能对象');
                }

                try {
                    await this.selectLayer(probeLayerId);
                    const probeBounds = this.normalizeBounds((this.findLayerById(doc, probeLayerId) || duplicated).bounds);
                    const centerX = probeBounds.left + probeBounds.width / 2;
                    const centerY = probeBounds.top + probeBounds.height / 2;

                    await action.batchPlay([
                        {
                            _obj: 'puppetWarp',
                            meshFidelity: 2,
                            meshExpansion: 0,
                            meshRotation: 0,
                            _options: { dialogOptions: 'dontDisplay' }
                        },
                        {
                            _obj: 'puppetWarpPin',
                            puppetPinLocation: {
                                _obj: 'point',
                                horizontal: centerX,
                                vertical: centerY
                            },
                            puppetPinRotation: 0,
                            puppetPinDepth: 0,
                            puppetPinStiffness: 100,
                            _options: { dialogOptions: 'dontDisplay' }
                        },
                        {
                            _obj: 'applyPuppetWarp',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    puppetWarpSupported = true;
                } catch (error: any) {
                    errors.push(`Puppet Warp 不可用: ${error.message}`);
                }
            }, { commandName: 'Verify Native Warp Support' });
        } finally {
            if (probeLayerId) {
                await this.deleteLayerIfExists(probeLayerId);
            }
        }

        return {
            success: true,
            data: {
                freeTransformWarpSupported,
                puppetWarpSupported,
                usedSmartObject,
                notes,
                errors,
                recommendedMethod: puppetWarpSupported
                    ? 'native-puppet'
                    : freeTransformWarpSupported
                        ? 'native-warp'
                        : 'unavailable'
            }
        };
    }

    private async executePuppetWarp(params: {
        layerId?: number;
        commands: any[];
        preserveOriginal: boolean;
        resultLayerName?: string;
        autoConvertToSmartObject: boolean;
    }): Promise<ToolResult<any>> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }
        const baseLayer = params.layerId ? this.findLayerById(doc, params.layerId) : doc.activeLayers[0];
        if (!baseLayer) {
            return { success: false, error: '未找到要执行 Puppet Warp 的图层', data: null };
        }
        if (!Array.isArray(params.commands) || params.commands.length === 0) {
            return { success: false, error: '缺少 Puppet Warp batchPlay 命令', data: null };
        }

        let workingLayerId = Number(baseLayer.id);
        let workingLayerName = baseLayer.name;
        let createdDuplicate = false;

        try {
            await core.executeAsModal(async () => {
                if (params.preserveOriginal) {
                    const duplicated = await baseLayer.duplicate();
                    workingLayerId = Number(duplicated.id);
                    workingLayerName = duplicated.name;
                    createdDuplicate = true;
                }

                await this.selectLayer(workingLayerId);

                if (params.autoConvertToSmartObject) {
                    const smartLayer = await this.ensureSmartObject(workingLayerId);
                    workingLayerId = Number(smartLayer.id);
                    workingLayerName = smartLayer.name;
                    await this.selectLayer(workingLayerId);
                }

                await action.batchPlay(params.commands, { synchronousExecution: true });

                const outputLayer = this.findLayerById(doc, workingLayerId) || doc.activeLayers[0];
                if (!outputLayer) {
                    throw new Error('Puppet Warp 执行后未找到输出图层');
                }

                if (params.resultLayerName) {
                    outputLayer.name = params.resultLayerName;
                }

                workingLayerId = Number(outputLayer.id);
                workingLayerName = outputLayer.name;
            }, { commandName: 'Execute Puppet Warp' });

            return {
                success: true,
                data: {
                    outputLayerId: workingLayerId,
                    outputLayerName: workingLayerName,
                    preservedOriginal: params.preserveOriginal,
                    executionMethod: 'native-puppet'
                }
            };
        } catch (error: any) {
            if (createdDuplicate) {
                await this.deleteLayerIfExists(workingLayerId);
            }
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 尝试打开 Puppet Warp
     * 使用 performMenuCommand
     */
    private async openPuppetWarp(layerId?: number): Promise<ToolResult<any>> {
        try {
            // 如果指定了图层，先选中它
            if (layerId) {
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layerId }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
            }

            // Puppet Warp 的菜单命令 ID
            // 需要通过实验确定，常见的 ID 范围在 1000-5000
            // Edit 菜单下的命令通常在 1000-2000 范围
            const possibleCommandIds = [
                1143,  // 可能的 Puppet Warp ID
                1144,
                1145,
                1116,  // Free Transform
                1117,
            ];

            console.log('[WarpExplorer] 尝试打开 Puppet Warp...');
            
            // 尝试使用已知的菜单命令
            // 注意：这会打开 UI，需要用户交互
            // 在实际使用中，我们需要找到正确的 commandID
            
            return {
                success: true,
                data: {
                    message: 'Puppet Warp 需要通过菜单命令 ID 触发',
                    note: '请在 Photoshop 中使用 Edit > Puppet Warp 并观察 Console',
                    possibleCommandIds
                }
            };
        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 应用 Free Transform Warp（自由变换扭曲）
     * 这是一个可能有 batchPlay 支持的变形方式
     */
    private async applyFreeTransformWarp(layerId?: number, warpParams?: any): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            let layer;
            
            if (layerId) {
                layer = this.findLayerById(doc, layerId);
                if (!layer) {
                    return { success: false, error: `未找到图层 ID: ${layerId}`, data: null };
                }
            } else {
                layer = doc.activeLayers[0];
            }

            console.log(`[WarpExplorer] 尝试对图层 "${layer.name}" 应用 Warp...`);

            await core.executeAsModal(async () => {
                // 首先选中图层
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 尝试应用 Warp 变换
                // 这是 Free Transform 的 Warp 模式的可能命令格式
                const warpDescriptor = {
                    _obj: 'transform',
                    freeTransformCenterState: {
                        _enum: 'quadCenterState',
                        _value: 'QCSAverage'
                    },
                    // Warp 模式
                    warp: {
                        _obj: 'warp',
                        warpStyle: {
                            _enum: 'warpStyle',
                            _value: warpParams?.style || 'warpNone'  // 或 warpArc, warpShell, etc.
                        },
                        warpValue: warpParams?.value || 0,  // 弯曲程度
                        warpPerspective: warpParams?.perspective || 0,
                        warpPerspectiveOther: warpParams?.perspectiveOther || 0,
                        warpRotate: {
                            _enum: 'orientation',
                            _value: warpParams?.rotate || 'horizontal'
                        }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                };

                try {
                    const result = await action.batchPlay([warpDescriptor], { synchronousExecution: true });
                    console.log('[WarpExplorer] Warp 结果:', JSON.stringify(result, null, 2));
                } catch (warpError: any) {
                    console.error('[WarpExplorer] Warp 失败:', warpError.message);
                    throw warpError;
                }

            }, { commandName: 'Apply Warp Transform' });

            return {
                success: true,
                data: {
                    message: 'Warp 变换已应用',
                    layerName: layer.name
                }
            };

        } catch (error: any) {
            console.error('[WarpExplorer] applyFreeTransformWarp 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 获取图层的变形信息
     * 尝试读取已应用的 Warp 或 Puppet Warp 信息
     */
    private async getWarpInfo(layerId?: number): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            let layer;
            
            if (layerId) {
                layer = this.findLayerById(doc, layerId);
            } else {
                layer = doc.activeLayers[0];
            }

            if (!layer) {
                return { success: false, error: '未找到图层', data: null };
            }

            console.log(`[WarpExplorer] 获取图层 "${layer.name}" 的变形信息...`);

            // 尝试获取 Smart Object 的变形信息
            const getDescriptor = {
                _obj: 'get',
                _target: [
                    { _property: 'smartObject' },
                    { _ref: 'layer', _id: layer.id }
                ]
            };

            const result = await action.batchPlay([getDescriptor], { synchronousExecution: true });
            console.log('[WarpExplorer] Smart Object 信息:', JSON.stringify(result, null, 2));

            // 尝试获取 quiltWarp 信息
            const getQuiltWarp = {
                _obj: 'get',
                _target: [
                    { _property: 'quiltWarp' },
                    { _ref: 'layer', _id: layer.id }
                ]
            };

            try {
                const quiltResult = await action.batchPlay([getQuiltWarp], { synchronousExecution: true });
                console.log('[WarpExplorer] QuiltWarp 信息:', JSON.stringify(quiltResult, null, 2));
                return {
                    success: true,
                    data: {
                        smartObject: result?.[0],
                        quiltWarp: quiltResult?.[0]
                    }
                };
            } catch (quiltError) {
                console.log('[WarpExplorer] 无 QuiltWarp 信息');
            }

            return {
                success: true,
                data: {
                    smartObject: result?.[0],
                    note: '图层可能没有应用 Warp 变形'
                }
            };

        } catch (error: any) {
            console.error('[WarpExplorer] getWarpInfo 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 测试各种 Warp 变换命令
     */
    private async testWarpTransform(layerId?: number): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            let layer = layerId ? this.findLayerById(doc, layerId) : doc.activeLayers[0];
            
            if (!layer) {
                return { success: false, error: '未找到图层', data: null };
            }

            console.log('[WarpExplorer] 测试 Warp 变换命令...');

            // 测试可能的 Warp 样式
            const warpStyles = [
                'warpNone',
                'warpArc',
                'warpArcLower',
                'warpArcUpper',
                'warpArch',
                'warpBulge',
                'warpShellLower',
                'warpShellUpper',
                'warpFlag',
                'warpWave',
                'warpFish',
                'warpRise',
                'warpFisheye',
                'warpInflate',
                'warpSqueeze',
                'warpTwist',
                'warpCustom'  // 自定义网格
            ];

            // 尝试应用一个简单的 Arc Warp
            await core.executeAsModal(async () => {
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 尝试 Arc Warp
                const arcWarp = {
                    _obj: 'transform',
                    freeTransformCenterState: {
                        _enum: 'quadCenterState',
                        _value: 'QCSAverage'
                    },
                    warp: {
                        _obj: 'warp',
                        warpStyle: {
                            _enum: 'warpStyle',
                            _value: 'warpArc'
                        },
                        warpValue: 25,  // 弯曲程度 (-100 到 100)
                        warpPerspective: 0,
                        warpPerspectiveOther: 0,
                        warpRotate: {
                            _enum: 'orientation',
                            _value: 'horizontal'
                        }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                };

                try {
                    const result = await action.batchPlay([arcWarp], { synchronousExecution: true });
                    console.log('[WarpExplorer] Arc Warp 结果:', JSON.stringify(result, null, 2));
                } catch (err: any) {
                    console.log('[WarpExplorer] Arc Warp 失败:', err.message);
                }

            }, { commandName: 'Test Warp Transform' });

            return {
                success: true,
                data: {
                    message: '已测试 Warp 变换',
                    availableStyles: warpStyles,
                    note: '检查 Photoshop 图层是否有变化'
                }
            };

        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 列出可能的菜单命令 ID
     */
    private async listPossibleMenuCommands(): Promise<ToolResult<any>> {
        // 常见的 Edit 菜单命令 ID（来自 Photoshop 内部）
        const editMenuCommands = {
            'Free Transform': 1117,
            'Transform > Scale': 1118,
            'Transform > Rotate': 1119,
            'Transform > Skew': 1120,
            'Transform > Distort': 1121,
            'Transform > Perspective': 1122,
            'Transform > Warp': 1123,
            'Transform > Rotate 180': 1124,
            'Transform > Rotate 90 CW': 1125,
            'Transform > Rotate 90 CCW': 1126,
            'Transform > Flip Horizontal': 1127,
            'Transform > Flip Vertical': 1128,
            'Puppet Warp (estimated)': 1143,
            'Content-Aware Scale': 1130,
        };

        console.log('[WarpExplorer] 可能的菜单命令 ID:', editMenuCommands);

        return {
            success: true,
            data: {
                editMenuCommands,
                note: '这些是估计的命令 ID，实际值可能不同'
            }
        };
    }

    /**
     * 测试 QuiltWarp (自定义网格变形)
     * 这是 Photoshop 内部用于存储变形数据的结构
     */
    async testQuiltWarp(layerId?: number): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            
            let layer = layerId ? this.findLayerById(doc, layerId) : doc.activeLayers[0];
            if (!layer) {
                return { success: false, error: '未找到图层', data: null };
            }

            console.log(`[WarpExplorer] 测试 QuiltWarp 对图层 "${layer.name}"...`);

            await core.executeAsModal(async () => {
                // 选中图层
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 尝试 QuiltWarp 命令
                // 这是基于研究发现的可能命令格式
                const quiltWarpDescriptor = {
                    _obj: 'quiltWarp',
                    warpStyle: {
                        _enum: 'warpStyle',
                        _value: 'warpCustom'
                    },
                    // 网格行列数
                    deformNumRows: 4,
                    deformNumCols: 4,
                    // 自定义变形点（16个点 = 4x4 网格）
                    customEnvelopeWarp: {
                        _obj: 'customEnvelopeWarp',
                        meshPoints: this.generateMeshPoints(4, 4, layer.bounds)
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                };

                console.log('[WarpExplorer] QuiltWarp Descriptor:', JSON.stringify(quiltWarpDescriptor, null, 2));

                try {
                    const result = await action.batchPlay([quiltWarpDescriptor], { synchronousExecution: true });
                    console.log('[WarpExplorer] QuiltWarp 结果:', JSON.stringify(result, null, 2));
                } catch (err: any) {
                    console.log('[WarpExplorer] QuiltWarp 失败:', err.message);
                    
                    // 尝试备用方式：使用 transform + warp
                    console.log('[WarpExplorer] 尝试备用方式: transform + customWarp...');
                    
                    const transformWarp = {
                        _obj: 'transform',
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        },
                        warp: {
                            _obj: 'warp',
                            warpStyle: {
                                _enum: 'warpStyle',
                                _value: 'warpCustom'
                            },
                            // 贝塞尔网格变形点
                            warpValue: 0,
                            deformNumRows: 4,
                            deformNumCols: 4,
                            customEnvelopeWarp: {
                                _obj: 'customEnvelopeWarp',
                                meshPoints: this.generateBezierMeshPoints(4, 4, layer.bounds)
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    };

                    try {
                        const result2 = await action.batchPlay([transformWarp], { synchronousExecution: true });
                        console.log('[WarpExplorer] Transform+Warp 结果:', JSON.stringify(result2, null, 2));
                    } catch (err2: any) {
                        console.log('[WarpExplorer] Transform+Warp 也失败:', err2.message);
                        throw err2;
                    }
                }

            }, { commandName: 'Test QuiltWarp' });

            return {
                success: true,
                data: {
                    message: 'QuiltWarp 测试完成',
                    layerName: layer.name
                }
            };

        } catch (error: any) {
            console.error('[WarpExplorer] testQuiltWarp 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 生成网格变形点（简单版）
     */
    private generateMeshPoints(rows: number, cols: number, bounds: any): any[] {
        const points: any[] = [];
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        
        for (let row = 0; row <= rows; row++) {
            for (let col = 0; col <= cols; col++) {
                const x = bounds.left + (width * col / cols);
                const y = bounds.top + (height * row / rows);
                points.push({
                    _obj: 'meshPoint',
                    horizontal: { _unit: 'pixelsUnit', _value: x },
                    vertical: { _unit: 'pixelsUnit', _value: y }
                });
            }
        }
        
        console.log(`[WarpExplorer] 生成 ${points.length} 个网格点`);
        return points;
    }

    /**
     * 生成贝塞尔网格变形点（包含控制柄）
     */
    private generateBezierMeshPoints(rows: number, cols: number, bounds: any): any[] {
        const points: any[] = [];
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        
        // 每个网格点需要锚点 + 控制柄
        for (let row = 0; row <= rows; row++) {
            for (let col = 0; col <= cols; col++) {
                const x = bounds.left + (width * col / cols);
                const y = bounds.top + (height * row / rows);
                
                points.push({
                    _obj: 'pathPoint',
                    anchor: {
                        _obj: 'point',
                        horizontal: { _unit: 'pixelsUnit', _value: x },
                        vertical: { _unit: 'pixelsUnit', _value: y }
                    },
                    forward: {
                        _obj: 'point',
                        horizontal: { _unit: 'pixelsUnit', _value: x + 10 },
                        vertical: { _unit: 'pixelsUnit', _value: y }
                    },
                    backward: {
                        _obj: 'point',
                        horizontal: { _unit: 'pixelsUnit', _value: x - 10 },
                        vertical: { _unit: 'pixelsUnit', _value: y }
                    },
                    smooth: true
                });
            }
        }
        
        return points;
    }

    /**
     * 递归查找图层
     */
    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }

    private async selectLayer(layerId: number): Promise<void> {
        await action.batchPlay([{
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private async ensureSmartObject(layerId: number): Promise<any> {
        const doc = app.activeDocument;
        if (!doc) {
            throw new Error('没有打开的文档');
        }
        const currentLayer = this.findLayerById(doc, layerId);
        if (!currentLayer) {
            throw new Error(`未找到图层 ID: ${layerId}`);
        }

        const layerKind = currentLayer.kind?.toString?.() || '';
        if (String(layerKind).toLowerCase().includes('smartobject')) {
            return currentLayer;
        }

        await this.selectLayer(layerId);
        await action.batchPlay([{
            _obj: 'newPlacedLayer',
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });

        const converted = doc.activeLayers?.[0];
        if (!converted) {
            throw new Error('转换智能对象失败');
        }
        return converted;
    }

    private async deleteLayerIfExists(layerId: number): Promise<void> {
        try {
            const doc = app.activeDocument;
            const layer = doc ? this.findLayerById(doc, layerId) : null;
            if (!layer) {
                return;
            }

            await core.executeAsModal(async () => {
                await action.batchPlay([{
                    _obj: 'delete',
                    _target: [{ _ref: 'layer', _id: layerId }],
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
            }, { commandName: 'Delete Probe Layer' });
        } catch {
            // ignore cleanup failures
        }
    }

    private normalizeBounds(bounds: any): {
        left: number;
        top: number;
        width: number;
        height: number;
    } {
        const left = Number(bounds?.left?._value ?? bounds?.left ?? 0);
        const top = Number(bounds?.top?._value ?? bounds?.top ?? 0);
        const right = Number(bounds?.right?._value ?? bounds?.right ?? left);
        const bottom = Number(bounds?.bottom?._value ?? bounds?.bottom ?? top);
        return {
            left,
            top,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }

    /**
     * 录制 Puppet Warp 动作
     * 通过记录用户手动执行的 Puppet Warp 来获取命令格式
     */
    private async recordPuppetWarpAction(): Promise<ToolResult<any>> {
        try {
            console.log('[WarpExplorer] ===== Puppet Warp 录制指南 =====');
            console.log('1. 请确保 Photoshop 已打开并选中一个图层');
            console.log('2. 手动执行: Edit > Puppet Warp');
            console.log('3. 在图像上添加图钉并移动');
            console.log('4. 按 Enter 确认变形');
            console.log('5. 查看 UXP Developer Tool 控制台输出');
            console.log('');
            console.log('📌 监听 batchPlay 事件...');

            // 使用 Photoshop 的 notifier 监听历史记录变化
            // 这可以捕获到 Puppet Warp 的命令格式
            
            // 获取当前历史记录数量
            const getHistoryState = {
                _obj: 'get',
                _target: [
                    { _property: 'count' },
                    { _ref: 'historyState' }
                ]
            };

            const historyResult = await action.batchPlay([getHistoryState], { synchronousExecution: true });
            const initialHistoryCount = historyResult?.[0]?.count || 0;
            console.log(`[WarpExplorer] 初始历史记录数: ${initialHistoryCount}`);

            // 提供探索性命令尝试
            const possiblePuppetWarpCommands = [
                // 可能的 Puppet Warp 命令结构 1: puppetWarp 对象
                {
                    _obj: 'puppetWarp',
                    meshRigid: true,
                    meshMode: {
                        _enum: 'meshMode',
                        _value: 'normal'  // 或 'rigid', 'distort'
                    },
                    meshDensity: {
                        _enum: 'meshDensity',
                        _value: 'normal'  // 或 'fewer', 'more'
                    },
                    meshExpansion: 15,
                    pins: []  // 图钉位置
                },
                
                // 可能的命令结构 2: transform 包装
                {
                    _obj: 'transform',
                    transformType: {
                        _enum: 'transformType',
                        _value: 'puppetWarp'
                    },
                    puppet: {
                        _obj: 'puppet',
                        mode: 'normal',
                        density: 'normal',
                        expansion: 15
                    }
                },
                
                // 可能的命令结构 3: 使用 eventID
                {
                    _obj: 'make',
                    new: {
                        _class: 'puppetWarp'
                    }
                }
            ];

            return {
                success: true,
                data: {
                    message: '请手动执行 Puppet Warp 并观察控制台',
                    instructions: [
                        '1. 在 Photoshop 中选中一个图层',
                        '2. Edit > Puppet Warp',
                        '3. 添加图钉并移动',
                        '4. 按 Enter 确认',
                        '5. 在 UXP Developer Tool > Console 查看输出'
                    ],
                    possibleCommands: possiblePuppetWarpCommands,
                    note: 'Puppet Warp API 可能需要 Smart Object 或特定图层类型'
                }
            };

        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 测试 Smart Object Warp
     * Smart Object 可能有更好的变形 API 支持
     */
    private async testSmartObjectWarp(layerId?: number, warpParams?: any): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            let layer = layerId ? this.findLayerById(doc, layerId) : doc.activeLayers[0];
            if (!layer) {
                return { success: false, error: '未找到图层', data: null };
            }

            console.log(`[WarpExplorer] 测试 Smart Object Warp 对图层 "${layer.name}"...`);

            await core.executeAsModal(async () => {
                // 1. 检查是否是 Smart Object
                const isSmartObject = layer.kind === 'smartObject';
                console.log(`[WarpExplorer] 图层是否为 Smart Object: ${isSmartObject}`);

                // 2. 如果不是，先转换为 Smart Object
                if (!isSmartObject) {
                    console.log('[WarpExplorer] 转换为 Smart Object...');
                    await action.batchPlay([{
                        _obj: 'newPlacedLayer',
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                }

                // 3. 尝试应用 Smart Object 专属变形
                // Smart Object 可以使用更多变形选项
                const smartWarpCommands = [
                    // 尝试 1: placedLayerEditContents + transform
                    {
                        _obj: 'transform',
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        },
                        warp: {
                            _obj: 'warp',
                            warpStyle: {
                                _enum: 'warpStyle',
                                _value: warpParams?.style || 'warpArc'
                            },
                            warpValue: warpParams?.value || 30,
                            warpPerspective: 0,
                            warpPerspectiveOther: 0,
                            warpRotate: {
                                _enum: 'orientation',
                                _value: 'horizontal'
                            }
                        },
                        interpolation: {
                            _enum: 'interpolationType',
                            _value: 'bicubic'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ];

                for (const cmd of smartWarpCommands) {
                    try {
                        console.log('[WarpExplorer] 尝试命令:', JSON.stringify(cmd, null, 2));
                        const result = await action.batchPlay([cmd], { synchronousExecution: true });
                        console.log('[WarpExplorer] 结果:', JSON.stringify(result, null, 2));
                    } catch (err: any) {
                        console.log('[WarpExplorer] 命令失败:', err.message);
                    }
                }

            }, { commandName: 'Smart Object Warp Test' });

            return {
                success: true,
                data: {
                    message: 'Smart Object Warp 测试完成',
                    layerName: layer.name,
                    warpParams
                }
            };

        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 测试 Perspective Warp
     * 透视变形 - 另一种高级变形方式
     */
    private async testPerspectiveWarp(layerId?: number): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            let layer = layerId ? this.findLayerById(doc, layerId) : doc.activeLayers[0];
            if (!layer) {
                return { success: false, error: '未找到图层', data: null };
            }

            console.log(`[WarpExplorer] 测试 Perspective Warp...`);

            // Perspective Warp 的可能命令结构
            const perspectiveWarpInfo = {
                description: 'Perspective Warp 是另一种高级变形工具',
                menuLocation: 'Edit > Perspective Warp',
                possibleCommands: [
                    {
                        _obj: 'perspectiveWarp',
                        mode: 'layout',  // 或 'warp'
                        quads: []  // 四边形区域定义
                    },
                    {
                        _obj: 'transform',
                        transformType: {
                            _enum: 'transformType',
                            _value: 'perspectiveWarp'
                        }
                    }
                ],
                note: 'Perspective Warp 需要先定义网格再变形，比 Puppet Warp 更适合建筑透视校正'
            };

            console.log('[WarpExplorer] Perspective Warp 信息:', JSON.stringify(perspectiveWarpInfo, null, 2));

            return {
                success: true,
                data: perspectiveWarpInfo
            };

        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }
}

export default WarpExplorerTool;
