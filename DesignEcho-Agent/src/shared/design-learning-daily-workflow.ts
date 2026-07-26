import {
    buildDesignLearningDailyResearchPlan,
    type DesignLearningCadence,
    type DesignLearningDailyResearchPlan,
    type DesignLearningReferenceSource,
    type DesignLearningSourceAvailability
} from './design-learning-experience';

export type DesignLearningDailyWorkflowVersion = 'design-learning-daily-workflow/v0';
export type DesignLearningDailyWorkflowStatus =
    | 'ready_for_runtime'
    | 'ready_collect_references_only'
    | 'blocked_no_reference_sources';

export type DesignLearningDailyAdapter =
    | 'eagleReadonly'
    | 'webSearch'
    | 'projectCases'
    | 'analyzeReference';

export interface BuildDesignLearningDailyWorkflowRequestInput {
    date: string;
    cadence?: DesignLearningCadence;
    topics?: string[];
    sourceAvailability?: DesignLearningSourceAvailability;
    adapterAvailability?: Partial<Record<DesignLearningDailyAdapter, boolean>>;
    maxReferences?: number;
}

export interface DesignLearningDailyWorkflowRequest {
    version: DesignLearningDailyWorkflowVersion;
    status: DesignLearningDailyWorkflowStatus;
    date: string;
    cadence: DesignLearningCadence;
    topics: string[];
    plan: DesignLearningDailyResearchPlan;
    requiredAdapters: DesignLearningDailyAdapter[];
    blockedAdapters: Array<{
        adapter: DesignLearningDailyAdapter;
        reason: string;
    }>;
    runtimePolicy: {
        requiresInjectedProviders: true;
        doesNotExecuteSearchByItself: true;
        doesNotCallModelByItself: true;
        doesNotRunPhotoshop: true;
        doesNotWriteEagle: true;
    };
    memoryPolicy: {
        prepareCandidatesOnly: true;
        persistOnlyAfterReview: true;
        reviewStatus: 'needs_review';
        doesNotOverwriteUserPreferences: true;
    };
    safety: {
        canRunPhotoshop: false;
        canWriteEagle: false;
        canPersistMemory: false;
        canClaimDesignQuality: false;
        doesNotReturnRawImages: true;
    };
    blockers: string[];
    warnings: string[];
}

const VERSION: DesignLearningDailyWorkflowVersion = 'design-learning-daily-workflow/v0';

export function buildDesignLearningDailyWorkflowRequest(
    input: BuildDesignLearningDailyWorkflowRequestInput
): DesignLearningDailyWorkflowRequest {
    const plan = buildDesignLearningDailyResearchPlan({
        date: input.date,
        cadence: input.cadence || 'daily',
        topics: input.topics || [],
        sourceAvailability: input.sourceAvailability,
        maxReferences: input.maxReferences
    });
    const adapterAvailability = input.adapterAvailability || {};
    const requiredAdapters = collectRequiredAdapters(plan);
    const blockedAdapters = requiredAdapters
        .filter((adapter) => adapterAvailability[adapter] !== true)
        .map((adapter) => ({
            adapter,
            reason: adapter === 'analyzeReference'
                ? 'visual_analysis_adapter_required'
                : `${adapter}_provider_required`
        }));
    const blockers = [...plan.blockers];
    const missingSourceAdapters = blockedAdapters.filter((item) => item.adapter !== 'analyzeReference');
    if (missingSourceAdapters.length > 0) {
        blockers.push('reference_provider_adapter_required');
    }
    const missingAnalyzer = blockedAdapters.some((item) => item.adapter === 'analyzeReference');
    if (missingAnalyzer) {
        blockers.push('visual_analysis_adapter_required');
    }

    return {
        version: VERSION,
        status: resolveWorkflowStatus(plan, missingSourceAdapters.length > 0, missingAnalyzer),
        date: plan.date,
        cadence: plan.cadence,
        topics: plan.topics,
        plan,
        requiredAdapters,
        blockedAdapters,
        runtimePolicy: {
            requiresInjectedProviders: true,
            doesNotExecuteSearchByItself: true,
            doesNotCallModelByItself: true,
            doesNotRunPhotoshop: true,
            doesNotWriteEagle: true
        },
        memoryPolicy: {
            prepareCandidatesOnly: true,
            persistOnlyAfterReview: true,
            reviewStatus: 'needs_review',
            doesNotOverwriteUserPreferences: true
        },
        safety: {
            canRunPhotoshop: false,
            canWriteEagle: false,
            canPersistMemory: false,
            canClaimDesignQuality: false,
            doesNotReturnRawImages: true
        },
        blockers: uniqueStrings(blockers),
        warnings: uniqueStrings([
            ...plan.warnings,
            missingAnalyzer ? '缺少参考分析适配器时，只能收集候选，不能沉淀设计经验。' : ''
        ])
    };
}

function collectRequiredAdapters(plan: DesignLearningDailyResearchPlan): DesignLearningDailyAdapter[] {
    const adapters: DesignLearningDailyAdapter[] = [];
    const sourceMap: Record<DesignLearningReferenceSource, DesignLearningDailyAdapter> = {
        eagle_readonly: 'eagleReadonly',
        web_search: 'webSearch',
        project_cases: 'projectCases'
    };
    for (const source of plan.steps.flatMap((step) => step.sources)) {
        adapters.push(sourceMap[source]);
    }
    if (plan.steps.some((step) => step.kind === 'analyze_reference_design')) {
        adapters.push('analyzeReference');
    }
    return uniqueStrings(adapters) as DesignLearningDailyAdapter[];
}

function resolveWorkflowStatus(
    plan: DesignLearningDailyResearchPlan,
    hasMissingSourceAdapter: boolean,
    hasMissingAnalyzer: boolean
): DesignLearningDailyWorkflowStatus {
    if (plan.status === 'blocked_no_reference_sources' || hasMissingSourceAdapter) {
        return 'blocked_no_reference_sources';
    }
    if (hasMissingAnalyzer) return 'ready_collect_references_only';
    return 'ready_for_runtime';
}

function uniqueStrings(values: unknown[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        output.push(text);
    }
    return output;
}
