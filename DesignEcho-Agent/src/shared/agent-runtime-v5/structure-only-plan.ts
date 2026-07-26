/**
 * structure_only 确定性骨架（StructureOnlyPlan）+ Skill Preset 白名单 + Claim Guard
 *
 * 用途：尚未完成可靠视觉观察、用户仅"手动确认产品"时，详情页进入 structure_only 降级模式。
 * 按架构决策，**P0 阶段不调用任何规划模型**——直接由详情页 Skill 自己的结构 preset 确定性生成
 * 版面骨架，只含占位符与必需输入槽，不承载任何产品事实文案。即使用户确认"是袜子"，也不能自动扩展。
 *
 * 安全模型（按 GPT 纠偏定稿）：prompt 不是安全边界；intent 也不是被无条件信任的自由文本。
 * 1) Skill Preset 白名单：8 屏的 moduleType / order / intent 文本 / 占位符 / 必需输入槽全部预定义，
 *    与 design-task-types 解耦（后者的 purpose 被改不影响这里），杜绝"改 purpose 塞产品事实"。
 * 2) Schema 层：StructureModule 不含 title/body/sellingPoint 等可承载产品宣称的字段。
 * 3) Claim Guard：对任意来源 plan 做 fail-closed 校验——禁止字段、非白名单占位符、约束放开、
 *    以及 **intent 文本与 preset 不精确一致**（防篡改），任一命中即拒绝。不靠关键词扫描。
 *
 * 本模块是纯逻辑：不调模型、不写 Photoshop、不读像素。
 */

import { STRUCTURE_ONLY_CONSTRAINTS, type StructureOnlyConstraints } from './visual-observation-gate';

/** 模块语义类型（对齐详情页 8 屏；unknown 表示未知屏的安全默认）。 */
export type StructureModuleType =
    | 'hero_kv'
    | 'selling_points'
    | 'pain_solution'
    | 'material'
    | 'details'
    | 'colors'
    | 'parameters'
    | 'brand_trust'
    | 'unknown';

/** 允许出现在骨架中的占位符 token（白名单）。不在此列即视为泄漏。 */
export const STRUCTURE_ONLY_PLACEHOLDERS = [
    '[[PRODUCT_NAME]]',
    '[[PRIMARY_MESSAGE]]',
    '[[PRODUCT_IMAGE]]',
    '[[DETAIL_IMAGE]]',
    '[[MATERIAL_DETAIL]]',
    '[[COLOR_VARIANTS]]',
    '[[PAIN_POINT]]'
] as const;
export type StructurePlaceholder = (typeof STRUCTURE_ONLY_PLACEHOLDERS)[number];

/** 模块设计目标（键值结构）：key 为稳定机器标识，text 为预定义展示文本（非自由字段）。 */
export interface StructureModuleIntent {
    key: string;
    text: string;
}

/** preset 中一个模块的预定义（白名单权威来源）。 */
export interface StructureModulePreset {
    moduleId: string;
    moduleType: StructureModuleType;
    order: number;
    intent: StructureModuleIntent;
    requiredInputSlots: string[];
    placeholders: StructurePlaceholder[];
}

/** 一个任务类型的结构 preset（Skill 自己的白名单，与 design-task-types 解耦）。 */
export interface StructureSkillPreset {
    presetId: string;
    taskType: string;
    modules: StructureModulePreset[];
}

/**
 * 通用 Skill 结构 preset 注册表。**通用 Runtime 不内置任何具体 Skill 的 preset 数据**
 * （详情页八屏等定义在各自的 Skill preset 文件里，通过 registerStructureSkillPreset 自注册），
 * 以免通用代码再次耦合"详情页几屏"这类业务知识。
 */
const STRUCTURE_PRESETS = new Map<string, StructureSkillPreset>();

/** 注册一个 Skill 的结构 preset（由该 Skill 自己的 preset 文件调用）。 */
export function registerStructureSkillPreset(preset: StructureSkillPreset): void {
    STRUCTURE_PRESETS.set(preset.taskType, preset);
}

