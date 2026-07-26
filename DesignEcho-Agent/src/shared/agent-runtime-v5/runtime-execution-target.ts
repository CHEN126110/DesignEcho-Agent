/**
 * Runtime execution target identity.
 *
 * The target is an opaque, in-memory execution anchor. It deliberately stores no document name,
 * local path, Tool name, Tool arguments or Tool result payload. It is not a permission token and
 * cannot schedule or execute work.
 */

import { computeFastFingerprint } from './content-hash';

export type RuntimeExecutionTargetSource =
    | 'explicit_document_id'
    | 'explicit_document_name'
    | 'carried_active_document';

export interface RuntimeExecutionTargetAnchor {
    version: 'runtime-execution-target-anchor/v0';
    documentRef: string;
    objectRefs: string[];
    source: RuntimeExecutionTargetSource;
    boundaries: {
        opaqueIdentityOnly: true;
        containsDocumentName: false;
        containsLocalPath: false;
        containsToolPayload: false;
        grantsPermission: false;
        executesTools: false;
    };
}

export interface ResolveRuntimeExecutionTargetInput {
    arguments?: unknown;
    result?: unknown;
    previous?: RuntimeExecutionTargetAnchor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteIdentifier(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value.trim())) {
        return value.trim();
    }
    return '';
}

function boundedName(value: unknown): string {
    if (typeof value !== 'string') return '';
    const name = value.trim();
    if (!name || name.length > 240) return '';
    if (/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private)\/)/.test(name)) return '';
    return name;
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
    if (!isRecord(value)) return [];
    const records = [value];
    for (const key of [
        'data',
        'document',
        'activeDocument',
        'targetDocument',
        'documentInfo',
        'historyStateRef',
        'sourceHistoryStateRef',
        'photoshopMutationCommit'
    ]) {
        if (isRecord(value[key])) records.push(value[key] as Record<string, unknown>);
    }
    const mutationCommit = isRecord(value.photoshopMutationCommit)
        ? value.photoshopMutationCommit
        : undefined;
    if (mutationCommit) {
        if (isRecord(mutationCommit.before)) records.push(mutationCommit.before);
        if (isRecord(mutationCommit.after)) records.push(mutationCommit.after);
    }
    return records;
}

function readDocumentIdentity(values: readonly unknown[]): {
    identity: string;
    source: Exclude<RuntimeExecutionTargetSource, 'carried_active_document'>;
} | undefined {
    for (const value of values) {
        for (const record of nestedRecords(value)) {
            const id = finiteIdentifier(record.activeDocumentId)
                || finiteIdentifier(record.documentId ?? record.docId)
                || (record !== value ? finiteIdentifier(record.id) : '');
            if (id) return { identity: `id:${id}`, source: 'explicit_document_id' };
        }
    }
    for (const value of values) {
        for (const record of nestedRecords(value)) {
            const name = boundedName(record.activeDocumentName)
                || boundedName(record.documentName)
                || (record !== value ? boundedName(record.name) : '');
            if (name) return { identity: `name:${name}`, source: 'explicit_document_name' };
        }
    }
    return undefined;
}

function collectObjectRefs(values: readonly unknown[]): string[] {
    const identities: string[] = [];
    for (const value of values) {
        for (const record of nestedRecords(value)) {
            const direct = [record.layerId, record.targetLayerId, record.groupId, record.targetGroupId];
            for (const candidate of direct) {
                const id = finiteIdentifier(candidate);
                if (id) identities.push(`object:${computeFastFingerprint(id)}`);
            }
            const arrays = [record.layerIds, record.targetLayerIds];
            for (const array of arrays) {
                if (!Array.isArray(array)) continue;
                for (const candidate of array.slice(0, 32)) {
                    const id = finiteIdentifier(candidate);
                    if (id) identities.push(`object:${computeFastFingerprint(id)}`);
                }
            }
        }
    }
    return Array.from(new Set(identities)).slice(0, 32);
}

function buildAnchor(
    identity: string,
    source: RuntimeExecutionTargetSource,
    objectRefs: string[]
): RuntimeExecutionTargetAnchor {
    return {
        version: 'runtime-execution-target-anchor/v0',
        documentRef: `document:${computeFastFingerprint(identity)}`,
        objectRefs,
        source,
        boundaries: {
            opaqueIdentityOnly: true,
            containsDocumentName: false,
            containsLocalPath: false,
            containsToolPayload: false,
            grantsPermission: false,
            executesTools: false
        }
    };
}

export function resolveRuntimeExecutionTarget(
    input: ResolveRuntimeExecutionTargetInput
): RuntimeExecutionTargetAnchor | undefined {
    const values = [input.arguments, input.result];
    const explicitDocument = readDocumentIdentity(values);
    const objectRefs = collectObjectRefs(values);
    if (explicitDocument) {
        return buildAnchor(explicitDocument.identity, explicitDocument.source, objectRefs);
    }
    if (!input.previous) return undefined;
    return {
        ...input.previous,
        objectRefs: objectRefs.length > 0 ? objectRefs : [...input.previous.objectRefs],
        source: 'carried_active_document',
        boundaries: { ...input.previous.boundaries }
    };
}

export function sameRuntimeExecutionDocument(
    left: RuntimeExecutionTargetAnchor | undefined,
    right: RuntimeExecutionTargetAnchor | undefined
): boolean {
    return Boolean(left && right && left.documentRef === right.documentRef);
}
