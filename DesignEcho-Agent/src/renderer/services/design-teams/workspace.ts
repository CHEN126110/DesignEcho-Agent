/**
 * 团队共享工作区（黑板模式）
 *
 * 同一次自主 Agent 运行（或一次团队流水线）内，队友的产出自动沉淀在这里，
 * 后续队友的系统提示会注入前序成果摘要——队友之间不再依赖主模型手工转述。
 */

import type {
    DesignTeammateRole,
    DesignTeamMessageType,
    DesignTeamWorkspaceEntry
} from '../../../shared/types/design-team.types';

/** 注入系统提示的摘要总长上限（避免撑爆子 Agent 上下文） */
const MAX_DIGEST_CHARS = 6000;
/** 单条产出在摘要中的长度上限 */
const MAX_ENTRY_CHARS = 2000;

const STAGE_LABELS: Record<DesignTeamMessageType, string> = {
    scene_summary: '场景分析',
    market_research: '市场洞察',
    copy_strategy: '文案策略',
    design_plan: '设计计划',
    execution_report: '执行报告',
    review_report: '评审报告',
    revision_request: '修订要求',
    task_context: '任务上下文',
    task_status: '任务状态',
    model_dispatch_trace: '模型调度'
};

export class DesignTeamWorkspace {
    private readonly entries: DesignTeamWorkspaceEntry[] = [];

    record(entry: Omit<DesignTeamWorkspaceEntry, 'timestamp'>): void {
        this.entries.push({
            ...entry,
            content: String(entry.content || '').trim(),
            timestamp: new Date().toISOString()
        });
    }

    list(): DesignTeamWorkspaceEntry[] {
        return [...this.entries];
    }

    /** 最近一条指定类型的产出（如取最新设计计划） */
    latestOfType(outputType: DesignTeamMessageType): DesignTeamWorkspaceEntry | undefined {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].outputType === outputType && this.entries[i].success) {
                return this.entries[i];
            }
        }
        return undefined;
    }

    isEmpty(): boolean {
        return this.entries.length === 0;
    }

    /**
     * 生成注入后续队友系统提示的成果摘要。
     * 优先保留最新条目；超长条目截断并标注。
     */
    buildContextDigest(options?: { excludeRole?: DesignTeammateRole }): string {
        const visible = this.entries.filter(e => e.success && e.content);
        if (visible.length === 0) return '';

        const lines: string[] = ['## 团队已有成果（按时间先后）'];
        let budget = MAX_DIGEST_CHARS;

        for (const entry of visible) {
            if (options?.excludeRole && entry.role === options.excludeRole) continue;
            let content = entry.content;
            if (content.length > MAX_ENTRY_CHARS) {
                content = `${content.slice(0, MAX_ENTRY_CHARS)}…[已截断，原长 ${entry.content.length} 字符]`;
            }
            const block = `\n### [${STAGE_LABELS[entry.outputType] || entry.outputType}] ${entry.stage}（${entry.role}）\n${content}`;
            if (block.length > budget) {
                lines.push('\n（更早的成果因长度限制省略）');
                break;
            }
            lines.push(block);
            budget -= block.length;
        }

        return lines.length > 1 ? lines.join('\n') : '';
    }
}
