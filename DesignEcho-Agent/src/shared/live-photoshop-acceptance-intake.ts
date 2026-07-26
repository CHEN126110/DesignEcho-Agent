export type LivePhotoshopAcceptanceIntakeVersion =
    'live-photoshop-acceptance-intake/v0';

export type LivePhotoshopAcceptanceIntakeStatus =
    | 'no_artifact'
    | 'artifact_without_live_mode'
    | 'needs_live_run'
    | 'snapshot_checks_ready'
    | 'focus_and_snapshot_checks_ready'
    | 'failed_or_blocked';

export interface BuildLivePhotoshopAcceptanceIntakeInput {
    artifact?: unknown;
    artifactExists?: boolean;
    relativePath?: string;
    generatedAt?: string;
}

export interface LivePhotoshopAcceptanceSnapshotCheck {
    hasBeforeSnapshot: boolean;
    hasAfterSnapshot: boolean;
    hasSnapshotDiff: boolean;
    changedLayerCount?: number;
}

export interface LivePhotoshopAcceptanceFocusResult {
    hasFocusToolEvent: boolean;
    hasFocusResult: boolean;
    exactViewportControlClaimed: boolean;
    focusBoundary: string;
}

export interface LivePhotoshopAcceptanceToolRunSummary {
    toolCount: number;
    successfulToolCount: number;
    failedToolCount: number;
    toolNames: string[];
}

