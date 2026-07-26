/**
 * 队友产出 → Design Project State 写穿映射
 *
 * 映射关系定义在 design-teams 层（不在 Agent 运行时）：
 * - design_plan（design-strategist）→ state.layoutPlan
 * - review_report（critic）→ state.reviewResult（含结构化裁决解析）
 * - execution_report（executor）→ state.versionHistory 追加一条版本记录
 * 其余产出类型暂不写穿（A2/A3/A4 字段在 DPS-2 角色补齐后接入）。
 *
 * 写穿失败只记录告警，不阻断团队任务（State 是记忆，不是关键路径）。
 */

import type {
    DesignCriticVerdict,
    DesignTeammateRole,
    DesignTeamPipelineStageRecord,
    DesignTeamMessageType
} from '../../../shared/types/design-team.types';
import type {
    DesignProjectCopywritingItem,
    DesignProjectStatePatch
} from '../../../shared/types/design-project-state.types';
import { parseCriticVerdict } from '../../../shared/design-team-verdict';

const MAX_LAYOUT_PLAN_CHARS = 4000;
const MAX_REVIEW_SUMMARY_CHARS = 2000;
const MAX_VERSION_REASON_CHARS = 200;
const MAX_NOTE_CHARS = 800;
const MAX_LIST_ITEMS = 12;
const MAX_LEARNING_CHARS = 1200;

export interface TeammateOutputForSync {
    role: DesignTeammateRole;
    outputType: DesignTeamMessageType;
    stage: string;
    success: boolean;
    content: string;
}

export interface PipelineRetrospectiveForSync {
    goal: string;
    stages: DesignTeamPipelineStageRecord[];
    verdict?: DesignCriticVerdict;
    revisionRounds: number;
    revisionNotes?: string[];
}

