/**
 * 由 Skill Manifest 激活的设计方法知识。
 *
 * 这里承载专业方法正文，不执行 Tool、不生成固定 Workflow，也不决定阶段推进。
 * 通用方法可被所有设计 Skill 复用；品类 overlay 只能被声明的 Skill 装载。
 */

import type { RuntimeStage } from './contracts';
import type { RuntimeCapabilityProviderIdentity } from './contracts/capability-resolution';
import { buildBundledKnowledgeArtifactRecord } from '../design-knowledge-governance';

export const DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID = 'knowledge:design.content-strategy/v1' as const;
export const DESIGN_ART_DIRECTION_KNOWLEDGE_ID = 'knowledge:design.art-direction/v1' as const;
export const DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID = 'knowledge:design.layout-planning/v1' as const;
export const MAIN_IMAGE_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.main-image/v1' as const;
export const DETAIL_PAGE_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.detail-page/v1' as const;
export const SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.sku-color-card/v1' as const;
export const SKU_BATCH_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.sku-batch/v1' as const;

export interface DesignMethodKnowledgeDefinition {
    capabilityId: string;
    title: string;
    applicableSkillIds: string[];
    applicableStages: RuntimeStage[];
    sourceRevision: string;
    objective: string;
    method: string[];
    expectedOutput: string;
    evaluationFocus: string[];
    /**
     * 任务本质（workflow vs agent 的核心轴，对齐 Anthropic「Building Effective Agents」）：
     * - 'structured'：规格明确的结构化生产（SKU 组合/色卡等），以用户确认的规格为准，尽快进入执行，
     *   不需要长时间创意 brief/strategy 推演；
     * - 'creative'：开放式创意设计（主图/详情页从零设计），需要真正的设计规划。
     * 缺省（跨切面通用知识）不标注。结构化任务据此获得轻仪式引导，避免被创意声明仪式饿死。
     */
    productionNature?: 'structured' | 'creative';
}

export interface DesignMethodKnowledgeContext {
    version: 'design-method-knowledge-context/v0';
    manifestSkillId: string;
    selectedCapabilityIds: string[];
    sourceRefs: Array<{
        capabilityId: string;
        sourceRevision: string;
        snapshotFingerprint: string;
    }>;
    content: string;
    issues: string[];
    boundaries: {
        advisoryOnly: true;
        versionBound: true;
        lifecycleFiltered: true;
        grantsPermission: false;
        executesTools: false;
        advancesStage: false;
        declaresQualityPass: false;
    };
}

const COMMON_CONTENT_STRATEGY: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    title: '内容策略',
    applicableSkillIds: [],
    applicableStages: ['R3'],
    sourceRevision: 'design-method-content-strategy-v1',
    objective: '把用户目标、受众、产品事实和素材观察转成清晰的信息优先级。',
    method: [
        '区分已确认事实、用户主张与待验证假设，不用营销措辞替代真实来源。',
        '先确定单一首要沟通目标，再组织主信息、支持信息和行动信息。',
        '按受众决策顺序安排信息，删除与目标无关或重复的内容。',
        '为每项关键文案保留来源、适用场景与不可夸大的边界。'
    ],
    expectedOutput: '信息目标、受众决策问题、信息层级、关键文案方向与来源引用。',
    evaluationFocus: ['事实可追溯', '信息优先级清晰', '目标与受众一致', '无来源不明的夸张']
};

const COMMON_ART_DIRECTION: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    title: '视觉方向',
    applicableSkillIds: [],
    applicableStages: ['R3'],
    sourceRevision: 'design-method-art-direction-v1',
    objective: '把内容策略翻译为可执行且与品牌、产品和渠道一致的视觉语言。',
    method: [
        '从产品真实特征和品牌约束提炼视觉关键词，不直接复制参考图表面风格。',
        '明确色彩、光影、材质、构图、字体气质和图像处理原则。',
        '说明视觉选择如何服务信息目标，并列出需要避免的误导或风格冲突。',
        '优先建立可跨画面复用的规则，而不是给单个画面堆叠效果。'
    ],
    expectedOutput: '视觉关键词、色彩与光影方向、材质与字体原则、参考使用边界。',
    evaluationFocus: ['品牌一致性', '产品真实性', '视觉规则可执行', '参考未被照抄']
};

const COMMON_LAYOUT_PLANNING: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    title: '布局规划',
    applicableSkillIds: [],
    applicableStages: ['R4'],
    sourceRevision: 'design-method-layout-planning-v1',
    objective: '把信息与视觉策略转成有层级、阅读路径和可验证目标的布局计划。',
    method: [
        '先定义画布、安全区、主要阅读路径和视觉焦点，再安排元素。',
        '用角色、比例、对齐、间距和区域关系描述布局，不依赖模型猜测绝对坐标。',
        '为文字、产品、装饰和背景定义层级与遮挡关系，保留必要留白。',
        '把每个写入动作绑定到目标对象与写后读回检查。'
    ],
    expectedOutput: '区域结构、元素角色、比例与对齐、层级顺序、动作依赖和验证要求。',
    evaluationFocus: ['阅读路径明确', '信息层级稳定', '留白与对齐一致', '动作可验证']
};

