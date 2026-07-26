export interface AgentExecutionActivitySummaryLike {
    businessActionCount?: unknown;
    toolCallCount?: unknown;
    successfulToolCalls?: unknown;
    failedToolCalls?: unknown;
    summaryText?: unknown;
}

export interface AgentExecutionBusinessActivityCounts {
    total: number;
    completed: number;
    failed: number;
    breakdownAvailable: boolean;
}

function readOptionalCount(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return undefined;
    return Math.floor(count);
}

function readSummaryTextCount(value: unknown, pattern: RegExp): number | undefined {
    const match = String(value || '').match(pattern);
    return readOptionalCount(match?.[1]);
}

function resolveDeclaredTotal(summary: AgentExecutionActivitySummaryLike): number {
    const businessTotal = readOptionalCount(summary.businessActionCount);
    if (businessTotal !== undefined) return businessTotal;
    return readOptionalCount(summary.toolCallCount) || 0;
}

/**
 * 新记录使用结构化成功/失败分桶；旧记录可从标准摘要文本恢复。
 * 若只有总数而没有可靠分桶，则保留总数并显式标记明细缺失，不猜测完成或失败数量。
 */
export function resolveAgentExecutionBusinessActivityCounts(
    summary: AgentExecutionActivitySummaryLike | undefined
): AgentExecutionBusinessActivityCounts {
    if (!summary) {
        return { total: 0, completed: 0, failed: 0, breakdownAvailable: false };
    }
    const structuredCompleted = readOptionalCount(summary.successfulToolCalls);
    const structuredFailed = readOptionalCount(summary.failedToolCalls);
    const textCompleted = readSummaryTextCount(summary.summaryText, /(\d+)\s*项已处理/u);
    const textFailed = readSummaryTextCount(summary.summaryText, /(\d+)\s*项未完成/u);
    const completed = structuredCompleted ?? textCompleted;
    const failed = structuredFailed ?? textFailed;
    if (completed !== undefined && failed !== undefined) {
        return {
            total: completed + failed,
            completed,
            failed,
            breakdownAvailable: true
        };
    }
    return {
        total: Math.max(resolveDeclaredTotal(summary), completed || 0, failed || 0),
        completed: completed || 0,
        failed: failed || 0,
        breakdownAvailable: false
    };
}

export function normalizeAgentExecutionSummaryText(
    value: unknown,
    counts: AgentExecutionBusinessActivityCounts
): string {
    let normalized = String(value || '').trim();
    if (!normalized) return '';
    normalized = normalized.replace(/共处理\s*\d+\s*项/u, `共处理 ${counts.total} 项`);
    if (counts.breakdownAvailable) {
        return normalized
            .replace(/\d+\s*项已处理/u, `${counts.completed} 项已处理`)
            .replace(/\d+\s*项未完成/u, `${counts.failed} 项未完成`);
    }
    normalized = normalized
        .replace(/[，,]?\s*\d+\s*项已处理/u, '')
        .replace(/[，,]?\s*\d+\s*项未完成/u, '')
        .replace(/，。/gu, '。')
        .trim();
    if (counts.total <= 0 || normalized.includes('完成明细未记录')) return normalized;
    return `${normalized.replace(/[。.]$/u, '')}，完成明细未记录。`;
}
