import type { DesignLearningRuntimeReferenceCandidate } from './design-learning-runtime-runner';
import type { EagleReadonlyKnowledgeResponse } from './eagle-readonly-knowledge';
import {
    buildEagleVisualCaseIndexFromReadonlyKnowledge,
    type EagleVisualCaseIndex,
    type EagleVisualCaseIndexItem
} from './eagle-visual-case-index';

export interface EagleDesignLearningRuntimeReferenceOptions {
    maxItems?: number;
    requestedBy?: string;
    generatedAt?: string;
}

export interface EagleDesignLearningRuntimeBoundary {
    readonly: true;
    doesNotWriteEagle: true;
    doesNotRunPhotoshop: true;
    doesNotReturnRawImages: true;
    doesNotExposeLocalPaths: true;
    doesNotUseConfidence: true;
    requiresVisualAnalysisBeforeMemory: true;
}

export interface EagleDesignLearningRuntimeReferenceResult {
    references: Array<Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>>>;
    visualCaseSummary: EagleVisualCaseIndex['summary'];
    boundaries: EagleDesignLearningRuntimeBoundary;
    warnings: string[];
}

const RAW_OR_SCORE_PATTERNS = [
    /data:image/gi,
    /;base64,/gi,
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /"base64"/gi,
    /"imageBase64"/gi,
    /"rawImage"/gi,
    /"rawImages"/gi,
    /"buffer"/gi,
    /"bytes"/gi,
    /"pixels"/gi,
    /"confidence"/gi,
    /\bconfidence\b/gi,
    /置信/g
];

const LOCAL_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'，,；;]+/;

export function buildEagleDesignLearningRuntimeBoundary(): EagleDesignLearningRuntimeBoundary {
    return {
        readonly: true,
        doesNotWriteEagle: true,
        doesNotRunPhotoshop: true,
        doesNotReturnRawImages: true,
        doesNotExposeLocalPaths: true,
        doesNotUseConfidence: true,
        requiresVisualAnalysisBeforeMemory: true
    };
}

export function eagleReadonlyKnowledgeToDesignLearningRuntimeReferences(
    readonlyKnowledge: Pick<EagleReadonlyKnowledgeResponse, 'version' | 'results' | 'warnings'>,
    options: EagleDesignLearningRuntimeReferenceOptions = {}
): EagleDesignLearningRuntimeReferenceResult {
    const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
        purpose: 'design_reference',
        requestedBy: cleanString(options.requestedBy || 'design-learning-runtime'),
        generatedAt: cleanString(options.generatedAt)
    });
    return eagleVisualCaseIndexToDesignLearningRuntimeReferences(visualCaseIndex, options);
}

export function eagleVisualCaseIndexToDesignLearningRuntimeReferences(
    visualCaseIndex: EagleVisualCaseIndex,
    options: EagleDesignLearningRuntimeReferenceOptions = {}
): EagleDesignLearningRuntimeReferenceResult {
    const maxItems = clampNumber(options.maxItems, 1, 50, 12);
    const warnings: string[] = [];
    const references = dedupeById(visualCaseIndex.cases)
        .slice(0, maxItems)
        .map((item) => visualCaseToRuntimeReference(item))
        .filter((item): item is Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> => Boolean(item));
    const result: EagleDesignLearningRuntimeReferenceResult = {
        references,
        visualCaseSummary: visualCaseIndex.summary,
        boundaries: buildEagleDesignLearningRuntimeBoundary(),
        warnings
    };

    if (!isPublicRuntimeReferencePayloadSafe(result.references)) {
        warnings.push('eagle_runtime_reference_public_payload_sanitized');
        return {
            ...result,
            references: result.references.map(sanitizePublicReference)
        };
    }

    return result;
}

export function isPublicRuntimeReferencePayloadSafe(value: unknown): boolean {
    const text = JSON.stringify(value || '');
    return !LOCAL_PATH_PATTERN.test(text) && !RAW_OR_SCORE_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
    });
}

function visualCaseToRuntimeReference(
    item: EagleVisualCaseIndexItem
): Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> | undefined {
    const referenceId = cleanString(item.caseId);
    const title = cleanString(item.asset.name) || referenceId;
    if (!referenceId || !title) return undefined;

    const reference: Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> = {
        referenceId,
        title,
        sourceType: 'eagle_visual_case',
        tags: buildReferenceTags(item)
    };
    const sourceUrl = safeSourceUrl(item.source.sourceUrl);
    if (sourceUrl) reference.sourceUrl = sourceUrl;
    return sanitizePublicReference(reference);
}

function buildReferenceTags(item: EagleVisualCaseIndexItem): string[] {
    return uniqueStrings([
        'eagle',
        'visual-learning',
        item.purpose,
        item.visualReadiness,
        item.asset.extension,
        ...item.asset.tags,
        ...item.asset.folders.map((folder) => `folder:${folder}`)
    ]).slice(0, 24);
}

function sanitizePublicReference(
    reference: Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>>
): Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> {
    const cleanReference: Partial<Omit<DesignLearningRuntimeReferenceCandidate, 'source'>> = {
        referenceId: cleanString(reference.referenceId),
        title: cleanString(reference.title),
        sourceType: reference.sourceType === 'external_reference' || reference.sourceType === 'manual_reference'
            ? reference.sourceType
            : 'eagle_visual_case',
        tags: uniqueStrings(reference.tags || []).slice(0, 24)
    };
    const sourceUrl = safeSourceUrl(reference.sourceUrl);
    if (sourceUrl) cleanReference.sourceUrl = sourceUrl;
    return cleanReference;
}

function safeSourceUrl(value: unknown): string {
    const text = cleanString(value);
    if (!text) return '';
    if (LOCAL_PATH_PATTERN.test(text)) return '';
    if (/^file:/i.test(text)) return '';
    if (/^data:/i.test(text)) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^eagle:\/\/item\//i.test(text)) return text;
    return '';
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of RAW_OR_SCORE_PATTERNS) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, '[redacted]');
    }
    return text.replace(LOCAL_PATH_PATTERN, '[redacted-local-path]').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function dedupeById(values: EagleVisualCaseIndexItem[]): EagleVisualCaseIndexItem[] {
    const byId = new Map<string, EagleVisualCaseIndexItem>();
    for (const value of values) {
        const id = cleanString(value.caseId);
        if (!id || byId.has(id)) continue;
        byId.set(id, value);
    }
    return Array.from(byId.values());
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(numeric)));
}
