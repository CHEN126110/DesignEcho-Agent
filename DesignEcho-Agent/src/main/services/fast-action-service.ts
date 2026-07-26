/**
 * 快速动作服务
 * 
 * 核心理念：
 * 1. 简单任务 → 直接执行（不经过模型，毫秒级）
 * 2. 复杂任务 → 预编译任务链（一次模型调用，多步执行）
 * 3. 规则优先，模型处理未覆盖意图
 * 
 * 目标：常见操作 < 1秒完成
 */

import { DESIGN_STANDARDS } from './visual-thinking-service';

/**
 * 预定义的快速动作
 * 这些动作不需要模型思考，直接执行
 */
export interface FastAction {
    id: string;
    name: string;
    triggers: string[];           // 触发词
    steps: ActionStep[];          // 执行步骤
    needsContext?: string[];      // 需要的上下文（如 'selectedLayer', 'allTextLayers'）
    autoFix?: boolean;            // 执行后是否自动检查修复问题
}

export interface ActionStep {
    tool: string;
    params: any | ((context: any) => any);  // 静态参数或动态计算
    condition?: (context: any) => boolean;   // 条件执行
}

/**
 * 预定义的快速动作库
 */
export const FAST_ACTIONS: FastAction[] = [
    // ===== 对齐类（最常用，必须快）=====
    {
        id: 'center-horizontal',
        name: '水平居中',
        triggers: ['水平居中', '左右居中', 'center horizontal', 'center h'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'alignLayers', params: { alignment: 'centerHorizontal', relativeTo: 'canvas' } }
        ]
    },
    {
        id: 'center-vertical',
        name: '垂直居中',
        triggers: ['垂直居中', '上下居中', 'center vertical', 'center v'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'alignLayers', params: { alignment: 'centerVertical', relativeTo: 'canvas' } }
        ]
    },
    {
        id: 'center-both',
        name: '完全居中',
        triggers: ['居中', '正中间', '画布中心', 'center', '中间'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'alignLayers', params: { alignment: 'centerHorizontal', relativeTo: 'canvas' } },
            { tool: 'alignLayers', params: { alignment: 'centerVertical', relativeTo: 'canvas' } }
        ]
    },
    {
        id: 'align-left',
        name: '左对齐',
        triggers: ['左对齐', 'align left', '靠左'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'alignLayers', params: { alignment: 'left', relativeTo: 'canvas' } }
        ]
    },
    {
        id: 'align-right',
        name: '右对齐',
        triggers: ['右对齐', 'align right', '靠右'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'alignLayers', params: { alignment: 'right', relativeTo: 'canvas' } }
        ]
    },
    
    // ===== 移动类 =====
    {
        id: 'move-up',
        name: '上移',
        triggers: ['上移', '往上', 'move up', '向上移动'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'moveLayer', params: { y: -20, relative: true } }
        ]
    },
    {
        id: 'move-down',
        name: '下移',
        triggers: ['下移', '往下', 'move down', '向下移动'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'moveLayer', params: { y: 20, relative: true } }
        ]
    },
    {
        id: 'move-left',
        name: '左移',
        triggers: ['左移', '往左', 'move left', '向左移动'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'moveLayer', params: { x: -20, relative: true } }
        ]
    },
    {
        id: 'move-right',
        name: '右移',
        triggers: ['往右', '右移', 'move right', '向右移动'],
        needsContext: ['selectedLayer'],
        steps: [
            { tool: 'moveLayer', params: { x: 20, relative: true } }
        ]
    },
    
    // ===== 字号调整类（带智能计算）=====
    {
        id: 'font-larger',
        name: '字放大',
        triggers: ['字大一点', '放大字', '字号加大', 'bigger font', '字太小'],
        needsContext: ['selectedLayer', 'documentInfo'],
        steps: [
            {
                tool: 'setTextStyle',
                params: (ctx: any) => {
                    const currentSize = ctx.selectedLayer?.fontSize || 24;
                    const newSize = Math.round(currentSize * 1.25);  // 放大 25%
                    return { fontSize: newSize };
                }
            }
        ],
        autoFix: true
    },
    {
        id: 'font-smaller',
        name: '字缩小',
        triggers: ['字小一点', '缩小字', '字号减小', 'smaller font', '字太大'],
        needsContext: ['selectedLayer', 'documentInfo'],
        steps: [
            {
                tool: 'setTextStyle',
                params: (ctx: any) => {
                    const currentSize = ctx.selectedLayer?.fontSize || 24;
                    const newSize = Math.round(currentSize * 0.8);  // 缩小 20%
                    return { fontSize: newSize };
                }
            }
        ],
        autoFix: true
    },
    {
        id: 'font-optimize',
        name: '优化字号',
        triggers: ['字号不对', '调整字号', '优化字体大小'],
        needsContext: ['selectedLayer', 'documentInfo'],
        steps: [
            {
                tool: 'setTextStyle',
                params: (ctx: any) => {
                    // 根据画布高度和文字角色计算理想字号
                    const canvasHeight = ctx.documentInfo?.height || 800;
                    const textRole = ctx.selectedLayer?.inferredRole || 'body';
                    const standards = DESIGN_STANDARDS.typography.ecommerce;
                    const ideal = (standards as any)[textRole]?.ideal || 0.03;
                    return { fontSize: Math.round(canvasHeight * ideal) };
                }
            }
        ],
        autoFix: true
    },
    
    // ===== 快速操作 =====
    {
        id: 'undo',
        name: '撤销',
        triggers: ['撤销', 'undo', '回退', '返回上一步'],
        steps: [
            { tool: 'undo', params: {} }
        ]
    },
    {
        id: 'redo',
        name: '重做',
        triggers: ['重做', 'redo', '恢复'],
        steps: [
            { tool: 'redo', params: {} }
        ]
    }
];

