/**
 * Design Project State 纯逻辑层（合并、校验、摘要）
 *
 * 主进程 IPC 与渲染侧工具共用；无 IO、无环境依赖，可被 smoke 直接测试。
 */

import {
    DESIGN_PROJECT_STATE_SCHEMA_VERSION,
    type DesignProjectState,
    type DesignProjectStatePatch
} from './types/design-project-state.types';
import {
    applyDesignProjectFactOperations,
    buildDesignProjectFactProvenanceSummary,
    canDesignProjectFactSupportEvaluation,
    listDesignProjectFactRecords,
    normalizeDesignProjectFactRecords
} from './design-project-fact-provenance';
import {
    applyDesignProjectRuleOperations,
    buildDesignProjectRulePolicy,
    normalizeDesignProjectRuleRecords
} from './design-project-rule-governance';
import { normalizeArtifactRefs } from './agent-runtime-v5/artifact-repository-contract';

/** 摘要注入提示词的总长上限 */
const MAX_SUMMARY_CHARS = 3500;
/** 数组字段保留上限（防状态文件无限膨胀） */
const MAX_LIST_ITEMS = 50;
const MAX_LEARNINGS = 100;
const MAX_VERSIONS = 100;

const DESIGN_PROJECT_STATE_ALLOWED_KEYS = [
    'schemaVersion',
    'projectId',
    'projectName',
    'taskType',
    'platform',
    'canvasSize',
    'brandStyle',
    'targetUser',
    'productFacts',
    'factRecords',
    'ruleRecords',
    'materialAssets',
    'painPoints',
    'competitorNotes',
    'sellingPoints',
    'copywriting',
    'visualDirection',
    'layoutPlan',
    'productionTasks',
    'reviewResult',
    'deliveryFiles',
    'artifactRefs',
    'learnings',
    'versionHistory',
    'updatedAt',
    'updatedBy'
] as const satisfies readonly (keyof DesignProjectState)[];

const DESIGN_PROJECT_STATE_SET_ALLOWED_KEYS = new Set<string>([
    'projectId',
    'projectName',
    'taskType',
    'platform',
    'canvasSize',
    'brandStyle',
    'targetUser',
    'productFacts',
    'materialAssets',
    'painPoints',
    'competitorNotes',
    'sellingPoints',
    'copywriting',
    'visualDirection',
    'layoutPlan',
    'productionTasks',
    'reviewResult',
    'deliveryFiles'
] as const satisfies readonly (keyof DesignProjectState)[]);

export function createEmptyDesignProjectState(): DesignProjectState {
    return { schemaVersion: DESIGN_PROJECT_STATE_SCHEMA_VERSION };
}

/** 读入的原始 JSON 规范化为合法状态（容忍历史/损坏数据，不抛错） */
export function normalizeDesignProjectState(raw: unknown): DesignProjectState {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return createEmptyDesignProjectState();
    }
    const source = raw as Record<string, unknown>;
    const state = createEmptyDesignProjectState();
    const target = state as unknown as Record<string, unknown>;
    for (const key of DESIGN_PROJECT_STATE_ALLOWED_KEYS) {
        if (key === 'schemaVersion' || !Object.prototype.hasOwnProperty.call(source, key)) continue;
        target[key] = source[key];
    }
    for (const key of ['productFacts', 'painPoints', 'competitorNotes', 'sellingPoints', 'deliveryFiles'] as const) {
        const value = state[key];
        if (value !== undefined && !Array.isArray(value)) delete (state as any)[key];
    }
    for (const key of ['materialAssets', 'copywriting', 'productionTasks', 'learnings', 'versionHistory'] as const) {
        const value = state[key];
        if (value !== undefined && !Array.isArray(value)) delete (state as any)[key];
    }
    state.factRecords = normalizeDesignProjectFactRecords(state.factRecords);
    if (state.factRecords.length === 0) delete state.factRecords;
    state.ruleRecords = normalizeDesignProjectRuleRecords(state.ruleRecords);
    if (state.ruleRecords.length === 0) delete state.ruleRecords;
    state.artifactRefs = normalizeArtifactRefs(state.artifactRefs);
    if (state.artifactRefs.length === 0) delete state.artifactRefs;
    return state;
}

function capList<T>(list: T[] | undefined, max: number): T[] | undefined {
    if (!Array.isArray(list)) return undefined;
    return list.length > max ? list.slice(list.length - max) : list;
}

/**
 * 应用增量更新：set 按字段整体替换；learnings / versionHistory 只追加。
 * 返回新对象，不修改入参。
 */
