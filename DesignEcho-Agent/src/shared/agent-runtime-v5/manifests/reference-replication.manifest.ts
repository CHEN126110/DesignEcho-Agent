/**
 * 参考版式复刻 Runtime Manifest。
 *
 * 产物身份仍由用户目标决定；本 Skill 只负责把具体参考图解析为可编辑结构并落地。
 * 单画布海报/横幅与多屏详情页的拓扑由 output intent 决定，不在 Runtime 编排层写死。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID
} from '../design-method-knowledge';

export const REFERENCE_REPLICATION_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'design.reference_replication',
    version: '0.1.0',
    task_type: 'design.reference_replication.v1',
    display_name: '参考版式复刻',
    planning_role: 'method',
    legacy_skill_ids: ['layout-replication'],
    required_inputs: ['goal', 'reference_image'],
    optional_inputs: ['artifact_kind', 'canvas_size', 'project_path', 'output_mode'],
    input_sources: {
        goal: ['user_goal'],
        reference_image: ['structured_input', 'attached_image', 'selected_project_asset'],
        artifact_kind: ['structured_input'],
        canvas_size: ['structured_input', 'photoshop_document'],
        project_path: ['structured_input', 'project_context'],
        output_mode: ['structured_input']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 24,
            max_tool_calls: 100,
            max_iterations: 55,
            max_vision_candidates: 4,
            max_visual_analyses: 1,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 600_000
        },
        verification_tier: 'screenshot',
        cost_profile: {
            model_call_class: 'vision-light',
            photoshop_tool_class: 'write-heavy',
            image_processing_class: 'bounded-vision',
            expected_latency: 'medium',
            resource_risk: 'medium'
        },
        vision_policy: 'bounded'
    },
    runtime_stages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default', 'vision.reference'],
    optional_model_profiles: ['review.strict'],
    read_scopes: ['brief', 'reference_image', 'layout_plan', 'photoshop', 'review'],
    write_scopes: ['layout_plan', 'execution_tasks', 'review', 'delivery'],
    tool_namespaces: [
        'agent.',
        'project.',
        'memory.',
        'photoshop.read.',
        'photoshop.sandbox.',
        'delivery.'
    ],
    available_tools: [
        'agent.interaction.requestConfirmation',
        'project.listResources',
        'project.searchResources',
        'memory.designProjectState',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getVisualSnapshot',
        'photoshop.sandbox.createDocument',
        'photoshop.sandbox.createScreenGroup',
        'photoshop.sandbox.createShape',
        'photoshop.sandbox.placeImage',
        'photoshop.sandbox.transformLayer',
        'photoshop.sandbox.writeText',
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
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge'
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: ['design-quality-verdict/v0'],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    template_families: ['reference.layout.editable.v1'],
    review_rubric_ref: 'design-quality-verdict/v0',
    delivery_outputs: ['editable_design_document', 'preview', 'replication_report'],
    exit_criteria: [
        '参考图结构已经解析并保留可追溯记录',
        '交付物身份与用户目标一致，参考方法没有改写海报、横幅、主图或详情页身份',
        '参考元素 expected/applied/failed/skipped 覆盖率已经记录',
        '写入后已有画布截图或 overlay 检查记录',
        '失败元素被修复或明确保留为阻塞项后才能结束'
    ]
};