export interface LivePhotoshopAcceptanceIntake {
    version: LivePhotoshopAcceptanceIntakeVersion;
    status: LivePhotoshopAcceptanceIntakeStatus;
    generatedAt: string;
    source: {
        relativePath?: string;
        exists: boolean;
        mode: string | null;
        success: boolean | null;
        skipped: boolean;
    };
    readOnly: true;
    userVisible: false;
    canClaimDesignQuality: false;
    mustNotRunLivePhotoshop: true;
    snapshotCheck: LivePhotoshopAcceptanceSnapshotCheck;
    focusResult: LivePhotoshopAcceptanceFocusResult;
    toolRunSummary: LivePhotoshopAcceptanceToolRunSummary;
    sourceRecords: string[];
    requiredNextChecks: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

const LIVE_MODES = new Set([
    'live-photoshop-preflight',
    'guarded-live-photoshop',
    'live-photoshop-disposable-document',
    'live-photoshop-deterministic-operations'
]);

const MAX_SCAN_DEPTH = 7;
const MAX_SCAN_ARRAY_ITEMS = 80;

export function buildLivePhotoshopAcceptanceIntake(
    input: BuildLivePhotoshopAcceptanceIntakeInput = {}
): LivePhotoshopAcceptanceIntake {
    const artifactExists = input.artifactExists ?? (input.artifact !== undefined && input.artifact !== null);
    const payload = unwrapArtifactPayload(input.artifact);
    const payloadRecord = toRecord(payload);
    const mode = stringOrNull(payloadRecord?.mode);
    const skipped = payloadRecord?.skipped === true;
    const success = typeof payloadRecord?.success === 'boolean' ? payloadRecord.success : null;
    const snapshotCheck = buildSnapshotCheck(payloadRecord);
    const focusResult = buildFocusResult(payloadRecord);
    const toolRunSummary = buildToolRunSummary(payloadRecord);
    const blockers = buildBlockers({
        artifactExists,
        payload: payloadRecord,
        focusResult,
        success
    });
    const status = resolveStatus({
        artifactExists,
        mode,
        skipped,
        success,
        snapshotCheck,
        focusResult,
        blockers
    });
    const requiredNextChecks = buildRequiredNextChecks({
        artifactExists,
        mode,
        skipped,
        snapshotCheck,
        focusResult
    });

    return {
        version: 'live-photoshop-acceptance-intake/v0',
        status,
        generatedAt: input.generatedAt || new Date().toISOString(),
        source: {
            relativePath: input.relativePath || relativePathFromArtifact(input.artifact),
            exists: artifactExists,
            mode,
            success,
            skipped
        },
        readOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        mustNotRunLivePhotoshop: true,
        snapshotCheck,
        focusResult,
        toolRunSummary,
        sourceRecords: buildSourceRecords({
            mode,
            snapshotCheck,
            focusResult,
            toolRunSummary,
            payload: payloadRecord
        }),
        requiredNextChecks,
        blockers,
        warnings: buildWarnings(status, requiredNextChecks),
        limitations: [
            'This intake reads an existing live Photoshop acceptance artifact only; it never launches Electron, providers, or Photoshop.',
            'Snapshot checks and focus results describe runtime observability, not design quality or reference fidelity.',
            'A focusLayer result must not be interpreted as exact Photoshop canvas pan or zoom control.',
            'This intake is hidden diagnostic context and must not be displayed as model reasoning.'
        ]
    };
}

export function hasLivePhotoshopAcceptanceChecksReady(
    intake: LivePhotoshopAcceptanceIntake
): boolean {
    return intake.status === 'snapshot_checks_ready'
        || intake.status === 'focus_and_snapshot_checks_ready';
}

function unwrapArtifactPayload(artifact: unknown): unknown {
    const record = toRecord(artifact);
    if (record && Object.prototype.hasOwnProperty.call(record, 'payload')) {
        return record.payload;
    }
    return artifact;
}

function relativePathFromArtifact(artifact: unknown): string | undefined {
    const record = toRecord(artifact);
    const relativePath = record?.relativePath;
    return typeof relativePath === 'string' ? relativePath : undefined;
}

function buildSnapshotCheck(payload: Record<string, unknown> | undefined): LivePhotoshopAcceptanceSnapshotCheck {
    const hasBeforeSnapshot = hasObjectAtKey(payload, 'beforeSnapshot')
        || hasObjectAtPath(payload, ['bundle', 'beforeSnapshot'])
        || hasObjectAtPath(payload, ['debug', 'bundle', 'beforeSnapshot']);
    const hasAfterSnapshot = hasObjectAtKey(payload, 'afterSnapshot')
        || hasObjectAtPath(payload, ['bundle', 'afterSnapshot'])
        || hasObjectAtPath(payload, ['debug', 'bundle', 'afterSnapshot']);
    const hasSnapshotDiff = hasObjectAtKey(payload, 'snapshotDiff')
        || caseCheckBoolean(payload, 'hasSnapshotDiff');
    const changedLayerCount = firstNumber([
        caseCheckNumber(payload, 'changedLayerCount'),
        numberAtPath(payload, ['bundle', 'snapshotDiff', 'summary', 'changed']),
        numberAtPath(payload, ['debug', 'bundle', 'snapshotDiff', 'summary', 'changed'])
    ]);

    return {
        hasBeforeSnapshot,
        hasAfterSnapshot,
        hasSnapshotDiff,
        changedLayerCount
    };
}

function buildFocusResult(payload: Record<string, unknown> | undefined): LivePhotoshopAcceptanceFocusResult {
    const toolNames = collectToolNames(payload);
    const hasFocusToolEvent = toolNames.includes('focusLayer')
        || liveAssertionNames(payload).some((name) => name.toLowerCase().includes('focus'));
    const hasFocusResult = hasFocusToolEvent
        || hasKeyDeep(payload, 'focusResult')
        || hasKeyDeep(payload, 'focusedLayer');

    return {
        hasFocusToolEvent,
        hasFocusResult,
        exactViewportControlClaimed: claimsExactViewportControl(payload),
        focusBoundary: 'focusLayer may select a layer, request makeVisible, bring Photoshop to front, and refresh UI, but it must not claim exact canvas pan or zoom control.'
    };
}

function buildToolRunSummary(payload: Record<string, unknown> | undefined): LivePhotoshopAcceptanceToolRunSummary {
    const toolEvents = collectToolEvents(payload);
    const toolNames = Array.from(new Set([
        ...toolEvents.map((event) => event.name).filter(Boolean),
        ...collectToolNames(payload)
    ])).sort();
    const caseToolCount = caseCheckNumber(payload, 'toolCount');
    const toolCount = toolEvents.length > 0
        ? toolEvents.length
        : caseToolCount ?? toolNames.length;
    const successfulToolCount = toolEvents.filter((event) => event.success === true).length;
    const failedToolCount = toolEvents.filter((event) => event.success === false).length;

    return {
        toolCount,
        successfulToolCount,
        failedToolCount,
        toolNames
    };
}

function buildBlockers(input: {
    artifactExists: boolean;
    payload: Record<string, unknown> | undefined;
    focusResult: LivePhotoshopAcceptanceFocusResult;
    success: boolean | null;
}): string[] {
    const blockers: string[] = [];
    if (!input.artifactExists) return blockers;

    const parseError = stringOrNull(input.payload?.parseError);
    const error = stringOrNull(input.payload?.error);
    if (parseError) blockers.push(`artifact_parse_error: ${shorten(parseError)}`);
    if (error) blockers.push(`artifact_error: ${shorten(error)}`);

    for (const blocker of arrayOfStrings(input.payload?.preflight && toRecord(input.payload.preflight)?.blockers)) {
        blockers.push(`preflight_blocker: ${shorten(blocker)}`);
    }
    for (const blocker of arrayOfStrings(input.payload?.preflight && toRecord(input.payload.preflight)?.takeoverBlockers)) {
        blockers.push(`takeover_blocker: ${shorten(blocker)}`);
    }
    for (const assertion of liveAssertionFailures(input.payload)) {
        blockers.push(`live_assertion_failed: ${shorten(assertion)}`);
    }

    if (input.focusResult.exactViewportControlClaimed) {
        blockers.push('focus_result_claims_exact_viewport_control');
    }
    if (input.success === false && blockers.length === 0) {
        blockers.push('artifact_success_false_without_specific_blocker');
    }
    return blockers;
}

function resolveStatus(input: {
    artifactExists: boolean;
    mode: string | null;
    skipped: boolean;
    success: boolean | null;
    snapshotCheck: LivePhotoshopAcceptanceSnapshotCheck;
    focusResult: LivePhotoshopAcceptanceFocusResult;
    blockers: string[];
}): LivePhotoshopAcceptanceIntakeStatus {
    if (!input.artifactExists) return 'no_artifact';
    if (!isLiveMode(input.mode)) return 'artifact_without_live_mode';
    if (input.skipped) return 'needs_live_run';
    if (input.blockers.length > 0 || input.success === false) return 'failed_or_blocked';

    const snapshotReady = isSnapshotCheckReady(input.snapshotCheck);
    if (snapshotReady && input.focusResult.hasFocusResult) {
        return 'focus_and_snapshot_checks_ready';
    }
    if (snapshotReady) return 'snapshot_checks_ready';
    return 'needs_live_run';
}

function buildRequiredNextChecks(input: {
    artifactExists: boolean;
    mode: string | null;
    skipped: boolean;
    snapshotCheck: LivePhotoshopAcceptanceSnapshotCheck;
    focusResult: LivePhotoshopAcceptanceFocusResult;
}): string[] {
    const required = new Set<string>();
    if (!input.artifactExists) {
        required.add('live_photoshop_acceptance_artifact_required');
    }
    if (input.artifactExists && !isLiveMode(input.mode)) {
        required.add('live_photoshop_acceptance_artifact_required');
    }
    if (input.skipped) {
        required.add('live_photoshop_takeover_run_required');
    }
    if (!isSnapshotCheckReady(input.snapshotCheck)) {
        required.add('before_after_snapshot_required');
    }
    if (!input.focusResult.hasFocusResult) {
        required.add('focus_tool_result_required');
    }
    required.add('manual_review_or_screenshot_required_for_design_quality');
    return Array.from(required);
}

function buildSourceRecords(input: {
    mode: string | null;
    snapshotCheck: LivePhotoshopAcceptanceSnapshotCheck;
    focusResult: LivePhotoshopAcceptanceFocusResult;
    toolRunSummary: LivePhotoshopAcceptanceToolRunSummary;
    payload: Record<string, unknown> | undefined;
}): string[] {
    const records: string[] = [];
    if (input.mode) records.push(`artifact_mode:${input.mode}`);
    if (input.snapshotCheck.hasBeforeSnapshot) records.push('before_snapshot');
    if (input.snapshotCheck.hasAfterSnapshot) records.push('after_snapshot');
    if (input.snapshotCheck.hasSnapshotDiff) records.push('snapshot_diff');
    if (input.focusResult.hasFocusToolEvent) records.push('focus_tool_event');
    if (input.focusResult.hasFocusResult) records.push('focus_result');
    if (input.toolRunSummary.toolCount > 0) records.push('tool_events');
    if (liveAssertionNames(input.payload).length > 0) records.push('live_assertions');
    return records;
}

function buildWarnings(
    status: LivePhotoshopAcceptanceIntakeStatus,
    requiredNextChecks: string[]
): string[] {
    const warnings: string[] = [];
    if (status === 'snapshot_checks_ready') {
        warnings.push('Snapshot checks are ready, but the focus result is missing or incomplete.');
    }
    if (requiredNextChecks.includes('manual_review_or_screenshot_required_for_design_quality')) {
        warnings.push('Design quality still requires screenshot, pixel, or manual review.');
    }
    return warnings;
}

function isSnapshotCheckReady(snapshotCheck: LivePhotoshopAcceptanceSnapshotCheck): boolean {
    return snapshotCheck.hasBeforeSnapshot
        && snapshotCheck.hasAfterSnapshot
        && snapshotCheck.hasSnapshotDiff;
}

function isLiveMode(mode: string | null): boolean {
    return Boolean(mode && LIVE_MODES.has(mode));
}

function caseCheckBoolean(payload: Record<string, unknown> | undefined, key: string): boolean {
    return caseCheckValues(payload, key).some((value) => value === true);
}

function caseCheckNumber(payload: Record<string, unknown> | undefined, key: string): number | undefined {
    return firstNumber(caseCheckValues(payload, key));
}

function caseCheckValues(payload: Record<string, unknown> | undefined, key: string): unknown[] {
    const values: unknown[] = [];
    for (const item of arrayOfRecords(payload?.cases)) {
        const checks = toRecord(item.checks);
        if (checks && Object.prototype.hasOwnProperty.call(checks, key)) {
            values.push(checks[key]);
        }
    }
    const report = toRecord(payload?.report);
    const reportChecks = toRecord(report?.checks);
    if (reportChecks && Object.prototype.hasOwnProperty.call(reportChecks, key)) {
        values.push(reportChecks[key]);
    }
    return values;
}

function collectToolEvents(value: unknown): Array<{ name: string; success?: boolean }> {
    const events: Array<{ name: string; success?: boolean }> = [];
    scanDeep(value, (record) => {
        const tools = Array.isArray(record.tools) ? record.tools : undefined;
        if (!tools) return;
        for (const item of tools.slice(0, MAX_SCAN_ARRAY_ITEMS)) {
            const tool = toRecord(item);
            const name = stringOrNull(tool?.name) || stringOrNull(tool?.toolName);
            if (!name) continue;
            events.push({
                name,
                success: typeof tool?.success === 'boolean' ? tool.success : undefined
            });
        }
    });
    return events;
}

function collectToolNames(value: unknown): string[] {
    const names = new Set<string>();
    for (const event of collectToolEvents(value)) {
        names.add(event.name);
    }
    scanDeep(value, (record) => {
        const name = stringOrNull(record.toolName) || stringOrNull(record.name);
        if (name && isToolLikeRecord(record)) {
            names.add(name);
        }
    });
    return Array.from(names);
}

function isToolLikeRecord(record: Record<string, unknown>): boolean {
    return Object.prototype.hasOwnProperty.call(record, 'toolName')
        || Object.prototype.hasOwnProperty.call(record, 'toolResult')
        || Object.prototype.hasOwnProperty.call(record, 'acceptanceStatus')
        || Object.prototype.hasOwnProperty.call(record, 'success');
}

function liveAssertionNames(payload: Record<string, unknown> | undefined): string[] {
    return arrayOfRecords(payload?.liveAssertions)
        .map((item) => stringOrNull(item.name))
        .filter((name): name is string => Boolean(name));
}

function liveAssertionFailures(payload: Record<string, unknown> | undefined): string[] {
    return arrayOfRecords(payload?.liveAssertions)
        .filter((item) => item.passed === false)
        .map((item) => stringOrNull(item.name) || 'unnamed-live-assertion');
}

function hasObjectAtKey(value: unknown, key: string): boolean {
    let found = false;
    scanDeep(value, (record) => {
        if (found) return;
        if (isRecord(record[key])) found = true;
    });
    return found;
}

function hasObjectAtPath(value: unknown, path: string[]): boolean {
    return isRecord(valueAtPath(value, path));
}

function hasKeyDeep(value: unknown, key: string): boolean {
    let found = false;
    scanDeep(value, (record) => {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            found = true;
        }
    });
    return found;
}