export function applyDesignProjectStatePatch(
    current: DesignProjectState,
    patch: DesignProjectStatePatch
): DesignProjectState {
    const now = new Date().toISOString();
    const next: DesignProjectState = { ...normalizeDesignProjectState(current) };

    if (patch.set && typeof patch.set === 'object') {
        for (const [key, value] of Object.entries(patch.set)) {
            if (value === undefined || value === null) continue;
            // set 采用正向清单；未知字段与 Repository / 追加型 / 元数据字段一律不进入项目记忆。
            if (!DESIGN_PROJECT_STATE_SET_ALLOWED_KEYS.has(key)) continue;
            (next as unknown as Record<string, unknown>)[key] = value;
        }
    }

    if (Array.isArray(patch.upsertFacts) || Array.isArray(patch.reviewFacts)) {
        next.factRecords = applyDesignProjectFactOperations({
            current: next.factRecords,
            upsertFacts: patch.upsertFacts,
            reviewFacts: patch.reviewFacts,
            authority: patch.factWriteAuthority,
            updatedBy: patch.updatedBy,
            now
        });
        if (next.factRecords.length === 0) delete next.factRecords;
    }

    if (Array.isArray(patch.upsertRules) || Array.isArray(patch.reviewRules)) {
        next.ruleRecords = applyDesignProjectRuleOperations({
            current: next.ruleRecords,
            upsertRules: patch.upsertRules,
            reviewRules: patch.reviewRules,
            authority: patch.ruleWriteAuthority,
            updatedBy: patch.updatedBy,
            now
        });
        if (next.ruleRecords.length === 0) delete next.ruleRecords;
    }

    if (patch.appendLearning && String(patch.appendLearning).trim()) {
        next.learnings = capList([
            ...(next.learnings || []),
            {
                note: String(patch.appendLearning).trim(),
                timestamp: now,
                ...(patch.updatedBy ? { source: patch.updatedBy } : {})
            }
        ], MAX_LEARNINGS);
    }

    if (patch.appendVersion && String(patch.appendVersion.reason || '').trim()) {
        const versions = next.versionHistory || [];
        const autoVersion = `V${String(versions.length + 1).padStart(2, '0')}`;
        next.versionHistory = capList([
            ...versions,
            {
                version: String(patch.appendVersion.version || autoVersion),
                reason: String(patch.appendVersion.reason).trim(),
                timestamp: now,
                ...(patch.updatedBy ? { author: patch.updatedBy } : {})
            }
        ], MAX_VERSIONS);
    }

    // 列表字段封顶
    for (const key of ['productFacts', 'painPoints', 'competitorNotes', 'sellingPoints', 'deliveryFiles', 'materialAssets', 'copywriting', 'productionTasks'] as const) {
        if (Array.isArray(next[key])) {
            (next as any)[key] = capList(next[key] as any[], MAX_LIST_ITEMS);
        }
    }

    next.updatedAt = now;
    if (patch.updatedBy) next.updatedBy = String(patch.updatedBy);
    return next;
}

function summaryLine(label: string, value: string | undefined): string | null {
    const text = String(value || '').trim();
    return text ? `- ${label}：${text}` : null;
}

function summaryList(label: string, list: string[] | undefined, max = 8): string | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const shown = list.slice(0, max).join('；');
    const suffix = list.length > max ? `（共 ${list.length} 条）` : '';
    return `- ${label}：${shown}${suffix}`;
}

function formatProductionTaskStatus(status: unknown): string {
    switch (status) {
        case 'in_progress': return '进行中';
        case 'done': return '已完成';
        case 'blocked': return '受阻';
        default: return '待做';
    }
}

/**
 * 任务进度纪律（多步设计任务的系统提示常驻节）：
 * 教模型把任务计划落进 productionTasks 并持续维护——这是跨轮次的任务真相源，
 * 中断续跑以它为准（治"续跑轮重做已完成步骤/重复置入"，机制级而非提示补丁：
 * 配套 = 摘要展示任务清单 + updateDesignProjectState 写回通道 + 续跑摘要指向它）。
 */
export function buildTaskStateDisciplineSection(): string {
    return [
        '## 任务进度纪律（多步任务）',
        '- 开始多步设计任务时，先用 updateDesignProjectState 把任务拆成 productionTasks（title + status）落进项目状态；',
        '- 每完成或受阻一项立即更新该项 status；产出实体（如置入图层的 id/名称、导出文件路径）记进该项 note；',
        '- 项目状态里的任务清单是跨轮次的任务真相源：续跑时以它为准——不重做 done 项，从 in_progress / pending 项继续。'
    ].join('\n');
}

/**
 * 生成注入主循环 / 队友系统提示的状态摘要（有界）。
 * 空状态返回空字符串（调用方据此跳过注入）。
 */
