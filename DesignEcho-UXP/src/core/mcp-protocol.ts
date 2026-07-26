/**
 * MCP (Model Context Protocol) 协议实现
 * 
 * 使 UXP 插件符合 MCP 标准，可被任何 MCP 客户端调用
 * 参考: https://modelcontextprotocol.io/
 */

import { ToolRegistry } from '../tools/registry';
import { ToolExecutionContext } from '../tools/types';
import {
    executeToolWithPhotoshopTargetGuard,
    stripPhotoshopTargetGuard
} from './photoshop-target-guard';
import { createToolFailureResult } from './tool-error-normalizer';

// MCP 协议版本
export const MCP_VERSION = '2024-11-05';

// MCP 服务器信息
export const SERVER_INFO = {
    name: 'designecho-photoshop',
    version: '1.0.0',
    description: 'DesignEcho Photoshop UXP Plugin - MCP Server for Adobe Photoshop automation',
    vendor: 'DesignEcho'
};

// MCP 能力声明
export const SERVER_CAPABILITIES = {
    tools: {
        listChanged: true  // 工具列表可能动态变化
    },
    resources: {
        subscribe: false,  // 暂不支持资源订阅
        listChanged: true
    },
    prompts: {
        listChanged: false  // 提示词是静态的
    },
    logging: {}
};

/**
 * MCP 工具定义格式
 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * MCP 资源定义
 */
export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

/**
 * MCP 提示词定义
 */
export interface MCPPrompt {
    name: string;
    description: string;
    arguments?: {
        name: string;
        description: string;
        required?: boolean;
    }[];
}

/**
 * MCP 协议处理器
 */
export class MCPProtocolHandler {
    private toolRegistry: ToolRegistry;
    private initialized: boolean = false;
    private clientInfo: any = null;

    constructor(toolRegistry: ToolRegistry) {
        this.toolRegistry = toolRegistry;
    }

    /**
     * 处理 MCP 方法调用
     */
    async handleMethod(method: string, params: any, context?: ToolExecutionContext): Promise<any> {
        const loggedParams = method === 'tools/call' && params && typeof params === 'object'
            ? {
                ...params,
                arguments: stripPhotoshopTargetGuard(params.arguments)
            }
            : stripPhotoshopTargetGuard(params);
        console.log(`[MCP] 处理方法: ${method}`, loggedParams);

        switch (method) {
            // === 初始化 ===
            case 'initialize':
                return this.handleInitialize(params);
            
            case 'initialized':
                return this.handleInitialized();

            // === 工具 ===
            case 'tools/list':
                return this.handleToolsList();
            
            case 'tools/call':
                return this.handleToolsCall(params, context);

            // === 资源 ===
            case 'resources/list':
                return this.handleResourcesList();
            
            case 'resources/read':
                return this.handleResourcesRead(params);
            
            case 'resources/templates/list':
                return this.handleResourceTemplatesList();

            // === 提示词 ===
            case 'prompts/list':
                return this.handlePromptsList();
            
            case 'prompts/get':
                return this.handlePromptsGet(params);

            // === 日志 ===
            case 'logging/setLevel':
                return this.handleLoggingSetLevel(params);

            // === 心跳 ===
            case 'ping':
                return { status: 'pong' };

            default:
                // 尝试作为工具调用处理（兼容旧格式）
                // 支持两种格式：直接工具名（如 "getLayerHierarchy"）或 "tool.xxx" 格式
                let toolName = method;
                if (method.startsWith('tool.')) {
                    toolName = method.substring(5);  // 去掉 "tool." 前缀
                }
                
                if (this.toolRegistry.getTool(toolName)) {
                    return this.handleLegacyToolCall(toolName, params, context);
                }
                throw new Error(`Unknown method: ${method}`);
        }
    }

    /**
     * 处理初始化请求
     */
    private handleInitialize(params: any): any {
        console.log('[MCP] 初始化请求:', params);
        
        this.clientInfo = params.clientInfo || null;
        
        return {
            protocolVersion: MCP_VERSION,
            capabilities: SERVER_CAPABILITIES,
            serverInfo: SERVER_INFO
        };
    }

    /**
     * 处理初始化完成通知
     */
    private handleInitialized(): void {
        console.log('[MCP] 初始化完成');
        this.initialized = true;
    }

