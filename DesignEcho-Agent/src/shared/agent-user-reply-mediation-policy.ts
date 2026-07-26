export type ModelMediatedUserReplyKind =
    | 'assistant_speech'
    | 'status_notice'
    | 'tool_summary'
    | 'blocker_notice'
    | 'test_fixture';

export interface RequiresModelMediatedUserReplyInput {
    skillId?: string;
    success?: boolean;
    userVisibleKind?: ModelMediatedUserReplyKind;
}

export interface BuildModelMediatedSkillReplyMessagesInput {
    userInput?: string;
    skillId?: string;
    skillResultMessage?: string;
    resultData?: unknown;
}

const MODEL_MEDIATED_DESIGN_SKILL_IDS = new Set([
    'project-image-analysis',
    'sku-batch',
    'main-image-design',
    'detail-page-design',
    'ecommerce-socks-design',
    'layout-replication',
    'visual-analysis'
]);

function cleanText(value: unknown, maxLength = 1200): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function safeStringifyResult(value: unknown, maxLength = 3000): string {
    if (value === undefined || value === null) return '';
    const seen = new WeakSet<object>();
    try {
        const text = JSON.stringify(value, (key, innerValue) => {
            const normalizedKey = String(key || '').toLowerCase();
            if (/(base64|imagedata|dataurl|raw|pixel|buffer|binary)/i.test(normalizedKey)) {
                return '[binary-redacted]';
            }
            if (typeof innerValue === 'string') return cleanText(innerValue, 500);
            if (innerValue && typeof innerValue === 'object') {
                if (seen.has(innerValue)) return '[circular-redacted]';
                seen.add(innerValue);
            }
            return innerValue;
        });
        return cleanText(text, maxLength);
    } catch {
        return cleanText(value, maxLength);
    }
}

export function requiresModelMediatedUserReply(input: RequiresModelMediatedUserReplyInput): boolean {
    if (input.success !== true) return false;
    if (input.userVisibleKind && input.userVisibleKind !== 'tool_summary') return false;
    const skillId = cleanText(input.skillId, 80);
    return MODEL_MEDIATED_DESIGN_SKILL_IDS.has(skillId);
}

export function buildModelMediatedSkillReplyMessages(
    input: BuildModelMediatedSkillReplyMessagesInput
): Array<{ role: 'system' | 'user'; content: string }> {
    const userInput = cleanText(input.userInput, 800) || '用户没有提供额外文字。';
    const skillId = cleanText(input.skillId, 80) || 'unknown-skill';
    const skillResultMessage = cleanText(input.skillResultMessage, 1600) || '工具没有返回可读摘要。';
    const resultData = safeStringifyResult(input.resultData, 3000);

    return [
        {
            role: 'system',
            content: [
                '你是主 Agent，也是面向用户说话的设计师。',
                '下面的工具结果只给你参考，不能直接当成用户回复。',
                '请基于实际结果输出自然中文：先说你观察到了什么，再说你的判断、建议或下一步。',
                '不要把工具日志逐条复述，不要说“脚本已经完成”来代替自己的判断。',
                '如果当前结果不足，只说明不足和你下一步会如何继续查看或检查；不要编造没有看到的画面或素材。'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                `用户请求：${userInput}`,
                `已调用能力：${skillId}`,
                `工具结果：${skillResultMessage}`,
                resultData ? `结构化结果摘要：${resultData}` : '',
                '请输出给用户看的回复，不要输出 JSON。'
            ].filter(Boolean).join('\n')
        }
    ];
}