function capText(value: unknown, max: number): string {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…[已截断]`;
}

function extractJsonObjectCandidates(text: string): string[] {
    const candidates: string[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let j = i; j < text.length; j++) {
            const ch = text[j];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
            } else if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    candidates.push(text.slice(i, j + 1));
                    i = j;
                    break;
                }
            }
        }
    }
    return candidates;
}

function parseLastJsonObject(text: string): any | null {
    const candidates = extractJsonObjectCandidates(text);
    for (let i = candidates.length - 1; i >= 0; i--) {
        try {
            const parsed = JSON.parse(candidates[i]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            // 尝试上一个候选
        }
    }
    return null;
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => capText(item, MAX_NOTE_CHARS))
        .filter(Boolean)
        .slice(0, MAX_LIST_ITEMS);
}

function normalizeCopywritingItems(value: unknown): DesignProjectCopywritingItem[] {
    if (!Array.isArray(value)) return [];
    const items: DesignProjectCopywritingItem[] = [];
    for (const raw of value) {
        if (typeof raw === 'string') {
            const text = capText(raw, MAX_NOTE_CHARS);
            if (text) items.push({ slot: '文案方案', text });
            continue;
        }
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const text = capText(item.text ?? item.copy ?? item.content, MAX_NOTE_CHARS);
        if (!text) continue;
        items.push({
            slot: capText(item.slot ?? item.name ?? '文案方案', 80),
            text,
            ...(item.basis ? { basis: capText(item.basis, 200) } : {})
        });
    }
    return items.slice(0, MAX_LIST_ITEMS);
}

export function buildStatePatchForTeammateOutput(output: TeammateOutputForSync): DesignProjectStatePatch | null {
    if (!output.success) return null;
    const content = String(output.content || '').trim();
    if (!content) return null;
    const updatedBy = `design-team:${output.role}:${output.stage}`;

    if (output.outputType === 'design_plan') {
        return {
            set: {
                layoutPlan: content.length > MAX_LAYOUT_PLAN_CHARS
                    ? `${content.slice(0, MAX_LAYOUT_PLAN_CHARS)}…[已截断]`
                    : content
            },
            updatedBy
        };
    }

    if (output.outputType === 'market_research') {
        const parsed = parseLastJsonObject(content);
        const painPoints = normalizeStringList(parsed?.painPoints ?? parsed?.pain_points);
        const competitorNotes = normalizeStringList(parsed?.competitorNotes ?? parsed?.competitor_notes);
        const set: NonNullable<DesignProjectStatePatch['set']> = {};
        if (painPoints.length) set.painPoints = painPoints;
        set.competitorNotes = competitorNotes.length
            ? competitorNotes
            : [capText(content, MAX_NOTE_CHARS)];
        return { set, updatedBy };
    }

    if (output.outputType === 'copy_strategy') {
        const parsed = parseLastJsonObject(content);
        const sellingPoints = normalizeStringList(parsed?.sellingPoints ?? parsed?.selling_points);
        const copywriting = normalizeCopywritingItems(parsed?.copywriting ?? parsed?.copy);
        const set: NonNullable<DesignProjectStatePatch['set']> = {};
        set.copywriting = copywriting.length
            ? copywriting
            : [{ slot: '文案策略摘要', text: capText(content, MAX_NOTE_CHARS) }];
        return {
            set,
            ...(sellingPoints.length > 0 ? {
                upsertFacts: sellingPoints.map((statement) => ({
                    claimType: 'selling_point' as const,
                    statement,
                    source: {
                        kind: 'agent_inference' as const,
                        sourceRef: `team-output:${output.role}`
                    }
                })),
                factWriteAuthority: 'agent_proposal' as const
            } : {}),
            updatedBy
        };
    }

    if (output.outputType === 'review_report') {
        const verdict = parseCriticVerdict(content);
        return {
            set: {
                reviewResult: {
                    verdict: verdict.status,
                    summary: verdict.reviewText.length > MAX_REVIEW_SUMMARY_CHARS
                        ? `${verdict.reviewText.slice(0, MAX_REVIEW_SUMMARY_CHARS)}…[已截断]`
                        : verdict.reviewText,
                    issues: verdict.issues,
                    reviewedAt: new Date().toISOString()
                }
            },
            updatedBy
        };
    }

    if (output.outputType === 'execution_report') {
        const firstLine = content.split('\n').map(l => l.trim()).find(Boolean) || '执行完成';
        return {
            appendVersion: {
                reason: firstLine.length > MAX_VERSION_REASON_CHARS
                    ? `${firstLine.slice(0, MAX_VERSION_REASON_CHARS)}…`
                    : firstLine
            },
            updatedBy
        };
    }

    return null;
}

export function buildPipelineRetrospectiveStatePatch(
    input: PipelineRetrospectiveForSync
): DesignProjectStatePatch | null {
    const goal = capText(input.goal, 180);
    if (!goal) return null;
    const successfulStages = input.stages.filter((stage) => stage.success);
    if (successfulStages.length === 0) return null;

    const verdictText = input.verdict?.status === 'pass'
        ? '评审通过'
        : input.verdict?.status === 'needs_fix'
            ? `评审仍有 ${input.verdict.issues.length} 个待改进项`
            : input.verdict?.status === 'unparseable'
                ? '评审已完成但未提供机读裁决'
                : '未进入评审';

    const latestExecution = [...successfulStages]
        .reverse()
        .find((stage) => stage.role === 'executor');
    const executionSummary = latestExecution?.message
        ? capText(latestExecution.message.split('\n').map((line) => line.trim()).find(Boolean), 220)
        : '';
    const revisionSummary = input.revisionRounds > 0
        ? `发生 ${input.revisionRounds} 轮修订；退回原因：${(input.revisionNotes || []).map((item) => capText(item, 260)).filter(Boolean).join(' / ') || '评审要求返工'}`
        : '未发生评审退回';

    const note = [
        `目标「${goal}」${verdictText}`,
        revisionSummary,
        executionSummary ? `最终执行：${executionSummary}` : ''
    ].filter(Boolean).join('。');

    return {
        appendLearning: capText(note, MAX_LEARNING_CHARS),
        updatedBy: 'design-team:pipeline-retrospective'
    };
}

/** 把队友产出写穿到项目状态；失败不抛错 */
export async function syncTeammateOutputToDesignState(
    projectPath: string | undefined,
    output: TeammateOutputForSync
): Promise<void> {
    if (!projectPath) return;
    const patch = buildStatePatchForTeammateOutput(output);
    if (!patch) return;
    try {
        await (window as any).designEcho?.updateDesignState?.(projectPath, patch);
    } catch (error: any) {
        console.warn(`[DesignTeams] 状态写穿失败（${output.stage}/${output.role}）：${error?.message || error}`);
    }
}

/** 把一次团队流水线的 A9 复盘写入项目状态；失败不阻断主流程 */
export async function syncPipelineRetrospectiveToDesignState(
    projectPath: string | undefined,
    retrospective: PipelineRetrospectiveForSync
): Promise<void> {
    if (!projectPath) return;
    const patch = buildPipelineRetrospectiveStatePatch(retrospective);
    if (!patch) return;
    try {
        await (window as any).designEcho?.updateDesignState?.(projectPath, patch);
    } catch (error: any) {
        console.warn(`[DesignTeams] 流水线复盘写穿失败：${error?.message || error}`);
    }
}
