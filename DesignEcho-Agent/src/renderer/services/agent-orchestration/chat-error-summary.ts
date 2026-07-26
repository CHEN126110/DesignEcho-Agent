export interface ChatErrorSummaryOptions {
    isCloud?: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\b[A-Za-z0-9_+/-]{24,}\.[A-Za-z0-9_+/-]{12,}\.[A-Za-z0-9_+/-]{12,}\b/g,
    /\b(api[_-]?key|token|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi
];

export function redactSecretLikeText(text: string): string {
    let redacted = text;
    for (const pattern of SECRET_PATTERNS) {
        redacted = redacted.replace(pattern, (match) => {
            const key = match.split(/[:=]/)[0];
            if (/api[_-]?key|token|authorization/i.test(key)) {
                return `${key}: [redacted]`;
            }
            return '[redacted]';
        });
    }
    return redacted;
}

export function compactChatError(error: unknown, maxLength = 260): string {
    const raw = redactSecretLikeText(error instanceof Error ? error.message : String(error || '')).trim();
    if (!raw) return '';

    const normalized = raw
        .replace(/\s+/g, ' ')
        .replace(/\[\{"@type".*$/u, '')
        .replace(/\{"error":\{.*?"message"\s*:\s*"([^"]+)".*$/u, '$1')
        .trim();

    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function summarizeChatError(error: unknown, options: ChatErrorSummaryOptions = {}): string {
    const compact = compactChatError(error);
    const lower = compact.toLowerCase();

    if (/429|too many requests|quota|rate.?limit|retry in|resource_exhausted/i.test(compact)) {
        return compact
            ? `⚠️ 模型额度或限流已触发：${compact}`
            : '⚠️ 模型额度或限流已触发，请稍后重试或切换模型。';
    }

    if (/api key|unauthorized|forbidden|\b401\b|\b403\b|authentication/i.test(compact)) {
        return compact
            ? `⚠️ API 密钥或账号权限错误：${compact}`
            : '⚠️ API 密钥或账号权限错误，请检查设置。';
    }

    if (lower.includes('google') || lower.includes('gemini')) {
        return compact
            ? `⚠️ Google / Gemini 调用失败：${compact}`
            : '⚠️ Google / Gemini 调用失败，请检查模型、额度和网络。';
    }

    if (lower.includes('ollama') || lower.includes('localhost:11434')) {
        return '⚠️ 无法连接到 Ollama，请确保服务已启动。';
    }

    if (lower.includes('fetch') && options.isCloud) {
        return compact
            ? `⚠️ 无法连接到云端 AI 服务：${compact}`
            : '⚠️ 无法连接到云端 AI 服务，请检查网络和 API 密钥。';
    }

    if (lower.includes('fetch') && !options.isCloud) {
        return '⚠️ 无法连接到 AI 模型。请确保 Ollama 正在运行，或切换到云端模式。';
    }

    return compact ? `抱歉，处理时出错了：${compact}` : '抱歉，处理时出错了。';
}