const MAIN_IMAGE_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    title: '主图方法 overlay',
    applicableSkillIds: ['ecommerce.main_image'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-main-image-v1',
    objective: '在首屏注意力有限的条件下，建立产品主体、核心卖点与渠道约束的单画面决策。',
    method: [
        '优先保护产品形态、纹理、颜色和比例真实性。',
        '只保留支撑首要沟通目标的卖点，避免多个同权焦点。',
        '主体尺度、背景对比和文案区域必须共同服务缩略图识别。',
        '变体之间保持品牌和构图规则一致，同时让差异真实可辨。'
    ],
    expectedOutput: '主视觉焦点、主体策略、卖点层级、缩略图可读性与变体一致性要求。',
    evaluationFocus: ['主体识别', '产品真实性', '核心卖点聚焦', '缩略图可读性'],
    productionNature: 'creative'
};

const DETAIL_PAGE_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
    title: '详情页方法 overlay',
    applicableSkillIds: ['ecommerce.detail_page'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-detail-page-v1',
    objective: '把消费者决策问题组织成连续叙事，并让每屏承担明确且不重复的沟通职责。',
    method: [
        '按认知、兴趣、理解、信任和行动的决策顺序组织信息，而不是套固定屏数。',
        '每屏只设一个首要目标，屏间通过消费者问题与支持信息自然承接。',
        '产品事实、场景收益、细节说明和规格信息应与真实视觉观察匹配。',
        '长页面保持网格、节奏和品牌规则一致，同时允许重点屏形成变化。'
    ],
    expectedOutput: '叙事顺序、逐屏目标、支持信息类型、屏间承接和全局视觉一致性规则。',
    evaluationFocus: ['叙事连贯', '逐屏职责清晰', '内容与来源匹配', '长页节奏一致'],
    productionNature: 'creative'
};

const SKU_BATCH_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SKU_BATCH_METHOD_KNOWLEDGE_ID,
    title: 'SKU 批量图方法 overlay',
    applicableSkillIds: ['ecommerce.sku_batch'],
    applicableStages: ['R1', 'R3', 'R4'],
    sourceRevision: 'design-method-sku-batch-v3',
    objective: '在批量一致性与单个 SKU 真实性之间建立可重复、可检查的生产规则。',
    method: [
        '若用户没有给出 SKU 组合（颜色×规格/双装），第一步就用交互卡片一次性向用户收集组合与命名并等待确认；不要凭空推断组合，也不要为 SKU 反复声明创意 brief/strategy——SKU 的「策略」就是用户确认的组合与模板，尽快进入组合卡与生产，而不是长时间规划。',
        '先核对 SKU 组合、素材映射和命名依据，不用占位或推断补齐缺失变体。',
        '先检查真实模板结构：ordered_slots 使用一槽一色；region_composition 允许一个矩形区域容纳多色，并用显式容量计划连接区域与颜色顺序。',
        '多区域容量只能来自模板命名或几何检查；中低置信分配必须经视觉复核，执行阶段不得临场猜测。',
        '固定画布、主体尺度、对齐、留白和导出规则，只让真实差异发生变化。',
        '颜色、纹理和组合关系以源素材为准，调整不能破坏产品真实性。',
        '批量输出逐项保留身份、变体、导出和视觉复核记录。'
    ],
    expectedOutput: 'SKU 映射、TemplateLayoutPlan、区域容量或槽位规则、允许变化字段、逐项验证与导出清单。',
    evaluationFocus: ['模板方法识别正确', '区域容量来源明确', '批量一致性', 'SKU 映射正确', '颜色纹理真实', '逐项可追溯'],
    productionNature: 'structured'
};

const SKU_COLOR_CARD_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
    title: 'SKU 色卡方法 overlay',
    applicableSkillIds: ['ecommerce.sku_color_card'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-sku-color-card-v1',
    objective: '把已确认的颜色图片整理成可编辑、可复用、名称准确且结构一致的 SKU 色卡文档。',
    method: [
        '输入顺序就是颜色编排顺序；色名优先使用用户确认值，否则使用文件名，不按颜色关键词重新排序。',
        '每个颜色建立独立同名图层组；卡片主体必须是可编辑智能对象，不能栅格化成不可追溯结果。',
        '商品图先以 contain 生成安全结构草稿并剪切到圆角底；固定 cover/contain 都不是最终设计，不能替代 Agent 的视觉判断。',
        '结构草稿后逐卡打开智能对象看图：模型判断主体大小、重心和裁切。主体检测可靠时由 fitLayerSubjectToRegion 求解缩放与位移；检测失败或超时时，模型依据画面用 transformLayer/moveLayer 小步调整。两条路径都必须在每次调整后再次看图。',
        '白色色名标签和文字位于智能对象内部；标签比例按真实内部文档尺寸换算，文字再依据 Photoshop 真实 bounds 缩放并水平、垂直居中。',
        '逐卡读回剪切关系与智能对象状态；最终读回主文档尺寸、图层结构和保存结果。'
    ],
    expectedOutput: '颜色来源映射、色卡布局计划、逐卡智能对象/剪切检查记录、最终 PSB 路径与结构验收报告。',
    evaluationFocus: ['颜色名称准确', '输入覆盖完整', '智能对象可编辑', '剪切结构正确', '主体视觉尺度与裁切', '文字适配与居中', '布局一致', '写后检查完整'],
    productionNature: 'structured'
};

