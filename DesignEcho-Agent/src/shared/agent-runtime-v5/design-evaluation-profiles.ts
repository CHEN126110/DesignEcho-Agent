/**
 * manifest-selected Evaluation Profile capability。
 *
 * Profile 只定义“评价什么、必须完成哪些验证检查、用哪组共享断言”，最终裁决仍由
 * DesignScorecard → buildDesignVerdict 单一路径完成。本模块纯逻辑，不调模型、
 * 不执行 Tool、不读图片、不授予权限，也不根据 task text 猜 Profile。
 */

import {
    DESIGN_ASSERTIONS,
    getVlmJudgeAssertions,
    scoreDesignAssertions,
    type AssertionSeverity,
    type DesignAssertion,
    type DesignAssertionResult,
    type DesignQualityDimensionKey,
    type DesignScorecard
} from '../design-quality-assertion';
import type { DesignCriticIssueOwner } from '../types/design-team.types';
import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './capability-provider-identities';
import type { RuntimeCapabilityProviderIdentity } from './contracts/capability-resolution';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
    MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
    SKU_BATCH_METHOD_KNOWLEDGE_ID,
    listDesignMethodKnowledgeDefinitions
} from './design-method-knowledge';

export const MAIN_IMAGE_EVALUATION_PROFILE_ID = 'rubrics/main-image.v1' as const;
export const DETAIL_PAGE_EVALUATION_PROFILE_ID = 'rubrics/detail-page.v1' as const;
export const DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID = 'rubrics/detail-page-scoped-edit.v1' as const;
export const SKU_COLOR_CARD_EVALUATION_PROFILE_ID = 'rubrics/sku-color-card.v1' as const;
export const SKU_BATCH_EVALUATION_PROFILE_ID = 'rubrics/sku-batch.v1' as const;

export type DesignEvaluationProfileId =
    | typeof MAIN_IMAGE_EVALUATION_PROFILE_ID
    | typeof DETAIL_PAGE_EVALUATION_PROFILE_ID
    | typeof DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
    | typeof SKU_COLOR_CARD_EVALUATION_PROFILE_ID
    | typeof SKU_BATCH_EVALUATION_PROFILE_ID;

export type DesignEvaluationVerificationStatus = 'passed' | 'failed' | 'needs_review';
export type DesignEvaluationVerificationSource =
    | 'task_contract'
    | 'runtime_observation'
    | 'quality_adapter'
    | 'human_review';

export interface DesignEvaluationVerificationRecord {
    key: string;
    status: DesignEvaluationVerificationStatus;
    source: DesignEvaluationVerificationSource;
    /** 只允许稳定验证记录 token，不保存路径、Prompt、图片或任意结果载荷。 */
    verificationRef: string;
}

export interface DesignEvaluationCheck {
    id: string;
    key: string;
    label: string;
    dimension: DesignQualityDimensionKey;
    weight: number;
    severity: AssertionSeverity;
    owner: DesignCriticIssueOwner;
    required: boolean;
    /** 哪类生产 owner 可以为此检查签发验证记录；调用方传入其它 source 必须忽略。 */
    allowedSources: DesignEvaluationVerificationSource[];
    expectedFix: string;
}

export interface DesignEvaluationProfile {
    version: 'design-evaluation-profile/v0';
    profileId: DesignEvaluationProfileId;
    skillId: string;
    taskType: string;
    capabilityGoal: string;
    /** 评价 Profile 必须与本 Skill 实际装载的方法知识保持可审计绑定。 */
    methodKnowledgeRefs: string[];
    assertionRefs: string[];
    checks: DesignEvaluationCheck[];
    scoring: {
        passThreshold: number;
        minCoverage: number;
    };
    outputType: 'design-scorecard';
    finalVerdictProvider: typeof DESIGN_QUALITY_VERDICT_CAPABILITY_ID;
    boundaries: {
        executesTools: false;
        callsModel: false;
        grantsPermission: false;
        selectsWorkflow: false;
        finalVerdictOwnedByProfile: false;
    };
}

