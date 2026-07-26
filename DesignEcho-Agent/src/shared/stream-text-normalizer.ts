export interface NormalizedStreamTextChunk {
    fullText: string;
    deltaText: string;
    mode: 'initial' | 'delta' | 'snapshot' | 'stale_snapshot';
}

/**
 * 把 Provider 可能返回的真增量或累计快照统一成同一种增量语义。
 *
 * OpenAI-compatible 接口并不总能保证 reasoning_content 是 token delta；
 * 部分实现会重复返回“到目前为止的完整文本”。所有流入口都使用本函数，
 * 避免某一层把累计快照再次 +=，形成前缀滚雪球。
 */
export function normalizeStreamTextChunk(
    accumulated: string,
    incoming: string
): NormalizedStreamTextChunk {
    const currentText = String(accumulated || '');
    const incomingText = String(incoming || '');
    if (!incomingText) {
        return {
            fullText: currentText,
            deltaText: '',
            mode: 'stale_snapshot'
        };
    }
    if (!currentText) {
        return {
            fullText: incomingText,
            deltaText: incomingText,
            mode: 'initial'
        };
    }
    if (incomingText.startsWith(currentText)) {
        return {
            fullText: incomingText,
            deltaText: incomingText.slice(currentText.length),
            mode: 'snapshot'
        };
    }
    if (currentText.startsWith(incomingText)) {
        return {
            fullText: currentText,
            deltaText: '',
            mode: 'stale_snapshot'
        };
    }
    return {
        fullText: currentText + incomingText,
        deltaText: incomingText,
        mode: 'delta'
    };
}
