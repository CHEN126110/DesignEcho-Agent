import type { AgentContext } from '../unified-agent.service';

export type DesignTaskType = 'sku' | 'detail' | 'mainImage';

export interface DesignIntent {
    taskType: DesignTaskType;
    projectPath?: string;
    templatePath?: string;
    outputDir?: string;
    brandTone?: string;
    hardConstraints?: Record<string, unknown>;
    softConstraints?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface DesignPlanStep {
    tool: string;
    params: Record<string, unknown>;
    reason: string;
    blocking?: boolean;
}

export interface DesignPlan {
    intent: DesignIntent;
    // Canonical step list consumed by executors.
    steps: DesignPlanStep[];
    // Backward-compatible alias for old callers.
    layoutSteps?: DesignPlanStep[];
    copyPlan?: Array<{ layerId: number; text: string; role: string }>;
    assetPlan?: Array<{ layerId: number; imagePath: string; fitMode: string }>;
}

function mapSkillToTaskType(skillId: string): DesignTaskType {
    if (skillId === 'sku-batch') return 'sku';
    if (skillId === 'main-image-design') return 'mainImage';
    return 'detail';
}

export function buildDesignIntent(
    skillId: string,
    params: Record<string, any>,
    context?: AgentContext
): DesignIntent {
    const projectPath = params.projectPath || context?.projectContext?.projectPath || undefined;
    const outputDir = params.outputDir || projectPath || undefined;

    return {
        taskType: mapSkillToTaskType(skillId),
        projectPath,
        templatePath: params.templatePath,
        outputDir,
        brandTone: params.brandTone || 'professional',
        hardConstraints: params.hardConstraints || {},
        softConstraints: params.softConstraints || {},
        metadata: {
            userIntent: params.userIntent || context?.userInput || '',
            requestedSizes: params.sizes || (params.size ? [params.size] : undefined)
        }
    };
}

function createPlan(intent: DesignIntent, steps: DesignPlanStep[]): DesignPlan {
    return {
        intent,
        steps,
        // Keep old shape to avoid breaking older UI readers.
        layoutSteps: steps
    };
}

export function buildDesignPlan(intent: DesignIntent): DesignPlan {
    if (intent.taskType === 'mainImage') {
        return createPlan(intent, [
            {
                tool: 'getSubjectBounds',
                params: {},
                reason: '识别主体边界用于构图与缩放',
                blocking: true
            },
            {
                tool: 'smartLayout',
                params: { action: 'applyLayout' },
                reason: '按目标画幅执行智能布局'
            },
            {
                tool: 'quickExport',
                params: { format: 'jpg' },
                reason: '导出主图结果'
            }
        ]);
    }

    if (intent.taskType === 'detail') {
        return createPlan(intent, [
            {
                tool: 'parseDetailPageTemplate',
                params: {},
                reason: '解析屏结构与占位符',
                blocking: true
            },
            {
                tool: 'matchDetailPageContent',
                params: { projectPath: intent.projectPath || '' },
                reason: '匹配素材与文案'
            },
            {
                tool: 'fillDetailPage',
                params: {},
                reason: '执行批量填充'
            },
            {
                tool: 'exportDetailPageSlices',
                params: { outputDir: intent.outputDir || '' },
                reason: '导出详情页切片'
            }
        ]);
    }

    return createPlan(intent, [
        {
            tool: 'skuLayout',
            params: { action: 'execute' },
            reason: '执行 SKU 批量排版'
        }
    ]);
}