    /**
     * 获取工具列表
     */
    private handleToolsList(): { tools: MCPTool[] } {
        const schemas = this.toolRegistry.getAllSchemas();
        
        const tools: MCPTool[] = schemas.map(schema => ({
            name: schema.name,
            description: schema.description,
            inputSchema: {
                type: 'object',
                properties: schema.parameters.properties,
                required: schema.parameters.required || []
            }
        }));

        console.log(`[MCP] 返回 ${tools.length} 个工具`);
        return { tools };
    }

    /**
     * 调用工具
     */
    private async handleToolsCall(params: { name: string; arguments?: any }, context?: ToolExecutionContext): Promise<any> {
        const { name, arguments: args } = params;
        
        console.log(`[MCP] 调用工具: ${name}`, stripPhotoshopTargetGuard(args));
        const result = await this.executeTool(name, args || {}, context);
        
        // MCP 标准返回格式
        return {
            content: [
                {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }
            ],
            isError: (result as any)?.success === false
        };
    }

    /**
     * 兼容旧的工具调用格式
     */
    private async handleLegacyToolCall(method: string, params: any, context?: ToolExecutionContext): Promise<any> {
        return await this.executeTool(method, params || {}, context);
    }

    /**
     * 统一工具执行入口
     * MCP tools/call 与 legacy tool.xxx 必须经过同一执行路径
     */
    private async executeTool(name: string, args: any, context?: ToolExecutionContext): Promise<any> {
        const tool = this.toolRegistry.getTool(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }
        try {
            return await executeToolWithPhotoshopTargetGuard(tool, args || {}, context);
        } catch (error: any) {
            console.error(`[MCP] 工具执行失败:`, error);
            return createToolFailureResult({
                toolName: name,
                error,
                params: stripPhotoshopTargetGuard(args || {})
            });
        }
    }

    /**
     * 获取资源列表
     */
    private handleResourcesList(): { resources: MCPResource[] } {
        const resources: MCPResource[] = [];
        
        // 动态获取当前 Photoshop 状态
        try {
            const app = require('photoshop').app;
            const doc = app.activeDocument;
            
            if (doc) {
                // 文档作为资源
                resources.push({
                    uri: `photoshop://document/${doc.id}`,
                    name: doc.name,
                    description: `当前文档: ${doc.width}x${doc.height}px`,
                    mimeType: 'application/vnd.adobe.photoshop'
                });

                // 每个图层作为资源
                const addLayerResources = (layers: any[], parentPath: string = '') => {
                    for (const layer of layers) {
                        const path = parentPath ? `${parentPath}/${layer.name}` : layer.name;
                        resources.push({
                            uri: `photoshop://layer/${doc.id}/${layer.id}`,
                            name: path,
                            description: `图层类型: ${layer.kind || 'unknown'}`,
                            mimeType: layer.kind === 1 ? 'text/plain' : 'image/png'  // 1 = TEXT
                        });
                        
                        if (layer.layers) {
                            addLayerResources(layer.layers, path);
                        }
                    }
                };
                
                addLayerResources(doc.layers || []);
            }
        } catch (e) {
            console.warn('[MCP] 获取资源列表失败:', e);
        }

        console.log(`[MCP] 返回 ${resources.length} 个资源`);
        return { resources };
    }

