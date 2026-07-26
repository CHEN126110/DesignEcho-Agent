export type EagleWritebackGateVersion = 'eagle-writeback-gate/v0';
export type EagleWritebackSource =
    | 'manual_review'
    | 'eagle_visual_case_index'
    | 'model_suggestion'
    | 'acceptance_record'
    | 'user_preference';

export type EagleWritebackAction =
    | 'add_tags'
    | 'remove_tags'
    | 'update_annotation'
    | 'set_rating'
    | 'add_to_folders'
    | 'remove_from_folders'
    | 'delete_item'
    | 'move_to_trash'
    | 'merge_tags'
    | 'delete_tag'
    | 'unknown';

export type EagleWritebackGateStatus =
    | 'blocked_pending_user_confirmation'
    | 'blocked_no_actions'
    | 'blocked_invalid_action'
    | 'blocked_dangerous_action'
    | 'blocked_bulk_writeback_requires_separate_review'
    | 'blocked_unsafe_payload'
    | 'ready_for_manual_writeback';

export type EagleWritebackToolName =
    | 'item_add_tags'
    | 'item_remove_tags'
    | 'item_update'
    | 'item_add_to_folders'
    | 'item_remove_from_folders';

export const EAGLE_WRITEBACK_GATE_VERSION: EagleWritebackGateVersion = 'eagle-writeback-gate/v0';
export const EAGLE_WRITEBACK_BULK_LIMIT = 50;

export interface EagleWritebackCaseReference {
    caseId?: unknown;
    source?: {
        provider?: unknown;
        itemId?: unknown;
        knowledgeResultId?: unknown;
        filePath?: unknown;
        thumbnailPath?: unknown;
    };
    asset?: {
        name?: unknown;
        tags?: unknown;
        folders?: unknown;
        annotation?: unknown;
        width?: unknown;
        height?: unknown;
    };
}

export interface EagleWritebackProposedAction {
    action: EagleWritebackAction | string;
    itemId?: unknown;
    tags?: unknown;
    folders?: unknown;
    annotation?: unknown;
    rating?: unknown;
    reason?: unknown;
}

export interface EagleWritebackGateInput {
    requestedBy?: unknown;
    source?: EagleWritebackSource | string;
    userConfirmed?: boolean;
    cases?: EagleWritebackCaseReference[];
    proposedActions?: EagleWritebackProposedAction[];
    bulkLimit?: number;
    generatedAt?: unknown;
}

export interface EagleWritebackGateBoundary {
    readonly: true;
    requiresUserConfirmation: true;
    doesNotExecuteEagleWrites: true;
    doesNotRunPhotoshop: true;
    doesNotReturnRawImages: true;
    blocksDangerousBulkOperations: true;
}

export interface EagleWritebackPlanOperation {
    planId: string;
    itemId: string;
    action: Exclude<EagleWritebackAction, 'delete_item' | 'move_to_trash' | 'merge_tags' | 'delete_tag' | 'unknown'>;
    eagleTool: EagleWritebackToolName;
    paramsPreview: Record<string, unknown>;
    reason: string;
    sourceCaseIds: string[];
    execution: 'manual_or_confirmed_external_write_only';
}

export interface EagleWritebackGate {
    version: EagleWritebackGateVersion;
    status: EagleWritebackGateStatus;
    canExecute: false;
    source: string;
    requestedBy: string;
    generatedAt?: string;
    proposedActionCount: number;
    targetItemCount: number;
    writebackPlan: EagleWritebackPlanOperation[];
    blockers: string[];
    warnings: string[];
    auditTrail: string[];
    boundaries: EagleWritebackGateBoundary;
}

const SAFE_ACTION_TO_TOOL: Record<string, EagleWritebackToolName> = {
    add_tags: 'item_add_tags',
    remove_tags: 'item_remove_tags',
    update_annotation: 'item_update',
    set_rating: 'item_update',
    add_to_folders: 'item_add_to_folders',
    remove_from_folders: 'item_remove_from_folders'
};

const DANGEROUS_ACTIONS = new Set([
    'delete_item',
    'move_to_trash',
    'merge_tags',
    'delete_tag'
]);

const RAW_IMAGE_PATTERNS = [
    'data:image',
    ';base64,',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"'
];

export function buildEagleWritebackGateBoundary(): EagleWritebackGateBoundary {
    return {
        readonly: true,
        requiresUserConfirmation: true,
        doesNotExecuteEagleWrites: true,
        doesNotRunPhotoshop: true,
        doesNotReturnRawImages: true,
        blocksDangerousBulkOperations: true
    };
}

