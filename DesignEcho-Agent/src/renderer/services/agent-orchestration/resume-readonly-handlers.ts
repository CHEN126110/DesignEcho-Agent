import type { AgentResumeReadonlyToolHandlers } from '../../../shared/agent-resume-context-pipeline';
import { buildProjectDesignUnderstandingSummary } from '../../../shared/project-design-understanding-summary';
import type { ProjectContext } from './types';

export type ResumeReadonlyExecuteToolCall = (
    toolName: string,
    params: Record<string, unknown>
) => Promise<unknown>;

export interface BuildAgentResumeReadonlyToolHandlersInput {
    executeToolCall: ResumeReadonlyExecuteToolCall;
    projectContext?: ProjectContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertReadonlyToolResult(toolName: string, result: unknown): unknown {
    if (isRecord(result) && result.success === false) {
        const error = typeof result.error === 'string' && result.error.trim()
            ? result.error.trim()
            : '只读工具返回失败。';
        throw new Error(`${toolName} 只读上下文读取失败：${error}`);
    }
    return result;
}

function summarizeProjectContext(projectContext?: ProjectContext): Record<string, unknown> {
    if (!projectContext?.projectPath) {
        return {
            hasProject: false,
            warnings: ['当前没有项目上下文；恢复规划只能基于 Photoshop 只读上下文。']
        };
    }

    const productDesignUnderstanding = buildProjectDesignUnderstandingSummary({
        projectContext
    });

    return {
        hasProject: true,
        projectPath: projectContext.projectPath,
        hasSkuFiles: projectContext.hasSkuFiles,
        hasTemplates: projectContext.hasTemplates,
        availableColors: projectContext.availableColors,
        projectImageCount: projectContext.projectImageCount,
        projectImageFolders: projectContext.projectImageFolders,
        sampleImagePaths: projectContext.sampleImagePaths,
        selectedProjectImagePath: projectContext.selectedProjectImagePath,
        selectedProjectImageName: projectContext.selectedProjectImageName,
        assetSummary: projectContext.assetIndex?.summary,
        visualSamplingPlan: projectContext.visualSamplingPlan
            ? {
                scenario: projectContext.visualSamplingPlan.scenario,
                selectedCandidates: projectContext.visualSamplingPlan.selectedCandidates?.slice(0, 12),
                warnings: projectContext.visualSamplingPlan.warnings,
                limitations: projectContext.visualSamplingPlan.limitations
            }
            : undefined,
        visualInsightCache: projectContext.visualInsightCache
            ? {
                source: projectContext.visualInsightCache.source,
                exists: projectContext.visualInsightCache.exists,
                totalEntries: projectContext.visualInsightCache.summary.totalEntries,
                entriesWithInsight: projectContext.visualInsightCache.summary.entriesWithInsight,
                entriesWithRawPayloadRemoved: projectContext.visualInsightCache.summary.entriesWithRawPayloadRemoved,
                warnings: projectContext.visualInsightCache.warnings,
                limitations: projectContext.visualInsightCache.limitations
            }
            : undefined,
        productDesignUnderstanding: productDesignUnderstanding.lines,
        productDesignBriefWarnings: productDesignUnderstanding.warnings,
        contextSnapshotSource: projectContext.contextSnapshotSource,
        contextSnapshotSummary: projectContext.contextSnapshot
            ? {
                snapshotVersion: projectContext.contextSnapshot.snapshotVersion,
                project: projectContext.contextSnapshot.project,
                readiness: projectContext.contextSnapshot.readiness,
                selectedAssetCount: projectContext.contextSnapshot.selectedAssetPaths.length,
                userConstraintCount: projectContext.contextSnapshot.userConstraints.length,
                taskHistoryCount: projectContext.contextSnapshot.taskHistory.length,
                unverifiedItemCount: projectContext.contextSnapshot.unverifiedItems.length,
                hasAssetIndex: Boolean(projectContext.contextSnapshot.assetIndex),
                hasVisualSamplingPlan: Boolean(projectContext.contextSnapshot.visualSamplingPlan),
                hasVisualInsightCache: Boolean(projectContext.contextSnapshot.visualInsightCache)
            }
            : undefined,
        contextSnapshotWarnings: projectContext.contextSnapshotWarnings || projectContext.contextSnapshot?.warnings,
        contextSnapshotLimitations: projectContext.contextSnapshotLimitations || projectContext.contextSnapshot?.limitations
    };
}

export function buildAgentResumeReadonlyToolHandlers(
    input: BuildAgentResumeReadonlyToolHandlersInput
): AgentResumeReadonlyToolHandlers {
    const readTool = async (toolName: string, params: Record<string, unknown>) => {
        const result = await input.executeToolCall(toolName, params);
        return assertReadonlyToolResult(toolName, result);
    };

    return {
        getDocumentInfo: () => readTool('getDocumentInfo', {}),
        getDocumentSnapshot: () => readTool('getDocumentSnapshot', {
            maxWidth: 640,
            maxHeight: 640,
            format: 'jpeg'
        }),
        getLayerHierarchy: () => readTool('getLayerHierarchy', {
            includeHidden: true,
            includeBounds: true,
            flatList: false
        }),
        getAcceptanceSnapshot: () => readTool('getAcceptanceSnapshot', {
            includeHidden: true,
            includeBounds: true,
            includeText: true,
            maxLayers: 300
        }),
        getProjectContextSnapshot: () => summarizeProjectContext(input.projectContext)
    };
}
