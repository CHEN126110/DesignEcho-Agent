/**
 * R4 对账摘要的跨轮 Context Anchor 与 freshness 裁决。
 *
 * Anchor 只保存稳定指纹和观察精度，不保存图层名、原始层树、路径、图片、Tool 参数或结果。
 * Freshness 只决定旧 resume 建议是否仍可作为参考，不执行、不阻断、不调度任何 Tool。
 */

import { classifyAgentToolExecution } from '../agent-tool-execution-preflight';

export type RuntimeResumeDocumentAnchorSource =
    | 'layer_hierarchy'
    | 'annotated_snapshot'
    | 'document_info';

export type RuntimeResumeDocumentAnchorFidelity =
    | 'structure'
    | 'visual_structure'
    | 'partial_structure'
    | 'summary';

export interface RuntimeResumeDocumentAnchor {
    source: RuntimeResumeDocumentAnchorSource;
    fidelity: RuntimeResumeDocumentAnchorFidelity;
    fingerprint: string;
    itemCount: number;
    observedAfterLastMutation: boolean;
}

export interface RuntimeResumeProjectStateAnchor {
    fingerprint: string;
    schemaVersion: string;
    hasUpdatedAt: boolean;
    versionCount: number;
    productionTaskCount: number;
}

export interface RuntimeResumeCompletedStepDescriptor {
    stepId: string;
    kind: string;
    capabilityRefs: string[];
    observedOutcomes: string[];
}

export interface RuntimeResumeContextAnchor {
    version: 'runtime-resume-context-anchor/v0';
    document?: RuntimeResumeDocumentAnchor;
    projectState?: RuntimeResumeProjectStateAnchor;
    boundaries: {
        digestOnly: true;
        containsLayerNames: false;
        containsRawLayers: false;
        containsImages: false;
        containsPaths: false;
        containsToolArguments: false;
        containsToolResults: false;
        categoryNeutral: true;
        grantsPermission: false;
        changesTaskResult: false;
    };
}

export interface RuntimeResumeFreshnessProbeRequest {
    source: RuntimeResumeDocumentAnchorSource;
    toolName: 'getLayerHierarchy' | 'getAnnotatedSnapshot' | 'getDocumentInfo';
    arguments: Record<string, unknown>;
    boundaries: {
        readOnly: true;
        executesWrites: false;
        blocksTaskOnFailure: false;
    };
}