/** 按任务类型取 Skill 结构 preset；缺失返回 undefined，调用方据此 fail-closed。 */
export function getStructureSkillPreset(taskType: string): StructureSkillPreset | undefined {
    return STRUCTURE_PRESETS.get(taskType);
}

/** 一个版面模块：只表达结构意图（来自 preset）、必需输入槽与占位符，绝不承载产品事实文案。 */
export interface StructureModule {
    moduleId: string;
    moduleType: StructureModuleType;
    order: number;
    intent: StructureModuleIntent;
    requiredInputSlots: string[];
    placeholders: StructurePlaceholder[];
}

/** structure_only 详情页骨架。capabilityStatus 恒为 fallback，约束全部收紧。 */
export interface StructureOnlyPlan {
    planId: string;
    projectId: string;
    sourceRevision: number;
    presetId: string;
    capabilityStatus: 'fallback';
    outputScope: 'structure_only';
    modules: StructureModule[];
    constraints: StructureOnlyConstraints;
}

/** Claim Guard 校验结果（fail-closed：valid=false 时调用方不得发布骨架）。 */
export interface ClaimGuardViolation {
    code:
        | 'STRUCTURE_ONLY_PRODUCT_CLAIM' //  出现可承载产品宣称的禁止字段
        | 'STRUCTURE_ONLY_INVALID_PLACEHOLDER' //  非白名单 / 非 preset 占位符
        | 'STRUCTURE_ONLY_CONSTRAINT_VIOLATION' //  约束未收紧
        | 'STRUCTURE_ONLY_UNKNOWN_MODULE' //  模块不在 preset 中
        | 'STRUCTURE_ONLY_INTENT_TAMPERED'; //  intent 文本/类型/顺序与 preset 不一致
    jsonPointer: string;
    text: string;
}
export interface ClaimGuardResult {
    valid: boolean;
    violations: ClaimGuardViolation[];
}

/** 不允许出现在骨架任何层级的字段名（可承载未经验证的产品宣称）。 */
const FORBIDDEN_CLAIM_FIELDS = [
    'title', 'subtitle', 'heading', 'body', 'copy', 'text', 'content', 'description',
    'sellingPoint', 'sellingPoints', 'materialName', 'material', 'productColor', 'color',
    'productLength', 'length', 'size', 'performanceClaims', 'claims', 'tags'
];

export interface BuildStructureOnlyPlanInput {
    preset: StructureSkillPreset;
    projectId: string;
    sourceRevision: number;
    planId?: string;
}

/**
 * 由 Skill 结构 preset **确定性**生成 structure_only 骨架（不调模型，不依赖 design-task-types）。
 * 每个模块直接复制 preset 的预定义值；不引入任何 preset 之外的内容。
 */
export function buildStructureOnlyPlan(input: BuildStructureOnlyPlanInput): StructureOnlyPlan {
    const presetModules = Array.isArray(input.preset?.modules) ? input.preset.modules : [];
    const modules: StructureModule[] = presetModules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((pm) => ({
            moduleId: pm.moduleId,
            moduleType: pm.moduleType,
            order: pm.order,
            intent: { key: pm.intent.key, text: pm.intent.text },
            requiredInputSlots: [...pm.requiredInputSlots],
            placeholders: [...pm.placeholders]
        }));
    return {
        planId: input.planId || `structure-only:${input.projectId}`,
        projectId: input.projectId,
        sourceRevision: input.sourceRevision,
        presetId: input.preset.presetId,
        capabilityStatus: 'fallback',
        outputScope: 'structure_only',
        modules,
        constraints: STRUCTURE_ONLY_CONSTRAINTS
    };
}

/**
 * Claim Guard：对任意来源骨架做 fail-closed 校验，**必须对照 preset 核对精确来源**。
 * 不靠关键词，而靠：禁止字段 + 占位符白名单 + 约束收紧 + intent/type/order 与 preset 精确一致。
 */
