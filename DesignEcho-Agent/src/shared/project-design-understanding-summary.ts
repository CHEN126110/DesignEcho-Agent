import type { ProjectAssetIndex } from './project-asset-index';
import {
    buildProjectProductUnderstanding,
    type ProjectProductUnderstanding
} from './project-product-understanding';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';

export interface BuildProjectDesignUnderstandingSummaryInput {
    projectContext?: {
        assetIndex?: ProjectAssetIndex;
        visualInsightCache?: ProjectVisualInsightCacheReadResult;
    } | null;
    maxItemsPerLine?: number;
}

export interface ProjectDesignUnderstandingSummary {
    version: 'project-design-understanding-summary/v0';
    understanding: ProjectProductUnderstanding;
    lines: string[];
    warnings: string[];
    limitations: string[];
}

function joinItems(items: string[] | undefined, maxItems: number): string {
    return (items || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems).join(' / ');
}

function line(label: string, value: string): string {
    return value ? `${label}=${value}` : '';
}

export function buildProjectDesignUnderstandingSummary(
    input: BuildProjectDesignUnderstandingSummaryInput
): ProjectDesignUnderstandingSummary {
    const maxItems = Math.max(1, Math.min(8, Math.round(Number(input.maxItemsPerLine || 5))));
    const understanding = buildProjectProductUnderstanding({
        assetIndex: input.projectContext?.assetIndex,
        visualInsightCache: input.projectContext?.visualInsightCache
    });

    const lines = [
        line('observedProductTypes', joinItems(understanding.observations.productTypes, maxItems)),
        line('observedMaterials', joinItems(understanding.observations.materials, maxItems)),
        line('observedScenes', joinItems(understanding.observations.scenes, maxItems)),
        line('observedStyleTags', joinItems(understanding.observations.styleTags, maxItems)),
        line('observedSellingPoints', joinItems(understanding.observations.sellingPointObservations, maxItems)),
        line('visualSummaries', joinItems(understanding.observations.visualSummaries, maxItems)),
        line(
            'assetCoverage',
            `images:${understanding.coverage.imageAssetCount}; insights:${understanding.coverage.visualInsightCount}; linked:${understanding.coverage.linkedVisualInsightCount}`
        ),
        line('productUnderstandingWarnings', joinItems(understanding.warnings, maxItems))
    ].filter(Boolean);

    return {
        version: 'project-design-understanding-summary/v0',
        understanding,
        lines,
        warnings: understanding.warnings,
        limitations: [
            'ProjectDesignUnderstandingSummary only summarizes already-structured product observations for Agent planning prompts.',
            'It does not read task text, infer a category, author R1/R3/R4, execute Photoshop, or decide a final design by itself.'
        ]
    };
}
