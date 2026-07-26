import type { DesignMemoryItem, DesignMemoryScope } from './design-memory-knowledge';
import type { EagleVisualCaseIndex, EagleVisualCaseIndexItem } from './eagle-visual-case-index';
import { sanitizeDesignLearningVisualCase, type DesignLearningVisualCase } from './design-learning-visual-case';

export type DesignLearningDailyResearchPlanVersion = 'design-learning-daily-research-plan/v0';
export type DesignLearningExperienceVersion = 'design-learning-experience/v0';

export type DesignLearningCadence = 'manual' | 'daily' | 'weekly';
export type DesignLearningResearchPlanStatus = 'ready_for_runtime' | 'blocked_no_reference_sources';
export type DesignLearningReferenceSource = 'eagle_readonly' | 'web_search' | 'project_cases';
export type DesignLearningStepKind =
    | 'collect_references'
    | 'analyze_reference_design'
    | 'extract_reusable_experience'
    | 'prepare_memory_candidates'
    | 'review_before_persisting';
export type DesignLearningExperienceStatus = 'ready_for_review' | 'blocked_no_references' | 'blocked_missing_analysis';
export type DesignLearningReviewStatus = 'needs_human_review' | 'reviewed_approved' | 'reviewed_rejected';

export const DESIGN_LEARNING_DAILY_RESEARCH_PLAN_VERSION: DesignLearningDailyResearchPlanVersion = 'design-learning-daily-research-plan/v0';
export const DESIGN_LEARNING_EXPERIENCE_VERSION: DesignLearningExperienceVersion = 'design-learning-experience/v0';

export interface DesignLearningSourceAvailability {
    eagleReadonly?: boolean;
    webSearch?: boolean;
    projectCases?: boolean;
    visualAnalysis?: boolean;
}

export interface BuildDesignLearningDailyResearchPlanInput {
    date: string;
    cadence?: DesignLearningCadence;
    topics?: string[];
    sourceAvailability?: DesignLearningSourceAvailability;
    maxReferences?: number;
}

export interface DesignLearningBoundary {
    readonly: true;
    doesNotExecuteSearch: true;
    doesNotCallProvider: true;
    noPhotoshopWrites: true;
    doesNotWriteEagle: true;
    doesNotPersistMemory: true;
    doesNotReturnRawImages: true;
    doesNotClaimDesignQuality: true;
}

export interface DesignLearningDailyResearchStep {
    kind: DesignLearningStepKind;
    title: string;
    sources: DesignLearningReferenceSource[];
    maxItems?: number;
    requiredRuntimeContext: string[];
    output: string;
}

export interface DesignLearningDailyResearchPlan {
    version: DesignLearningDailyResearchPlanVersion;
    status: DesignLearningResearchPlanStatus;
    date: string;
    cadence: DesignLearningCadence;
    topics: string[];
    sourceAvailability: Required<DesignLearningSourceAvailability>;
    maxReferences: number;
    steps: DesignLearningDailyResearchStep[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignLearningBoundary;
}

export interface DesignLearningStrengthObservation {
    aspect: string;
    observation: string;
    reason: string;
    suitableFor?: string[];
}

export interface DesignLearningReferenceObservation {
    referenceId: string;
    analysisSource: string;
    observedAt?: string;
    productCategory?: string;
    designType?: string;
    summary: string;
    strengths?: DesignLearningStrengthObservation[];
    suitableScenarios?: string[];
    avoidWhen?: string[];
    reusableHeuristics?: string[];
    reviewStatus?: DesignLearningReviewStatus;
    sourceNotes?: string[];
    limitations?: string[];
    /** 视觉案例（真实参考图预览 + 分割主体框，展示用）。由采集端在分析时填入。 */
    visualCase?: DesignLearningVisualCase;
}

export interface BuildDesignLearningExperienceIndexInput {
    generatedAt?: string;
    sourceLabel?: string;
    visualCaseIndex?: EagleVisualCaseIndex | null;
    observations?: DesignLearningReferenceObservation[];
}

export interface DesignLearningExperienceSource {
    referenceId: string;
    sourceType: 'eagle_visual_case' | 'external_reference' | 'manual_reference';
    title: string;
    sourceUrl?: string;
    tags: string[];
}

export interface DesignLearningExperienceRecord {
    recordId: string;
    title: string;
    source: DesignLearningExperienceSource;
    productCategory?: string;
    designType?: string;
    summary: string;
    whatLooksGood: string[];
    whyItWorks: string[];
    suitableScenarios: string[];
    avoidWhen: string[];
    reusableHeuristics: string[];
    reviewStatus: DesignLearningReviewStatus;
    canBecomeMemory: boolean;
    memoryCandidateId?: string;
    sourceNotes: string[];
    limitations: string[];
    /** 视觉案例（真实参考图 + 分割主体框，展示用）。 */
    visualCase?: DesignLearningVisualCase;
}

export interface DesignLearningExperienceIndex {
    version: DesignLearningExperienceVersion;
    status: DesignLearningExperienceStatus;
    generatedAt?: string;
    sourceLabel?: string;
    summary: {
        referenceCount: number;
        observationCount: number;
        recordCount: number;
        memoryCandidateCount: number;
        blockedObservationCount: number;
    };
    records: DesignLearningExperienceRecord[];
    reviewRequirements: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignLearningBoundary;
}

export interface DesignLearningMemoryOptions {
    scope?: DesignMemoryScope;
    now?: string | number;
}

const UNSAFE_PAYLOAD_TOKENS = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"'
];