export interface RuntimeActionPlanResumeFreshness {
    version: 'runtime-action-plan-resume-freshness/v0';
    sourceRunId: string;
    status: 'verified' | 'mismatch' | 'insufficient_context' | 'probe_failed';
    documentMatch: 'matched' | 'mismatched' | 'missing' | 'insufficient';
    projectStateMatch: 'matched' | 'mismatched' | 'missing' | 'not_required';
    verifiedCompletedStepIds: string[];
    invalidatedCompletedStepIds: string[];
    verifiedCompletedSteps: RuntimeResumeCompletedStepDescriptor[];
    invalidatedCompletedSteps: RuntimeResumeCompletedStepDescriptor[];
    verifiedResumeStepIds: string[];
    invalidatedResumeStepIds: string[];
    reasons: string[];
    boundaries: {
        observationOnly: true;
        advisoryOnly: true;
        taskRelatednessModelOwned: true;
        executesTools: false;
        executesWrites: false;
        blocksTask: false;
        autoSkipsSteps: false;
        autoRecoversSteps: false;
        schedulerAuthority: false;
        grantsPermission: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeResumeToolLogEntry {
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
}

const MAX_STRUCTURE_ITEMS = 400;
const MAX_RESUME_STEP_IDS = 12;

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : fallback;
}

function boolean(value: unknown): boolean {
    return value === true;
}

function cleanToken(value: unknown, limit = 80): string {
    const text = String(value || '').trim();
    return /^[A-Za-z0-9_.:/-]{1,80}$/.test(text) ? text.slice(0, limit) : '';
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isRecord(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((output, key) => {
        output[key] = stableValue(value[key]);
        return output;
    }, {});
}

function stableHash(value: unknown): string {
    const input = JSON.stringify(stableValue(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `ctx-${hash.toString(16).padStart(8, '0')}`;
}

function unwrapResult(value: unknown): Record<string, any> {
    if (!isRecord(value)) return {};
    if (isRecord(value.data) && Object.keys(value).every((key) => ['success', 'data', 'message'].includes(key))) {
        return value.data;
    }
    return value;
}

function flattenHierarchyNodes(value: unknown, output: Array<Record<string, unknown>>): void {
    if (!Array.isArray(value) || output.length >= MAX_STRUCTURE_ITEMS) return;
    for (const rawNode of value) {
        if (output.length >= MAX_STRUCTURE_ITEMS) return;
        if (!isRecord(rawNode)) continue;
        output.push({
            id: finite(rawNode.id),
            kind: cleanToken(rawNode.kind || rawNode.type || 'unknown'),
            visible: rawNode.visible !== false,
            locked: boolean(rawNode.locked),
            opacity: finite(rawNode.opacity, 100),
            blendMode: cleanToken(rawNode.blendMode || 'normal'),
            parentId: finite(rawNode.parentId),
            index: finite(rawNode.index),
            depth: finite(rawNode.depth)
        });
        flattenHierarchyNodes(rawNode.children, output);
    }
}

function buildHierarchyAnchor(entry: RuntimeResumeToolLogEntry): RuntimeResumeDocumentAnchor | undefined {
    const args = isRecord(entry.arguments) ? entry.arguments : {};
    if (args.rootLayerId !== undefined || args.includeHidden === false) return undefined;
    const result = unwrapResult(entry.result);
    const rawNodes = Array.isArray(result.flatList)
        ? result.flatList
        : (Array.isArray(result.hierarchy) ? result.hierarchy : result.layers);
    const nodes: Array<Record<string, unknown>> = [];
    flattenHierarchyNodes(rawNodes, nodes);
    if (nodes.length === 0) return undefined;
    const declaredTotal = Number(result.totalLayers);
    const complete = nodes.length < MAX_STRUCTURE_ITEMS
        && (!Number.isFinite(declaredTotal) || declaredTotal === nodes.length);
    return {
        source: 'layer_hierarchy',
        fidelity: complete ? 'structure' : 'partial_structure',
        fingerprint: stableHash({ nodes, total: Number.isFinite(declaredTotal) ? declaredTotal : nodes.length }),
        itemCount: nodes.length,
        observedAfterLastMutation: true
    };
}

function buildAnnotatedAnchor(entry: RuntimeResumeToolLogEntry): RuntimeResumeDocumentAnchor | undefined {
    const args = isRecord(entry.arguments) ? entry.arguments : {};
    if (args.region !== undefined || args.includeHidden === true) return undefined;
    if (args.layerFilter !== undefined && args.layerFilter !== 'visual') return undefined;
    const result = unwrapResult(entry.result);
    const rawLayers = Array.isArray(result.layers) ? result.layers : result.elements;
    if (!Array.isArray(rawLayers) || rawLayers.length === 0) return undefined;
    const layers = rawLayers.slice(0, MAX_STRUCTURE_ITEMS).filter(isRecord).map((layer) => {
        const bounds = isRecord(layer.bounds) ? layer.bounds : {};
        return {
            id: finite(layer.id),
            kind: cleanToken(layer.kind || layer.type || 'unknown'),
            visible: layer.visible !== false,
            left: finite(bounds.left ?? bounds.x),
            top: finite(bounds.top ?? bounds.y),
            right: finite(bounds.right),
            bottom: finite(bounds.bottom),
            width: finite(bounds.width),
            height: finite(bounds.height)
        };
    });
    if (layers.length === 0) return undefined;
    const documentSize = isRecord(result.documentSize) ? result.documentSize : {};
    const truncated = rawLayers.length > MAX_STRUCTURE_ITEMS;
    return {
        source: 'annotated_snapshot',
        fidelity: truncated ? 'partial_structure' : 'visual_structure',
        fingerprint: stableHash({
            documentSize: {
                width: finite(documentSize.width),
                height: finite(documentSize.height)
            },
            layers
        }),
        itemCount: layers.length,
        observedAfterLastMutation: true
    };
}

function buildDocumentInfoAnchor(entry: RuntimeResumeToolLogEntry): RuntimeResumeDocumentAnchor | undefined {
    const result = unwrapResult(entry.result);
    const document = isRecord(result.document) ? result.document : result;
    const id = finite(document.id ?? document.documentId);
    const width = finite(document.width);
    const height = finite(document.height);
    const layerCount = finite(document.layerCount);
    if (id === 0 && width === 0 && height === 0 && layerCount === 0) return undefined;
    return {
        source: 'document_info',
        fidelity: 'summary',
        fingerprint: stableHash({
            id,
            width,
            height,
            resolution: finite(document.resolution),
            colorMode: cleanToken(document.colorMode),
            layerCount
        }),
        itemCount: layerCount,
        observedAfterLastMutation: true
    };
}

function buildDocumentAnchor(entry: RuntimeResumeToolLogEntry): RuntimeResumeDocumentAnchor | undefined {
    const name = String(entry.name || '').trim();
    if (name === 'getLayerHierarchy') return buildHierarchyAnchor(entry);
    if (name === 'getAnnotatedSnapshot') return buildAnnotatedAnchor(entry);
    if (name === 'getDocumentInfo') return buildDocumentInfoAnchor(entry);
    return undefined;
}

function anchorStrength(anchor: RuntimeResumeDocumentAnchor): number {
    if (anchor.fidelity === 'structure') return 3;
    if (anchor.fidelity === 'visual_structure') return 2;
    if (anchor.fidelity === 'summary') return 1;
    return 0;
}

function buildProjectStateAnchor(value: unknown): RuntimeResumeProjectStateAnchor | undefined {
    if (!isRecord(value)) return undefined;
    const versionHistory = Array.isArray(value.versionHistory) ? value.versionHistory : [];
    const productionTasks = Array.isArray(value.productionTasks) ? value.productionTasks : [];
    const lastVersion = isRecord(versionHistory[versionHistory.length - 1])
        ? versionHistory[versionHistory.length - 1]
        : {};
    const projectDigestInput = {
        schemaVersion: cleanToken(value.schemaVersion),
        projectId: cleanToken(value.projectId),
        taskType: cleanToken(value.taskType),
        canvasSize: isRecord(value.canvasSize)
            ? {
                width: finite(value.canvasSize.width),
                height: finite(value.canvasSize.height),
                preset: cleanToken(value.canvasSize.preset)
            }
            : undefined,
        updatedAt: String(value.updatedAt || '').slice(0, 40),
        versionCount: versionHistory.length,
        lastVersion: cleanToken(lastVersion.version),
        lastVersionTimestamp: String(lastVersion.timestamp || '').slice(0, 40),
        productionTaskStatuses: productionTasks.slice(0, 100).map((task) => (
            isRecord(task) ? cleanToken(task.status || 'pending') : ''
        ))
    };
    if (!projectDigestInput.schemaVersion && !projectDigestInput.projectId
        && !projectDigestInput.updatedAt && productionTasks.length === 0 && versionHistory.length === 0) {
        return undefined;
    }
    return {
        fingerprint: stableHash(projectDigestInput),
        schemaVersion: projectDigestInput.schemaVersion,
        hasUpdatedAt: Boolean(projectDigestInput.updatedAt),
        versionCount: versionHistory.length,
        productionTaskCount: productionTasks.length
    };
}

function resolveLatestProjectState(
    log: readonly RuntimeResumeToolLogEntry[],
    fallback: unknown
): unknown {
    for (let index = log.length - 1; index >= 0; index -= 1) {
        const entry = log[index];
        const name = String(entry.name || '').trim();
        if (name !== 'getDesignProjectState' && name !== 'updateDesignProjectState') continue;
        const result = isRecord(entry.result) ? entry.result : {};
        if (result.success === false) continue;
        const unwrapped = unwrapResult(result);
        if (isRecord(unwrapped.state)) return unwrapped.state;
        if (isRecord(unwrapped.data) && isRecord(unwrapped.data.state)) return unwrapped.data.state;
    }
    return fallback;
}

export function buildRuntimeResumeContextAnchor(input: {
    toolCallLog?: readonly RuntimeResumeToolLogEntry[];
    projectState?: unknown;
}): RuntimeResumeContextAnchor {
    const log = Array.isArray(input.toolCallLog) ? input.toolCallLog : [];
    let lastMutationIndex = -1;
    log.forEach((entry, index) => {
        const result = isRecord(entry.result) ? entry.result : {};
        if (result.success === false) return;
        if (classifyAgentToolExecution(String(entry.name || ''), entry.arguments) === 'photoshop_write') {
            lastMutationIndex = index;
        }
    });
    const candidates = log
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry, index }) => {
            const result = isRecord(entry.result) ? entry.result : {};
            return index > lastMutationIndex && result.success !== false;
        })
        .map(({ entry, index }) => ({ anchor: buildDocumentAnchor(entry), index }))
        .filter((item): item is { anchor: RuntimeResumeDocumentAnchor; index: number } => Boolean(item.anchor))
        .sort((a, b) => anchorStrength(b.anchor) - anchorStrength(a.anchor) || b.index - a.index);
    const document = candidates[0]?.anchor;
    const projectState = buildProjectStateAnchor(resolveLatestProjectState(log, input.projectState));
    return {
        version: 'runtime-resume-context-anchor/v0',
        ...(document ? { document } : {}),
        ...(projectState ? { projectState } : {}),
        boundaries: {
            digestOnly: true,
            containsLayerNames: false,
            containsRawLayers: false,
            containsImages: false,
            containsPaths: false,
            containsToolArguments: false,
            containsToolResults: false,
            categoryNeutral: true,
            grantsPermission: false,
            changesTaskResult: false
        }
    };
}

export function buildRuntimeResumeFreshnessProbeRequest(
    anchor: RuntimeResumeContextAnchor | undefined
): RuntimeResumeFreshnessProbeRequest | undefined {
    const source = anchor?.document?.source;
    if (source === 'layer_hierarchy') {
        return {
            source,
            toolName: 'getLayerHierarchy',
            arguments: { includeHidden: true, includeBounds: false, flatList: true },
            boundaries: { readOnly: true, executesWrites: false, blocksTaskOnFailure: false }
        };
    }
    if (source === 'annotated_snapshot') {
        return {
            source,
            toolName: 'getAnnotatedSnapshot',
            arguments: { includeHidden: false, layerFilter: 'visual' },
            boundaries: { readOnly: true, executesWrites: false, blocksTaskOnFailure: false }
        };
    }
    if (source === 'document_info') {
        return {
            source,
            toolName: 'getDocumentInfo',
            arguments: {},
            boundaries: { readOnly: true, executesWrites: false, blocksTaskOnFailure: false }
        };
    }
    return undefined;
}

function cleanStepIds(values: readonly unknown[]): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => /^[a-z][a-z0-9_-]{0,47}$/.test(value))))
        .slice(0, MAX_RESUME_STEP_IDS);
}