    /**
     * 读取资源
     */
    private async handleResourcesRead(params: { uri: string }): Promise<any> {
        const { uri } = params;
        console.log(`[MCP] 读取资源: ${uri}`);

        // 解析 URI: photoshop://document/123 | photoshop://layer/123/456 | photoshop://document/123/layers
        const docLayersMatch = uri.match(/^photoshop:\/\/(document)\/(\d+)\/layers$/);
        const standardMatch = uri.match(/^photoshop:\/\/(document|layer)\/(\d+)(?:\/(\d+))?$/);
        if (!standardMatch && !docLayersMatch) {
            throw new Error(`Invalid resource URI: ${uri}`);
        }

        let type: string, docIdStr: string, layerId: string | undefined;
        if (docLayersMatch) {
            type = 'document';
            docIdStr = docLayersMatch[2];
            layerId = 'layers';
        } else {
            [, type, docIdStr, layerId] = standardMatch!;
        }
        const docId = parseInt(docIdStr, 10);
        const app = require('photoshop').app;
        let doc: any = null;
        for (let i = 0; i < app.documents.length; i++) {
            if (app.documents[i].id === docId) {
                doc = app.documents[i];
                break;
            }
        }
        if (!doc) doc = app.activeDocument;
        if (!doc || doc.id !== docId) {
            throw new Error(`Document not found: ${docId}`);
        }

        if (type === 'document') {
            if (layerId === 'layers') {
                // 返回文档图层树
                const buildLayerTree = (layers: any[]): any[] => {
                    return (layers || []).map((l: any) => ({
                        id: l.id,
                        name: l.name,
                        kind: l.kind?.toString(),
                        visible: l.visible,
                        layers: l.layers ? buildLayerTree(l.layers) : undefined
                    }));
                };
                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify({
                                documentId: doc.id,
                                documentName: doc.name,
                                layers: buildLayerTree(doc.layers || [])
                            }, null, 2)
                        }
                    ]
                };
            }
            // 返回文档信息
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            id: doc.id,
                            name: doc.name,
                            width: doc.width,
                            height: doc.height,
                            resolution: doc.resolution,
                            mode: doc.mode?.toString(),
                            layerCount: doc.layers?.length || 0
                        }, null, 2)
                    }
                ]
            };
        } else if (type === 'layer' && layerId && layerId !== 'layers') {
            // 返回图层信息
            const layer = this.findLayerById(doc, parseInt(layerId));
            if (!layer) {
                throw new Error(`Layer not found: ${layerId}`);
            }

            const layerInfo: any = {
                id: layer.id,
                name: layer.name,
                kind: layer.kind?.toString(),
                visible: layer.visible,
                locked: layer.locked,
                bounds: layer.bounds ? {
                    left: layer.bounds.left,
                    top: layer.bounds.top,
                    right: layer.bounds.right,
                    bottom: layer.bounds.bottom
                } : null
            };

            // 如果是文本图层，包含文本内容
            if (layer.kind === 1 && layer.textItem) {  // 1 = TEXT
                layerInfo.textContent = layer.textItem.contents;
            }

            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(layerInfo, null, 2)
                    }
                ]
            };
        }

        throw new Error(`Unknown resource type: ${type}`);
    }

    /**
     * 获取资源模板列表
     */
    private handleResourceTemplatesList(): { resourceTemplates: any[] } {
        return {
            resourceTemplates: [
                {
                    uriTemplate: 'photoshop://document/{docId}',
                    name: 'Photoshop Document',
                    description: '获取文档信息（尺寸、分辨率、模式）',
                    mimeType: 'application/json'
                },
                {
                    uriTemplate: 'photoshop://layer/{docId}/{layerId}',
                    name: 'Photoshop Layer',
                    description: '获取图层信息（边界、类型、可见性、文本内容）',
                    mimeType: 'application/json'
                },
                {
                    uriTemplate: 'photoshop://document/{docId}/layers',
                    name: 'Document Layer Tree',
                    description: '获取文档完整图层树结构',
                    mimeType: 'application/json'
                }
            ]
        };
    }

    /**
     * 获取提示词列表
     */
    private handlePromptsList(): { prompts: MCPPrompt[] } {
        const prompts: MCPPrompt[] = [
            {
                name: 'layout-analysis',
                description: '分析 Photoshop 文档的排版布局，检测字间距、行高、对齐等问题',
                arguments: [
                    {
                        name: 'focusArea',
                        description: '重点关注的区域（可选）：header, body, footer, all',
                        required: false
                    }
                ]
            },
            {
                name: 'text-optimize',
                description: '优化营销文案，使其更具吸引力和说服力',
                arguments: [
                    {
                        name: 'text',
                        description: '需要优化的文案内容',
                        required: true
                    },
                    {
                        name: 'style',
                        description: '风格：professional, casual, creative, urgent',
                        required: false
                    }
                ]
            },
            {
                name: 'visual-compare',
                description: '对比参考图和当前设计，分析差异并给出建议',
                arguments: [
                    {
                        name: 'referenceImage',
                        description: '参考图的 base64 数据',
                        required: true
                    }
                ]
            },
            {
                name: 'design-review',
                description: '全面审查当前设计的视觉效果和用户体验',
                arguments: []
            },
            {
                name: 'sku-batch-analyze',
                description: '分析 SKU 素材并规划颜色组合，输出可执行的组合方案',
                arguments: [
                    {
                        name: 'comboSizes',
                        description: '目标规格，如 [2, 3, 4, 5] 表示 2双/3双/4双/5双',
                        required: false
                    },
                    {
                        name: 'countPerSize',
                        description: '每种规格的组合数量',
                        required: false
                    }
                ]
            },
            {
                name: 'layer-style-audit',
                description: '审计图层样式一致性（混合模式、不透明度、效果）',
                arguments: [
                    {
                        name: 'scope',
                        description: '范围：selected | visible | all',
                        required: false
                    }
                ]
            },
            {
                name: 'export-optimization',
                description: '优化导出设置（格式、质量、尺寸）并执行批量导出',
                arguments: [
                    {
                        name: 'format',
                        description: '导出格式：jpg | png | webp',
                        required: false
                    },
                    {
                        name: 'quality',
                        description: 'JPEG 质量 1-12',
                        required: false
                    }
                ]
            }
        ];

        console.log(`[MCP] 返回 ${prompts.length} 个提示词`);
        return { prompts };
    }

    /**
     * 获取提示词内容
     */
    private async handlePromptsGet(params: { name: string; arguments?: Record<string, string> }): Promise<any> {
        const { name, arguments: args } = params;
        console.log(`[MCP] 获取提示词: ${name}`, args);

        const prompts: Record<string, (args: any) => any> = {
            'layout-analysis': (a) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请分析当前 Photoshop 文档的排版布局。
${a?.focusArea ? `重点关注: ${a.focusArea}` : '检查所有区域'}

请检查以下方面：
1. 字间距 (tracking) 是否合适
2. 行高 (leading) 是否合理
3. 元素对齐是否规范
4. 视觉层级是否清晰
5. 留白是否均衡

请使用 diagnoseState 和 getAllTextLayers 工具获取当前文档信息，然后给出具体的优化建议。`
                        }
                    }
                ]
            }),
            
            'text-optimize': (a) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请优化以下营销文案：

"${a?.text || '（请提供文案内容）'}"

${a?.style ? `风格要求: ${a.style}` : ''}

要求：
1. 保持核心信息不变
2. 增强吸引力和说服力
3. 控制字数，适合视觉设计
4. 提供 3 个优化版本供选择`
                        }
                    }
                ]
            }),
            
            'visual-compare': (a) => ({
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: '请对比这张参考图和当前设计，分析视觉差异并给出具体的修改建议。'
                            },
                            a?.referenceImage ? {
                                type: 'image',
                                data: a.referenceImage,
                                mimeType: 'image/png'
                            } : null
                        ].filter(Boolean)
                    }
                ]
            }),
            
            'design-review': () => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请全面审查当前 Photoshop 设计。

