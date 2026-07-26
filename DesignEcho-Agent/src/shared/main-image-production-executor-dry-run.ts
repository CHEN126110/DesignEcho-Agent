import type {
    MainImageProductionExecutorDispatchPlan,
    MainImageProductionExecutorQueueItem
} from './main-image-production-executor-bridge';

export type MainImageProductionExecutorDryRunStatus =
    | 'blocked_missing_dispatch_plan'
    | 'blocked_dispatch_plan_not_ready'
    | 'completed_dry_run';

export interface MainImageProductionExecutorDryRunInput {
    productionExecutorDispatchPlan?: MainImageProductionExecutorDispatchPlan | null;
}

export interface MainImageProductionExecutorDryRunOperationResult {
    id: string;
    requestId: string;
    tool: MainImageProductionExecutorQueueItem['tool'];
    phase: MainImageProductionExecutorQueueItem['phase'];
    status: 'dry_run_recorded';
    documentId?: string;
    documentName?: string;
    groupPath?: string[];
    payloadPreview: Record<string, unknown>;
    requiredReadback: MainImageProductionExecutorQueueItem['requiredReadback'];
    requiredPostRunReadbackTools: string[];
    sourceContextIds: string[];
    executionBoundary: string;
    actualResult: null;
}

export interface MainImageProductionExecutorDryRunReadbackPlan {
    requiredTools: string[];
    requiredReadback: string[];
    requiresActualBounds: boolean;
    requiresAcceptanceSnapshot: boolean;
    afterRunOnly: true;
    boundary: string;
}

export interface MainImageProductionExecutorDryRunPreview {
    version: 'main-image-production-executor-dry-run-preview/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionExecutorDryRunStatus;
    mode: 'dry-run';
    dispatchStatus?: MainImageProductionExecutorDispatchPlan['status'];
    operationResults: MainImageProductionExecutorDryRunOperationResult[];
    operationCount: number;
    readbackPlan: MainImageProductionExecutorDryRunReadbackPlan;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const EMPTY_READBACK_PLAN: MainImageProductionExecutorDryRunReadbackPlan = {
    requiredTools: [],
    requiredReadback: [],
    requiresActualBounds: false,
    requiresAcceptanceSnapshot: false,
    afterRunOnly: true,
    boundary: 'dry-run readback plan only; no Photoshop state has been read'
};

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function sanitizeUnknown(value: unknown): unknown {
    if (typeof value === 'string') return cleanString(value);
    if (Array.isArray(value)) return value.map(sanitizeUnknown);
    if (!value || typeof value !== 'object') return value;

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        sanitized[cleanString(key)] = sanitizeUnknown(item);
    }
    return sanitized;
}

function sanitizePayloadPreview(value: Record<string, unknown>): Record<string, unknown> {
    const sanitized = sanitizeUnknown(value);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : {};
}

function collectReadbackPlan(
    operations: MainImageProductionExecutorDryRunOperationResult[]
): MainImageProductionExecutorDryRunReadbackPlan {
    const requiredTools = new Set<string>();
    const requiredReadback = new Set<string>();

    for (const operation of operations) {
        for (const tool of operation.requiredPostRunReadbackTools) {
            requiredTools.add(tool);
        }
        for (const readback of operation.requiredReadback) {
            requiredReadback.add(readback);
        }
    }

    return {
        requiredTools: Array.from(requiredTools),
        requiredReadback: Array.from(requiredReadback),
        requiresActualBounds: requiredReadback.has('actualBounds'),
        requiresAcceptanceSnapshot: requiredTools.has('getAcceptanceSnapshot'),
        afterRunOnly: true,
        boundary: 'readback plan describes what must be read after a future executor run; dry-run does not read Photoshop'
    };
}

function toOperationResult(
    item: MainImageProductionExecutorQueueItem,
    index: number
): MainImageProductionExecutorDryRunOperationResult {
    return {
        id: `dry-run-${String(index + 1).padStart(3, '0')}-${item.requestId}`,
        requestId: item.requestId,
        tool: item.tool,
        phase: item.phase,
        status: 'dry_run_recorded',
        documentId: item.documentId,
        documentName: item.documentName,
        groupPath: cleanStrings(item.groupPath),
        payloadPreview: sanitizePayloadPreview(item.payloadPreview),
        requiredReadback: item.requiredReadback,
        requiredPostRunReadbackTools: cleanStrings(item.requiredPostRunReadbackTools),
        sourceContextIds: cleanStrings(item.sourceContextIds),
        executionBoundary: 'dry-run adapter recorded this operation only; no Photoshop command was called',
        actualResult: null
    };
}

function makePreview(input: {
    status: MainImageProductionExecutorDryRunStatus;
    dispatchStatus?: MainImageProductionExecutorDispatchPlan['status'];
    operationResults?: MainImageProductionExecutorDryRunOperationResult[];
    readbackPlan?: MainImageProductionExecutorDryRunReadbackPlan;
    blockers?: string[];
    warnings?: string[];
}): MainImageProductionExecutorDryRunPreview {
    const operationResults = input.operationResults || [];
    return {
        version: 'main-image-production-executor-dry-run-preview/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        mode: 'dry-run',
        dispatchStatus: input.dispatchStatus,
        operationResults,
        operationCount: operationResults.length,
        readbackPlan: input.readbackPlan || EMPTY_READBACK_PLAN,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        limitations: [
            'dry-run executor adapter 只把 executor queue 转成可审计结果，不执行 Photoshop。',
            'actualResult 固定为 null；没有真实工具返回值时不能伪造 layerId、bounds、截图或导出路径。',
            'dry-run 只能证明执行计划结构完整，不能证明视觉质量、导出成功或设计完成。'
        ]
    };
}

export function buildMainImageProductionExecutorDryRunPreview(
    input: MainImageProductionExecutorDryRunInput
): MainImageProductionExecutorDryRunPreview {
    const dispatchPlan = input.productionExecutorDispatchPlan;
    if (!dispatchPlan) {
        return makePreview({
            status: 'blocked_missing_dispatch_plan',
            blockers: ['main_image_production_executor_dispatch_plan_required']
        });
    }

    if (dispatchPlan.status !== 'ready_for_dry_run_bridge') {
        return makePreview({
            status: 'blocked_dispatch_plan_not_ready',
            dispatchStatus: dispatchPlan.status,
            blockers: ['dry_run_bridge_status_required'],
            warnings: dispatchPlan.warnings,
        });
    }

    const operationResults = dispatchPlan.executorQueue.map(toOperationResult);
    const readbackPlan = collectReadbackPlan(operationResults);

    return makePreview({
        status: 'completed_dry_run',
        dispatchStatus: dispatchPlan.status,
        operationResults,
        readbackPlan,
        warnings: dispatchPlan.warnings,
    });
}