const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/;

export function buildDesignLearningDailyResearchPlan(
    input: BuildDesignLearningDailyResearchPlanInput
): DesignLearningDailyResearchPlan {
    const topics = uniqueStrings(input.topics || []).slice(0, 12);
    const sourceAvailability = normalizeSourceAvailability(input.sourceAvailability);
    const sources = collectSources(sourceAvailability);
    const maxReferences = clampNumber(input.maxReferences, 1, 30, 8);
    const blockers = sources.length === 0 ? ['reference_source_required'] : [];
    const steps = blockers.length > 0
        ? []
        : buildDailyResearchSteps({ sources, maxReferences, visualAnalysisAvailable: sourceAvailability.visualAnalysis });
    return {
        version: DESIGN_LEARNING_DAILY_RESEARCH_PLAN_VERSION,
        status: blockers.length > 0 ? 'blocked_no_reference_sources' : 'ready_for_runtime',
        date: cleanString(input.date) || new Date().toISOString().slice(0, 10),
        cadence: input.cadence || 'daily',
        topics,
        sourceAvailability,
        maxReferences,
        steps,
        blockers,
        warnings: buildDailyPlanWarnings(sourceAvailability, topics),
        limitations: [
            '该计划只描述每日学习需要的运行步骤，不会在构建器中联网、调用模型、写 Eagle 或写 Photoshop。',
            '参考图收藏不是学习结果；必须经过设计分析、理由抽取、适用场景判断和人工/模型复核后才能沉淀。',
            '学习结果默认只生成待复核记忆候选，不能直接覆盖用户偏好或业务 skill 执行参数。'
        ],
        boundaries: buildDesignLearningBoundary()
    };
}

export function buildDesignLearningExperienceIndex(
    input: BuildDesignLearningExperienceIndexInput
): DesignLearningExperienceIndex {
    const visualCases = new Map((input.visualCaseIndex?.cases || []).map((item) => [cleanString(item.caseId), item]));
    const observations = Array.isArray(input.observations) ? input.observations : [];
    const records = observations
        .map((observation) => buildLearningRecord(observation, visualCases.get(cleanString(observation.referenceId))))
        .filter((record): record is DesignLearningExperienceRecord => Boolean(record));
    const blockedObservationCount = observations.length - records.length;
    const blockers = buildExperienceBlockers({ visualCaseCount: visualCases.size, observationCount: observations.length, recordCount: records.length });
    return {
        version: DESIGN_LEARNING_EXPERIENCE_VERSION,
        status: resolveExperienceStatus({ visualCaseCount: visualCases.size, observationCount: observations.length, recordCount: records.length }),
        generatedAt: cleanString(input.generatedAt) || undefined,
        sourceLabel: cleanString(input.sourceLabel) || undefined,
        summary: {
            referenceCount: visualCases.size,
            observationCount: observations.length,
            recordCount: records.length,
            memoryCandidateCount: records.filter((record) => record.canBecomeMemory).length,
            blockedObservationCount
        },
        records,
        reviewRequirements: buildExperienceReviewRequirements(records),
        blockers,
        warnings: buildExperienceWarnings({ blockedObservationCount, visualCaseIndex: input.visualCaseIndex || null }),
        limitations: [
            '学习经验只来自已提供的参考和分析观察，不从 Eagle 标签、文件名或路径反推审美事实。',
            '经验记录不能直接触发 Photoshop 写入，也不能直接写回 Eagle。',
            '经验沉淀为记忆前必须保留来源、理由、适用场景和待复核状态。',
            '业务 skill 使用经验时仍必须结合当前项目素材、平台规范、截图 QA 和人工复核。'
        ],
        boundaries: buildDesignLearningBoundary()
    };
}

