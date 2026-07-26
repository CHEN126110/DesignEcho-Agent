/**
 * 记忆服务
 * 
 * 为 Agent 提供持久化记忆能力
 * 
 * 记忆类型：
 * 1. 用户偏好记忆 - 常用字体、配色、设计风格
 * 2. 操作模式记忆 - 频繁执行的任务序列
 * 3. 项目上下文记忆 - 当前项目的设计规范
 * 4. 短期记忆 - 当前对话的操作历史（用于撤销/重做）
 * 5. 实体记忆 - 提及过的图层、颜色等实体
 */

import type {
    DesignKnowledgeQuery,
    DesignKnowledgeResult,
    DesignKnowledgeSourceType
} from '../../shared/design-knowledge-search';
import {
    buildDesignMemoryItemsFromUserPreferences,
    searchDesignMemoryKnowledge,
    type BuildDesignMemoryItemsFromPreferencesOptions,
    type DesignMemorySourceNote,
    type DesignMemoryItem,
    type DesignMemoryKind,
    type DesignMemoryScope,
    type DesignMemorySource,
    type DesignMemoryStatus
} from '../../shared/design-memory-knowledge';
import {
    reviewDesignLearningMemoryCandidate,
    type DesignLearningMemoryReviewDecision,
    type DesignLearningMemoryReviewResult,
    type ReviewDesignLearningMemoryCandidateInput
} from '../../shared/design-learning-memory-review';
import {
    buildDesignLearningMemoryReviewQueueView,
    type DesignLearningMemoryReviewQueueView
} from '../../shared/design-learning-memory-review-queue';
import {
    applyDesignKnowledgeDispositions,
    createDesignKnowledgeDisposition,
    type DesignKnowledgeDisposition
} from '../../shared/design-knowledge-governance';
import { sanitizeDesignLearningVisualCase } from '../../shared/design-learning-visual-case';
import {
    buildHumanReviewRecord,
    normalizeHumanReviewRecord,
    type BuildHumanReviewRecordInput,
    type HumanReviewRecord,
    type HumanReviewRecordListOptions
} from '../../shared/human-review-record';

// ==================== 类型定义 ====================

/**
 * 用户偏好
 */
export interface UserPreferences {
    // 设计偏好
    design: {
        preferredFonts: string[];       // 常用字体
        preferredColors: string[];      // 常用颜色
        preferredStyles: string[];      // 设计风格（极简、现代、复古等）
        defaultAlignment: string;       // 默认对齐方式
        defaultSpacing: number;         // 默认间距
    };
    // 交互偏好
    interaction: {
        verbosity: 'concise' | 'normal' | 'detailed';  // 回复详细程度
        confirmBeforeExecute: boolean;   // 执行前是否确认
        autoSave: boolean;               // 自动保存
        showThinking: boolean;           // 显示思考过程
    };
    // 工作流偏好
    workflow: {
        defaultExportFormat: string;     // 默认导出格式
        defaultExportQuality: number;    // 默认导出质量
        autoBeautify: boolean;           // 自动美化
    };
}

export type PreferenceMemoryCategory =
    | 'font'
    | 'color'
    | 'style'
    | 'workflow'
    | 'interaction'
    | 'copywriting'
    | 'layout'
    | 'unknown';

export type PreferenceMemorySourceType = 'explicit' | 'inferred' | 'temporary' | 'deprecated';
export type PreferenceMemoryStatus = 'active' | 'disabled' | 'needs_review' | 'archived';

export interface PreferenceMemoryItem {
    id: string;
    category: PreferenceMemoryCategory;
    value: string;
    label: string;
    sourceType: PreferenceMemorySourceType;
    status: PreferenceMemoryStatus;
    sourceNote: string;
    createdAt: number;
    updatedAt: number;
    lastUsedAt?: number;
    usageCount: number;
    scope?: {
        type: 'user' | 'project' | 'brand' | 'session';
        id?: string;
    };
}

export interface UpsertExplicitPreferenceInput {
    category: PreferenceMemoryCategory;
    value: string;
    label?: string;
    sourceNote?: string;
    scope?: PreferenceMemoryItem['scope'];
}

export interface UpdatePreferenceItemInput {
    category?: PreferenceMemoryCategory;
    value?: string;
    label?: string;
    sourceType?: PreferenceMemorySourceType;
    status?: PreferenceMemoryStatus;
    sourceNote?: string;
    scope?: PreferenceMemoryItem['scope'];
}

export interface ListPreferenceItemsOptions {
    scope?: PreferenceMemoryItem['scope'];
    includeLegacy?: boolean;
}

export interface PreferenceExportSnapshot {
    version: 'designecho-preferences/v1';
    exportedAt: number;
    preferenceItems: PreferenceMemoryItem[];
}

export interface ImportPreferencesOptions {
    mode?: 'merge' | 'replace';
}

export interface PreferenceImportResult {
    mode: 'merge' | 'replace';
    importedCount: number;
    replacedExistingCount: number;
    skippedCount: number;
}

export interface ClearPreferencesOptions {
    sourceTypes?: PreferenceMemorySourceType[];
    statuses?: PreferenceMemoryStatus[];
    includeLegacy?: boolean;
}

export interface PreferenceCleanupResult {
    archivedCount: number;
    legacyCleared: boolean;
}

export interface ListPersistedDesignMemoryItemsOptions {
    scope?: DesignMemoryScope;
    status?: DesignMemoryStatus;
    kind?: DesignMemoryKind;
    source?: DesignMemorySource;
    limit?: number;
}

export interface GetDesignLearningMemoryReviewQueueOptions {
    scope?: DesignMemoryScope;
    limit?: number;
}

export interface ReviewDesignLearningMemoryCandidateByIdInput {
    candidateId: string;
    decision?: DesignLearningMemoryReviewDecision | string;
    reviewer?: unknown;
    notes?: unknown;
    reviewedAt?: unknown;
}

export interface CreateDesignMemoryRevisionInput {
    itemId: string;
    title?: string;
    summary?: string;
    tags?: string[];
    changeNote?: string;
    updatedAt?: string;
}

export interface SetDesignMemoryLifecycleInput {
    itemId: string;
    status: 'active' | 'disabled';
    reason?: string;
    updatedAt?: string;
}

/**
 * 操作模式 - 用户频繁执行的任务序列
 */
export interface OperationPattern {
    id: string;
    name: string;
    description?: string;
    triggers: string[];                  // 触发这个模式的关键词
    steps: Array<{
        tool: string;
        params: any;
    }>;
    frequency: number;                   // 执行次数
    lastUsed: number;                    // 最后使用时间
    createdAt: number;
}

/**
 * 项目上下文
 */
export interface ProjectContext {
    projectId: string;
    // 设计规范
    designSpecs: {
        brandColors?: string[];          // 品牌色
        fontFamily?: string;             // 主字体
        styleguide?: string;             // 设计规范描述
    };
    // 最近操作
    recentLayers: Array<{
        id: number;
        name: string;
        lastAccessed: number;
    }>;
    // 常用操作
    frequentTools: Array<{
        tool: string;
        count: number;
    }>;
}

/**
 * 短期记忆 - 当前会话的操作历史
 */
export interface ShortTermMemory {
    // 操作历史（用于撤销/重做）
    operationHistory: Array<{
        id: string;
        tool: string;
        params: any;
        result: any;
        timestamp: number;
        canUndo: boolean;
    }>;
    // 当前上下文变量
    contextVariables: {
        selectedLayerId?: number;
        selectedLayerName?: string;
        lastMentionedLayers?: Array<{ id: number; name: string }>;
        lastMentionedColor?: string;
        lastMentionedSize?: { width: number; height: number };
        currentTaskType?: string;
    };
    // 对话摘要
    conversationSummary: string;
    // 最后更新时间
    lastUpdated: number;
}

/**
 * 实体记忆 - 对话中提及的实体
 */
export interface EntityMemory {
    // 图层实体
    layers: Map<string, {
        id: number;
        name: string;
        mentions: number;
        lastMentioned: number;
    }>;
    // 颜色实体
    colors: Map<string, {
        value: string;
        name?: string;
        mentions: number;
    }>;
    // 尺寸实体
    sizes: Map<string, {
        width: number;
        height: number;
        name?: string;
        mentions: number;
    }>;
}

/**
 * 完整记忆状态
 */
export interface MemoryState {
    preferences: UserPreferences;
    preferenceItems: PreferenceMemoryItem[];
    designMemoryItems: DesignMemoryItem[];
    knowledgeDispositions: DesignKnowledgeDisposition[];
    patterns: OperationPattern[];
    humanReviewRecords: HumanReviewRecord[];
    projectContexts: Map<string, ProjectContext>;
    shortTerm: ShortTermMemory;
    entities: EntityMemory;
    version: number;
    lastSaved: number;
}

// ==================== 默认值 ====================

const DEFAULT_PREFERENCES: UserPreferences = {
    design: {
        preferredFonts: [],
        preferredColors: [],
        preferredStyles: [],
        defaultAlignment: 'centerHorizontal',
        defaultSpacing: 20
    },
    interaction: {
        verbosity: 'normal',
        confirmBeforeExecute: false,
        autoSave: true,
        showThinking: true
    },
    workflow: {
        defaultExportFormat: 'png',
        defaultExportQuality: 90,
        autoBeautify: false
    }
};