function claimsExactViewportControl(value: unknown): boolean {
    let claimed = false;
    scanDeep(value, (record) => {
        if (record.exactPanZoomSupported === true) claimed = true;
        if (record.pannedOrZoomed === true) claimed = true;
        if (record.exactViewportControl === true) claimed = true;
    });
    return claimed;
}

function scanDeep(
    value: unknown,
    visitor: (record: Record<string, unknown>) => void,
    depth = 0
): void {
    if (depth > MAX_SCAN_DEPTH) return;
    if (Array.isArray(value)) {
        for (const item of value.slice(0, MAX_SCAN_ARRAY_ITEMS)) {
            scanDeep(item, visitor, depth + 1);
        }
        return;
    }
    if (!isRecord(value)) return;

    visitor(value);
    for (const nested of Object.values(value)) {
        scanDeep(nested, visitor, depth + 1);
    }
}

function valueAtPath(value: unknown, path: string[]): unknown {
    let current = value;
    for (const item of path) {
        const record = toRecord(current);
        if (!record) return undefined;
        current = record[item];
    }
    return current;
}

function numberAtPath(value: unknown, path: string[]): number | undefined {
    const valueAtTarget = valueAtPath(value, path);
    return typeof valueAtTarget === 'number' && Number.isFinite(valueAtTarget)
        ? valueAtTarget
        : undefined;
}

function firstNumber(values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.map(toRecord).filter((item): item is Record<string, unknown> => Boolean(item));
}

function arrayOfStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value)) return undefined;
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shorten(value: string): string {
    const redacted = value.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '[redacted:data-uri]');
    return redacted.length > 220 ? `${redacted.slice(0, 217)}...` : redacted;
}
