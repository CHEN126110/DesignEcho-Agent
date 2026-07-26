/**
 * v5 工作流契约 — 入口聚合（按 GPT 定稿规范，2026-06-24）
 *
 * 不可变工作流产物的 canonical 类型与唯一 owner。
 * Project State 只保存引用（ArtifactRef）和少量 UI 摘要，不互相覆盖完整产物。
 */

export * from './common';
export * from './context-snapshot';
export * from './creative-strategy';
export * from './detail-page-plan';
export * from './preview-scene';
export * from './review-report';
export * from './approval-record';

import type { ArtifactProducerUnit } from './common';

/** 各 Contract 的 artifactType 稳定标识 */
export const V5_ARTIFACT_TYPES = {
    runtimeDesignBrief: 'runtime_design_brief',
    contextSnapshot: 'context_snapshot',
    visualObservation: 'visual_observation',
    creativeStrategy: 'creative_strategy',
    runtimeDesignStrategy: 'runtime_design_strategy',
    runtimeActionPlan: 'runtime_action_plan',
    detailPagePlan: 'detail_page_plan',
    previewScene: 'preview_scene',
    photoshopDocument: 'photoshop_document',
    exportedAsset: 'exported_asset',
    reviewReport: 'review_report',
    evaluationReport: 'evaluation_report',
    approvalRecord: 'approval_record',
    runtimeDeliveryReceipt: 'runtime_delivery_receipt',
    runtimeDeliveryVerification: 'runtime_delivery_verification'
} as const;

export type V5ArtifactType = typeof V5_ARTIFACT_TYPES[keyof typeof V5_ARTIFACT_TYPES];

/** 下游读取者标识（含非 owner 的消费方） */
export type ContractReader = ArtifactProducerUnit | 'UI' | 'WorkflowRuntime' | 'P0' | 'ToolRegistry';

/**
 * 契约所有权表（GPT 定稿第八节）：每个 Contract 只有唯一写入者，禁止交叉写入。
 * Repository / Runtime 据此拒绝越权写入。
 */
export const V5_CONTRACT_OWNERSHIP: Record<V5ArtifactType, { writer: ArtifactProducerUnit; readers: ContractReader[] }> = {
    [V5_ARTIFACT_TYPES.runtimeDesignBrief]: { writer: 'R1', readers: ['R2', 'R3', 'R4', 'R5', 'WorkflowRuntime'] },
    [V5_ARTIFACT_TYPES.contextSnapshot]: { writer: 'R2', readers: ['R3', 'R4', 'R5'] },
    [V5_ARTIFACT_TYPES.visualObservation]: { writer: 'R2', readers: ['R3', 'R4', 'R5'] },
    [V5_ARTIFACT_TYPES.creativeStrategy]: { writer: 'R3', readers: ['R4', 'R5'] },
    [V5_ARTIFACT_TYPES.runtimeDesignStrategy]: { writer: 'R3', readers: ['R4', 'R5', 'WorkflowRuntime'] },
    [V5_ARTIFACT_TYPES.runtimeActionPlan]: { writer: 'R4', readers: ['E1', 'R5', 'WorkflowRuntime'] },
    [V5_ARTIFACT_TYPES.detailPagePlan]: { writer: 'R4', readers: ['E1', 'R5'] },
    [V5_ARTIFACT_TYPES.previewScene]: { writer: 'E1', readers: ['R5', 'UI', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.photoshopDocument]: { writer: 'E1', readers: ['R5', 'E2', 'UI', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.exportedAsset]: { writer: 'E1', readers: ['R5', 'E2', 'UI', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.reviewReport]: { writer: 'R5', readers: ['UI', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.evaluationReport]: { writer: 'R5', readers: ['E2', 'UI', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.approvalRecord]: { writer: 'ApprovalService', readers: ['WorkflowRuntime', 'P0', 'ToolRegistry'] },
    [V5_ARTIFACT_TYPES.runtimeDeliveryReceipt]: { writer: 'E2', readers: ['UI', 'WorkflowRuntime', 'ApprovalService'] },
    [V5_ARTIFACT_TYPES.runtimeDeliveryVerification]: { writer: 'E2', readers: ['UI', 'WorkflowRuntime', 'ApprovalService'] }
};

/** 判断某 runtime unit 是否是某 artifactType 的唯一合法写入者 */
export function isContractWriter(artifactType: string, unit: ArtifactProducerUnit): boolean {
    const entry = (V5_CONTRACT_OWNERSHIP as Record<string, { writer: ArtifactProducerUnit }>)[artifactType];
    return Boolean(entry && entry.writer === unit);
}
