/**
 * SKU 色卡 Skill Manifest。
 *
 * 卡片方法、质量与可用 Tool 由声明装载；Runtime 不包含袜子品类、具体文件名
 * 或固定项目路径。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import { SKU_COLOR_CARD_EVALUATION_PROFILE_ID } from '../design-evaluation-profiles';

export const SKU_COLOR_CARD_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'ecommerce.sku_color_card',
    version: '0.1.0',
    task_type: 'ecommerce.sku_color_card.v1',
    display_name: 'SKU 色卡设计',
    legacy_skill_ids: ['sku-color-card'],
    required_inputs: ['color_card_sources'],
    optional_inputs: ['output_path', 'canvas_size', 'card_size', 'layout_columns', 'show_index_numbers'],
    input_sources: {
        color_card_sources: ['structured_input', 'attached_image', 'project_asset'],
        output_path: ['structured_input', 'project_context'],
        canvas_size: ['structured_input', 'photoshop_document'],
        card_size: ['structured_input'],
        layout_columns: ['structured_input'],
        show_index_numbers: ['structured_input']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 22,
            max_tool_calls: 80,
            max_iterations: 45,
            max_vision_candidates: 4,
            max_visual_analyses: 2,
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
    // 结构化生产走精简阶段链（同 sku-batch）：R0→R2→E1→R5，
    // 去掉 R1/R3/R4 三道声明门，让色卡生产不被创意仪式锁在 E1 之外。
    runtime_stages: ['R0', 'R2', 'E1', 'R5'],
    required_model_profiles: ['reasoning.default', 'vision.reference'],
    optional_model_profiles: ['review.strict'],
    read_scopes: ['brief', 'assets', 'photoshop', 'review'],
    write_scopes: ['layout_plan', 'execution_tasks', 'review', 'delivery'],
    tool_namespaces: ['project.', 'photoshop.read.', 'photoshop.sandbox.', 'delivery.'],
    available_tools: [
        'project.listResources',
        'project.searchResources',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getVisualSnapshot',
        'photoshop.read.inspectLayers',
        'photoshop.sandbox.createDocument',
        'photoshop.sandbox.createShape',
        'photoshop.sandbox.manageLayers',
        'photoshop.sandbox.editSmartObject',
        'photoshop.sandbox.placeImage',
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
        SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
        'tool:getDesignPrinciples'
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: ['design-quality-verdict/v0', SKU_COLOR_CARD_EVALUATION_PROFILE_ID],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    template_families: ['sku.color-card.editable.v1'],
    review_rubric_ref: SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    delivery_outputs: ['sku_color_card_document', 'execution_report', 'review_report'],
    exit_criteria: [
        '每个已确认来源对应且只对应一个同名颜色组',
        '逐卡智能对象与商品图剪切关系已读回',
        '逐卡商品主体经过写后视觉观察、必要调整和再次观察',
        '色名文字依据真实 bounds 适配并在白底内水平、垂直居中',
        '最终文档结构、画布尺寸和保存结果已读回',
        'R5 review 通过后才能声明色卡质量完成'
    ]
};
