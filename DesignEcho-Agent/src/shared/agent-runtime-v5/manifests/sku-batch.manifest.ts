/**
 * SKU 批量图 Skill Manifest（skill-runtime-manifest.schema）
 *
 * SKU 生产可以继续复用旧 workflow bridge，但 R0 / ReAct / R5 / Reflexion 的
 * 上层契约必须来自 manifest，而不是直接 execute_skill 直达脚本。
 */

import type { SkillRuntimeManifest } from '../contracts';
import { SKU_WORKFLOW_STAGES_CAPABILITY_ID } from '../capability-provider-identities';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    SKU_BATCH_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import { SKU_BATCH_EVALUATION_PROFILE_ID } from '../design-evaluation-profiles';

export const SKU_BATCH_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'ecommerce.sku_batch',
    version: '0.1.0',
    task_type: 'ecommerce.sku_batch.v1',
    display_name: '电商 SKU 批量图',
    legacy_skill_ids: ['sku-batch'],
    required_inputs: ['goal'],
    optional_inputs: [
        'sku_source',
        'combination_rules',
        'template_source',
        'export_format',
        'self_select_note',
        'platform_size'
    ],
    input_sources: {
        goal: ['user_goal'],
        sku_source: ['structured_input', 'project_sku'],
        combination_rules: ['structured_input'],
        template_source: ['structured_input', 'project_template'],
        export_format: ['structured_input'],
        self_select_note: ['structured_input'],
        platform_size: ['structured_input', 'photoshop_document']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            // 走完 R0→E2 八阶段（含 brief/strategy 声明）+ 执行编排 + 逐项复核，
            // 8 次模型调用远不够，会饿死在声明阶段。26 与 iterations(50)/tool(90) 相称。
            // soft_time 必须兜住慢模型：一轮模型调用约 15–20s，240s 会在进 E1 执行前
            // 就耗尽（实测 14 轮 ≈ 240s，0 次写入即被掐停），故按全局上限取 600s。
            max_model_calls: 26,
            max_tool_calls: 90,
            max_iterations: 50,
            max_vision_candidates: 0,
            max_visual_analyses: 0,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 600_000
        },
        verification_tier: 'metadata',
        cost_profile: {
            model_call_class: 'text-light',
            photoshop_tool_class: 'write-heavy',
            image_processing_class: 'metadata-only',
            expected_latency: 'long',
            resource_risk: 'medium'
        },
        vision_policy: 'disabled'
    },
    // 结构化生产（规格/组合已由用户确认）走精简阶段链，不套创意八阶段：
    // R0(上下文,自动)→R2(读取现状即过)→E1(生产工具+写入放行,调 sku-batch)→R5(复核)。
    // 去掉 R1 brief / R3 strategy / R4 action-plan 三道「需模型声明才推进」的门——
    // 它们是结构化任务够不到 E1、只读现状不动手的根因（生产工具/写入都锁在 currentStage==='E1'）。
    // 创意任务（main-image/detail-page）仍保留完整八阶段。
    runtime_stages: ['R0', 'R2', 'E1', 'R5'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['review.strict'],
    read_scopes: ['brief', 'assets', 'photoshop', 'execution_tasks', 'review'],
    write_scopes: ['brief', 'layout_plan', 'execution_tasks', 'review', 'delivery'],
    tool_namespaces: ['project.', 'preview.', 'photoshop.read.', 'photoshop.sandbox.', 'delivery.'],
    available_tools: [
        'project.listResources',
        'project.searchResources',
        'preview.renderStoryboard',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getLayerBounds',
        'photoshop.sandbox.createScreenGroup',
        'photoshop.sandbox.placeImage',
        'photoshop.sandbox.transformLayer',
        'photoshop.sandbox.writeText',
        'delivery.exportAsset',
        'delivery.saveDocument'
    ],
    forbidden_tools: [
        'photoshop.apply.overwriteCurrentDocument',
        'photoshop.raw.batchPlay'
    ],
    knowledge_refs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
        DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
        SKU_BATCH_METHOD_KNOWLEDGE_ID,
        'tool:getDesignPrinciples',
        SKU_WORKFLOW_STAGES_CAPABILITY_ID
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: ['design-quality-verdict/v0', SKU_BATCH_EVALUATION_PROFILE_ID],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    template_families: ['sku.batch.standard.v1'],
    review_rubric_ref: SKU_BATCH_EVALUATION_PROFILE_ID,
    delivery_outputs: ['sku_images', 'sku_manifest', 'review_report'],
    exit_criteria: [
        'SKU 组合计划来自项目上下文或用户确认',
        '每轮执行后必须检查导出结果或当前画面',
        'R5 review 通过后才能进入交付说明'
    ]
};