function cleanCompletedStepDescriptors(
    values: readonly unknown[],
    allowedStepIds: ReadonlySet<string>
): RuntimeResumeCompletedStepDescriptor[] {
    const descriptors: RuntimeResumeCompletedStepDescriptor[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (!isRecord(value)) continue;
        const stepId = String(value.stepId || '').trim();
        if (!allowedStepIds.has(stepId) || seen.has(stepId)) continue;
        seen.add(stepId);
        descriptors.push({
            stepId,
            kind: cleanToken(value.kind, 48),
            capabilityRefs: Array.isArray(value.capabilityRefs)
                ? Array.from(new Set(value.capabilityRefs.map((ref) => cleanToken(ref, 120)).filter(Boolean))).slice(0, 8)
                : [],
            observedOutcomes: Array.isArray(value.observedOutcomes)
                ? Array.from(new Set(value.observedOutcomes.map((ref) => cleanToken(ref, 80)).filter(Boolean))).slice(0, 8)
                : []
        });
        if (descriptors.length >= MAX_RESUME_STEP_IDS) break;
    }
    return descriptors;
}

export function evaluateRuntimeActionPlanResumeFreshness(input: {
    sourceRunId: string;
    previousAnchor?: RuntimeResumeContextAnchor;
    currentAnchor?: RuntimeResumeContextAnchor;
    completedStepIds?: readonly string[];
    completedStepDescriptors?: readonly unknown[];
    resumeStepIds?: readonly string[];
    probeSucceeded: boolean;
}): RuntimeActionPlanResumeFreshness {
    const completedStepIds = cleanStepIds(input.completedStepIds || []);
    const completedStepDescriptors = cleanCompletedStepDescriptors(
        input.completedStepDescriptors || [],
        new Set(completedStepIds)
    );
    const resumeStepIds = cleanStepIds(input.resumeStepIds || []);
    const reasons: string[] = [];
    let documentMatch: RuntimeActionPlanResumeFreshness['documentMatch'] = 'missing';
    let projectStateMatch: RuntimeActionPlanResumeFreshness['projectStateMatch'] = 'not_required';
    let status: RuntimeActionPlanResumeFreshness['status'];

    if (!input.probeSucceeded) {
        status = 'probe_failed';
        reasons.push('readonly_probe_failed');
    } else {
        const previousDocument = input.previousAnchor?.document;
        const currentDocument = input.currentAnchor?.document;
        const strongPrevious = previousDocument
            && ['structure', 'visual_structure'].includes(previousDocument.fidelity);
        if (!previousDocument || !currentDocument) {
            documentMatch = 'missing';
            reasons.push('document_anchor_missing');
        } else if (!strongPrevious || previousDocument.source !== currentDocument.source
            || previousDocument.fidelity !== currentDocument.fidelity) {
            documentMatch = 'insufficient';
            reasons.push('document_anchor_insufficient');
        } else if (previousDocument.fingerprint !== currentDocument.fingerprint) {
            documentMatch = 'mismatched';
            reasons.push('document_fingerprint_mismatch');
        } else {
            documentMatch = 'matched';
        }

        const previousProject = input.previousAnchor?.projectState;
        const currentProject = input.currentAnchor?.projectState;
        if (previousProject) {
            if (!currentProject) {
                projectStateMatch = 'missing';
                reasons.push('project_state_anchor_missing');
            } else if (previousProject.fingerprint !== currentProject.fingerprint) {
                projectStateMatch = 'mismatched';
                reasons.push('project_state_fingerprint_mismatch');
            } else {
                projectStateMatch = 'matched';
            }
        }

        if (documentMatch === 'mismatched' || projectStateMatch === 'mismatched') {
            status = 'mismatch';
        } else if (documentMatch !== 'matched'
            || (previousProject && projectStateMatch !== 'matched')) {
            status = 'insufficient_context';
        } else {
            status = 'verified';
        }
    }

    return {
        version: 'runtime-action-plan-resume-freshness/v0',
        sourceRunId: String(input.sourceRunId || '').slice(0, 100),
        status,
        documentMatch,
        projectStateMatch,
        verifiedCompletedStepIds: status === 'verified' ? completedStepIds : [],
        invalidatedCompletedStepIds: status === 'verified' ? [] : completedStepIds,
        verifiedCompletedSteps: status === 'verified' ? completedStepDescriptors : [],
        invalidatedCompletedSteps: status === 'verified' ? [] : completedStepDescriptors,
        verifiedResumeStepIds: status === 'verified' ? resumeStepIds : [],
        invalidatedResumeStepIds: status === 'verified' ? [] : resumeStepIds,
        reasons: reasons.slice(0, 12),
        boundaries: {
            observationOnly: true,
            advisoryOnly: true,
            taskRelatednessModelOwned: true,
            executesTools: false,
            executesWrites: false,
            blocksTask: false,
            autoSkipsSteps: false,
            autoRecoversSteps: false,
            schedulerAuthority: false,
            grantsPermission: false,
            countsAsTaskProgress: false,
            countsAsQualityPass: false
        }
    };
}