export function detectStructureOnlyClaimLeakage(plan: unknown, preset: StructureSkillPreset): ClaimGuardResult {
    const violations: ClaimGuardViolation[] = [];
    const p = plan as Partial<StructureOnlyPlan> | null | undefined;

    if (!p || typeof p !== 'object') {
        return { valid: false, violations: [{ code: 'STRUCTURE_ONLY_PRODUCT_CLAIM', jsonPointer: '/', text: 'plan 为空或非对象' }] };
    }

    const presetById = new Map<string, StructureModulePreset>();
    for (const pm of preset?.modules || []) presetById.set(pm.moduleId, pm);
    const allowedPlaceholders = new Set<string>(STRUCTURE_ONLY_PLACEHOLDERS as readonly string[]);
    const modules: unknown[] = Array.isArray(p.modules) ? (p.modules as unknown[]) : [];

    modules.forEach((mod, index) => {
        const m = (mod || {}) as Record<string, unknown>;
        const ptr = `/modules/${index}`;

        //  1) 禁止字段（可承载产品宣称）
        for (const key of Object.keys(m)) {
            if (FORBIDDEN_CLAIM_FIELDS.includes(key)) {
                violations.push({ code: 'STRUCTURE_ONLY_PRODUCT_CLAIM', jsonPointer: `${ptr}/${key}`, text: String(m[key]) });
            }
        }

        //  2) 模块必须在 preset 中
        const presetModule = presetById.get(String(m.moduleId));
        if (!presetModule) {
            violations.push({ code: 'STRUCTURE_ONLY_UNKNOWN_MODULE', jsonPointer: `${ptr}/moduleId`, text: String(m.moduleId) });
            return;
        }

        //  3) intent / type / order 必须与 preset 精确一致（防有人改 intent 塞产品事实）
        const intent = (m.intent || {}) as Record<string, unknown>;
        if (String(intent.text) !== presetModule.intent.text || String(intent.key) !== presetModule.intent.key) {
            violations.push({ code: 'STRUCTURE_ONLY_INTENT_TAMPERED', jsonPointer: `${ptr}/intent`, text: String(intent.text) });
        }
        if (m.moduleType !== presetModule.moduleType) {
            violations.push({ code: 'STRUCTURE_ONLY_INTENT_TAMPERED', jsonPointer: `${ptr}/moduleType`, text: String(m.moduleType) });
        }
        if (Number(m.order) !== presetModule.order) {
            violations.push({ code: 'STRUCTURE_ONLY_INTENT_TAMPERED', jsonPointer: `${ptr}/order`, text: String(m.order) });
        }

        //  4) 占位符必须既在白名单、又是该 preset 模块允许的子集
        const presetPlaceholders = new Set<string>(presetModule.placeholders as readonly string[]);
        const placeholders = Array.isArray(m.placeholders) ? m.placeholders : [];
        placeholders.forEach((ph, pi) => {
            const phStr = String(ph);
            if (!allowedPlaceholders.has(phStr) || !presetPlaceholders.has(phStr)) {
                violations.push({ code: 'STRUCTURE_ONLY_INVALID_PLACEHOLDER', jsonPointer: `${ptr}/placeholders/${pi}`, text: phStr });
            }
        });
    });

    //  5) 内容约束必须收紧（任一放开即违规）
    const c = p.constraints as Partial<StructureOnlyConstraints> | undefined;
    if (!c
        || c.visualClaimsAllowed !== false
        || c.productClaimsAllowed !== false
        || c.qualityGateEligible !== false
        || c.capabilityStatus !== 'fallback') {
        violations.push({ code: 'STRUCTURE_ONLY_CONSTRAINT_VIOLATION', jsonPointer: '/constraints', text: JSON.stringify(c || null) });
    }

    return { valid: violations.length === 0, violations };
}

/** fail-closed：骨架不干净即抛错，调用方不得发布。错误信息指明违规位置。 */
export function assertStructureOnlyPlanClean(plan: unknown, preset: StructureSkillPreset): void {
    const result = detectStructureOnlyClaimLeakage(plan, preset);
    if (!result.valid) {
        const detail = result.violations.map((v) => `${v.code}@${v.jsonPointer}=${v.text}`).join('; ');
        throw new Error(`STRUCTURE_ONLY_CLAIM_LEAKAGE: 检测到结构草案混入产品事实或偏离 preset，已拒绝发布。违规：${detail}`);
    }
}