export type DesignEvaluationProfileValidationIssueCode =
    | 'profile_id_invalid'
    | 'profile_identity_missing'
    | 'profile_goal_missing'
    | 'profile_method_knowledge_empty'
    | 'profile_method_knowledge_duplicate'
    | 'profile_method_knowledge_unknown'
    | 'profile_method_knowledge_scope_mismatch'
    | 'profile_assertions_empty'
    | 'profile_assertion_duplicate'
    | 'profile_assertion_unknown'
    | 'profile_checks_empty'
    | 'profile_check_duplicate'
    | 'profile_required_check_missing'
    | 'profile_check_invalid'
    | 'profile_check_source_policy_invalid'
    | 'profile_threshold_invalid'
    | 'profile_final_verdict_provider_invalid';

export interface DesignEvaluationProfileValidationIssue {
    code: DesignEvaluationProfileValidationIssueCode;
    target: string;
}

export interface DesignEvaluationProfileValidationResult {
    valid: boolean;
    issues: DesignEvaluationProfileValidationIssue[];
}

export type DesignEvaluationProfileIssueCode =
    | 'critical_check_missing'
    | 'critical_check_needs_review'
    | 'verification_explicitly_failed'
    | 'unsafe_verification_record_ignored'
    | 'verification_source_not_allowed'
    | 'verification_record_conflict';

export type DesignEvaluationProfileStatus =
    | 'passed'
    | 'failed'
    | 'needs_review'
    | 'incomplete_verification'
    | 'insufficient_observations';

export type DesignEvaluationScorecard = Omit<DesignScorecard, 'gate'> & {
    gate: DesignEvaluationProfileStatus;
};

export interface DesignEvaluationProfileResult {
    version: 'design-evaluation-profile-result/v0';
    profileId: DesignEvaluationProfileId;
    status: DesignEvaluationProfileStatus;
    scorecard: DesignEvaluationScorecard;
    verification: {
        missingRequiredCheckKeys: string[];
        failedCheckKeys: string[];
        needsReviewCheckKeys: string[];
    };
    coverage: {
        requiredCheckCount: number;
        completedRequiredCheckCount: number;
        ratio: number;
    };
    issueCodes: DesignEvaluationProfileIssueCode[];
    boundaries: {
        usesSingleDesignScorecard: true;
        finalVerdictOwnedByProfile: false;
        defaultPassWhenChecksMissing: false;
        containsRawMeasurementPayloads: false;
    };
}

export interface DesignEvaluationProfileDigest {
    version: 'design-evaluation-profile-digest/v0';
    profileId: DesignEvaluationProfileId;
    status: DesignEvaluationProfileStatus;
    overallScore: number;
    coverageRatio: number;
    requiredCheckCount: number;
    completedRequiredCheckCount: number;
    missingRequiredCheckCount: number;
    failedCheckCount: number;
    verificationCoverageRatio: number;
    issueCodes: DesignEvaluationProfileIssueCode[];
    boundaries: {
        digestOnly: true;
        notFinalVerdict: true;
    };
}

const SHARED_ASSERTION_BY_ID = new Map(DESIGN_ASSERTIONS.map((assertion) => [assertion.id, assertion]));
const METHOD_KNOWLEDGE_BY_ID = new Map(listDesignMethodKnowledgeDefinitions().map((definition) => (
    [definition.capabilityId, definition] as const
)));
const SAFE_TOKEN_PATTERN = /^[a-zA-Z0-9._:@/-]+$/;
const COMMON_METHOD_KNOWLEDGE_REFS = Object.freeze([
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID
]);

function allowedVerificationSourcesForKey(key: string): DesignEvaluationVerificationSource[] {
    switch (key) {
        case 'fresh_structure_snapshot':
        case 'fresh_visual_evaluation':
        case 'requested_change_applied':
        case 'outside_scope_preserved':
            return ['runtime_observation'];
        case 'sku_product_truth':
        case 'sku_visual_consistency':
            return ['human_review'];
        default:
            return ['quality_adapter'];
    }
}