export function designLearningExperiencesToMemoryItems(
    index: DesignLearningExperienceIndex,
    options: DesignLearningMemoryOptions = {}
): DesignMemoryItem[] {
    const now = normalizeDateTime(options.now) || new Date().toISOString();
    const scope = options.scope || { type: 'user' as const };
    return index.records
        .filter((record) => record.canBecomeMemory)
        .map((record): DesignMemoryItem => ({
            id: record.memoryCandidateId || `design-learning-${stableHash(record.recordId)}`,
            kind: 'visual_case',
            scope,
            status: record.reviewStatus === 'reviewed_approved' ? 'active' : 'needs_review',
            source: 'imported_case',
            title: record.title,
            summary: [
                record.summary,
                `好在哪儿：${record.whatLooksGood.slice(0, 3).join('；')}`,
                `为什么有效：${record.whyItWorks.slice(0, 3).join('；')}`,
                `适用：${record.suitableScenarios.slice(0, 4).join(' / ')}`
            ].map(cleanString).filter(Boolean).join(' '),
            // 结构化洞察全量保留（含此前被丢弃的 reusableHeuristics/avoidWhen/limitations）：
            // 供复核面板展示"Agent 到底学到了什么真实内容"，让用户能判断与调整。
            // 不随自动检索进提示词；复核通过后经用户显式引用可以 720 字有界摘要随引用进入（见 knowledge-selection-context）。
            learnedInsights: {
                whatLooksGood: record.whatLooksGood,
                whyItWorks: record.whyItWorks,
                reusableHeuristics: record.reusableHeuristics,
                suitableScenarios: record.suitableScenarios,
                avoidWhen: record.avoidWhen,
                limitations: record.limitations
            },
            // 视觉案例：真实参考图 + 分割主体框（展示用，不进提示词）
            ...(record.visualCase ? { visualCase: record.visualCase } : {}),
            sourceNotes: [{
                source: 'design-learning-experience',
                summary: `reference=${record.source.referenceId}; review=${record.reviewStatus}; heuristics=${record.reusableHeuristics.length}`,
                status: record.reviewStatus === 'reviewed_approved' ? 'active' : 'needs_review'
            }],
            tags: uniqueStrings([
                'design-learning',
                'visual-case',
                record.productCategory || '',
                record.designType || '',
                ...record.source.tags,
                ...record.suitableScenarios.slice(0, 5)
            ]),
            appliesTo: ['reference', 'recipe'],
            allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
            sourceRank: record.reviewStatus === 'reviewed_approved' ? 76 : 0,
            createdAt: now,
            updatedAt: now
        }));
}

export function buildDesignLearningBoundary(): DesignLearningBoundary {
    return {
        readonly: true,
        doesNotExecuteSearch: true,
        doesNotCallProvider: true,
        noPhotoshopWrites: true,
        doesNotWriteEagle: true,
        doesNotPersistMemory: true,
        doesNotReturnRawImages: true,
        doesNotClaimDesignQuality: true
    };
}

export function isDesignLearningExperiencePayloadSafe(value: unknown): boolean {
    const text = JSON.stringify(value || '');
    if (UNSAFE_PAYLOAD_TOKENS.some((token) => text.includes(token))) return false;
    return !LOCAL_PATH_PATTERN.test(text);
}

