export type AgentDiagnosticRecordVersion = 'agent-diagnostic-record/v0';

export interface AgentDiagnosticRecord {
    version: AgentDiagnosticRecordVersion;
    recordKeys: string[];
    payloadRedacted: true;
    warnings: string[];
    detailPageSkillReadiness?: unknown;
    designAgentOs?: unknown;
    agentIntentDeliberationGate?: unknown;
    designPlannerContext?: unknown;
    businessVisualContext?: unknown;
    businessSkillImagePlacementVerificationIntake?: unknown;
    businessSkillExecutionPlanIntake?: unknown;
    agentResumableTaskContract?: unknown;
    agentResumeExecutionPolicy?: unknown;
    agentResumeContextGate?: unknown;
    agentResumeContextRefreshRun?: unknown;
    agentResumeReadonlyContextExecutor?: unknown;
    agentResumePlanning?: unknown;
    agentResumeExecutionGate?: unknown;
    agentResumeControlledExecutionRequest?: unknown;
    agentResumeControlledExecutionRunner?: unknown;
    mainImageQaReport?: unknown;
    mainImageExecutionAlignment?: unknown;
    mainImageScreenshotQa?: unknown;
    mainImageScreenshotProbeReadiness?: unknown;
    skuConfiguredExecutionPlan?: unknown;
    skuExecutionManifest?: unknown;
    skuExportReadback?: unknown;
    skuVisualReviewIntake?: unknown;
    skuColorCardImageProbeReview?: unknown;
    modelMediatedUserReplyUnavailable?: unknown;
}

const SUPPORTED_RECORD_KEYS = [
    'detailPageSkillReadiness',
    'designAgentOs',
    'agentIntentDeliberationGate',
    'designPlannerContext',
    'businessVisualContext',
    'businessSkillImagePlacementVerificationIntake',
    'businessSkillExecutionPlanIntake',
    'agentResumableTaskContract',
    'agentResumeExecutionPolicy',
    'agentResumeContextGate',
    'agentResumeContextRefreshRun',
    'agentResumeReadonlyContextExecutor',
    'agentResumePlanning',
    'agentResumeExecutionGate',
    'agentResumeControlledExecutionRequest',
    'agentResumeControlledExecutionRunner',
    'mainImageQaReport',
    'mainImageExecutionAlignment',
    'mainImageScreenshotQa',
    'mainImageScreenshotProbeReadiness',
    'skuConfiguredExecutionPlan',
    'skuExecutionManifest',
    'skuExportReadback',
    'skuVisualReviewIntake',
    'skuColorCardImageProbeReview',
    'modelMediatedUserReplyUnavailable'
] as const;

const REDACTED_VALUE = '[redacted]';
const MAX_OBJECT_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

type SupportedRecordKey = typeof SUPPORTED_RECORD_KEYS[number];

export function buildAgentDiagnosticRecord(data: unknown): AgentDiagnosticRecord | undefined {
    if (!isRecord(data)) return undefined;

    const record: AgentDiagnosticRecord = {
        version: 'agent-diagnostic-record/v0',
        recordKeys: [],
        payloadRedacted: true,
        warnings: []
    };

    for (const key of SUPPORTED_RECORD_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        const sanitized = sanitizeAgentDiagnosticValue(data[key]);
        if (sanitized === undefined) continue;
        (record as Record<SupportedRecordKey, unknown>)[key] = sanitized;
        record.recordKeys.push(key);
    }

    if (record.recordKeys.length === 0) return undefined;
    return record;
}

export function sanitizeAgentDiagnosticValue(value: unknown, depth = 0): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_OBJECT_DEPTH) return '[redacted:max-depth]';

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeAgentDiagnosticValue(item, depth + 1));
    }

    if (!isRecord(value)) return String(value);

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (isRawPayloadKey(key)) {
            output[key] = REDACTED_VALUE;
            continue;
        }
        const sanitized = sanitizeAgentDiagnosticValue(nestedValue, depth + 1);
        if (sanitized !== undefined) {
            output[key] = sanitized;
        }
    }
    return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRawPayloadKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized === 'payloadredacted' || normalized === 'rawpayloadredacted') return false;
    return normalized.includes('base64')
        || normalized.includes('imagedata')
        || normalized.includes('rawimage')
        || normalized.includes('rawpayload')
        || normalized.includes('binary')
        || normalized.includes('buffer');
}