const DEFINITIONS: readonly DesignMethodKnowledgeDefinition[] = Object.freeze([
    COMMON_CONTENT_STRATEGY,
    COMMON_ART_DIRECTION,
    COMMON_LAYOUT_PLANNING,
    MAIN_IMAGE_OVERLAY,
    DETAIL_PAGE_OVERLAY,
    SKU_COLOR_CARD_OVERLAY,
    SKU_BATCH_OVERLAY
]);

function clean(value: unknown): string {
    return String(value || '').trim();
}

function formatDefinition(definition: DesignMethodKnowledgeDefinition): string {
    return [
        `### ${definition.title} · ${definition.capabilityId} · revision=${definition.sourceRevision}`,
        `目标：${definition.objective}`,
        ...(definition.productionNature === 'structured'
            ? ['任务本质：结构化生产——以用户确认的规格/组合为准，尽快进入执行；不做长时间创意 brief/strategy 推演，缺规格时先用交互卡片收集再执行。']
            : definition.productionNature === 'creative'
                ? ['任务本质：开放式创意设计——需要真实的设计规划与视觉判断。']
                : []),
        '方法：',
        ...definition.method.map((item) => `- ${item}`),
        `输出：${definition.expectedOutput}`,
        `评价关注：${definition.evaluationFocus.join('；')}`
    ].join('\n');
}

export function listDesignMethodKnowledgeDefinitions(): DesignMethodKnowledgeDefinition[] {
    return DEFINITIONS.map((definition) => ({
        ...definition,
        applicableSkillIds: [...definition.applicableSkillIds],
        applicableStages: [...definition.applicableStages],
        method: [...definition.method],
        evaluationFocus: [...definition.evaluationFocus]
    }));
}

export function listDesignMethodKnowledgeProviderIdentities(): RuntimeCapabilityProviderIdentity[] {
    return DEFINITIONS.map((definition) => ({
        capabilityId: definition.capabilityId,
        kind: 'knowledge',
        providerId: `runtime:${definition.capabilityId}`,
        source: 'runtime_contract',
        exposure: 'runtime_context',
        exposedAsToolSchema: false,
        ...(definition.applicableSkillIds.length > 0
            ? { applicableSkillIds: [...definition.applicableSkillIds] }
            : {})
    }));
}

export function buildDesignMethodKnowledgeContext(input: {
    knowledgeRefs: readonly string[];
    manifestSkillId: string;
}): DesignMethodKnowledgeContext {
    const manifestSkillId = clean(input.manifestSkillId);
    const byId = new Map(DEFINITIONS.map((definition) => [definition.capabilityId, definition]));
    const selected: DesignMethodKnowledgeDefinition[] = [];
    const sourceRefs: DesignMethodKnowledgeContext['sourceRefs'] = [];
    const issues: string[] = [];
    const seen = new Set<string>();

    for (const rawReference of input.knowledgeRefs) {
        const reference = clean(rawReference);
        if (!reference || seen.has(reference)) continue;
        seen.add(reference);
        const definition = byId.get(reference);
        if (!definition) continue;
        if (definition.applicableSkillIds.length > 0
            && !definition.applicableSkillIds.includes(manifestSkillId)) {
            issues.push(`${reference}:skill_scope_mismatch`);
            continue;
        }
        const artifactRecord = buildBundledKnowledgeArtifactRecord({
            id: definition.capabilityId,
            title: definition.title,
            summary: formatDefinition(definition),
            sourceRevision: definition.sourceRevision
        });
        if (artifactRecord.usageSnapshot.counts.usable !== 1) {
            issues.push(`${reference}:knowledge_not_current_or_usable`);
            continue;
        }
        selected.push(definition);
        sourceRefs.push({
            capabilityId: definition.capabilityId,
            sourceRevision: artifactRecord.governance.sourceRevision,
            snapshotFingerprint: artifactRecord.usageSnapshot.snapshotFingerprint
        });
    }

    return {
        version: 'design-method-knowledge-context/v0',
        manifestSkillId,
        selectedCapabilityIds: selected.map((definition) => definition.capabilityId),
        sourceRefs,
        content: selected.length > 0
            ? [
                '以下内容是当前 Skill Manifest 激活的专业方法建议。它不授予工具权限，不替代当前用户目标、项目事实、执行 Policy 或 Evaluation。',
                ...selected.map(formatDefinition)
            ].join('\n\n')
            : '',
        issues,
        boundaries: {
            advisoryOnly: true,
            versionBound: true,
            lifecycleFiltered: true,
            grantsPermission: false,
            executesTools: false,
            advancesStage: false,
            declaresQualityPass: false
        }
    };
}