const DEFAULT_SHORT_TERM: ShortTermMemory = {
    operationHistory: [],
    contextVariables: {},
    conversationSummary: '',
    lastUpdated: Date.now()
};

function normalizeStoredPreferences(value: unknown): UserPreferences {
    const record = value && typeof value === 'object' ? value as Partial<UserPreferences> : {};
    const design: Partial<UserPreferences['design']> = record.design && typeof record.design === 'object'
        ? record.design
        : {};
    const interaction: Partial<UserPreferences['interaction']> = record.interaction && typeof record.interaction === 'object'
        ? record.interaction
        : {};
    const workflow: Partial<UserPreferences['workflow']> = record.workflow && typeof record.workflow === 'object'
        ? record.workflow
        : {};
    const verbosity = interaction.verbosity === 'concise' || interaction.verbosity === 'detailed'
        ? interaction.verbosity
        : 'normal';
    const defaultSpacing = Number(design.defaultSpacing);
    const defaultExportQuality = Number(workflow.defaultExportQuality);
    return {
        design: {
            preferredFonts: uniqueTexts(Array.isArray(design.preferredFonts) ? design.preferredFonts.map(String) : []),
            preferredColors: uniqueTexts(Array.isArray(design.preferredColors) ? design.preferredColors.map(String) : []),
            preferredStyles: uniqueTexts(Array.isArray(design.preferredStyles) ? design.preferredStyles.map(String) : []),
            defaultAlignment: normalizePreferenceText(design.defaultAlignment) || DEFAULT_PREFERENCES.design.defaultAlignment,
            defaultSpacing: Number.isFinite(defaultSpacing) ? defaultSpacing : DEFAULT_PREFERENCES.design.defaultSpacing
        },
        interaction: {
            verbosity,
            confirmBeforeExecute: typeof interaction.confirmBeforeExecute === 'boolean'
                ? interaction.confirmBeforeExecute
                : DEFAULT_PREFERENCES.interaction.confirmBeforeExecute,
            autoSave: typeof interaction.autoSave === 'boolean'
                ? interaction.autoSave
                : DEFAULT_PREFERENCES.interaction.autoSave,
            showThinking: typeof interaction.showThinking === 'boolean'
                ? interaction.showThinking
                : DEFAULT_PREFERENCES.interaction.showThinking
        },
        workflow: {
            defaultExportFormat: normalizePreferenceText(workflow.defaultExportFormat)
                || DEFAULT_PREFERENCES.workflow.defaultExportFormat,
            defaultExportQuality: Number.isFinite(defaultExportQuality)
                ? defaultExportQuality
                : DEFAULT_PREFERENCES.workflow.defaultExportQuality,
            autoBeautify: typeof workflow.autoBeautify === 'boolean'
                ? workflow.autoBeautify
                : DEFAULT_PREFERENCES.workflow.autoBeautify
        }
    };
}

function normalizeStoredShortTerm(value: unknown): ShortTermMemory {
    const record = value && typeof value === 'object' ? value as Partial<ShortTermMemory> : {};
    return {
        operationHistory: Array.isArray(record.operationHistory) ? record.operationHistory : [],
        contextVariables: record.contextVariables && typeof record.contextVariables === 'object'
            ? record.contextVariables
            : {},
        conversationSummary: normalizePreferenceText(record.conversationSummary),
        lastUpdated: Number.isFinite(Number(record.lastUpdated)) ? Number(record.lastUpdated) : Date.now()
    };
}

function createDefaultMemoryState(): MemoryState {
    return {
        preferences: normalizeStoredPreferences(DEFAULT_PREFERENCES),
        preferenceItems: [],
        designMemoryItems: [],
        knowledgeDispositions: [],
        patterns: [],
        humanReviewRecords: [],
        projectContexts: new Map(),
        shortTerm: normalizeStoredShortTerm(DEFAULT_SHORT_TERM),
        entities: {
            layers: new Map(),
            colors: new Map(),
            sizes: new Map()
        },
        version: 1,
        lastSaved: Date.now()
    };
}

// ==================== 存储键 ====================

const STORAGE_KEY = 'designecho-memory';
const MAX_OPERATION_HISTORY = 50;
const MAX_PATTERNS = 20;
// 仅限制单次读取量，不再在保存时通过 slice 静默删除版本与复核审计。
const MAX_DESIGN_MEMORY_ITEMS = 2000;
const MAX_RECENT_LAYERS = 10;
const MAX_HUMAN_REVIEW_RECORDS = 120;
const PREFERENCES_EXPORT_VERSION = 'designecho-preferences/v1' as const;

const PREFERENCE_CATEGORIES: readonly PreferenceMemoryCategory[] = [
    'font',
    'color',
    'style',
    'workflow',
    'interaction',
    'copywriting',
    'layout',
    'unknown'
];

const PREFERENCE_SOURCE_TYPES: readonly PreferenceMemorySourceType[] = [
    'explicit',
    'inferred',
    'temporary',
    'deprecated'
];

const PREFERENCE_STATUSES: readonly PreferenceMemoryStatus[] = [
    'active',
    'disabled',
    'needs_review',
    'archived'
];

const PREFERENCE_SCOPE_TYPES: readonly NonNullable<PreferenceMemoryItem['scope']>['type'][] = [
    'user',
    'project',
    'brand',
    'session'
];

const DESIGN_MEMORY_KINDS: readonly DesignMemoryKind[] = [
    'user_preference',
    'brand_preference',
    'project_rule',
    'approved_recipe',
    'rejected_pattern',
    'visual_case',
    'benchmark_case',
    'failure_pattern'
];

const DESIGN_MEMORY_SOURCES: readonly DesignMemorySource[] = [
    'explicit_user_feedback',
    'manual_setting',
    'accepted_output',
    'rejected_output',
    'imported_case',
    'benchmark',
    'inferred_from_operations',
    'legacy_local_preference'
];

const DESIGN_MEMORY_STATUSES: readonly DesignMemoryStatus[] = [
    'active',
    'needs_review',
    'disabled',
    'superseded',
    'expired'
];

const DESIGN_MEMORY_SCOPE_TYPES: readonly DesignMemoryScope['type'][] = [
    'user',
    'project',
    'brand',
    'session'
];

const DESIGN_KNOWLEDGE_SOURCE_TYPES: readonly DesignKnowledgeSourceType[] = [
    'local_recipe',
    'manual_rule',
    'design_crawler',
    'web_page',
    'mimo_web_search',
    'local_case',
    'eagle_library'
];

const FORBIDDEN_PREFERENCE_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi,
    /confidence/gi,
    /置信度?/gi
];

const LOCAL_PATH_PAYLOAD_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/g;

function normalizePreferenceText(value: unknown): string {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    for (const pattern of FORBIDDEN_PREFERENCE_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PAYLOAD_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}

function uniqueTexts(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizePreferenceText).filter(Boolean)));
}