function buildDailyResearchSteps(input: {
    sources: DesignLearningReferenceSource[];
    maxReferences: number;
    visualAnalysisAvailable: boolean;
}): DesignLearningDailyResearchStep[] {
    return [
        {
            kind: 'collect_references',
            title: '收集今日设计参考候选',
            sources: input.sources,
            maxItems: input.maxReferences,
            requiredRuntimeContext: input.sources.map((source) => `${source}_available`),
            output: 'reference_candidates'
        },
        {
            kind: 'analyze_reference_design',
            title: '分析参考为什么好看',
            sources: input.sources,
            maxItems: input.maxReferences,
            requiredRuntimeContext: input.visualAnalysisAvailable
                ? ['visual_analysis_available']
                : ['visual_analysis_or_human_notes_required'],
            output: 'reference_design_observations'
        },
        {
            kind: 'extract_reusable_experience',
            title: '抽取适用场景和可复用经验',
            sources: input.sources,
            requiredRuntimeContext: ['reference_design_observations'],
            output: 'design_learning_experience_records'
        },
        {
            kind: 'prepare_memory_candidates',
            title: '准备待复核记忆候选',
            sources: input.sources,
            requiredRuntimeContext: ['design_learning_experience_records'],
            output: 'needs_review_design_memory_candidates'
        },
        {
            kind: 'review_before_persisting',
            title: '复核后再进入长期知识',
            sources: input.sources,
            requiredRuntimeContext: ['human_or_model_review_required'],
            output: 'reviewed_memory_candidates'
        }
    ];
}

function buildLearningRecord(
    observation: DesignLearningReferenceObservation,
    visualCase?: EagleVisualCaseIndexItem
): DesignLearningExperienceRecord | null {
    const referenceId = cleanString(observation.referenceId);
    const strengths = normalizeStrengths(observation.strengths);
    const suitableScenarios = uniqueStrings([
        ...(observation.suitableScenarios || []),
        ...strengths.flatMap((item) => item.suitableFor || [])
    ]);
    const reusableHeuristics = uniqueStrings(observation.reusableHeuristics || []);
    const summary = cleanString(observation.summary);
    if (!referenceId || !summary || strengths.length < 2 || suitableScenarios.length === 0 || reusableHeuristics.length < 1) {
        return null;
    }
    const source = buildExperienceSource(referenceId, visualCase);
    const reviewStatus = observation.reviewStatus || 'needs_human_review';
    const recordId = `design-learning:${stableHash([referenceId, summary, source.title].join('|'))}`;
    return {
        recordId,
        title: `${source.title} 学习经验`,
        source,
        productCategory: cleanString(observation.productCategory) || undefined,
        designType: cleanString(observation.designType) || undefined,
        summary,
        whatLooksGood: uniqueStrings(strengths.map((item) => item.observation)),
        whyItWorks: uniqueStrings(strengths.map((item) => item.reason)),
        suitableScenarios,
        avoidWhen: uniqueStrings(observation.avoidWhen || []),
        reusableHeuristics,
        reviewStatus,
        canBecomeMemory: reviewStatus !== 'reviewed_rejected',
        memoryCandidateId: `design-learning-memory-${stableHash(recordId)}`,
        sourceNotes: uniqueStrings([
            `analysis_source=${cleanString(observation.analysisSource) || 'unknown'}`,
            observation.observedAt ? `observed_at=${cleanString(observation.observedAt)}` : '',
            visualCase ? `visual_case=${visualCase.caseId}` : `reference=${referenceId}`,
            ...(observation.sourceNotes || [])
        ]),
        limitations: uniqueStrings([
            ...(observation.limitations || []),
            '该经验需要结合当前商品、平台尺寸、项目素材和实际输出 QA 后使用。',
            '该经验不能直接变成 Photoshop 写入动作或 Eagle 写回动作。'
        ]),
        // 视觉案例来自观察（采集端在分析时填入真实预览图 + 分割主体框），清洗后携带
        ...(sanitizeDesignLearningVisualCase(observation.visualCase) ? { visualCase: sanitizeDesignLearningVisualCase(observation.visualCase) } : {})
    };
}

