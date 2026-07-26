export interface BusinessSkillVisualObservationRefreshRuntimeCapabilities {
    canAnalyze: boolean;
    canWriteCache: boolean;
}

export function detectBusinessSkillVisualObservationRefreshRuntime(): BusinessSkillVisualObservationRefreshRuntimeCapabilities {
    const api = getDesignEchoRuntimeApi();
    return {
        canAnalyze: typeof api?.analyzeAssetContent === 'function',
        canWriteCache: typeof api?.writeProjectVisualInsightCache === 'function'
    };
}

function getDesignEchoRuntimeApi(): any {
    if (typeof window !== 'undefined') {
        return (window as any)?.designEcho;
    }
    return (globalThis as any)?.window?.designEcho;
}
