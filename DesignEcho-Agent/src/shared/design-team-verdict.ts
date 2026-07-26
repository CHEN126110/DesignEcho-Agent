/**
 * 设计团队评审裁决解析（纯逻辑，主/渲染进程共用，可被 smoke 直接测试）
 *
 * critic 约定在评审报告末尾输出机读 JSON：
 *   {"verdict":"pass"} 或
 *   {"verdict":"needs_fix","issues":[{"target":"...","problem":"...","suggestion":"..."}]}
 * 解析失败返回 unparseable：按"已评审但无法机读"处理，不阻断流程、不伪造裁决。
 */

import type {
    DesignCriticIssue,
    DesignCriticIssueOwner,
    DesignCriticVerdict
} from './types/design-team.types';
import { toDesignCriticIssues } from './design-quality-assertion';
import type { DesignScorecard } from './design-quality-assertion';

const OWNER_ALIASES: Record<string, DesignCriticIssueOwner> = {
    requirement: 'requirement',
    requirements: 'requirement',
    brief: 'requirement',
    strategy: 'requirement',
    'design-strategist': 'requirement',
    需求: 'requirement',
    策略: 'requirement',

    asset: 'asset',
    assets: 'asset',
    material: 'asset',
    materials: 'asset',
    'scene-analyst': 'asset',
    素材: 'asset',
    画面: 'asset',
    图层: 'asset',

    insight: 'insight',
    insights: 'insight',
    market: 'insight',
    'market-researcher': 'insight',
    user: 'insight',
    用户: 'insight',
    市场: 'insight',
    洞察: 'insight',

    copy: 'copy',
    copywriting: 'copy',
    copywriter: 'copy',
    text: 'copy',
    文案: 'copy',
    文字: 'copy',

    visual: 'visual',
    style: 'visual',
    视觉: 'visual',
    风格: 'visual',

    layout: 'layout',
    composition: 'layout',
    版式: 'layout',
    排版: 'layout',

    execution: 'execution',
    executor: 'execution',
    photoshop: 'execution',
    执行: 'execution',
    落地: 'execution'
};

export function normalizeDesignCriticIssueOwner(value: unknown): DesignCriticIssueOwner | undefined {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return undefined;
    return OWNER_ALIASES[key];
}

/** 括号配平提取顶层 JSON 对象候选（含 "verdict" 的）；正则非贪婪匹配会在嵌套对象处截断，不可用 */
function extractVerdictJsonCandidates(text: string): string[] {
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
                    const candidate = text.slice(i, j + 1);
                    if (candidate.includes('"verdict"')) candidates.push(candidate);
                    i = j; // 跳过整个对象，嵌套子对象不再单独入选
                    break;
                }
            }
        }
    }
    return candidates;
}

export function parseCriticVerdict(reviewMessage: string): DesignCriticVerdict {
    const text = String(reviewMessage || '');
    const jsonCandidates = extractVerdictJsonCandidates(text);
    for (let i = jsonCandidates.length - 1; i >= 0; i--) {
        try {
            const parsed = JSON.parse(jsonCandidates[i]);
            const verdict = String(parsed?.verdict || '').trim();
            if (verdict !== 'pass' && verdict !== 'needs_fix') continue;
            const issues = Array.isArray(parsed?.issues)
                ? parsed.issues
                    .filter((item: any) => item && (item.problem || item.target))
                    .map((item: any) => {
                        const owner = normalizeDesignCriticIssueOwner(item.owner ?? item.reroute);
                        return {
                            ...(owner ? { owner } : {}),
                            target: String(item.target || '未指明对象'),
                            problem: String(item.problem || ''),
                            suggestion: String(item.suggestion || '')
                        };
                    })
                : [];
            return {
                status: verdict,
                issues,
                reviewText: text.replace(jsonCandidates[i], '').trim()
            };
        } catch {
            // 尝试下一个候选
        }
    }
    return { status: 'unparseable', issues: [], reviewText: text.trim() };
}

/**
 * 把确定性评分卡并进评审裁决（critic 接评分卡的单一并轨口，纯逻辑可 smoke）。
 *
 * 调用方契约：scorecard 应来自 evaluateDeterministicAssertions → scoreDesignAssertions
 * （仅确定性断言、真实测量，0 token），例如流水线各阶段累计 toolCallLog 的归一化测量。
 *
 * 并轨规则（与 design-quality-verdict-bundle 的"blocker 硬 / major 软"单一分级口径一致）：
 * - 失败/待复核断言经 toDesignCriticIssues 转成带 owner 的 issue，与模型 issues 并集合并
 *   （按 target+problem 去重，模型原 issues 一条不丢）；
 * - 仅 blocker 级确定性失败强制翻 needs_fix——红线不允许被模型散文结论（pass）或
 *   不可机读（unparseable）抵消；
 * - major/minor 级失败与 needs_review 项只进 issues（评审可见、修订轮可引用），不翻转
 *   模型基于真实看图得出的 pass——梯度缺陷判软，1px 溢出（craft.precision，minor）或
 *   targetFit:'cover' 合法铺满这类场景不白烧修订轮；
 * - 评分卡没有任何断言被真实测量评估（全 uneval）时原样返回：无测量不注水、不伪造裁决。
 */
export function mergeDeterministicScorecardIntoCriticVerdict(
    verdict: DesignCriticVerdict,
    scorecard: DesignScorecard | null | undefined
): DesignCriticVerdict {
    if (!scorecard || !scorecard.coverage || scorecard.coverage.evaluated === 0) {
        return verdict;
    }

    const deterministicIssues = toDesignCriticIssues(scorecard);
    const mergedIssues: DesignCriticIssue[] = [...verdict.issues];
    const issueKey = (issue: DesignCriticIssue): string => JSON.stringify([issue.target, issue.problem]);
    const seen = new Set(verdict.issues.map(issueKey));
    for (const issue of deterministicIssues) {
        const key = issueKey(issue);
        if (seen.has(key)) continue;
        seen.add(key);
        mergedIssues.push(issue);
    }

    // 分级口径：仅 blocker 级失败断言硬性翻转裁决（与 design-quality-verdict-bundle:196-238 一致），
    // major/minor 失败只随 issues 提示，不抵消模型的 pass。
    const hasBlockerFailure = scorecard.blockers.length > 0;

    return {
        ...verdict,
        status: hasBlockerFailure ? 'needs_fix' : verdict.status,
        issues: mergedIssues,
        deterministicScorecard: {
            overallScore: scorecard.overallScore,
            gate: scorecard.gate,
            evaluated: scorecard.coverage.evaluated,
            total: scorecard.coverage.total,
            summary: scorecard.summary
        }
    };
}
