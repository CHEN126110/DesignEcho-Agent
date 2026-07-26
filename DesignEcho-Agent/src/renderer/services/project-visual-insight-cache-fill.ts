import {
    buildProjectVisualInsightCacheEntry,
    buildProjectVisualInsightCacheFillPlan,
    buildProjectVisualInsightCacheFillResult,
    mapAssetAnalysisToProjectVisualInsight,
    type AssetAnalysisPayload,
    type ProjectVisualInsightCacheFillEntryResult,
    type ProjectVisualInsightCacheFillResult
} from '../../shared/project-visual-insight-cache-fill';
import type {
    ProjectVisualSamplingCacheEntry,
    ProjectVisualSamplingPlan
} from '../../shared/project-visual-sampling';

export interface RunProjectVisualInsightCacheFillInput {
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    enabled?: unknown;
    maxCandidates?: number;
    modelId?: string;
    nowIso?: string;
    analyzeAssetContent?: (imagePath: string) => Promise<AssetAnalysisPayload>;
    writeProjectVisualInsightCache?: (options: {
        projectPath: string;
        entries: ProjectVisualSamplingCacheEntry[];
        replace?: boolean;
        nowIso?: string;
    }) => Promise<unknown>;
}

function getDefaultAnalyzeAssetContent(): RunProjectVisualInsightCacheFillInput['analyzeAssetContent'] {
    const api = (window as any)?.designEcho;
    return typeof api?.analyzeAssetContent === 'function'
        ? (imagePath: string) => api.analyzeAssetContent(imagePath)
        : undefined;
}

function getDefaultWriteProjectVisualInsightCache(): RunProjectVisualInsightCacheFillInput['writeProjectVisualInsightCache'] {
    const api = (window as any)?.designEcho;
    return typeof api?.writeProjectVisualInsightCache === 'function'
        ? (options) => api.writeProjectVisualInsightCache(options)
        : undefined;
}

function readErrorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || '').trim();
}

export async function runProjectVisualInsightCacheFill(
    input: RunProjectVisualInsightCacheFillInput
): Promise<ProjectVisualInsightCacheFillResult> {
    const analyzer = input.analyzeAssetContent || getDefaultAnalyzeAssetContent();
    const writer = input.writeProjectVisualInsightCache || getDefaultWriteProjectVisualInsightCache();
    const plan = buildProjectVisualInsightCacheFillPlan({
        projectPath: input.projectPath,
        visualSamplingPlan: input.visualSamplingPlan,
        enabled: input.enabled,
        hasAnalyzer: Boolean(analyzer),
        hasWriter: Boolean(writer),
        maxCandidates: input.maxCandidates
    });

    if (!plan.shouldCallAnalyzer || !analyzer || !writer) {
        return buildProjectVisualInsightCacheFillResult({
            plan,
            entryResults: []
        });
    }

    const capturedAt = input.nowIso || new Date().toISOString();
    const entryResults: ProjectVisualInsightCacheFillEntryResult[] = [];

    for (const candidate of plan.candidates) {
        try {
            const payload = await analyzer(candidate.path);
            const insight = mapAssetAnalysisToProjectVisualInsight({
                candidate,
                payload,
                modelId: input.modelId,
                capturedAt
            });

            if (!insight) {
                entryResults.push({
                    candidate,
                    status: 'failed',
                    error: payload?.error || '视觉模型没有返回可映射的结构化素材摘要。'
                });
                continue;
            }

            const entry = buildProjectVisualInsightCacheEntry({
                candidate,
                insight,
                updatedAt: capturedAt
            });
            entryResults.push({
                candidate,
                status: 'completed',
                entry
            });
        } catch (error) {
            entryResults.push({
                candidate,
                status: 'failed',
                error: readErrorText(error) || 'analyzeAssetContent 调用失败。'
            });
        }
    }

    const entries = entryResults.map((result) => result.entry).filter(Boolean) as ProjectVisualSamplingCacheEntry[];
    let writeSucceeded = entries.length === 0 ? false : true;
    let writeError: unknown;

    if (entries.length > 0) {
        try {
            await writer({
                projectPath: plan.projectPath || '',
                entries,
                replace: false,
                nowIso: capturedAt
            });
        } catch (error) {
            writeSucceeded = false;
            writeError = error;
        }
    }

    return buildProjectVisualInsightCacheFillResult({
        plan,
        entryResults,
        writeSucceeded,
        writeError
    });
}
