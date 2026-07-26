export type VisibleThinkingStepSourceType =
    | 'thinking'
    | 'status'
    | 'tool_call'
    | 'tool_result'
    | 'decision'
    | 'reading'
    | 'exploring'
    | 'analyzing';

export type ThinkingStepDisplayRole =
    | 'reasoning'
    | 'decision'
    | 'observation'
    | 'agent'
    | 'action';

export interface ThinkingStepPresentationInput {
    type?: VisibleThinkingStepSourceType;
    toolName?: unknown;
    tone?: 'thought' | 'action';
}

export function resolveThinkingStepDisplayRole(
    input: ThinkingStepPresentationInput
): ThinkingStepDisplayRole {
    if (input.tone === 'action' || input.toolName || input.type === 'tool_call' || input.type === 'tool_result') {
        return 'action';
    }

    switch (input.type) {
        case 'decision':
            return 'decision';
        case 'reading':
        case 'exploring':
        case 'analyzing':
            return 'observation';
        case 'status':
            return 'agent';
        case 'thinking':
        default:
            return 'reasoning';
    }
}

export function resolveThinkingStepRoleLabel(
    role: ThinkingStepDisplayRole,
    sourceType?: VisibleThinkingStepSourceType
): string {
    if (role === 'action') return '执行';
    if (role === 'decision') return '判断';
    if (role === 'agent') return '说明';
    if (role === 'observation') {
        if (sourceType === 'reading') return '读取';
        if (sourceType === 'exploring') return '检索';
        return '观察';
    }
    return '思考';
}

// 过程区（思考/观察/执行）只做单行纯文本展示，不渲染 markdown。模型输出里的
// markdown 强调标记会裸露成字符、状态/装饰 emoji 会和时间线节点的状态重复成彩色噪音，
// 故在展示前统一剥离。注意：仅用于过程区——正式回复（TextBlock）仍走完整 markdown 渲染。
const PROCESS_TEXT_DECORATION_EMOJI =
    /[✅✔✓☑❌✗✖✘⚠✨⭐\u{1F389}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{1F534}\u{1F535}\u{1F4A1}\u{1F525}\u{1F6A8}\u{1F44D}\u{1F44C}\u{1F3AF}]️?/gu;

export function cleanInlineProcessText(text: string): string {
    return String(text || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(PROCESS_TEXT_DECORATION_EMOJI, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
