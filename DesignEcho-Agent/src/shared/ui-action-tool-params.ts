const SENSITIVE_UI_ACTION_TOOL_PARAM_KEYS = new Set([
    'adapter',
    'allowphotoshopwrites',
    'approvedliveadapterrun',
    'approvedliveexecution',
    'explicitprojectwriteapproval',
    'executiontarget',
    'liveexecutionapproved',
    'liveexecutionscope',
    'projectwriteapproval'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveUiActionToolParamKey(key: string): boolean {
    return SENSITIVE_UI_ACTION_TOOL_PARAM_KEYS.has(key.toLowerCase());
}

export function sanitizeUiActionToolParams(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeUiActionToolParams(item));
    }

    if (!isRecord(value)) {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (isSensitiveUiActionToolParamKey(key)) continue;
        output[key] = sanitizeUiActionToolParams(child);
    }
    return output;
}
