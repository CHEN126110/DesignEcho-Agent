# Agent Skills 与工具系统最佳实践

> **适用版本**: DesignEcho 2.0+  
> **更新日期**: 2026-01-25  
> **参考框架**: Mastra, ii-agent, MCP

---

## 目录

1. [Skills 系统概述](#1-skills-系统概述)
2. [工具基类设计](#2-工具基类设计)
3. [工具注册与管理](#3-工具注册与管理)
4. [执行上下文](#4-执行上下文)
5. [参数校验](#5-参数校验)
6. [异步执行模式](#6-异步执行模式)
7. [工具分类标准](#7-工具分类标准)
8. [Agent 工作流](#8-agent-工作流)
9. [多智能体协同](#9-多智能体协同)
10. [最新实践案例](#10-最新实践案例)

---

## 1. Skills 系统概述

### 1.1 什么是 Skills

**Skills（技能）** 是 Agent 能够执行的原子操作单元。在 DesignEcho 中：

- **Tool (工具)**: 单一功能的执行单元，如 `GetLayerBounds`
- **Skill (技能)**: 一组相关工具的集合，如 "图层操作" 技能包含移动、缩放、旋转等工具
- **Capability (能力)**: 更高层次的功能集，如 "智能抠图" 包含检测、分割、应用蒙版等技能

### 1.2 DesignEcho 中的实现

```
┌─────────────────────────────────────────────────────────┐
│                    Agent 决策层                          │
│  (根据用户意图选择调用哪些 Skills/Tools)                  │
├─────────────────────────────────────────────────────────┤
│                    Skills 集合                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │  图层技能    │ │  画布技能    │ │  图像处理技能    │ │
│  │ - Move      │ │ - Create    │ │ - Matting       │ │
│  │ - Resize    │ │ - Crop      │ │ - Inpainting    │ │
│  │ - Rotate    │ │ - Export    │ │ - ColorAdjust   │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    ToolRegistry                          │
│               (工具注册表 - 统一管理)                     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 工具基类设计

### 2.1 接口定义

```typescript
// 工具接口规范
interface ITool {
    // 元数据
    name: string;           // 工具唯一标识
    description: string;    // 工具描述（供 LLM 理解）
    category: ToolCategory; // 工具分类
    
    // Schema
    inputSchema: JSONSchema;  // 输入参数 Schema
    outputSchema?: JSONSchema; // 输出结果 Schema（可选）
    
    // 执行
    execute(params: unknown, context: ExecutionContext): Promise<ToolResult>;
    
    // 生命周期
    initialize?(): Promise<void>;
    dispose?(): void;
}

// 执行结果
interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
    logs?: string[];      // 执行日志
    metadata?: {
        duration: number;  // 执行耗时
        cached: boolean;   // 是否使用缓存
    };
}
```

### 2.2 基类实现

```typescript
// tools/base-tool.ts
abstract class BaseTool implements ITool {
    abstract name: string;
    abstract description: string;
    abstract inputSchema: JSONSchema;
    
    category: ToolCategory = 'general';
    
    async execute(params: unknown, context: ExecutionContext): Promise<ToolResult> {
        const startTime = Date.now();
        const logs: string[] = [];
        
        try {
            // 1. 参数校验
            const validated = this.validateParams(params);
            if (!validated.valid) {
                return {
                    success: false,
                    error: { code: 'INVALID_PARAMS', message: validated.error! }
                };
            }
            
            // 2. 执行前钩子
            await this.beforeExecute?.(validated.data, context);
            logs.push(`[${this.name}] Executing...`);
            
            // 3. 核心执行
            const result = await this.doExecute(validated.data, context);
            
            // 4. 执行后钩子
            await this.afterExecute?.(result, context);
            
            return {
                success: true,
                data: result,
                logs,
                metadata: {
                    duration: Date.now() - startTime,
                    cached: false
                }
            };
            
        } catch (error: any) {
            logs.push(`[${this.name}] Error: ${error.message}`);
            return {
                success: false,
                error: { code: 'EXECUTION_ERROR', message: error.message },
                logs,
                metadata: { duration: Date.now() - startTime, cached: false }
            };
        }
    }
    
    // 子类实现核心逻辑
    abstract doExecute(params: unknown, context: ExecutionContext): Promise<unknown>;
    
    // 可选钩子
    beforeExecute?(params: unknown, context: ExecutionContext): Promise<void>;
    afterExecute?(result: unknown, context: ExecutionContext): Promise<void>;
    
    // 参数校验
    private validateParams(params: unknown): { valid: boolean; data?: unknown; error?: string } {
        // 使用 JSON Schema 校验
        // ...
    }
}
```

### 2.3 具体工具示例

```typescript
// tools/layer/get-layer-bounds.ts
class GetLayerBoundsTool extends BaseTool {
    name = 'getLayerBounds';
    description = '获取指定图层的边界框坐标';
    category: ToolCategory = 'layer';
    
    inputSchema = {
        type: 'object',
        properties: {
            layerId: { type: 'number', description: '图层 ID' }
        },
        required: ['layerId']
    };
    
    async doExecute(params: { layerId: number }, context: ExecutionContext) {
        const { app, action } = require('photoshop');
        
        const result = await action.batchPlay([{
            _obj: 'get',
            _target: [
                { _property: 'bounds' },
                { _ref: 'layer', _id: params.layerId }
            ]
        }], { synchronousExecution: true });
        
        const bounds = result[0].bounds;
        return {
            left: bounds.left._value,
            top: bounds.top._value,
            right: bounds.right._value,
            bottom: bounds.bottom._value,
            width: bounds.right._value - bounds.left._value,
            height: bounds.bottom._value - bounds.top._value
        };
    }
}
```

---

## 3. 工具注册与管理

### 3.1 工具注册表

```typescript
// tools/registry.ts
class ToolRegistry {
    private tools: Map<string, ITool> = new Map();
    private categories: Map<ToolCategory, string[]> = new Map();
    
    // 注册工具
    register(tool: ITool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" already registered`);
        }
        
        this.tools.set(tool.name, tool);
        
        // 分类索引
        const categoryTools = this.categories.get(tool.category) || [];
        categoryTools.push(tool.name);
        this.categories.set(tool.category, categoryTools);
        
        console.log(`[Registry] Registered: ${tool.name} (${tool.category})`);
    }
    
    // 批量注册
    registerAll(tools: ITool[]): void {
        tools.forEach(tool => this.register(tool));
    }
    
    // 获取工具
    get(name: string): ITool | undefined {
        return this.tools.get(name);
    }
    
    // 按分类获取
    getByCategory(category: ToolCategory): ITool[] {
        const names = this.categories.get(category) || [];
        return names.map(name => this.tools.get(name)!);
    }
    
    // 生成工具列表（供 LLM）
    getToolDescriptions(): ToolDescription[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }));
    }
    
    // 条件加载
    async loadConditionally(condition: () => boolean, tools: ITool[]): Promise<void> {
        if (condition()) {
            this.registerAll(tools);
        }
    }
}

// 单例导出
export const toolRegistry = new ToolRegistry();
```

### 3.2 动态加载模式

```typescript
// 基于环境变量条件加载
async function initializeTools() {
    const registry = toolRegistry;
    
    // 核心工具（始终加载）
    registry.registerAll([
        new GetLayerBoundsTool(),
        new MoveLayerTool(),
        new GetDocumentInfoTool()
    ]);
    
    // 高级工具（按需加载）
    if (process.env.ENABLE_ADVANCED_TOOLS === 'true') {
        registry.registerAll([
            new InpaintingTool(),
            new GenerativeBackgroundTool()
        ]);
    }
    
    // GPU 工具（检测硬件）
    const hasGPU = await checkGPUAvailability();
    if (hasGPU) {
        registry.registerAll([
            new GPUAcceleratedMattingTool()
        ]);
    }
    
    console.log(`[Init] ${registry.size} tools registered`);
}
```

---

## 4. 执行上下文

### 4.1 上下文定义

```typescript
interface ExecutionContext {
    // 请求信息
    requestId: string;
    timestamp: number;
    
    // 用户会话
    sessionId?: string;
    userId?: string;
    
    // Photoshop 状态
    activeDocument?: {
        id: number;
        name: string;
        width: number;
        height: number;
    };
    activeLayer?: {
        id: number;
        name: string;
    };
    
    // 共享状态
    sharedState: Map<string, unknown>;
    
    // 日志
    log: (message: string) => void;
    
    // 进度报告
    reportProgress: (percent: number, message?: string) => void;
    
    // 中断信号
    abortSignal?: AbortSignal;
}
```

### 4.2 上下文传递

```typescript
// 创建上下文
function createContext(request: IncomingRequest): ExecutionContext {
    const sharedState = new Map<string, unknown>();
    
    return {
        requestId: request.id,
        timestamp: Date.now(),
        
        sharedState,
        
        log: (message) => {
            console.log(`[${request.id}] ${message}`);
        },
        
        reportProgress: (percent, message) => {
            wsServer.sendNotification('progress', {
                requestId: request.id,
                percent,
                message
            });
        }
    };
}

// 工具间共享数据
async function executeWorkflow(context: ExecutionContext) {
    // 工具 A 设置共享数据
    const boundsResult = await registry.get('getLayerBounds')?.execute(
        { layerId: 123 }, 
        context
    );
    context.sharedState.set('layerBounds', boundsResult.data);
    
    // 工具 B 读取共享数据
    const bounds = context.sharedState.get('layerBounds');
    await registry.get('cropCanvas')?.execute(
        { ...bounds }, 
        context
    );
}
```

---

## 5. 参数校验

### 5.1 JSON Schema 校验

```typescript
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

function validateWithSchema(data: unknown, schema: JSONSchema): ValidationResult {
    const validate = ajv.compile(schema);
    const valid = validate(data);
    
    
    if (valid) {
        return { valid: true, data };
    }
    
    return {
        valid: false,
        error: ajv.errorsText(validate.errors)
    };
}
```

### 5.2 Zod 校验（类型安全）

```typescript
import { z } from 'zod';

// 定义 Schema
const MoveLayerParams = z.object({
    layerId: z.number().int().positive(),
    deltaX: z.number(),
    deltaY: z.number(),
    relative: z.boolean().default(true)
});

type MoveLayerInput = z.infer<typeof MoveLayerParams>;

// 在工具中使用
class MoveLayerTool extends BaseTool {
    private schema = MoveLayerParams;
    
    async doExecute(params: unknown, context: ExecutionContext) {
        const validated = this.schema.parse(params); // 自动类型推断
        // validated: MoveLayerInput
        
        await moveLayer(validated.layerId, validated.deltaX, validated.deltaY);
    }
}
```

---

## 6. 异步执行模式

### 6.1 长任务处理

```typescript
// 支持中断的长任务
async function executeWithAbort(
    task: () => Promise<unknown>,
    signal?: AbortSignal
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        // 检查是否已中断
        if (signal?.aborted) {
            reject(new Error('Task aborted'));
            return;
        }
        
        // 监听中断信号
        signal?.addEventListener('abort', () => {
            reject(new Error('Task aborted'));
        });
        
        // 执行任务
        task().then(resolve).catch(reject);
    });
}

// 使用
async execute(params: unknown, context: ExecutionContext) {
    const result = await executeWithAbort(
        () => this.runInference(params),
        context.abortSignal
    );
    return result;
}
```

### 6.2 进度报告

```typescript
// 分步进度报告
async function removeBackgroundWithProgress(
    imageData: Buffer,
    context: ExecutionContext
): Promise<Buffer> {
    context.reportProgress(0, '开始处理...');
    
    context.reportProgress(10, '加载模型...');
    await loadModel();
    
    context.reportProgress(30, '预处理图像...');
    const preprocessed = await preprocess(imageData);
    
    context.reportProgress(50, 'AI 推理中...');
    const mask = await runInference(preprocessed);
    
    context.reportProgress(80, '后处理...');
    const result = await postprocess(mask);
    
    context.reportProgress(100, '完成');
    return result;
}
```

---

## 7. 工具分类标准

### 7.1 分类枚举

```typescript
type ToolCategory = 
    | 'layer'      // 图层操作
    | 'canvas'     // 画布操作
    | 'image'      // 图像处理
    | 'text'       // 文字操作
    | 'layout'     // 布局排版
    | 'morphing'   // 形态变换
    | 'ai'         // AI 功能
    | 'export'     // 导出
    | 'system';    // 系统
```

### 7.2 DesignEcho 工具分类

| 分类 | 工具数量 | 示例 |
|------|----------|------|
| **layer** | 15+ | GetLayerBounds, MoveLayer, DeleteLayer |
| **canvas** | 10+ | CreateDocument, CropCanvas, ResizeCanvas |
| **image** | 8+ | GetPixelData, ApplyMattingResult |
| **text** | 5+ | CreateTextLayer, UpdateTextContent |
| **layout** | 12+ | AnalyzeLayout, AlignElements |
| **morphing** | 8+ | MorphToShape, DetectContours |
| **ai** | 5+ | RemoveBackground, Inpainting |
| **system** | 3+ | GetDocumentInfo, GetSystemInfo |

---

## 8. Agent 工作流

### 8.1 工作流定义

```typescript
interface Workflow {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    triggers?: WorkflowTrigger[];
}

interface WorkflowStep {
    id: string;
    tool: string;           // 工具名称
    params: Record<string, unknown> | ParamResolver;
    condition?: (context: ExecutionContext) => boolean;
    onError?: 'stop' | 'continue' | 'retry';
    maxRetries?: number;
}

type ParamResolver = (context: ExecutionContext) => Record<string, unknown>;
```

### 8.2 工作流执行器

```typescript
class WorkflowExecutor {
    constructor(private registry: ToolRegistry) {}
    
    async execute(workflow: Workflow, context: ExecutionContext): Promise<WorkflowResult> {
        const results: StepResult[] = [];
        
        for (const step of workflow.steps) {
            // 条件检查
            if (step.condition && !step.condition(context)) {
                console.log(`[Workflow] Skipping step: ${step.id}`);
                continue;
            }
            
            // 获取工具
            const tool = this.registry.get(step.tool);
            if (!tool) {
                throw new Error(`Tool not found: ${step.tool}`);
            }
            
            // 解析参数
            const params = typeof step.params === 'function' 
                ? step.params(context) 
                : step.params;
            
            // 执行（带重试）
            let result: ToolResult;
            let retries = 0;
            
            do {
                result = await tool.execute(params, context);
                
                if (result.success) break;
                
                if (step.onError === 'retry' && retries < (step.maxRetries || 3)) {
                    retries++;
                    console.log(`[Workflow] Retrying step ${step.id} (${retries})`);
                }
            } while (retries < (step.maxRetries || 3));
            
            // 存储结果
            context.sharedState.set(`step.${step.id}`, result.data);
            results.push({ stepId: step.id, result });
            
            // 错误处理
            if (!result.success && step.onError === 'stop') {
                return { success: false, results, error: result.error };
            }
        }
        
        return { success: true, results };
    }
}
```

### 8.3 工作流示例

```typescript
// 一键美化工作流
const beautifyWorkflow: Workflow = {
    id: 'one-click-beautify',
    name: '一键美化',
    description: '自动优化设计稿的布局和文字',
    steps: [
        {
            id: 'analyze',
            tool: 'analyzeLayout',
            params: {},
            onError: 'stop'
        },
        {
            id: 'optimize-text',
            tool: 'optimizeTextLayers',
            params: (ctx) => ({
                layoutInfo: ctx.sharedState.get('step.analyze')
            })
        },
        {
            id: 'align',
            tool: 'autoAlign',
            params: (ctx) => ({
                elements: ctx.sharedState.get('step.analyze').elements
            }),
            condition: (ctx) => {
                const layout = ctx.sharedState.get('step.analyze') as any;
                return layout?.needsAlignment === true;
            }
        }
    ]
};
```

---

## 9. 多智能体协同

### 9.1 协同模式

```
┌─────────────────────────────────────────────────────────┐
│                    协调者 (Orchestrator)                 │
│                 接收任务 → 分解 → 分发 → 汇总             │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │  设计分析     │ │  布局优化     │ │    图像处理      │ │
│  │   Agent      │ │   Agent      │ │     Agent       │ │
│  │             │ │              │ │                 │ │
│  │ - 分析结构   │ │ - 调整间距   │ │ - 抠图          │ │
│  │ - 提取颜色   │ │ - 对齐元素   │ │ - 调色          │ │
│  │ - 识别风格   │ │ - 优化排版   │ │ - 特效          │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 9.2 消息传递

```typescript
interface AgentMessage {
    from: string;
    to: string;
    type: 'request' | 'response' | 'event';
    payload: unknown;
    timestamp: number;
}

class AgentCoordinator {
    private agents: Map<string, Agent> = new Map();
    private messageQueue: AgentMessage[] = [];
    
    async dispatch(message: AgentMessage): Promise<AgentMessage> {
        const targetAgent = this.agents.get(message.to);
        if (!targetAgent) {
            throw new Error(`Agent not found: ${message.to}`);
        }
        
        return await targetAgent.handleMessage(message);
    }
    
    // 并行执行多个 Agent
    async parallel(
        tasks: { agent: string; payload: unknown }[]
    ): Promise<unknown[]> {
        const promises = tasks.map(task => 
            this.dispatch({
                from: 'orchestrator',
                to: task.agent,
                type: 'request',
                payload: task.payload,
                timestamp: Date.now()
            })
        );
        
        return await Promise.all(promises);
    }
}
```

---

## 10. 最新实践案例

### 10.1 智能抠图 Skill

```typescript
// 完整的智能抠图技能实现
class IntelligentMattingSkill {
    private samService: SAMService;
    private birefnetService: BiRefNetService;
    
    async execute(params: {
        layerId: number;
        selectionBounds?: BoundingBox;
        mode: 'auto' | 'selection' | 'point';
    }, context: ExecutionContext): Promise<Buffer> {
        context.reportProgress(0, '初始化...');
        
        // 1. 获取图层图像
        const imageData = await this.getLayerImage(params.layerId);
        context.reportProgress(20, '图像已获取');
        
        // 2. 根据模式选择处理方式
        let mask: Buffer;
        
        if (params.mode === 'selection' && params.selectionBounds) {
            // 选区模式：SAM Box Prompt
            context.reportProgress(40, 'SAM 分割中...');
            mask = await this.samService.segmentWithBox(
                imageData, 
                params.selectionBounds
            );
        } else {
            // 自动模式：BiRefNet
            context.reportProgress(40, 'BiRefNet 分割中...');
            mask = await this.birefnetService.segment(imageData);
        }
        
        // 3. 后处理
        context.reportProgress(80, '优化边缘...');
        mask = await this.refineMask(mask);
        
        context.reportProgress(100, '完成');
        return mask;
    }
    
    private async refineMask(mask: Buffer): Promise<Buffer> {
        // 高斯模糊 + 阈值
        const sharp = (await import('sharp')).default;
        
        return await sharp(mask)
            .blur(2.5)
            .threshold(128)
            .toBuffer();
    }
}
```

### 10.2 形态统一 Skill

```typescript
// 形态统一技能（带缓存）
class ShapeMorphingSkill {
    // 主体位置缓存（解决检测不稳定问题）
    private positionCache: Map<string, RelativePosition> = new Map();
    
    async execute(params: {
        layerIds: number[];
        targetShape: 'circle' | 'square' | 'custom';
    }, context: ExecutionContext): Promise<void> {
        for (let i = 0; i < params.layerIds.length; i++) {
            const layerId = params.layerIds[i];
            const progress = (i / params.layerIds.length) * 100;
            context.reportProgress(progress, `处理图层 ${i + 1}/${params.layerIds.length}`);
            
            // 获取或缓存主体位置
            const cacheKey = `layer_${layerId}`;
            let position = this.positionCache.get(cacheKey);
            
            if (!position) {
                // 首次执行：使用 AI 检测
                position = await this.detectSubjectPosition(layerId);
                this.positionCache.set(cacheKey, position);
            }
            
            // 应用形态变换
            await this.applyMorphing(layerId, position, params.targetShape);
        }
        
        context.reportProgress(100, '形态统一完成');
    }
}
```

---

## 附录

### A. 参考框架

| 框架 | 链接 | 亮点 |
|------|------|------|
| **Mastra** | [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | TypeScript Agent 框架 |
| **ii-agent** | [Intelligent-Internet/ii-agent](https://github.com/Intelligent-Internet/ii-agent) | 工具系统设计 |
| **MCP** | [Model Context Protocol](https://modelcontextprotocol.io/) | 标准化协议 |

### B. 设计原则

1. **单一职责**: 每个工具只做一件事
2. **松耦合**: 工具间通过上下文共享数据，不直接依赖
3. **可测试**: 每个工具可独立测试
4. **幂等性**: 相同输入产生相同输出
5. **可观测**: 完整的日志和进度报告

### C. 代码位置索引

| 文件 | 功能 |
|------|------|
| `UXP/src/tools/registry.ts` | 工具注册表 |
| `UXP/src/tools/types.ts` | 工具类型定义 |
| `UXP/src/tools/layer/*.ts` | 图层工具实现 |
| `Agent/src/main/services/*.ts` | 后端服务 |
| `Agent/src/main/services/playwright-web-service.ts` | Playwright 网页内容提取 |
| `Agent/src/main/ipc-handlers/web-page-handlers.ts` | 网页提取 IPC |
| `Agent/src/renderer/services/skill-executors/design-reference-search.executor.ts` | 设计参考搜索技能执行器 |

### D. 设计参考搜索 Skill 适配说明 (2026-03)

**目标**: 让 Agent 能去网站搜索内容获取设计参考。

**实现方式**:
1. **Tool 层**: 新增 `searchDesigns`（MCP 设计平台）和 `fetchWebPageDesignContent`（Playwright 网页提取）
2. **Skill 层**: `DesignReferenceSearchSkill` 声明 + `designReferenceSearchExecutor` 执行器
3. **IPC**: `web:fetchPageDesignContent` 调用主进程 Playwright 服务
4. **分类**: 工具分类为 `analysis`，与 Agent-Skills 最佳实践中的 ToolCategory 一致

**与 .trae/playwright-skill 的区别**:
- `.trae/playwright-skill`: Claude Code 的浏览器自动化测试技能（写脚本到 /tmp、执行测试）
- DesignEcho 适配: 复用 Playwright 的 `chromium.launch` 做**无头网页内容提取**，不涉及测试脚本，直接在主进程调用 `fetchWebPageDesignContent`

---

> **文档维护**: 请在工具系统架构变更后同步更新此文档