/**
 * 快速动作服务
 */
export class FastActionService {
    private actions: Map<string, FastAction> = new Map();
    private triggerIndex: Map<string, string> = new Map();  // trigger -> actionId
    
    constructor() {
        this.buildIndex();
    }
    
    /**
     * 构建触发词索引
     */
    private buildIndex(): void {
        for (const action of FAST_ACTIONS) {
            this.actions.set(action.id, action);
            for (const trigger of action.triggers) {
                this.triggerIndex.set(trigger.toLowerCase(), action.id);
            }
        }
    }
    
    /**
     * 匹配用户输入，返回可直接执行的动作
     */
    matchAction(userInput: string): FastAction | null {
        const input = userInput.toLowerCase().trim();
        
        // 精确匹配
        const exactMatch = this.triggerIndex.get(input);
        if (exactMatch) {
            return this.actions.get(exactMatch) || null;
        }
        
        // 模糊匹配（包含触发词）
        for (const [trigger, actionId] of this.triggerIndex) {
            if (input.includes(trigger) || trigger.includes(input)) {
                return this.actions.get(actionId) || null;
            }
        }
        
        return null;
    }
    
    /**
     * 执行快速动作
     */
    async execute(
        action: FastAction,
        context: any,
        executeToolCall: (tool: string, params: any) => Promise<any>
    ): Promise<{
        success: boolean;
        results: any[];
        totalTime: number;
        message: string;
    }> {
        const startTime = Date.now();
        const results: any[] = [];
        
        try {
            for (const step of action.steps) {
                // 检查条件
                if (step.condition && !step.condition(context)) {
                    continue;
                }
                
                // 计算参数
                const params = typeof step.params === 'function' 
                    ? step.params(context) 
                    : step.params;
                
                // 执行工具
                const result = await executeToolCall(step.tool, params);
                results.push({ tool: step.tool, params, result });
                
                // 更新上下文（用于后续步骤）
                if (result.newPosition) {
                    context.selectedLayer = { ...context.selectedLayer, ...result.newPosition };
                }
            }
            
            const totalTime = Date.now() - startTime;
            
            return {
                success: true,
                results,
                totalTime,
                message: `✅ ${action.name} 完成（${totalTime}ms）`
            };
            
        } catch (error: any) {
            const totalTime = Date.now() - startTime;
            return {
                success: false,
                results,
                totalTime,
                message: `❌ ${action.name} 失败：${error.message}`
            };
        }
    }
    
    /**
     * 获取所有可用的快速动作（用于 UI 提示）
     */
    getAvailableActions(): Array<{ id: string; name: string; triggers: string[] }> {
        return FAST_ACTIONS.map(a => ({
            id: a.id,
            name: a.name,
            triggers: a.triggers
        }));
    }
}

/**
 * 任务分类器
 * 判断任务是否可以快速执行，还是需要模型思考
 */
export class TaskClassifier {
    private fastActionService: FastActionService;
    
    constructor() {
        this.fastActionService = new FastActionService();
    }
    
    /**
     * 分类任务
     */
    classify(userInput: string): {
        type: 'fast' | 'model' | 'hybrid';
        fastAction?: FastAction;
        reason: string;
    } {
        // 1. 检查是否匹配快速动作
        const fastAction = this.fastActionService.matchAction(userInput);
        if (fastAction) {
            return {
                type: 'fast',
                fastAction,
                reason: `匹配快速动作：${fastAction.name}`
            };
        }
        
        // 2. 检查是否是简单的确定性任务
        const simplePatterns = [
            /^(撤销|undo|重做|redo)$/i,
            /^(居中|center)$/i,
            /^(上移|下移|左移|右移)/,
        ];
        
        for (const pattern of simplePatterns) {
            if (pattern.test(userInput.trim())) {
                return {
                    type: 'fast',
                    reason: '简单确定性任务'
                };
            }
        }
        
        // 3. 检查是否需要创意/分析（必须用模型）
        const modelRequiredPatterns = [
            /分析|评估|建议|优化|改进|怎么样/,
            /帮我想|有什么|如何|为什么/,
            /创意|灵感|参考/,
            /文案|标题|描述|slogan/i,
        ];
        
        for (const pattern of modelRequiredPatterns) {
            if (pattern.test(userInput)) {
                return {
                    type: 'model',
                    reason: '需要模型创意/分析'
                };
            }
        }
        
        // 4. 混合任务（先快速执行，再用模型验证）
        return {
            type: 'hybrid',
            reason: '可能需要模型辅助验证'
        };
    }
}

/**
 * 批量执行器
 * 将多个工具调用合并执行，减少往返时间
 */
export class BatchExecutor {
    /**
     * 批量执行工具调用
     */
    async executeBatch(
        toolCalls: Array<{ tool: string; params: any }>,
        executeToolCall: (tool: string, params: any) => Promise<any>
    ): Promise<{
        results: any[];
        totalTime: number;
        successCount: number;
        failCount: number;
    }> {
        const startTime = Date.now();
        const results: any[] = [];
        let successCount = 0;
        let failCount = 0;
        
        // 对于独立的工具调用，可以并行执行
        // 对于有依赖的，顺序执行
        for (const call of toolCalls) {
            try {
                const result = await executeToolCall(call.tool, call.params);
                results.push({ ...call, result, success: true });
                successCount++;
            } catch (error: any) {
                results.push({ ...call, error: error.message, success: false });
                failCount++;
            }
        }
        
        return {
            results,
            totalTime: Date.now() - startTime,
            successCount,
            failCount
        };
    }
}

// 导出单例
export const fastActionService = new FastActionService();
export const taskClassifier = new TaskClassifier();
export const batchExecutor = new BatchExecutor();