function verificationCheck(input: Omit<DesignEvaluationCheck, 'allowedSources'>): DesignEvaluationCheck {
    return Object.freeze({
        ...input,
        allowedSources: allowedVerificationSourcesForKey(input.key)
    });
}

const PROFILE_BOUNDARIES: DesignEvaluationProfile['boundaries'] = Object.freeze({
    executesTools: false,
    callsModel: false,
    grantsPermission: false,
    selectsWorkflow: false,
    finalVerdictOwnedByProfile: false
});

const MAIN_IMAGE_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: MAIN_IMAGE_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.main_image',
    taskType: 'ecommerce.main_image.v1',
    capabilityGoal: '评价主图的主体识别、卖点视觉化、信息层级、画面精度与真实操作结果。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, MAIN_IMAGE_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.subject-ratio',
        'comp.alignment',
        'color.contrast',
        'hier.type-scale',
        'craft.precision',
        'overall.above-baseline',
        'impact.squint',
        'sell.visualized',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth'
    ],
    checks: [
        verificationCheck({
            id: 'main-image.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '在最后一次写入后重新读取完整图层结构。'
        }),
        verificationCheck({
            id: 'main-image.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '写后视觉复核',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            expectedFix: '取得写后画面并完成 Profile 对应的视觉断言评价。'
        }),
        verificationCheck({
            id: 'main-image.qa-report',
            key: 'main_image_qa_report',
            label: '主图 QA 报告',
            dimension: 'overall',
            weight: 5,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            expectedFix: '生成结构化主图 QA 报告，并由适配器明确给出 passed / failed / needs_review。'
        })
    ],
    scoring: { passThreshold: 78, minCoverage: 0.75 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DETAIL_PAGE_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: DETAIL_PAGE_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    capabilityGoal: '评价详情页跨屏叙事、卖点事实支撑、版式层级、屏幕覆盖与落位质量。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.alignment',
        'color.contrast',
        'color.background-designed',
        'hier.type-scale',
        'craft.precision',
        'overall.above-baseline',
        'sell.visualized',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth'
    ],
    checks: [
        verificationCheck({
            id: 'detail-page.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '在最后一次写入后重新读取完整详情页结构。'
        }),
        verificationCheck({
            id: 'detail-page.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '跨屏视觉复核',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            expectedFix: '取得详情页写后屏幕快照并完成视觉断言评价。'
        }),
        verificationCheck({
            id: 'detail-page.screen-coverage',
            key: 'detail_page_screen_coverage',
            label: '计划屏覆盖',
            dimension: 'hierarchy',
            weight: 4,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            expectedFix: '由详情页 screen result 适配器核验计划屏、实际屏与缺失屏。'
        }),
        verificationCheck({
            id: 'detail-page.placement-audit',
            key: 'detail_page_placement_audit',
            label: '内容落位审计',
            dimension: 'craft',
            weight: 4,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '运行结构化 placement audit，修复溢出、缺图、缺文案或错误屏归属。'
        }),
        verificationCheck({
            id: 'detail-page.content-verification',
            key: 'detail_page_content_verification',
            label: '卖点内容核验',
            dimension: 'selling_point_visual',
            weight: 3,
            severity: 'major',
            owner: 'requirement',
            required: true,
            expectedFix: '把每屏卖点与真实商品事实、素材分析或市场洞察记录关联。'
        })
    ],
    scoring: { passThreshold: 76, minCoverage: 0.75 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DETAIL_PAGE_SCOPED_EDIT_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    capabilityGoal: '评价详情页局部修改是否准确落在目标范围、保持可编辑，并避免无关区域被意外改变。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.alignment',
        'color.contrast',
        'hier.type-scale',
        'craft.precision',
        'type.character',
        'overall.above-baseline'
    ],
    checks: [
        verificationCheck({
            id: 'detail-page-scoped-edit.requested-change',
            key: 'requested_change_applied',
            label: '目标修改参数与写后状态一致',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '使用带显式目标的原子修改，并取得 before/after 验收断言，确认写后状态匹配声明的修改值。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.outside-scope',
            key: 'outside_scope_preserved',
            label: '无关图层保持不变',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '核对 before/after 图层差异，确保变化范围没有超出显式目标图层。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '目标修改写后结构读回',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '在最后一次局部写入后读回目标文字、图层结构或边界，确认修改真实存在。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '局部修改视觉复核',
            dimension: 'overall',
            weight: 2,
            severity: 'major',
            owner: 'visual',
            required: false,
            expectedFix: '在字体适配、换行或位置可能变化时查看写后目标区域。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.placement-audit',
            key: 'detail_page_placement_audit',
            label: '目标范围落位审计',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: false,
            expectedFix: '仅在局部修改改变布局时检查目标区域溢出、遮挡和屏归属。'
        })
    ],
    scoring: { passThreshold: 72, minCoverage: 0.6 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const SKU_BATCH_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: SKU_BATCH_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.sku_batch',
    taskType: 'ecommerce.sku_batch.v1',
    capabilityGoal: '评价 SKU 变体覆盖、商品真实性、标签可读性、批量一致性与导出读回。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SKU_BATCH_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.alignment',
        'hier.type-scale',
        'craft.precision',
        'color.scheme',
        'hier.three-level',
        'type.character'
    ],
    checks: [
        verificationCheck({
            id: 'sku.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '在批量写入后读取结构，确认图层与规格仍可编辑。'
        }),
        verificationCheck({
            id: 'sku.variant-coverage',
            key: 'sku_variant_coverage',
            label: 'SKU 变体覆盖',
            dimension: 'overall',
            weight: 5,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            expectedFix: '用组合计划与实际完成清单核对规格、颜色、组合和备注覆盖。'
        }),
        verificationCheck({
            id: 'sku.product-truth',
            key: 'sku_product_truth',
            label: '商品真实性',
            dimension: 'selling_point_visual',
            weight: 5,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            expectedFix: '确认每个 SKU 只改变允许变化的颜色或组合，不破坏真实纹理与形态。'
        }),
        verificationCheck({
            id: 'sku.export-readback',
            key: 'sku_export_readback',
            label: '导出读回',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '对全部预期导出执行文件、尺寸和脱敏 visualMetrics 读回。'
        }),
        verificationCheck({
            id: 'sku.visual-consistency',
            key: 'sku_visual_consistency',
            label: '批量视觉一致性',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            expectedFix: '由结构化批量视觉复核确认主体大小、位置、文字与留白一致。'
        })
    ],
    scoring: { passThreshold: 80, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const SKU_COLOR_CARD_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.sku_color_card',
    taskType: 'ecommerce.sku_color_card.v1',
    capabilityGoal: '评价 SKU 色卡的来源覆盖、色名准确、可编辑智能对象结构、剪切关系与布局一致性。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.alignment',
        'color.background-designed',
        'hier.type-scale',
        'craft.precision',
        'color.scheme',
        'hier.three-level',
        'type.character'
    ],
    checks: [
        verificationCheck({
            id: 'sku-color-card.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 3,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '在最后一次色卡写入后读回主文档图层、文字和边界。'
        }),
        verificationCheck({
            id: 'sku-color-card.final-structure',
            key: 'sku_color_card_final_structure',
            label: '色卡业务结构检查',
            dimension: 'craft',
            weight: 4,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '修复色卡执行报告中的最终结构错误，并重新完成业务结构读回。'
        }),
        verificationCheck({
            id: 'sku-color-card.source-coverage',
            key: 'sku_color_card_source_coverage',
            label: '颜色来源覆盖',
            dimension: 'overall',
            weight: 5,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            expectedFix: '核对每个已确认来源都对应且只对应一个同名颜色组。'
        }),
        verificationCheck({
            id: 'sku-color-card.smart-object-editability',
            key: 'sku_color_card_smart_object_editability',
            label: '智能对象可编辑性',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '逐卡读回智能对象类型，禁止以栅格化结果冒充可编辑色卡。'
        }),
        verificationCheck({
            id: 'sku-color-card.clipping-structure',
            key: 'sku_color_card_clipping_structure',
            label: '商品图剪切结构',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            expectedFix: '确认每张商品图都在智能对象内部剪切到圆角底。'
        }),
        verificationCheck({
            id: 'sku-color-card.label-text-fit',
            key: 'sku_color_card_label_text_fit',
            label: '色名文字适配与居中',
            dimension: 'craft',
            weight: 4,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '读取白底和文字的真实 bounds，缩小超宽文字并验证水平、垂直居中。'
        }),
        verificationCheck({
            id: 'sku-color-card.visual-consistency',
            key: 'sku_color_card_visual_consistency',
            label: '色卡视觉一致性',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            expectedFix: '基于写后快照评价商品主体大小、重心、裁切，以及卡片、标签和编号的一致性；必要时调整后再次观察。'
        })
    ],
    scoring: { passThreshold: 80, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DESIGN_EVALUATION_PROFILES: readonly DesignEvaluationProfile[] = Object.freeze([
    MAIN_IMAGE_PROFILE,
    DETAIL_PAGE_PROFILE,
    DETAIL_PAGE_SCOPED_EDIT_PROFILE,
    SKU_COLOR_CARD_PROFILE,
    SKU_BATCH_PROFILE
]);

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function isSafeToken(value: unknown): boolean {
    const text = String(value || '').trim();
    return Boolean(text)
        && text.length <= 160
        && SAFE_TOKEN_PATTERN.test(text)
        && !text.includes('..')
        && !text.includes('://')
        && !/api[_-]?key|access[_-]?token|secret/i.test(text);
}

export function validateDesignEvaluationProfile(
    profile: DesignEvaluationProfile
): DesignEvaluationProfileValidationResult {
    const issues: DesignEvaluationProfileValidationIssue[] = [];
    const add = (code: DesignEvaluationProfileValidationIssueCode, target: string): void => {
        issues.push({ code, target });
    };

    if (!isSafeToken(profile.profileId)) add('profile_id_invalid', 'profileId');
    if (!String(profile.skillId || '').trim() || !String(profile.taskType || '').trim()) {
        add('profile_identity_missing', 'skillId/taskType');
    }
    if (!String(profile.capabilityGoal || '').trim()) add('profile_goal_missing', 'capabilityGoal');
    if (!Array.isArray(profile.methodKnowledgeRefs) || profile.methodKnowledgeRefs.length === 0) {
        add('profile_method_knowledge_empty', 'methodKnowledgeRefs');
    }
    if (unique(profile.methodKnowledgeRefs).length !== profile.methodKnowledgeRefs.length) {
        add('profile_method_knowledge_duplicate', 'methodKnowledgeRefs');
    }
    profile.methodKnowledgeRefs.forEach((capabilityId) => {
        const definition = METHOD_KNOWLEDGE_BY_ID.get(capabilityId);
        if (!definition) {
            add('profile_method_knowledge_unknown', capabilityId);
            return;
        }
        if (definition.applicableSkillIds.length > 0
            && !definition.applicableSkillIds.includes(profile.skillId)) {
            add('profile_method_knowledge_scope_mismatch', capabilityId);
        }
    });
    if (!Array.isArray(profile.assertionRefs) || profile.assertionRefs.length === 0) {
        add('profile_assertions_empty', 'assertionRefs');
    }
    if (unique(profile.assertionRefs).length !== profile.assertionRefs.length) {
        add('profile_assertion_duplicate', 'assertionRefs');
    }
    profile.assertionRefs.forEach((assertionId) => {
        if (!SHARED_ASSERTION_BY_ID.has(assertionId)) add('profile_assertion_unknown', assertionId);
    });
    if (!Array.isArray(profile.checks) || profile.checks.length === 0) {
        add('profile_checks_empty', 'checks');
    }
    const checkIds = profile.checks.map((check) => check.id);
    const checkKeys = profile.checks.map((check) => check.key);
    if (unique(checkIds).length !== checkIds.length || unique(checkKeys).length !== checkKeys.length) {
        add('profile_check_duplicate', 'checks');
    }
    if (!profile.checks.some((check) => check.required)) {
        add('profile_required_check_missing', 'checks');
    }
    profile.checks.forEach((check) => {
        if (!isSafeToken(check.id)
            || !isSafeToken(check.key)
            || !String(check.label || '').trim()
            || !String(check.expectedFix || '').trim()
            || !Number.isFinite(check.weight)
            || check.weight <= 0
            || check.weight > 10) {
            add('profile_check_invalid', check.id || check.key || 'unknown');
        }
        if (!Array.isArray(check.allowedSources)
            || check.allowedSources.length === 0
            || unique(check.allowedSources).length !== check.allowedSources.length
            || check.allowedSources.some((source) => ![
                'task_contract',
                'runtime_observation',
                'quality_adapter',
                'human_review'
            ].includes(source))) {
            add('profile_check_source_policy_invalid', check.id || check.key || 'unknown');
        }
    });
    if (!Number.isFinite(profile.scoring.passThreshold)
        || profile.scoring.passThreshold <= 0
        || profile.scoring.passThreshold > 100
        || !Number.isFinite(profile.scoring.minCoverage)
        || profile.scoring.minCoverage <= 0
        || profile.scoring.minCoverage > 1) {
        add('profile_threshold_invalid', 'scoring');
    }
    if (profile.finalVerdictProvider !== DESIGN_QUALITY_VERDICT_CAPABILITY_ID) {
        add('profile_final_verdict_provider_invalid', 'finalVerdictProvider');
    }
    return { valid: issues.length === 0, issues };
}

function assertBuiltinProfilesValid(): void {
    DESIGN_EVALUATION_PROFILES.forEach((profile) => {
        const validation = validateDesignEvaluationProfile(profile);
        if (!validation.valid) {
            throw new Error(`Evaluation Profile ${profile.profileId} 非法: ${JSON.stringify(validation.issues)}`);
        }
    });
}

assertBuiltinProfilesValid();

export function listDesignEvaluationProfiles(): readonly DesignEvaluationProfile[] {
    return DESIGN_EVALUATION_PROFILES;
}

export function getDesignEvaluationProfileById(
    profileId: string | undefined
): DesignEvaluationProfile | undefined {
    const normalized = String(profileId || '').trim();
    return DESIGN_EVALUATION_PROFILES.find((profile) => profile.profileId === normalized);
}

export function listDesignEvaluationProfileCapabilityProviders(): RuntimeCapabilityProviderIdentity[] {
    return DESIGN_EVALUATION_PROFILES.map((profile) => ({
        capabilityId: profile.profileId,
        kind: 'evaluation',
        providerId: `evaluation-profile:${profile.profileId}`,
        source: 'runtime_contract',
        exposure: 'evaluation_gate',
        exposedAsToolSchema: false,
        applicableSkillIds: [profile.skillId],
        applicableTaskTypes: [profile.taskType]
    }));
}

function buildVerificationAssertion(check: DesignEvaluationCheck): DesignAssertion {
    return {
        id: check.id,
        dimension: check.dimension,
        label: check.label,
        weight: check.weight,
        severity: check.severity,
        method: 'deterministic',
        owner: check.owner,
        expectedFix: check.expectedFix
    };
}

export function getDesignEvaluationProfileAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return [
        ...profile.assertionRefs
            .map((assertionId) => SHARED_ASSERTION_BY_ID.get(assertionId))
            .filter((assertion): assertion is DesignAssertion => Boolean(assertion)),
        ...profile.checks.map(buildVerificationAssertion)
    ];
}

export function getDesignEvaluationProfileVlmAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return getVlmJudgeAssertions(getDesignEvaluationProfileAssertions(profile));
}

function buildUnevaluatedResult(assertion: DesignAssertion, rationale: string): DesignAssertionResult {
    return {
        id: assertion.id,
        dimension: assertion.dimension,
        status: 'uneval',
        method: assertion.method,
        severity: assertion.severity,
        owner: assertion.owner,
        rationale,
        expectedFix: assertion.expectedFix
    };
}

function buildVerificationResult(
    check: DesignEvaluationCheck,
    verification: DesignEvaluationVerificationRecord | undefined
): DesignAssertionResult {
    const assertion = buildVerificationAssertion(check);
    if (!verification) {
        return buildUnevaluatedResult(assertion, `缺少结构化验证记录 ${check.key}，不能评价。`);
    }
    if (verification.status === 'passed') {
        return {
            ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 已通过。`),
            status: 'pass',
            score: 1,
            confidence: 1
        };
    }
    if (verification.status === 'failed') {
        return {
            ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 明确失败。`),
            status: 'fail',
            score: 0,
            confidence: 1
        };
    }
    return {
        ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 需要复核。`),
        status: 'needs_review',
        score: 0.5,
        confidence: 1
    };
}

function normalizeVerificationRecords(
    input: readonly DesignEvaluationVerificationRecord[],
    checks: readonly DesignEvaluationCheck[]
): {
    byKey: Map<string, DesignEvaluationVerificationRecord>;
    unsafeCount: number;
    sourceViolationCount: number;
    conflictCount: number;
} {
    const byKey = new Map<string, DesignEvaluationVerificationRecord>();
    const checkByKey = new Map(checks.map((check) => [check.key, check]));
    let unsafeCount = 0;
    let sourceViolationCount = 0;
    let conflictCount = 0;
    const statusPriority: Record<DesignEvaluationVerificationStatus, number> = {
        passed: 1,
        needs_review: 2,
        failed: 3
    };
    input.forEach((record) => {
        if (!isSafeToken(record.key)
            || !isSafeToken(record.verificationRef)
            || !Object.prototype.hasOwnProperty.call(statusPriority, record.status)) {
            unsafeCount += 1;
            return;
        }
        const check = checkByKey.get(record.key);
        if (!check) return;
        if (!check.allowedSources.includes(record.source)) {
            sourceViolationCount += 1;
            return;
        }
        const existing = byKey.get(record.key);
        if (!existing) {
            byKey.set(record.key, record);
            return;
        }
        if (existing.status !== record.status) conflictCount += 1;
        if (statusPriority[record.status] > statusPriority[existing.status]) {
            byKey.set(record.key, record);
        }
    });
    return { byKey, unsafeCount, sourceViolationCount, conflictCount };
}

function normalizeScorecard(scorecard: DesignScorecard): DesignEvaluationScorecard {
    switch (scorecard.gate) {
        case 'passed':
        case 'failed':
        case 'needs_review':
            return { ...scorecard, gate: scorecard.gate };
        default:
            return {
                ...scorecard,
                gate: 'insufficient_observations',
                passed: false,
                summary: '当前观察覆盖不足，不能声明质量检查已通过。'
            };
    }
}

export function evaluateDesignEvaluationProfile(input: {
    profile: DesignEvaluationProfile;
    assertionResults: readonly DesignAssertionResult[];
    verificationRecords?: readonly DesignEvaluationVerificationRecord[];
}): DesignEvaluationProfileResult {
    const profileAssertions = getDesignEvaluationProfileAssertions(input.profile);
    const baseResultById = new Map(input.assertionResults.map((result) => [result.id, result]));
    const verificationState = normalizeVerificationRecords(
        input.verificationRecords || [],
        input.profile.checks
    );
    const results: DesignAssertionResult[] = [];

    input.profile.assertionRefs.forEach((assertionId) => {
        const assertion = SHARED_ASSERTION_BY_ID.get(assertionId);
        if (!assertion) return;
        results.push(baseResultById.get(assertionId)
            || buildUnevaluatedResult(assertion, `Profile 未取得断言 ${assertionId} 的评价结果。`));
    });
    input.profile.checks.forEach((check) => {
        results.push(buildVerificationResult(check, verificationState.byKey.get(check.key)));
    });

    let scorecard = normalizeScorecard(scoreDesignAssertions(results, {
        passThreshold: input.profile.scoring.passThreshold,
        minCoverage: input.profile.scoring.minCoverage,
        assertions: profileAssertions
    }));
    const requiredChecks = input.profile.checks.filter((check) => check.required);
    const missingRequiredCheckKeys = requiredChecks
        .filter((check) => !verificationState.byKey.has(check.key))
        .map((check) => check.key);
    const failedCheckKeys = input.profile.checks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'failed')
        .map((check) => check.key);
    const needsReviewCheckKeys = input.profile.checks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'needs_review')
        .map((check) => check.key);
    const requiredNeedsReview = requiredChecks.some((check) => (
        verificationState.byKey.get(check.key)?.status === 'needs_review'
    ));

    if (scorecard.gate !== 'failed' && missingRequiredCheckKeys.length > 0) {
        scorecard = {
            ...scorecard,
            gate: 'incomplete_verification',
            passed: false,
            summary: `Evaluation Profile 缺少 ${missingRequiredCheckKeys.length} 项必需验证检查，不能声明通过。`
        };
    } else if (scorecard.gate === 'passed' && requiredNeedsReview) {
        scorecard = {
            ...scorecard,
            gate: 'needs_review',
            passed: false,
            summary: 'Evaluation Profile 的必需验证检查仍需复核，不能声明通过。'
        };
    }

    const issueCodes: DesignEvaluationProfileIssueCode[] = [];
    if (missingRequiredCheckKeys.length > 0) issueCodes.push('critical_check_missing');
    if (requiredNeedsReview) issueCodes.push('critical_check_needs_review');
    if (failedCheckKeys.length > 0) issueCodes.push('verification_explicitly_failed');
    if (verificationState.unsafeCount > 0) issueCodes.push('unsafe_verification_record_ignored');
    if (verificationState.sourceViolationCount > 0) issueCodes.push('verification_source_not_allowed');
    if (verificationState.conflictCount > 0) issueCodes.push('verification_record_conflict');

    const completedRequiredCheckCount = requiredChecks.length - missingRequiredCheckKeys.length;
    const verificationCoverageRatio = requiredChecks.length > 0
        ? completedRequiredCheckCount / requiredChecks.length
        : 0;

    return {
        version: 'design-evaluation-profile-result/v0',
        profileId: input.profile.profileId,
        status: scorecard.gate,
        scorecard,
        verification: {
            missingRequiredCheckKeys,
            failedCheckKeys,
            needsReviewCheckKeys
        },
        coverage: {
            requiredCheckCount: requiredChecks.length,
            completedRequiredCheckCount,
            ratio: verificationCoverageRatio
        },
        issueCodes: unique(issueCodes) as DesignEvaluationProfileIssueCode[],
        boundaries: {
            usesSingleDesignScorecard: true,
            finalVerdictOwnedByProfile: false,
            defaultPassWhenChecksMissing: false,
            containsRawMeasurementPayloads: false
        }
    };
}

export function buildDesignEvaluationProfileDigest(
    result: DesignEvaluationProfileResult
): DesignEvaluationProfileDigest {
    return {
        version: 'design-evaluation-profile-digest/v0',
        profileId: result.profileId,
        status: result.status,
        overallScore: result.scorecard.overallScore,
        coverageRatio: result.scorecard.coverage.ratio,
        requiredCheckCount: result.coverage.requiredCheckCount,
        completedRequiredCheckCount: result.coverage.completedRequiredCheckCount,
        missingRequiredCheckCount: result.verification.missingRequiredCheckKeys.length,
        failedCheckCount: result.verification.failedCheckKeys.length,
        verificationCoverageRatio: result.coverage.ratio,
        issueCodes: [...result.issueCodes],
        boundaries: {
            digestOnly: true,
            notFinalVerdict: true
        }
    };
}
