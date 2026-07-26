import type { TemplateBlueprintScreen } from '../../../shared/reference-replication-blueprint';
import type { MinimalDesignRepresentation } from '../../../shared/reference-replication';
import type { GeneratedReferenceElementResult, GeneratedTemplateScreen } from './layout-replication-apply';
import type { LayoutMatchExecutionItem, MatchResult } from './layout-replication-match';

export interface ReferenceElementCoverageReport {
    expected: number;
    applied: number;
    failed: number;
    skipped: number;
    missingIds: string[];
    appliedIds: string[];
    source: 'template-apply' | 'layout-match';
}

function buildBlueprintElementId(screenIndex: number, elementIndex: number, name: string): string {
    return `${screenIndex}:${elementIndex + 1}:${String(name || 'element')}`;
}

function normalizeId(value: unknown): string {
    return String(value || '').trim();
}

function buildMissingIds(expectedIds: string[], appliedIds: Set<string>): string[] {
    return expectedIds.filter((id) => !appliedIds.has(id));
}

export function buildTemplateApplyCoverageReport(params: {
    blueprintScreens: TemplateBlueprintScreen[];
    generatedScreens: GeneratedTemplateScreen[];
    elementResults?: GeneratedReferenceElementResult[];
    failedOps?: number;
}): ReferenceElementCoverageReport {
    const expectedIds: string[] = [];
    for (const screen of params.blueprintScreens || []) {
        for (let index = 0; index < (screen.elements || []).length; index += 1) {
            expectedIds.push(buildBlueprintElementId(screen.index, index, screen.elements[index]?.name));
        }
    }

    const appliedIds = new Set<string>();
    const failedIds = new Set<string>();
    const skippedIds = new Set<string>();

    if (Array.isArray(params.elementResults) && params.elementResults.length > 0) {
        for (const item of params.elementResults) {
            const id = normalizeId(item.referenceElementId);
            if (!id) continue;
            if (item.status === 'applied') {
                appliedIds.add(id);
                failedIds.delete(id);
                skippedIds.delete(id);
            } else if (item.status === 'failed') {
                failedIds.add(id);
            } else if (item.status === 'skipped') {
                skippedIds.add(id);
            }
        }

        const missingIdsFromEvents = buildMissingIds(expectedIds, appliedIds);
        return {
            expected: expectedIds.length,
            applied: appliedIds.size,
            failed: Array.from(failedIds).filter((id) => !appliedIds.has(id)).length,
            skipped: Array.from(skippedIds).filter((id) => !appliedIds.has(id)).length,
            missingIds: missingIdsFromEvents,
            appliedIds: Array.from(appliedIds),
            source: 'template-apply'
        };
    }

    for (const screen of params.generatedScreens || []) {
        const placeholders = [
            ...(screen.copyPlaceholders || []),
            ...(screen.imagePlaceholders || [])
        ];
        for (const placeholder of placeholders) {
            if (placeholder.sourceKind !== 'reference') continue;
            const id = normalizeId(placeholder.referenceElementId);
            if (id) appliedIds.add(id);
        }
    }

    const missingIds = buildMissingIds(expectedIds, appliedIds);
    const failedOps = Math.max(0, Math.round(Number(params.failedOps || 0)));
    const failed = failedOps > 0 ? missingIds.length : 0;
    const skipped = failedOps > 0 ? 0 : missingIds.length;

    return {
        expected: expectedIds.length,
        applied: appliedIds.size,
        failed,
        skipped,
        missingIds,
        appliedIds: Array.from(appliedIds),
        source: 'template-apply'
    };
}

function buildRepresentationElementIds(representation: MinimalDesignRepresentation): string[] {
    return (representation.elements || []).map((element, index) => normalizeId(element.id || element.name || `element_${index + 1}`));
}

function normalizeMatchReference(raw: unknown, expectedIds: string[]): string {
    const value = normalizeId(raw);
    if (!value) return '';
    if (expectedIds.includes(value)) return value;

    const lower = value.toLowerCase();
    return expectedIds.find((id) => id.toLowerCase() === lower) || '';
}

export function buildLayoutMatchCoverageReport(params: {
    representation: MinimalDesignRepresentation;
    matchResult?: MatchResult | null;
    executionResults?: LayoutMatchExecutionItem[];
}): ReferenceElementCoverageReport {
    const expectedIds = buildRepresentationElementIds(params.representation);
    const executed = params.executionResults || [];
    const appliedIds = new Set<string>();
    const failedIds = new Set<string>();
    const skippedIds = new Set<string>();

    for (const item of executed) {
        const id = normalizeMatchReference(item.refElement, expectedIds);
        if (!id) continue;
        if (item.success) {
            appliedIds.add(id);
            failedIds.delete(id);
            skippedIds.delete(id);
        } else if (item.skipped) {
            skippedIds.add(id);
        } else {
            failedIds.add(id);
        }
    }

    const referenced = new Set<string>();
    for (const match of params.matchResult?.matches || []) {
        const id = normalizeMatchReference(match.refElement, expectedIds);
        if (id) referenced.add(id);
    }

    for (const id of expectedIds) {
        if (appliedIds.has(id) || failedIds.has(id) || skippedIds.has(id)) continue;
        if (referenced.has(id)) {
            skippedIds.add(id);
        }
    }

    const missingIds = buildMissingIds(expectedIds, appliedIds);
    return {
        expected: expectedIds.length,
        applied: appliedIds.size,
        failed: Array.from(failedIds).filter((id) => !appliedIds.has(id)).length,
        skipped: Array.from(skippedIds).filter((id) => !appliedIds.has(id)).length,
        missingIds,
        appliedIds: Array.from(appliedIds),
        source: 'layout-match'
    };
}