function buildExperienceSource(
    referenceId: string,
    visualCase?: EagleVisualCaseIndexItem
): DesignLearningExperienceSource {
    if (!visualCase) {
        return {
            referenceId,
            sourceType: 'manual_reference',
            title: referenceId,
            tags: []
        };
    }
    return {
        referenceId,
        sourceType: 'eagle_visual_case',
        title: cleanString(visualCase.asset.name) || referenceId,
        sourceUrl: cleanString(visualCase.source.sourceUrl) || undefined,
        tags: uniqueStrings(visualCase.asset.tags)
    };
}

function normalizeStrengths(values: unknown): DesignLearningStrengthObservation[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((item) => {
            const value = item as Partial<DesignLearningStrengthObservation>;
            return {
                aspect: cleanString(value.aspect),
                observation: cleanString(value.observation),
                reason: cleanString(value.reason),
                suitableFor: uniqueStrings(value.suitableFor || [])
            };
        })
        .filter((item) => item.observation && item.reason);
}

function buildExperienceBlockers(input: {
    visualCaseCount: number;
    observationCount: number;
    recordCount: number;
}): string[] {
    if (input.visualCaseCount === 0 && input.observationCount === 0) return ['reference_or_observation_required'];
    if (input.recordCount === 0) return ['reference_design_analysis_required'];
    return [];
}

function resolveExperienceStatus(input: {
    visualCaseCount: number;
    observationCount: number;
    recordCount: number;
}): DesignLearningExperienceStatus {
    if (input.visualCaseCount === 0 && input.observationCount === 0) return 'blocked_no_references';
    if (input.recordCount === 0) return 'blocked_missing_analysis';
    return 'ready_for_review';
}

function buildExperienceReviewRequirements(records: DesignLearningExperienceRecord[]): string[] {
    const requirements = [
        'source_provenance_required',
        'why_it_works_required',
        'suitable_scenario_required',
        'avoid_scenario_review_recommended',
        'human_or_model_review_required'
    ];
    if (records.some((record) => record.reviewStatus !== 'reviewed_approved')) {
        requirements.push('memory_candidate_must_remain_needs_review');
    }
    return requirements;
}

function buildExperienceWarnings(input: {
    blockedObservationCount: number;
    visualCaseIndex: EagleVisualCaseIndex | null;
}): string[] {
    return uniqueStrings([
        ...(input.visualCaseIndex?.warnings || []),
        input.blockedObservationCount > 0
            ? `${input.blockedObservationCount} 条参考观察缺少设计理由、适用场景或可复用经验，已阻断沉淀。`
            : ''
    ]);
}

function buildDailyPlanWarnings(
    sourceAvailability: Required<DesignLearningSourceAvailability>,
    topics: string[]
): string[] {
    return uniqueStrings([
        topics.length === 0 ? '未提供学习主题；运行时应从当前项目、业务 skill 和用户偏好生成主题。' : '',
        !sourceAvailability.visualAnalysis
            ? '当前没有视觉分析能力时，只能收集候选和等待人工/模型分析，不能沉淀经验。'
            : ''
    ]);
}

function normalizeSourceAvailability(value?: DesignLearningSourceAvailability): Required<DesignLearningSourceAvailability> {
    return {
        eagleReadonly: Boolean(value?.eagleReadonly),
        webSearch: Boolean(value?.webSearch),
        projectCases: Boolean(value?.projectCases),
        visualAnalysis: Boolean(value?.visualAnalysis)
    };
}

function collectSources(sourceAvailability: Required<DesignLearningSourceAvailability>): DesignLearningReferenceSource[] {
    const sources: DesignLearningReferenceSource[] = [];
    if (sourceAvailability.eagleReadonly) sources.push('eagle_readonly');
    if (sourceAvailability.webSearch) sources.push('web_search');
    if (sourceAvailability.projectCases) sources.push('project_cases');
    return sources;
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const token of UNSAFE_PAYLOAD_TOKENS) {
        text = text.split(token).join('[redacted]');
    }
    text = text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]');
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