使用以下工具获取信息：
1. diagnoseState - 获取当前状态
2. getDocumentInfo - 获取文档信息
3. getAllTextLayers - 获取所有文本图层

然后从以下方面进行评估：
1. 整体视觉平衡
2. 配色协调性
3. 字体选择
4. 排版规范性
5. 信息层级
6. 用户体验

请给出综合评分 (1-100) 和具体改进建议。`
                        }
                    }
                ]
            }),
            'sku-batch-analyze': (a: any) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请分析当前 SKU 素材并规划颜色组合。

使用 skuLayout action=listLayerSets 获取颜色列表，然后：
1. 分析色系搭配
2. 规划组合方案（规格: ${JSON.stringify(a?.comboSizes || [2, 3, 4, 5])}，每规格 ${a?.countPerSize || 6} 个）
3. 输出可直接用于 sku-batch 技能的参数`
                        }
                    }
                ]
            }),
            'layer-style-audit': (a: any) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请审计图层样式一致性（范围: ${a?.scope || 'visible'}）。

使用 getLayerHierarchy、getLayerProperties 获取图层信息，检查：
1. 混合模式是否统一
2. 不透明度是否一致
3. 图层效果（投影、描边等）是否规范
4. 输出不一致项及修复建议`
                        }
                    }
                ]
            }),
            'export-optimization': (a: any) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `请优化导出设置并执行。

格式: ${a?.format || 'jpg'}，质量: ${a?.quality || 12}
使用 quickExport 或 batchExport 工具，确保输出符合电商平台要求。`
                        }
                    }
                ]
            })
        };

        const promptGenerator = prompts[name];
        if (!promptGenerator) {
            throw new Error(`Prompt not found: ${name}`);
        }

        return promptGenerator(args || {});
    }

    /**
     * 设置日志级别
     */
    private handleLoggingSetLevel(params: { level: string }): void {
        console.log(`[MCP] 设置日志级别: ${params.level}`);
        // 可以在这里实现日志级别控制
    }

    /**
     * 辅助方法：查找图层
     */
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

    /**
     * 检查是否已初始化
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * 获取客户端信息
     */
    getClientInfo(): any {
        return this.clientInfo;
    }
}