export function buildDesignProjectStateSummary(state: DesignProjectState | null | undefined): string {
    if (!state) return '';
    const normalized = normalizeDesignProjectState(state);
    const factRecords = listDesignProjectFactRecords(normalized);
    const factSummary = buildDesignProjectFactProvenanceSummary(normalized);
    const trustedFacts = factRecords.filter(canDesignProjectFactSupportEvaluation);
    const rulePolicy = buildDesignProjectRulePolicy(normalized, {
        taskType: normalized.taskType,
        channel: normalized.platform
    });

    const lines: Array<string | null> = [
        summaryLine('项目', [normalized.projectName, normalized.taskType, normalized.platform].filter(Boolean).join(' / ')),
        normalized.canvasSize && (normalized.canvasSize.width || normalized.canvasSize.preset)
            ? `- 画布：${normalized.canvasSize.preset || `${normalized.canvasSize.width}×${normalized.canvasSize.height}`}`
            : null,
        normalized.brandStyle ? `- 旧品牌风格参考（未确认）：${normalized.brandStyle}` : null,
        rulePolicy.applicableRules.length > 0
            ? `- 已确认项目/品牌规则：${rulePolicy.applicableRules.slice(0, 6).map((rule) => `[${rule.enforcement}] ${rule.statement}`).join('；')}${rulePolicy.applicableRules.length > 6 ? `（共 ${rulePolicy.applicableRules.length} 条）` : ''}`
            : null,
        rulePolicy.pendingRuleCount > 0
            ? `- 待确认规则：${rulePolicy.pendingRuleCount} 条（不能自动成为执行约束）`
            : null,
        rulePolicy.conflicts.length > 0
            ? `- 规则冲突：${rulePolicy.conflicts.length} 组（解决前不能声明质量通过）`
            : null,
        rulePolicy.requiresApprovalBeforeDelivery
            ? '- 交付审批：存在已确认的 approval_required 规则，交付前必须取得审批；该规则不授予工具执行权限'
            : null,
        summaryLine('目标用户', normalized.targetUser),
        summaryList('产品事实', normalized.productFacts),
        trustedFacts.length > 0
            ? `- 已确认事实：${trustedFacts.slice(0, 8).map((fact) => fact.statement).join('；')}${trustedFacts.length > 8 ? `（共 ${trustedFacts.length} 条）` : ''}`
            : null,
        factSummary.needsReview > 0
            ? `- 待确认事实：${factSummary.needsReview} 条（只能作为候选，不能直接作为已确认事实或质量结论）`
            : null,
        summaryList('用户痛点', normalized.painPoints),
        summaryList('核心卖点', normalized.sellingPoints),
        summaryList('竞品观察', normalized.competitorNotes, 4),
        Array.isArray(normalized.copywriting) && normalized.copywriting.length > 0
            ? `- 文案方案：${normalized.copywriting.slice(0, 6).map(c => `[${c.slot}] ${c.text}`).join('；')}${normalized.copywriting.length > 6 ? `（共 ${normalized.copywriting.length} 条）` : ''}`
            : null,
        summaryLine('视觉方向', normalized.visualDirection),
        summaryLine('版式规划', normalized.layoutPlan ? normalized.layoutPlan.slice(0, 400) : undefined),
        // 任务清单是跨轮次的任务真相源（治"续跑轮把上一轮半成品当原有内容重做"）：
        // 摘要不显示它 = 机制半隐身，模型既不会维护也无法据此续跑。
        Array.isArray(normalized.productionTasks) && normalized.productionTasks.length > 0
            ? `- 任务清单：${normalized.productionTasks.slice(0, 8).map(t => `[${formatProductionTaskStatus(t.status)}] ${t.title}${t.note ? `（${String(t.note).slice(0, 60)}）` : ''}`).join('；')}${normalized.productionTasks.length > 8 ? `（共 ${normalized.productionTasks.length} 项）` : ''}`
            : null,
        normalized.reviewResult?.verdict
            ? `- 最近评审：${normalized.reviewResult.verdict}${normalized.reviewResult.issues?.length ? `（${normalized.reviewResult.issues.length} 个待改进项）` : ''}`
            : null,
        Array.isArray(normalized.artifactRefs) && normalized.artifactRefs.length > 0
            ? `- 已发布产物：${normalized.artifactRefs.length} 个 Repository 引用（正文未进入 Project State）`
            : null,
        Array.isArray(normalized.versionHistory) && normalized.versionHistory.length > 0
            ? `- 最新版本：${normalized.versionHistory[normalized.versionHistory.length - 1].version}（${normalized.versionHistory[normalized.versionHistory.length - 1].reason}）`
            : null,
        Array.isArray(normalized.learnings) && normalized.learnings.length > 0
            ? `- 历史复盘：${normalized.learnings.slice(-3).map(l => l.note).join('；')}`
            : null
    ];

    const body = lines.filter(Boolean).join('\n');
    if (!body) return '';

    const summary = [
        '## 设计项目状态（Design Project State，共享项目记忆）',
        body,
        '说明：以上是项目已沉淀的共识。用户当前指令优先于历史状态；规则只约束设计质量与交付判断，不授予工具权限；状态有更新时用 updateDesignProjectState 写回。'
    ].join('\n');

    return summary.length > MAX_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…[状态摘要已截断]`
        : summary;
}