function slugPreferenceValue(value: string): string {
    return normalizePreferenceText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizePreferenceCategory(value: unknown): PreferenceMemoryCategory {
    const category = normalizePreferenceText(value) as PreferenceMemoryCategory;
    return PREFERENCE_CATEGORIES.includes(category) ? category : 'unknown';
}

function normalizePreferenceSourceType(value: unknown): PreferenceMemorySourceType {
    const sourceType = normalizePreferenceText(value) as PreferenceMemorySourceType;
    return PREFERENCE_SOURCE_TYPES.includes(sourceType) ? sourceType : 'inferred';
}

function normalizePreferenceStatus(value: unknown): PreferenceMemoryStatus {
    const status = normalizePreferenceText(value) as PreferenceMemoryStatus;
    return PREFERENCE_STATUSES.includes(status) ? status : 'needs_review';
}

function normalizePreferenceScope(scope: unknown): PreferenceMemoryItem['scope'] {
    const candidate = scope as PreferenceMemoryItem['scope'] | undefined;
    const type = normalizePreferenceText(candidate?.type) as NonNullable<PreferenceMemoryItem['scope']>['type'];
    const normalizedType = PREFERENCE_SCOPE_TYPES.includes(type) ? type : 'user';
    const id = normalizePreferenceText(candidate?.id).slice(0, 160) || undefined;
    return id ? { type: normalizedType, id } : { type: normalizedType };
}

function preferenceScopeId(scope: PreferenceMemoryItem['scope']): string {
    return normalizePreferenceText(scope?.id).toLowerCase();
}

function preferenceScopeMatches(
    itemScope: PreferenceMemoryItem['scope'],
    requestedScope?: PreferenceMemoryItem['scope']
): boolean {
    const normalizedItemScope = normalizePreferenceScope(itemScope);
    if (!requestedScope) {
        return normalizedItemScope?.type === 'user' && !normalizedItemScope.id;
    }

    const normalizedRequestedScope = normalizePreferenceScope(requestedScope);
    if (normalizedItemScope?.type === 'user' && !normalizedItemScope.id) {
        return true;
    }
    if (normalizedItemScope?.type !== normalizedRequestedScope?.type) {
        return false;
    }
    const itemId = preferenceScopeId(normalizedItemScope);
    const requestedId = preferenceScopeId(normalizedRequestedScope);
    if (requestedId) {
        return itemId === requestedId;
    }
    return !itemId;
}

function preferenceScopeSuffix(scope?: PreferenceMemoryItem['scope']): string {
    const normalizedScope = normalizePreferenceScope(scope);
    if (!normalizedScope || (normalizedScope.type === 'user' && !normalizedScope.id)) {
        return '';
    }
    return `${normalizedScope.type}-${slugPreferenceValue(normalizedScope.id || 'global') || 'global'}`;
}

function preferenceMemoryId(category: PreferenceMemoryCategory, value: string, scope?: PreferenceMemoryItem['scope']): string {
    const slug = slugPreferenceValue(value) || 'unknown';
    const suffix = preferenceScopeSuffix(scope);
    const scopePart = suffix ? `-${suffix}` : '';
    if (category === 'font') return `user-preference-font-${slug}${scopePart}`;
    if (category === 'color') return `user-preference-color-${slug}${scopePart}`;
    if (category === 'style') return `user-preference-style-${slug}${scopePart}`;
    if (category === 'workflow') return `user-preference-workflow-${slug}${scopePart}`;
    if (category === 'interaction') return `user-preference-interaction-${slug}${scopePart}`;
    return `user-preference-${category}-${slug}${scopePart}`;
}

function preferenceLabel(category: PreferenceMemoryCategory, value: string, label?: string): string {
    const cleanLabel = normalizePreferenceText(label);
    if (cleanLabel) return cleanLabel;
    if (category === 'font') return `常用字体：${value}`;
    if (category === 'color') return `常用颜色：${value}`;
    if (category === 'style') return `偏好风格：${value}`;
    if (category === 'workflow') return `工作流偏好：${value}`;
    if (category === 'interaction') return `交互偏好：${value}`;
    if (category === 'copywriting') return `文案偏好：${value}`;
    if (category === 'layout') return `排版偏好：${value}`;
    return `用户偏好：${value}`;
}

function normalizePreferenceMemoryItem(item: Partial<PreferenceMemoryItem> | undefined): PreferenceMemoryItem | undefined {
    const value = normalizePreferenceText(item?.value);
    const category = normalizePreferenceCategory(item?.category);
    const scope = normalizePreferenceScope(item?.scope);
    if (!value) return undefined;
    const now = Date.now();
    const id = normalizePreferenceText(item?.id) || preferenceMemoryId(category, value, scope);
    const status = normalizePreferenceStatus(item?.status);
    const sourceType = normalizePreferenceSourceType(item?.sourceType);
    return {
        id,
        category,
        value,
        label: preferenceLabel(category, value, item?.label),
        sourceType,
        status,
        sourceNote: normalizePreferenceText(item?.sourceNote) || '来自本地偏好记忆，不能覆盖当前用户指令、项目事实或平台规范。',
        createdAt: Number(item?.createdAt || now),
        updatedAt: Number(item?.updatedAt || now),
        lastUsedAt: item?.lastUsedAt ? Number(item.lastUsedAt) : undefined,
        usageCount: Math.max(0, Number(item?.usageCount || 0)),
        scope
    };
}

function normalizeImportedPreferenceMemoryItem(item: Partial<PreferenceMemoryItem> | undefined): PreferenceMemoryItem | undefined {
    const normalized = normalizePreferenceMemoryItem(item);
    if (!normalized) return undefined;
    return {
        ...normalized,
        id: preferenceMemoryId(normalized.category, normalized.value, normalized.scope)
    };
}

function preferenceItemToDesignMemoryItem(item: PreferenceMemoryItem, options: BuildDesignMemoryItemsFromPreferencesOptions = {}): DesignMemoryItem | undefined {
    const normalized = normalizePreferenceMemoryItem(item);
    if (!normalized || normalized.status !== 'active') return undefined;
    const source = normalized.sourceType === 'explicit'
        ? 'explicit_user_feedback'
        : normalized.sourceType === 'deprecated'
            ? 'legacy_local_preference'
            : 'inferred_from_operations';
    const sourceRank = normalized.sourceType === 'explicit'
        ? 84
        : normalized.sourceType === 'deprecated'
            ? 58
            : 52;
    const tags = uniqueTexts([
        'preference-memory',
        normalized.category,
        normalized.value,
        normalized.sourceType
    ]);
    return {
        id: normalized.id,
        kind: 'user_preference',
        scope: normalized.scope || options.scope || { type: 'user' },
        status: 'active',
        source,
        title: normalized.label,
        summary: `${normalized.label}。${normalized.sourceNote}`,
        sourceNotes: [{
            source,
            summary: normalized.sourceNote,
            status: normalized.sourceType === 'inferred' ? 'needs_review' : 'active'
        }],
        tags,
        allowedUses: ['prompt_context', 'user_reference'],
        sourceRank,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt
    };
}

function normalizeDesignMemoryScope(scope: unknown): DesignMemoryScope {
    const raw = scope && typeof scope === 'object' ? scope as Partial<DesignMemoryScope> : {};
    const type = DESIGN_MEMORY_SCOPE_TYPES.includes(raw.type as DesignMemoryScope['type'])
        ? raw.type as DesignMemoryScope['type']
        : 'user';
    return {
        type,
        id: normalizePreferenceText(raw.id) || undefined
    };
}

function normalizeDesignMemoryKind(value: unknown): DesignMemoryKind {
    const text = normalizePreferenceText(value);
    return DESIGN_MEMORY_KINDS.includes(text as DesignMemoryKind)
        ? text as DesignMemoryKind
        : 'visual_case';
}

function normalizeDesignMemorySource(value: unknown): DesignMemorySource {
    const text = normalizePreferenceText(value);
    return DESIGN_MEMORY_SOURCES.includes(text as DesignMemorySource)
        ? text as DesignMemorySource
        : 'imported_case';
}

function normalizeDesignMemoryStatus(value: unknown): DesignMemoryStatus {
    const text = normalizePreferenceText(value);
    return DESIGN_MEMORY_STATUSES.includes(text as DesignMemoryStatus)
        ? text as DesignMemoryStatus
        : 'needs_review';
}

function normalizeDesignMemorySourceNotes(value: unknown): NonNullable<DesignMemoryItem['sourceNotes']> {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry): DesignMemorySourceNote | undefined => {
            const raw = entry && typeof entry === 'object'
                ? entry as { source?: unknown; summary?: unknown; status?: unknown }
                : {};
            const source = normalizePreferenceText(raw.source);
            const summary = normalizePreferenceText(raw.summary);
            const statusText = normalizePreferenceText(raw.status);
            if (!source || !summary) return undefined;
            const status: DesignMemorySourceNote['status'] =
                statusText === 'active' || statusText === 'needs_review' || statusText === 'disabled'
                    ? statusText
                    : 'needs_review';
            return {
                source,
                summary,
                status
            };
        })
        .filter((item): item is DesignMemorySourceNote => Boolean(item));
}

function normalizeDesignLearningInsights(value: unknown): DesignMemoryItem['learnedInsights'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as NonNullable<DesignMemoryItem['learnedInsights']>;
    const normalized: NonNullable<DesignMemoryItem['learnedInsights']> = {
        whatLooksGood: uniqueTexts(Array.isArray(raw.whatLooksGood) ? raw.whatLooksGood.map(String) : []),
        whyItWorks: uniqueTexts(Array.isArray(raw.whyItWorks) ? raw.whyItWorks.map(String) : []),
        reusableHeuristics: uniqueTexts(Array.isArray(raw.reusableHeuristics) ? raw.reusableHeuristics.map(String) : []),
        suitableScenarios: uniqueTexts(Array.isArray(raw.suitableScenarios) ? raw.suitableScenarios.map(String) : []),
        avoidWhen: uniqueTexts(Array.isArray(raw.avoidWhen) ? raw.avoidWhen.map(String) : []),
        limitations: uniqueTexts(Array.isArray(raw.limitations) ? raw.limitations.map(String) : [])
    };
    return Object.values(normalized).some((items) => Array.isArray(items) && items.length > 0)
        ? normalized
        : undefined;
}

function normalizePersistedDesignMemoryItem(item: Partial<DesignMemoryItem> | undefined): DesignMemoryItem | undefined {
    if (!item || typeof item !== 'object') return undefined;
    const id = normalizePreferenceText(item.id);
    const title = normalizePreferenceText(item.title);
    const summary = normalizePreferenceText(item.summary);
    if (!id || !title || !summary) return undefined;
    const sourceRank = Number(item.sourceRank);
    const learnedInsights = normalizeDesignLearningInsights(item.learnedInsights);
    const visualCase = sanitizeDesignLearningVisualCase(item.visualCase);
    const revision = Number(item.revision);
    const usageCount = Number(item.usageCount);
    return {
        id,
        kind: normalizeDesignMemoryKind(item.kind),
        scope: normalizeDesignMemoryScope(item.scope),
        status: normalizeDesignMemoryStatus(item.status),
        source: normalizeDesignMemorySource(item.source),
        title,
        summary,
        ...(learnedInsights ? { learnedInsights } : {}),
        ...(visualCase ? { visualCase } : {}),
        sourceNotes: normalizeDesignMemorySourceNotes(item.sourceNotes),
        tags: uniqueTexts(Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '')) : []),
        appliesTo: Array.isArray(item.appliesTo) ? item.appliesTo : undefined,
        allowedUses: Array.isArray(item.allowedUses) ? uniqueTexts(item.allowedUses.map((use) => String(use || ''))) : undefined,
        sourceRank: Number.isFinite(sourceRank) ? Math.max(0, Math.min(100, Math.round(sourceRank))) : 0,
        lineageId: normalizePreferenceText(item.lineageId) || id,
        revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 1,
        supersedesId: normalizePreferenceText(item.supersedesId) || undefined,
        supersededById: normalizePreferenceText(item.supersededById) || undefined,
        usageCount: Number.isFinite(usageCount) && usageCount > 0 ? Math.floor(usageCount) : 0,
        lastUsedAt: normalizePreferenceText(item.lastUsedAt) || undefined,
        retirementReason: normalizePreferenceText(item.retirementReason) || undefined,
        createdAt: normalizePreferenceText(item.createdAt) || undefined,
        updatedAt: normalizePreferenceText(item.updatedAt) || undefined,
        expiresAt: normalizePreferenceText(item.expiresAt) || undefined
    };
}