export function buildEagleWritebackGate(input: EagleWritebackGateInput = {}): EagleWritebackGate {
    const requestedBy = sanitizeText(input.requestedBy) || 'unknown';
    const source = sanitizeText(input.source) || 'unknown';
    const generatedAt = sanitizeText(input.generatedAt);
    const cases = Array.isArray(input.cases) ? input.cases : [];
    const proposedActions = Array.isArray(input.proposedActions) ? input.proposedActions : [];
    const bulkLimit = normalizeBulkLimit(input.bulkLimit);
    const unsafePayload = containsRawImageSignal(input);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const auditTrail = [
        `source:${source}`,
        `requestedBy:${requestedBy}`,
        `userConfirmed:${input.userConfirmed === true ? 'true' : 'false'}`
    ];

    if (unsafePayload) blockers.push('unsafe_raw_image_payload');
    if (proposedActions.length === 0) blockers.push('no_writeback_actions');
    if (proposedActions.length > bulkLimit) blockers.push('bulk_writeback_limit_exceeded');
    if (proposedActions.some((action) => DANGEROUS_ACTIONS.has(normalizeAction(action.action)))) {
        blockers.push('dangerous_writeback_action');
    }
    if (proposedActions.some((action) => !isKnownAction(action.action))) {
        blockers.push('invalid_writeback_action');
    }

    const missingItemActions = proposedActions.filter((action) => !sanitizeText(action.itemId));
    if (missingItemActions.length > 0) blockers.push('missing_eagle_item_id');

    const sourceCaseIdsByItem = buildSourceCaseIdMap(cases);
    if (!input.userConfirmed) blockers.push('missing_user_confirmation');

    const status = resolveStatus(blockers);
    const writebackPlan = status === 'ready_for_manual_writeback'
        ? proposedActions.map((action, index) => buildPlanOperation(action, index, sourceCaseIdsByItem))
        : [];

    if (status === 'ready_for_manual_writeback') {
        warnings.push('Eagle writeback gate only creates a manual or separately confirmed writeback plan; it does not execute writes.');
    }

    const gate: EagleWritebackGate = {
        version: EAGLE_WRITEBACK_GATE_VERSION,
        status,
        canExecute: false,
        source,
        requestedBy,
        generatedAt: generatedAt || undefined,
        proposedActionCount: proposedActions.length,
        targetItemCount: new Set(proposedActions.map((action) => sanitizeText(action.itemId)).filter(Boolean)).size,
        writebackPlan,
        blockers: uniqueStrings(blockers),
        warnings: uniqueStrings(warnings),
        auditTrail,
        boundaries: buildEagleWritebackGateBoundary()
    };

    return sanitizeGate(gate);
}

export function isEagleWritebackGatePayloadSafe(value: unknown): boolean {
    return !containsRawImageSignal(value);
}

function resolveStatus(blockers: string[]): EagleWritebackGateStatus {
    if (blockers.includes('unsafe_raw_image_payload')) return 'blocked_unsafe_payload';
    if (blockers.includes('dangerous_writeback_action')) return 'blocked_dangerous_action';
    if (blockers.includes('bulk_writeback_limit_exceeded')) return 'blocked_bulk_writeback_requires_separate_review';
    if (blockers.includes('invalid_writeback_action') || blockers.includes('missing_eagle_item_id')) return 'blocked_invalid_action';
    if (blockers.includes('no_writeback_actions')) return 'blocked_no_actions';
    if (blockers.includes('missing_user_confirmation')) return 'blocked_pending_user_confirmation';
    return 'ready_for_manual_writeback';
}

function buildPlanOperation(
    action: EagleWritebackProposedAction,
    index: number,
    sourceCaseIdsByItem: Map<string, string[]>
): EagleWritebackPlanOperation {
    const normalizedAction = normalizeAction(action.action) as EagleWritebackPlanOperation['action'];
    const itemId = sanitizeText(action.itemId);
    return {
        planId: `eagle-writeback:${itemId}:${normalizedAction}:${index + 1}`,
        itemId,
        action: normalizedAction,
        eagleTool: SAFE_ACTION_TO_TOOL[normalizedAction],
        paramsPreview: buildParamsPreview(normalizedAction, action),
        reason: sanitizeText(action.reason) || 'User confirmed Eagle metadata update.',
        sourceCaseIds: sourceCaseIdsByItem.get(itemId) || [],
        execution: 'manual_or_confirmed_external_write_only'
    };
}

function buildParamsPreview(action: EagleWritebackPlanOperation['action'], proposed: EagleWritebackProposedAction): Record<string, unknown> {
    switch (action) {
        case 'add_tags':
        case 'remove_tags':
            return { tags: normalizeStringArray(proposed.tags).slice(0, 20) };
        case 'add_to_folders':
        case 'remove_from_folders':
            return { folders: normalizeStringArray(proposed.folders).slice(0, 20) };
        case 'update_annotation':
            return { annotation: sanitizeText(proposed.annotation).slice(0, 500) };
        case 'set_rating':
            return { rating: normalizeRating(proposed.rating) };
        default:
            return {};
    }
}

function buildSourceCaseIdMap(cases: EagleWritebackCaseReference[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const item of cases) {
        const itemId = sanitizeText(item?.source?.itemId);
        if (!itemId) continue;
        const caseId = sanitizeText(item.caseId) || `eagle-case:${itemId}`;
        const existing = result.get(itemId) || [];
        result.set(itemId, uniqueStrings([...existing, caseId]));
    }
    return result;
}

function sanitizeGate(gate: EagleWritebackGate): EagleWritebackGate {
    return JSON.parse(JSON.stringify(gate), (_key, value) => {
        if (typeof value === 'string') return sanitizeText(value);
        return value;
    }) as EagleWritebackGate;
}

function normalizeAction(value: unknown): string {
    return sanitizeText(value).toLowerCase();
}

function isKnownAction(value: unknown): boolean {
    const action = normalizeAction(value);
    return Boolean(SAFE_ACTION_TO_TOOL[action]) || DANGEROUS_ACTIONS.has(action);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return uniqueStrings(value.map(sanitizeText).filter(Boolean));
}

function normalizeRating(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(5, Math.round(parsed)));
}

function normalizeBulkLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return EAGLE_WRITEBACK_BULK_LIMIT;
    return Math.max(1, Math.min(EAGLE_WRITEBACK_BULK_LIMIT, Math.floor(parsed)));
}

function sanitizeText(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of RAW_IMAGE_PATTERNS) {
        text = text.split(pattern).join('[redacted-image-payload]');
    }
    return text;
}

function containsRawImageSignal(value: unknown): boolean {
    const text = typeof value === 'string' ? value : JSON.stringify(value || '');
    return RAW_IMAGE_PATTERNS.some((pattern) => text.includes(pattern));
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(sanitizeText).filter(Boolean)));
}