function sortDesignMemoryItems(items: DesignMemoryItem[]): DesignMemoryItem[] {
    return items.sort((a, b) => {
        const updatedDiff = Date.parse(String(b.updatedAt || '')) - Date.parse(String(a.updatedAt || ''));
        if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
}

function matchesDesignMemoryScope(itemScope: DesignMemoryScope, expected?: DesignMemoryScope): boolean {
    if (!expected) return true;
    if (itemScope.type !== expected.type) return false;
    if (expected.id && itemScope.id !== expected.id) return false;
    return true;
}

function normalizeKnowledgeDisposition(value: unknown): DesignKnowledgeDisposition | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<DesignKnowledgeDisposition>;
    const dispositionId = normalizePreferenceText(raw.dispositionId);
    const resultId = normalizePreferenceText(raw.resultId);
    const title = normalizePreferenceText(raw.title);
    const sourceRevision = normalizePreferenceText(raw.sourceRevision);
    const contentFingerprint = normalizePreferenceText(raw.contentFingerprint);
    const sourceType = DESIGN_KNOWLEDGE_SOURCE_TYPES.includes(raw.sourceType as DesignKnowledgeSourceType)
        ? raw.sourceType as DesignKnowledgeSourceType
        : undefined;
    if (!dispositionId || !resultId || !title || !sourceRevision || !contentFingerprint || !sourceType) {
        return undefined;
    }
    return {
        version: 'design-knowledge-disposition/v0',
        dispositionId,
        resultId,
        title,
        sourceType,
        sourceRevision,
        contentFingerprint,
        status: 'disabled',
        reason: normalizePreferenceText(raw.reason) || '用户从知识库中剔除该版本。',
        updatedAt: normalizePreferenceText(raw.updatedAt) || new Date().toISOString()
    };
}

function getVerbosityLabel(verbosity: UserPreferences['interaction']['verbosity']): string {
    if (verbosity === 'concise') {
        return '简洁';
    }
    if (verbosity === 'detailed') {
        return '详细';
    }
    return '正常';
}

// ==================== 记忆服务类 ====================

class MemoryService {
    private state: MemoryState;
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    private readonly changeListeners = new Set<() => void>();
    
    constructor() {
        this.state = this.loadFromStorage();
        console.log('[MemoryService] 初始化完成，加载了', this.state.patterns.length, '个操作模式');
    }
    
    // ========== 存储管理 ==========
    
    private loadFromStorage(): MemoryState {
        const fallback = createDefaultMemoryState();
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<MemoryState> & {
                    projectContexts?: unknown;
                    entities?: Partial<Record<keyof EntityMemory, unknown>>;
                };
                // 转换 Map 对象
                return {
                    ...fallback,
                    preferences: normalizeStoredPreferences(parsed.preferences),
                    preferenceItems: Array.isArray(parsed.preferenceItems)
                        ? parsed.preferenceItems
                            .map((item: Partial<PreferenceMemoryItem>) => normalizePreferenceMemoryItem(item))
                            .filter((item: PreferenceMemoryItem | undefined): item is PreferenceMemoryItem => Boolean(item))
                        : [],
                    designMemoryItems: Array.isArray(parsed.designMemoryItems)
                        ? parsed.designMemoryItems
                            .map((item: Partial<DesignMemoryItem>) => normalizePersistedDesignMemoryItem(item))
                            .filter((item: DesignMemoryItem | undefined): item is DesignMemoryItem => Boolean(item))
                        : [],
                    knowledgeDispositions: Array.isArray(parsed.knowledgeDispositions)
                        ? parsed.knowledgeDispositions
                            .map((item) => normalizeKnowledgeDisposition(item))
                            .filter((item): item is DesignKnowledgeDisposition => Boolean(item))
                        : [],
                    humanReviewRecords: Array.isArray(parsed.humanReviewRecords)
                        ? parsed.humanReviewRecords
                            .map((item: unknown) => normalizeHumanReviewRecord(item))
                            .filter((item: HumanReviewRecord | undefined): item is HumanReviewRecord => Boolean(item))
                        : [],
                    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
                    projectContexts: new Map(Array.isArray(parsed.projectContexts) ? parsed.projectContexts as any[] : []),
                    shortTerm: normalizeStoredShortTerm(parsed.shortTerm),
                    entities: {
                        layers: new Map(Array.isArray(parsed.entities?.layers) ? parsed.entities.layers as any[] : []),
                        colors: new Map(Array.isArray(parsed.entities?.colors) ? parsed.entities.colors as any[] : []),
                        sizes: new Map(Array.isArray(parsed.entities?.sizes) ? parsed.entities.sizes as any[] : [])
                    },
                    version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : fallback.version,
                    lastSaved: Number.isFinite(Number(parsed.lastSaved)) ? Number(parsed.lastSaved) : fallback.lastSaved
                };
            }
        } catch (e) {
            console.error('[MemoryService] 加载存储失败:', e);
        }
        
        return fallback;
    }
    
    private saveToStorage(options: { immediate?: boolean } = {}): void {
        this.emitChange();
        // 防抖：避免频繁写入
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        const persist = () => {
            try {
                const toSave = {
                    ...this.state,
                    projectContexts: Array.from(this.state.projectContexts.entries()),
                    entities: {
                        layers: Array.from(this.state.entities.layers.entries()),
                        colors: Array.from(this.state.entities.colors.entries()),
                        sizes: Array.from(this.state.entities.sizes.entries())
                    },
                    lastSaved: Date.now()
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } catch (error) {
                console.error('[MemoryService] 保存存储失败:', error);
                if (options.immediate) {
                    throw error;
                }
            }
        };

        if (options.immediate) {
            persist();
            return;
        }

        this.saveDebounceTimer = setTimeout(persist, 500);
    }

    subscribe(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    private emitChange(): void {
        for (const listener of this.changeListeners) listener();
    }
    
    // ========== 用户偏好 ==========
    
    getPreferences(): UserPreferences {
        return this.state.preferences;
    }

    private buildLegacyPreferenceItems(): PreferenceMemoryItem[] {
        const now = Date.now();
        const legacyItems: PreferenceMemoryItem[] = [];
        for (const font of uniqueTexts(this.state.preferences.design.preferredFonts)) {
            legacyItems.push({
                id: preferenceMemoryId('font', font),
                category: 'font',
                value: font,
                label: preferenceLabel('font', font),
                sourceType: 'deprecated',
                status: 'active',
                sourceNote: '来自旧版本地偏好字段，建议后续在偏好面板中确认或禁用。',
                createdAt: now,
                updatedAt: now,
                usageCount: 0,
                scope: { type: 'user' }
            });
        }
        for (const color of uniqueTexts(this.state.preferences.design.preferredColors)) {
            legacyItems.push({
                id: preferenceMemoryId('color', color),
                category: 'color',
                value: color,
                label: preferenceLabel('color', color),
                sourceType: 'deprecated',
                status: 'active',
                sourceNote: '来自旧版本地偏好字段，不能覆盖商品、品牌或平台规范。',
                createdAt: now,
                updatedAt: now,
                usageCount: 0,
                scope: { type: 'user' }
            });
        }
        for (const style of uniqueTexts(this.state.preferences.design.preferredStyles)) {
            legacyItems.push({
                id: preferenceMemoryId('style', style),
                category: 'style',
                value: style,
                label: preferenceLabel('style', style),
                sourceType: 'deprecated',
                status: 'active',
                sourceNote: '来自旧版本地偏好字段，可作为策略候选偏好。',
                createdAt: now,
                updatedAt: now,
                usageCount: 0,
                scope: { type: 'user' }
            });
        }
        const exportFormat = normalizePreferenceText(this.state.preferences.workflow.defaultExportFormat);
        if (exportFormat && exportFormat.toLowerCase() !== DEFAULT_PREFERENCES.workflow.defaultExportFormat) {
            legacyItems.push({
                id: preferenceMemoryId('workflow', `export-format-${exportFormat}`),
                category: 'workflow',
                value: exportFormat,
                label: `默认导出格式：${exportFormat}`,
                sourceType: 'deprecated',
                status: 'active',
                sourceNote: '来自旧版工作流偏好字段。',
                createdAt: now,
                updatedAt: now,
                usageCount: 0,
                scope: { type: 'user' }
            });
        }
        return legacyItems;
    }

    listPreferenceItems(options: ListPreferenceItemsOptions = {}): PreferenceMemoryItem[] {
        const storedById = new Map<string, PreferenceMemoryItem>();
        for (const item of this.state.preferenceItems || []) {
            const normalized = normalizePreferenceMemoryItem(item);
            if (normalized) storedById.set(normalized.id, normalized);
        }
        if (options.includeLegacy !== false) {
            for (const item of this.buildLegacyPreferenceItems()) {
                if (!storedById.has(item.id)) {
                    storedById.set(item.id, item);
                }
            }
        }
        return Array.from(storedById.values())
            .filter((item) => !options.scope || preferenceScopeMatches(item.scope, options.scope))
            .sort((a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label, 'zh-Hans-CN'));
    }

    private savePreferenceItem(item: PreferenceMemoryItem): PreferenceMemoryItem {
        const normalized = normalizePreferenceMemoryItem(item);
        if (!normalized) {
            throw new Error('保存偏好失败：偏好值为空。');
        }
        const index = this.state.preferenceItems.findIndex((candidate) => candidate.id === normalized.id);
        if (index >= 0) {
            this.state.preferenceItems[index] = normalized;
        } else {
            this.state.preferenceItems.unshift(normalized);
        }
        this.saveToStorage({ immediate: true });
        return normalized;
    }

    upsertExplicitPreference(input: UpsertExplicitPreferenceInput): PreferenceMemoryItem {
        const value = normalizePreferenceText(input.value);
        if (!value) {
            throw new Error('保存显式偏好失败：偏好值为空。');
        }
        const category = normalizePreferenceCategory(input.category);
        const scope = normalizePreferenceScope(input.scope || { type: 'user' });
        const now = Date.now();
        const id = preferenceMemoryId(category, value, scope);
        const existing = this.listPreferenceItems().find((item) => item.id === id);
        return this.savePreferenceItem({
            ...(existing || {}),
            id,
            category,
            value,
            label: preferenceLabel(category, value, input.label),
            sourceType: 'explicit',
            status: 'active',
            sourceNote: normalizePreferenceText(input.sourceNote) || '来自用户明确设置的偏好，可作为候选策略参考。',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            usageCount: Math.max(1, Number(existing?.usageCount || 0)),
            scope
        });
    }

    updatePreferenceItem(id: string, input: UpdatePreferenceItemInput): PreferenceMemoryItem {
        const existing = this.listPreferenceItems().find((item) => item.id === id);
        if (!existing) {
            throw new Error(`更新偏好失败：未找到偏好 ${id}。`);
        }

        const category = input.category ? normalizePreferenceCategory(input.category) : existing.category;
        const value = normalizePreferenceText(input.value ?? existing.value);
        if (!value) {
            throw new Error('更新偏好失败：偏好值为空。');
        }

        const scope = input.scope !== undefined ? normalizePreferenceScope(input.scope) : normalizePreferenceScope(existing.scope);
        const nextId = preferenceMemoryId(category, value, scope);
        const now = Date.now();
        const status = input.status ? normalizePreferenceStatus(input.status) : existing.status;
        const sourceType = input.sourceType
            ? normalizePreferenceSourceType(input.sourceType)
            : status === 'active' && existing.sourceType === 'inferred'
                ? 'explicit'
                : existing.sourceType;

        if (nextId !== existing.id) {
            const conflicting = (this.state.preferenceItems || [])
                .map((item) => normalizePreferenceMemoryItem(item))
                .find((item) => item?.id === nextId);
            if (conflicting) {
                throw new Error(`更新偏好失败：目标偏好已存在：${conflicting.label}。请先编辑或归档目标偏好后再修改作用域。`);
            }
            this.state.preferenceItems = (this.state.preferenceItems || [])
                .filter((item) => normalizePreferenceText(item.id) !== existing.id);
            this.state.preferenceItems.unshift({
                ...existing,
                status: 'archived',
                updatedAt: now
            });
        }

        return this.savePreferenceItem({
            ...existing,
            id: nextId,
            category,
            value,
            label: preferenceLabel(category, value, input.label ?? existing.label),
            sourceType,
            status,
            sourceNote: normalizePreferenceText(input.sourceNote ?? existing.sourceNote)
                || '来自用户编辑后的偏好，可作为候选策略参考。',
            createdAt: existing.createdAt || now,
            updatedAt: now,
            usageCount: Number(existing.usageCount || 0),
            lastUsedAt: existing.lastUsedAt,
            scope
        });
    }

    recordPreferenceUsed(id: string): PreferenceMemoryItem {
        const existing = this.listPreferenceItems().find((item) => item.id === id);
        if (!existing) {
            throw new Error(`记录偏好使用失败：未找到偏好 ${id}。`);
        }
        if (existing.status !== 'active') {
            throw new Error(`记录偏好使用失败：偏好「${existing.label}」当前状态为 ${existing.status}，不能记为有效偏好使用。`);
        }
        const now = Date.now();
        return this.savePreferenceItem({
            ...existing,
            lastUsedAt: now,
            updatedAt: now,
            usageCount: Number(existing.usageCount || 0) + 1
        });
    }

    exportPreferences(): PreferenceExportSnapshot {
        return {
            version: PREFERENCES_EXPORT_VERSION,
            exportedAt: Date.now(),
            preferenceItems: this.listPreferenceItems()
                .map((item) => normalizePreferenceMemoryItem(item))
                .filter((item): item is PreferenceMemoryItem => Boolean(item))
        };
    }

    importPreferences(input: unknown, options: ImportPreferencesOptions = {}): PreferenceImportResult {
        const mode = options.mode === 'replace' ? 'replace' : 'merge';
        const parsed = typeof input === 'string' ? JSON.parse(input) : input;
        const snapshot = parsed as Partial<PreferenceExportSnapshot> | PreferenceMemoryItem[] | undefined;
        const version = Array.isArray(snapshot) ? undefined : normalizePreferenceText(snapshot?.version);
        if (version && version !== PREFERENCES_EXPORT_VERSION) {
            throw new Error(`导入偏好失败：不支持的偏好快照版本 ${version}。`);
        }

        const rawItems = Array.isArray(snapshot)
            ? snapshot
            : Array.isArray(snapshot?.preferenceItems)
                ? snapshot.preferenceItems
                : undefined;
        if (!rawItems) {
            throw new Error('导入偏好失败：偏好快照缺少 preferenceItems 数组。');
        }

        const byId = new Map<string, PreferenceMemoryItem>();
        if (mode === 'merge') {
            for (const item of this.state.preferenceItems || []) {
                const normalized = normalizePreferenceMemoryItem(item);
                if (normalized) byId.set(normalized.id, normalized);
            }
        }

        let importedCount = 0;
        let replacedExistingCount = 0;
        let skippedCount = 0;
        for (const rawItem of rawItems) {
            const normalized = normalizeImportedPreferenceMemoryItem(rawItem);
            if (!normalized) {
                skippedCount++;
                continue;
            }
            if (byId.has(normalized.id)) {
                replacedExistingCount++;
            } else {
                importedCount++;
            }
            byId.set(normalized.id, normalized);
        }

        this.state.preferenceItems = Array.from(byId.values())
            .sort((a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label, 'zh-Hans-CN'));
        this.saveToStorage({ immediate: true });
        return { mode, importedCount, replacedExistingCount, skippedCount };
    }

    setPreferenceEnabled(id: string, enabled: boolean): PreferenceMemoryItem {
        const existing = this.listPreferenceItems().find((item) => item.id === id);
        if (!existing) {
            throw new Error(`更新偏好失败：未找到偏好 ${id}。`);
        }
        const confirmingInferred = enabled && (existing.sourceType === 'inferred' || existing.status === 'needs_review');
        const confirmationNote = '用户在设置面板确认该推断偏好。';
        return this.savePreferenceItem({
            ...existing,
            status: enabled ? 'active' : 'disabled',
            sourceType: confirmingInferred ? 'explicit' : existing.sourceType,
            sourceNote: confirmingInferred && !existing.sourceNote.includes(confirmationNote)
                ? `${existing.sourceNote} ${confirmationNote}`.trim()
                : existing.sourceNote,
            updatedAt: Date.now()
        });
    }

    archivePreference(id: string): PreferenceMemoryItem {
        const existing = this.listPreferenceItems().find((item) => item.id === id);
        if (!existing) {
            throw new Error(`归档偏好失败：未找到偏好 ${id}。`);
        }
        return this.savePreferenceItem({
            ...existing,
            status: 'archived',
            updatedAt: Date.now()
        });
    }

    clearInferredPreferences(): PreferenceCleanupResult {
        let archivedCount = 0;
        const now = Date.now();
        this.state.preferenceItems = (this.state.preferenceItems || []).map((item) => {
            if (item.sourceType === 'inferred' || item.status === 'needs_review') {
                archivedCount++;
                return {
                    ...item,
                    status: 'archived',
                    updatedAt: now
                };
            }
            return item;
        });
        this.saveToStorage({ immediate: true });
        return { archivedCount, legacyCleared: false };
    }

    clearPreferences(options: ClearPreferencesOptions = {}): PreferenceCleanupResult {
        const sourceTypes = new Set(options.sourceTypes || []);
        const statuses = new Set(options.statuses || []);
        const now = Date.now();
        let archivedCount = 0;
        this.state.preferenceItems = (this.state.preferenceItems || []).map((item) => {
            const sourceMatches = sourceTypes.size === 0 || sourceTypes.has(item.sourceType);
            const statusMatches = statuses.size === 0 || statuses.has(item.status);
            if (sourceMatches && statusMatches && item.status !== 'archived') {
                archivedCount++;
                return {
                    ...item,
                    status: 'archived',
                    updatedAt: now
                };
            }
            if (sourceMatches && statusMatches) {
                archivedCount++;
            }
            return item;
        });
        let legacyCleared = false;
        if (options.includeLegacy) {
            this.state.preferences = {
                ...this.state.preferences,
                design: {
                    ...this.state.preferences.design,
                    preferredFonts: [],
                    preferredColors: [],
                    preferredStyles: []
                }
            };
            legacyCleared = true;
        }
        this.saveToStorage({ immediate: true });
        return { archivedCount, legacyCleared };
    }

    getDesignMemoryItems(
        options: BuildDesignMemoryItemsFromPreferencesOptions = {}
    ): DesignMemoryItem[] {
        const blockedIds = new Set(
            (this.state.preferenceItems || [])
                .filter((item) => item.status === 'disabled' || item.status === 'archived')
                .map((item) => item.id)
        );
        const preferenceMemoryItems = (this.state.preferenceItems || [])
            .filter((item) => preferenceScopeMatches(item.scope, options.scope))
            .map((item) => preferenceItemToDesignMemoryItem(item, options))
            .filter((item): item is DesignMemoryItem => Boolean(item));
        const explicitIds = new Set(preferenceMemoryItems.map((item) => item.id));
        const legacyItems = buildDesignMemoryItemsFromUserPreferences(this.state.preferences, {
            ...options,
            scope: { type: 'user' }
        })
            .filter((item) => !blockedIds.has(item.id) && !explicitIds.has(item.id));
        const persistedItems = options.scope && options.scope.type !== 'user'
            ? [
                ...this.listPersistedDesignMemoryItems({ scope: { type: 'user' } }),
                ...this.listPersistedDesignMemoryItems({ scope: options.scope })
            ]
            : this.listPersistedDesignMemoryItems({ scope: options.scope });
        const byId = new Map<string, DesignMemoryItem>();
        for (const item of [
            ...legacyItems,
            ...preferenceMemoryItems,
            ...persistedItems
        ]) {
            byId.set(item.id, item);
        }
        return Array.from(byId.values());
    }

    recordDesignLearningMemoryReview(input: ReviewDesignLearningMemoryCandidateInput): DesignLearningMemoryReviewResult {
        const review = reviewDesignLearningMemoryCandidate(input);
        if (review.blockers.length > 0 || review.status === 'blocked_invalid_candidate' || review.status === 'blocked_missing_review') {
            throw new Error(`记录设计学习记忆失败：${review.blockers.join('；') || '复核结果未通过持久化门禁。'}`);
        }

        const reviewedItem = normalizePersistedDesignMemoryItem(review.reviewedItem);
        if (!reviewedItem) {
            throw new Error('记录设计学习记忆失败：复核后的记忆候选缺少必要字段。');
        }

        const existingIndex = this.state.designMemoryItems.findIndex((item) => normalizePreferenceText(item.id) === reviewedItem.id);
        if (existingIndex >= 0) {
            this.state.designMemoryItems[existingIndex] = reviewedItem;
        } else {
            this.state.designMemoryItems.unshift(reviewedItem);
        }
        this.state.designMemoryItems = sortDesignMemoryItems(
            this.state.designMemoryItems
                .map((item) => normalizePersistedDesignMemoryItem(item))
                .filter((item): item is DesignMemoryItem => Boolean(item))
        );
        this.saveToStorage({ immediate: true });
        return review;
    }

    listPersistedDesignMemoryItems(options: ListPersistedDesignMemoryItemsOptions = {}): DesignMemoryItem[] {
        const limit = Number.isFinite(options.limit) && Number(options.limit) > 0
            ? Math.min(Number(options.limit), MAX_DESIGN_MEMORY_ITEMS)
            : MAX_DESIGN_MEMORY_ITEMS;
        return sortDesignMemoryItems(
            (this.state.designMemoryItems || [])
                .map((item) => normalizePersistedDesignMemoryItem(item))
                .filter((item): item is DesignMemoryItem => Boolean(item))
                .filter((item) => matchesDesignMemoryScope(item.scope, options.scope))
                .filter((item) => !options.status || item.status === options.status)
                .filter((item) => !options.kind || item.kind === options.kind)
                .filter((item) => !options.source || item.source === options.source)
        ).slice(0, limit);
    }

    createDesignMemoryRevision(input: CreateDesignMemoryRevisionInput): DesignMemoryItem {
        const itemId = normalizePreferenceText(input.itemId);
        const existingIndex = this.state.designMemoryItems
            .findIndex((item) => normalizePreferenceText(item.id) === itemId);
        if (existingIndex < 0) {
            throw new Error(`修订知识失败：未找到知识 ${itemId}。`);
        }
        const existing = normalizePersistedDesignMemoryItem(this.state.designMemoryItems[existingIndex]);
        if (!existing) throw new Error('修订知识失败：现有知识记录无效。');
        if (existing.status === 'superseded') {
            throw new Error('修订知识失败：该版本已被替代，请从最新版本继续修订。');
        }
        if (existing.status === 'needs_review') {
            throw new Error('修订知识失败：待复核候选应先完成复核。');
        }

        const title = normalizePreferenceText(input.title ?? existing.title);
        const summary = normalizePreferenceText(input.summary ?? existing.summary);
        if (!title || !summary) throw new Error('修订知识失败：标题和知识内容不能为空。');
        const updatedAt = normalizePreferenceText(input.updatedAt) || new Date().toISOString();
        const lineageId = normalizePreferenceText(existing.lineageId) || existing.id;
        const latestRevision = this.state.designMemoryItems
            .map((item) => normalizePersistedDesignMemoryItem(item))
            .filter((item): item is DesignMemoryItem => Boolean(item))
            .filter((item) => (item.lineageId || item.id) === lineageId)
            .reduce((max, item) => Math.max(max, Number(item.revision) || 1), 1);
        const revision = latestRevision + 1;
        const revisionId = `${lineageId}:revision:${revision}:${Date.now().toString(36)}`;
        const changeNote = normalizePreferenceText(input.changeNote) || '用户在知识库中修订并发布新版本。';
        const revisionNote: DesignMemorySourceNote = {
            source: 'knowledge-library-revision',
            summary: `revision=${revision}; supersedes=${existing.id}; changed_by=user; note=${changeNote}`,
            status: 'active'
        };

        this.state.designMemoryItems[existingIndex] = {
            ...existing,
            status: 'superseded',
            supersededById: revisionId,
            sourceRank: 0,
            updatedAt,
            sourceNotes: [
                ...existing.sourceNotes,
                {
                    source: 'knowledge-library-revision',
                    summary: `superseded_by=${revisionId}; changed_by=user; changed_at=${updatedAt}`,
                    status: 'disabled'
                }
            ]
        };

        const revised = normalizePersistedDesignMemoryItem({
            ...existing,
            id: revisionId,
            title,
            summary,
            tags: Array.isArray(input.tags) ? uniqueTexts(input.tags) : existing.tags,
            status: 'active',
            lineageId,
            revision,
            supersedesId: existing.id,
            supersededById: undefined,
            retirementReason: undefined,
            sourceRank: Math.max(70, Number(existing.sourceRank) || 0),
            sourceNotes: [...existing.sourceNotes.filter((entry) => entry.status !== 'disabled'), revisionNote],
            createdAt: updatedAt,
            updatedAt,
            usageCount: 0,
            lastUsedAt: undefined
        });
        if (!revised) throw new Error('修订知识失败：新版本没有通过持久化校验。');
        this.state.designMemoryItems.unshift(revised);
        this.state.designMemoryItems = sortDesignMemoryItems(
            this.state.designMemoryItems
                .map((item) => normalizePersistedDesignMemoryItem(item))
                .filter((item): item is DesignMemoryItem => Boolean(item))
        );
        this.saveToStorage({ immediate: true });
        return revised;
    }

    setDesignMemoryLifecycle(input: SetDesignMemoryLifecycleInput): DesignMemoryItem {
        const itemId = normalizePreferenceText(input.itemId);
        const index = this.state.designMemoryItems
            .findIndex((item) => normalizePreferenceText(item.id) === itemId);
        if (index < 0) throw new Error(`更新知识状态失败：未找到知识 ${itemId}。`);
        const existing = normalizePersistedDesignMemoryItem(this.state.designMemoryItems[index]);
        if (!existing) throw new Error('更新知识状态失败：知识记录无效。');
        if (existing.status === 'superseded' || existing.status === 'expired') {
            throw new Error('更新知识状态失败：已替代或已过期版本不能直接恢复，请使用最新版本。');
        }
        if (existing.status === 'needs_review') {
            throw new Error('更新知识状态失败：待复核候选应通过学习复核处理。');
        }
        const updatedAt = normalizePreferenceText(input.updatedAt) || new Date().toISOString();
        const reason = normalizePreferenceText(input.reason)
            || (input.status === 'disabled' ? '用户从知识库中剔除该版本。' : '用户从知识库中恢复该版本。');
        const status = input.status;
        const updated = normalizePersistedDesignMemoryItem({
            ...existing,
            status,
            sourceRank: status === 'active' ? Math.max(70, Number(existing.sourceRank) || 0) : 0,
            retirementReason: status === 'disabled' ? reason : undefined,
            updatedAt,
            sourceNotes: [
                ...existing.sourceNotes,
                {
                    source: 'knowledge-library-lifecycle',
                    summary: `status=${status}; changed_by=user; changed_at=${updatedAt}; reason=${reason}`,
                    status: status === 'active' ? 'active' : 'disabled'
                }
            ]
        });
        if (!updated) throw new Error('更新知识状态失败：更新后的知识没有通过校验。');
        this.state.designMemoryItems[index] = updated;
        this.saveToStorage({ immediate: true });
        return updated;
    }

    recordDesignMemoryUsed(itemId: string): DesignMemoryItem {
        const normalizedId = normalizePreferenceText(itemId);
        const index = this.state.designMemoryItems
            .findIndex((item) => normalizePreferenceText(item.id) === normalizedId);
        if (index < 0) throw new Error(`记录知识使用失败：未找到知识 ${normalizedId}。`);
        const existing = normalizePersistedDesignMemoryItem(this.state.designMemoryItems[index]);
        if (!existing || existing.status !== 'active') {
            throw new Error('记录知识使用失败：只有当前有效知识可以加入任务。');
        }
        const updated = normalizePersistedDesignMemoryItem({
            ...existing,
            usageCount: Number(existing.usageCount || 0) + 1,
            lastUsedAt: new Date().toISOString()
        });
        if (!updated) throw new Error('记录知识使用失败：更新后的知识无效。');
        this.state.designMemoryItems[index] = updated;
        this.saveToStorage({ immediate: true });
        return updated;
    }

    listDesignKnowledgeDispositions(): DesignKnowledgeDisposition[] {
        return [...(this.state.knowledgeDispositions || [])]
            .map((item) => normalizeKnowledgeDisposition(item))
            .filter((item): item is DesignKnowledgeDisposition => Boolean(item))
            .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    }

    disableDesignKnowledgeResult(result: DesignKnowledgeResult, reason?: string): DesignKnowledgeDisposition {
        const disposition = createDesignKnowledgeDisposition(result, { reason });
        const index = this.state.knowledgeDispositions
            .findIndex((item) => item.dispositionId === disposition.dispositionId);
        if (index >= 0) this.state.knowledgeDispositions[index] = disposition;
        else this.state.knowledgeDispositions.unshift(disposition);
        this.saveToStorage({ immediate: true });
        return disposition;
    }

    restoreDesignKnowledgeDisposition(dispositionId: string): void {
        const normalizedId = normalizePreferenceText(dispositionId);
        const previousLength = this.state.knowledgeDispositions.length;
        this.state.knowledgeDispositions = this.state.knowledgeDispositions
            .filter((item) => item.dispositionId !== normalizedId);
        if (this.state.knowledgeDispositions.length === previousLength) {
            throw new Error(`恢复知识失败：未找到剔除记录 ${normalizedId}。`);
        }
        this.saveToStorage({ immediate: true });
    }

    applyDesignKnowledgeDispositions(results: DesignKnowledgeResult[]): {
        visibleResults: DesignKnowledgeResult[];
        disabledResults: DesignKnowledgeResult[];
    } {
        return applyDesignKnowledgeDispositions(results, this.listDesignKnowledgeDispositions());
    }

    recordUserConfirmedDesignMemoryItem(item: DesignMemoryItem): DesignMemoryItem {
        const normalized = normalizePersistedDesignMemoryItem(item);
        if (!normalized) {
            throw new Error('保存用户确认内容失败：记忆内容缺少必要字段。');
        }
        const hasUserConfirmation = normalized.source === 'accepted_output'
            && normalized.status === 'active'
            && normalized.sourceNotes.some((entry) => (
                entry.source === 'interactive-card-confirmation'
                && entry.status === 'active'
                && /confirmed_by=user(?:;|$)/.test(entry.summary)
            ));
        if (!hasUserConfirmation) {
            throw new Error('保存用户确认内容失败：只有用户在交互确认卡中明确确认的内容才能直接进入 active Memory。');
        }
        const existingIndex = this.state.designMemoryItems
            .findIndex((current) => normalizePreferenceText(current.id) === normalized.id);
        if (existingIndex >= 0) {
            this.state.designMemoryItems[existingIndex] = normalized;
        } else {
            this.state.designMemoryItems.unshift(normalized);
        }
        this.state.designMemoryItems = sortDesignMemoryItems(
            this.state.designMemoryItems
                .map((entry) => normalizePersistedDesignMemoryItem(entry))
                .filter((entry): entry is DesignMemoryItem => Boolean(entry))
        );
        this.saveToStorage({ immediate: true });
        return normalized;
    }

    getDesignLearningMemoryReviewQueueView(
        options: GetDesignLearningMemoryReviewQueueOptions = {}
    ): DesignLearningMemoryReviewQueueView {
        return buildDesignLearningMemoryReviewQueueView({
            items: this.listPersistedDesignMemoryItems({
                scope: options.scope,
                status: 'needs_review',
                limit: options.limit
            }),
            scope: options.scope,
            limit: options.limit
        });
    }

    reviewDesignLearningMemoryCandidateById(
        input: ReviewDesignLearningMemoryCandidateByIdInput
    ): DesignLearningMemoryReviewResult {
        const candidateId = normalizePreferenceText(input.candidateId);
        if (!candidateId) {
            throw new Error('复核设计学习候选失败：缺少候选 ID。');
        }
        const candidate = this.listPersistedDesignMemoryItems({ status: 'needs_review' })
            .find((item) => normalizePreferenceText(item.id) === candidateId);
        if (!candidate) {
            throw new Error(`复核设计学习候选失败：未找到待复核候选 ${candidateId}。`);
        }
        return this.recordDesignLearningMemoryReview({
            candidate,
            decision: input.decision,
            reviewer: input.reviewer,
            notes: input.notes,
            reviewedAt: input.reviewedAt
        });
    }

    getDesignKnowledgeResults(
        query: Pick<DesignKnowledgeQuery, 'query' | 'intents' | 'sourceTypes' | 'limit'>,
        options: BuildDesignMemoryItemsFromPreferencesOptions = {}
    ): DesignKnowledgeResult[] {
        return searchDesignMemoryKnowledge(query, this.getDesignMemoryItems(options));
    }
    
    updatePreferences(updates: Partial<UserPreferences>): void {
        this.state.preferences = {
            ...this.state.preferences,
            ...updates,
            design: { ...this.state.preferences.design, ...updates.design },
            interaction: { ...this.state.preferences.interaction, ...updates.interaction },
            workflow: { ...this.state.preferences.workflow, ...updates.workflow }
        };
        this.saveToStorage({ immediate: true });
    }
    
    // ========== 操作模式 ==========
    
    getPatterns(): OperationPattern[] {
        return this.state.patterns;
    }
    
    /**
     * 匹配操作模式
     */
    matchPattern(userInput: string): OperationPattern | null {
        const input = userInput.toLowerCase().trim();
        
        for (const pattern of this.state.patterns) {
            for (const trigger of pattern.triggers) {
                if (input.includes(trigger.toLowerCase())) {
                    return pattern;
                }
            }
        }
        
        return null;
    }
    
    /**
     * 记录操作序列为模式
     */
    recordPattern(name: string, triggers: string[], steps: Array<{ tool: string; params: any }>): string {
        const pattern: OperationPattern = {
            id: `pattern-${Date.now()}`,
            name,
            triggers,
            steps,
            frequency: 1,
            lastUsed: Date.now(),
            createdAt: Date.now()
        };
        
        this.state.patterns.unshift(pattern);
        
        // 限制数量
        if (this.state.patterns.length > MAX_PATTERNS) {
            this.state.patterns.pop();
        }
        
        this.saveToStorage();
        return pattern.id;
    }
    
    /**
     * 更新模式使用频率
     */
    usePattern(patternId: string): void {
        const pattern = this.state.patterns.find(p => p.id === patternId);
        if (pattern) {
            pattern.frequency++;
            pattern.lastUsed = Date.now();
            this.saveToStorage();
        }
    }
    
    /**
     * 删除操作模式
     */
    deletePattern(patternId: string): void {
        this.state.patterns = this.state.patterns.filter(p => p.id !== patternId);
        this.saveToStorage();
    }
    
    // ========== 项目上下文 ==========
    
    getProjectContext(projectId: string): ProjectContext | undefined {
        return this.state.projectContexts.get(projectId);
    }
    
    updateProjectContext(projectId: string, updates: Partial<ProjectContext>): void {
        const existing = this.state.projectContexts.get(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        this.state.projectContexts.set(projectId, {
            ...existing,
            ...updates
        });
        
        this.saveToStorage();
    }
    
    /**
     * 记录图层访问
     */
    recordLayerAccess(projectId: string, layerId: number, layerName: string): void {
        const ctx = this.getProjectContext(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        // 移除已有的相同图层
        ctx.recentLayers = ctx.recentLayers.filter(l => l.id !== layerId);
        
        // 添加到最前面
        ctx.recentLayers.unshift({
            id: layerId,
            name: layerName,
            lastAccessed: Date.now()
        });
        
        // 限制数量
        if (ctx.recentLayers.length > MAX_RECENT_LAYERS) {
            ctx.recentLayers.pop();
        }
        
        this.state.projectContexts.set(projectId, ctx);
        this.saveToStorage();
    }
    
    /**
     * 记录工具使用
     */
    recordToolUsage(projectId: string, toolName: string): void {
        const ctx = this.getProjectContext(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        const existing = ctx.frequentTools.find(t => t.tool === toolName);
        if (existing) {
            existing.count++;
        } else {
            ctx.frequentTools.push({ tool: toolName, count: 1 });
        }
        
        // 排序
        ctx.frequentTools.sort((a, b) => b.count - a.count);
        
        // 限制数量
        if (ctx.frequentTools.length > 20) {
            ctx.frequentTools = ctx.frequentTools.slice(0, 20);
        }
        
        this.state.projectContexts.set(projectId, ctx);
        this.saveToStorage();
    }
    
    // ========== 短期记忆 ==========
    
    getShortTermMemory(): ShortTermMemory {
        return this.state.shortTerm;
    }
    
    /**
     * 记录操作（用于撤销/重做）
     */
    recordOperation(tool: string, params: any, result: any, canUndo: boolean = true): void {
        this.state.shortTerm.operationHistory.push({
            id: `op-${Date.now()}`,
            tool,
            params,
            result,
            timestamp: Date.now(),
            canUndo
        });
        
        // 限制数量
        if (this.state.shortTerm.operationHistory.length > MAX_OPERATION_HISTORY) {
            this.state.shortTerm.operationHistory.shift();
        }
        
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    /**
     * 获取最后一个可撤销的操作
     */
    getLastUndoableOperation(): { tool: string; params: any; result: any } | null {
        for (let i = this.state.shortTerm.operationHistory.length - 1; i >= 0; i--) {
            const op = this.state.shortTerm.operationHistory[i];
            if (op.canUndo) {
                return { tool: op.tool, params: op.params, result: op.result };
            }
        }
        return null;
    }
    
    /**
     * 更新上下文变量
     */
    setContextVariable<K extends keyof ShortTermMemory['contextVariables']>(
        key: K,
        value: ShortTermMemory['contextVariables'][K]
    ): void {
        this.state.shortTerm.contextVariables[key] = value;
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    getContextVariable<K extends keyof ShortTermMemory['contextVariables']>(
        key: K
    ): ShortTermMemory['contextVariables'][K] {
        return this.state.shortTerm.contextVariables[key];
    }
    
    /**
     * 清空短期记忆（新对话时调用）
     */
    clearShortTermMemory(): void {
        this.state.shortTerm = DEFAULT_SHORT_TERM;
    }
    
    /**
     * 更新对话摘要
     */
    updateConversationSummary(summary: string): void {
        this.state.shortTerm.conversationSummary = summary;
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    // ========== 实体记忆 ==========
    
    /**
     * 记录提及的图层
     */
    rememberLayer(id: number, name: string): void {
        const key = `${id}`;
        const existing = this.state.entities.layers.get(key);
        
        if (existing) {
            existing.mentions++;
            existing.lastMentioned = Date.now();
        } else {
            this.state.entities.layers.set(key, {
                id,
                name,
                mentions: 1,
                lastMentioned: Date.now()
            });
        }
        
        // 同时更新短期记忆的 lastMentionedLayers
        const mentioned = this.state.shortTerm.contextVariables.lastMentionedLayers || [];
        const filtered = mentioned.filter(l => l.id !== id);
        this.state.shortTerm.contextVariables.lastMentionedLayers = [
            { id, name },
            ...filtered
        ].slice(0, 5);
    }
    
    /**
     * 记录提及的颜色
     */
    rememberColor(value: string, name?: string): void {
        const key = value.toLowerCase();
        const existing = this.state.entities.colors.get(key);
        
        if (existing) {
            existing.mentions++;
        } else {
            this.state.entities.colors.set(key, {
                value,
                name,
                mentions: 1
            });
        }
        
        this.state.shortTerm.contextVariables.lastMentionedColor = value;
    }
    
    /**
     * 解析"上一个"、"刚才的"等指代
     */
    resolveReference(reference: string): {
        type: 'layer' | 'color' | 'size' | 'unknown';
        value: any;
    } {
        const ref = reference.toLowerCase();
        
        // 图层指代
        if (ref.includes('这个') || ref.includes('它') || ref.includes('当前')) {
            const selectedId = this.state.shortTerm.contextVariables.selectedLayerId;
            const selectedName = this.state.shortTerm.contextVariables.selectedLayerName;
            if (selectedId) {
                return { type: 'layer', value: { id: selectedId, name: selectedName } };
            }
        }
        
        if (ref.includes('上一个') || ref.includes('刚才')) {
            const lastLayers = this.state.shortTerm.contextVariables.lastMentionedLayers;
            if (lastLayers && lastLayers.length > 0) {
                return { type: 'layer', value: lastLayers[0] };
            }
        }
        
        // 颜色指代
        if (ref.includes('那个颜色') || ref.includes('刚才的颜色')) {
            const lastColor = this.state.shortTerm.contextVariables.lastMentionedColor;
            if (lastColor) {
                return { type: 'color', value: lastColor };
            }
        }
        
        return { type: 'unknown', value: null };
    }
    
    // ========== 记忆摘要（供 Prompt 使用）==========
    
    /**
     * 生成记忆上下文（注入到系统提示词）
     */
    getMemoryContext(projectId?: string): string {
        const parts: string[] = [];
        
        // 1. 用户偏好摘要
        const prefs = this.state.preferences;
        if (prefs.design.preferredFonts.length > 0 || prefs.design.preferredColors.length > 0) {
            parts.push(`## 用户偏好
- 常用字体: ${prefs.design.preferredFonts.slice(0, 3).join('、') || '未设置'}
- 常用颜色: ${prefs.design.preferredColors.slice(0, 5).join('、') || '未设置'}
- 回复风格: ${getVerbosityLabel(prefs.interaction.verbosity)}`);
        }
        
        // 2. 项目上下文
        if (projectId) {
            const ctx = this.state.projectContexts.get(projectId);
            if (ctx) {
                const recentLayerNames = ctx.recentLayers.slice(0, 5).map(l => l.name).join('、');
                const frequentTools = ctx.frequentTools.slice(0, 5).map(t => t.tool).join('、');
                
                if (recentLayerNames || frequentTools) {
                    parts.push(`## 项目上下文
- 最近操作的图层: ${recentLayerNames || '无'}
- 常用工具: ${frequentTools || '无'}`);
                }
                
                if (ctx.designSpecs.brandColors?.length) {
                    parts.push(`- 品牌色: ${ctx.designSpecs.brandColors.join('、')}`);
                }
            }
        }
        
        // 3. 短期记忆
        const shortTerm = this.state.shortTerm;
        if (shortTerm.contextVariables.selectedLayerName) {
            parts.push(`## 当前状态
- 选中图层: "${shortTerm.contextVariables.selectedLayerName}"`);
        }
        
        if (shortTerm.operationHistory.length > 0) {
            const lastOps = shortTerm.operationHistory
                .slice(-3)
                .map(op => op.tool)
                .join(' → ');
            parts.push(`- 最近操作: ${lastOps}`);
        }
        
        if (shortTerm.conversationSummary) {
            parts.push(`- 对话摘要: ${shortTerm.conversationSummary}`);
        }
        
        return parts.length > 0 ? parts.join('\n\n') : '';
    }
    
    /**
     * 获取所有自定义操作模式（供快速动作使用）
     */
    getCustomActions(): Array<{
        id: string;
        name: string;
        triggers: string[];
        steps: Array<{ tool: string; params: any }>;
    }> {
        return this.state.patterns.map(p => ({
            id: p.id,
            name: p.name,
            triggers: p.triggers,
            steps: p.steps
        }));
    }

    // ========== 人工复核记录 ==========

    recordHumanReview(input: BuildHumanReviewRecordInput): HumanReviewRecord {
        const record = buildHumanReviewRecord(input);
        if (!record.canPersist) {
            const reason = record.blockers.length > 0
                ? record.blockers.join('；')
                : '复核草稿未就绪或缺少可复核来源。';
            throw new Error(`记录人工复核失败：${reason}`);
        }

        const existingIndex = this.state.humanReviewRecords.findIndex((item) => item.recordId === record.recordId);
        if (existingIndex >= 0) {
            this.state.humanReviewRecords[existingIndex] = record;
        } else {
            this.state.humanReviewRecords.unshift(record);
        }
        this.state.humanReviewRecords = this.state.humanReviewRecords
            .map((item) => normalizeHumanReviewRecord(item))
            .filter((item): item is HumanReviewRecord => Boolean(item))
            .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
            .slice(0, MAX_HUMAN_REVIEW_RECORDS);
        this.saveToStorage({ immediate: true });
        return record;
    }

    listHumanReviewRecords(options: HumanReviewRecordListOptions = {}): HumanReviewRecord[] {
        const limit = Number.isFinite(options.limit) && Number(options.limit) > 0
            ? Math.min(Number(options.limit), MAX_HUMAN_REVIEW_RECORDS)
            : MAX_HUMAN_REVIEW_RECORDS;
        return (this.state.humanReviewRecords || [])
            .map((item) => normalizeHumanReviewRecord(item))
            .filter((item): item is HumanReviewRecord => Boolean(item))
            .filter((item) => !options.projectId || item.projectId === options.projectId)
            .filter((item) => !options.scenario || item.scenario === options.scenario)
            .filter((item) => !options.subjectFingerprint || item.source?.subject?.fingerprint === options.subjectFingerprint)
            .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
            .slice(0, limit);
    }
}

// ==================== 单例导出 ====================

let memoryServiceInstance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
    if (!memoryServiceInstance) {
        memoryServiceInstance = new MemoryService();
    }
    return memoryServiceInstance;
}

export default MemoryService;
