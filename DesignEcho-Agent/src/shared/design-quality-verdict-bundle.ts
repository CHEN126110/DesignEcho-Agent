/**
 * 设计质量裁决单一口径（纯逻辑，可 smoke）。
 *
 * 背景：项目里"设计达标判断"现在有两套来源——
 *   1) task-completion-contract（agent-runtime/types.ts 的 TaskCompletionContract）：二元 required 检查，
 *      只查"产物在不在"（有没有主视觉/文案/导出），由 agent.ts 早停补救消费；
 *   2) design-quality-assertion 的 DesignScorecard：14 条断言→8 维加权评分，查"质量够不够"。
 * 若两者各自被早停门禁/critic/reflexion 直接读取拼判定，会形成第二套并行判定，重蹈项目最痛的
 * "多套重叠正则意图分类器"耦合覆辙。
 *
 * 本模块是**唯一裁决口径**：所有下游（早停门禁、critic、reflexion 重入）只消费 buildDesignVerdict
 * 产出的 DesignVerdict，禁止各自直接读 contract + scorecard 拼判定。
 *
 * 串联（非并行）规则——契约优先，质量其次：
 *   - 非设计任务（无 contract 或 kind 不在 designKinds）→ not_applicable（不评分）。
 *   - 契约失败（status==='failed' 或有 required 项 failed）→ failed，且**不看 scorecard**
 *     （产物都没齐，谈质量无意义；这一步保证不会出现"契约失败但评分通过"的并行覆盖）。
 *   - 契约通过但无 scorecard → 回落契约结果（向后兼容：等同当前二元判定）。
 *   - 契约通过 + 有 scorecard → 看 scorecard.gate（按"分级"强制力分流，用户 2026-06-29 拍板）：
 *       gate=failed 且有 blocker 级失败 → failed，blocker 断言进 blockers（**硬**，下游进 summary.blockers 触发返工）；
 *       gate=failed 但仅 major 梯度缺陷（无 blocker） → needs_review，进 warnings（**软**，只提示不返工）；
 *       needs_review → needs_review（软）；
 *       incomplete_verification → passed_unverified（**红线：质量没测到不伪造失败**，只标未验证）；
 *       passed → passed。
 *
 * 分级口径：唯一"硬阻断"信号是 blocker 级失败断言（→ verdict.blockers）；major 梯度缺陷、needs_review、
 * 覆盖率不足都归 warnings（软）。下游接线只需把 verdict.blockers→summary.blockers（硬）、
 * verdict.warnings→summary.warnings（软），即实现分级强制力，无需各自重判，杜绝并行判定。
 */

import type {
    DesignScorecard,
    DesignScorecardGate,
    DesignAssertionResult
} from './design-quality-assertion';
import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';

/** 结构化最小契约视图（与 agent-runtime/types.ts 的 TaskCompletionContract 结构兼容，避免 shared→renderer 反向依赖）。 */
export interface DesignVerdictContractView {
    kind: string;
    status: string;
    required: Array<{
        id: string;
        label?: string;
        status: 'passed' | 'failed' | 'needs_review' | 'not_applicable';
        reason?: string;
    }>;
    blockers?: string[];
    warnings?: string[];
    summary?: string;
}

export type DesignVerdictStatus =
    | 'passed'
    | 'failed'
    | 'needs_review'
    | 'passed_unverified'
    | 'not_applicable';

export type DesignVerdictSource = 'contract' | 'scorecard' | 'contract+scorecard' | 'none';

export interface DesignVerdict {
    version: typeof DESIGN_QUALITY_VERDICT_CAPABILITY_ID;
    status: DesignVerdictStatus;
    /** 裁决依据来自哪一层，便于诊断与避免误以为"评分没生效"。 */
    source: DesignVerdictSource;
    contractStatus?: string;
    /** 契约里 status==='failed' 的 required 项 id（产物缺口）。 */
    contractFailedRequirementIds: string[];
    scorecardGate?: DesignScorecardGate;
    /** scorecard 加权总分（0..100），无 scorecard 时为 undefined。 */
    overallScore?: number;
    /** 阻断级原因（人类可读）：产物缺口 + 质量 blocker 断言。 */
    blockers: string[];
    /** 非阻断级提示：契约/质量的 needs_review、覆盖率不足等。 */
    warnings: string[];
    summary: string;
}

export interface BuildDesignVerdictInput {
    contract?: DesignVerdictContractView | null;
    scorecard?: DesignScorecard | null;
    /** 视为"设计任务"的 contract.kind 集合（默认仅 creative_design）。 */
    designKinds?: readonly string[];
}

const DEFAULT_DESIGN_KINDS: readonly string[] = ['creative_design'];

function assertionToText(result: DesignAssertionResult): string {
    const fix = result.expectedFix ? `（建议：${result.expectedFix}）` : '';
    return `${result.rationale || result.id}${fix}`;
}

function notApplicable(reason: string): DesignVerdict {
    return {
        version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
        status: 'not_applicable',
        source: 'none',
        contractFailedRequirementIds: [],
        blockers: [],
        warnings: [],
        summary: reason
    };
}

/**
 * 单一裁决口径：把 task-completion-contract 与 DesignScorecard 串联成一个 DesignVerdict。
 * 纯函数，不读运行时、不调模型。
 */
export function buildDesignVerdict(input: BuildDesignVerdictInput): DesignVerdict {
    const contract = input.contract ?? null;
    const scorecard = input.scorecard ?? null;
    const designKinds = input.designKinds ?? DEFAULT_DESIGN_KINDS;

    // 1) 非设计任务：不评分、不裁决质量。
    if (!contract) {
        return notApplicable('无 task-completion-contract，非设计达标裁决范围。');
    }
    if (!designKinds.includes(contract.kind)) {
        return notApplicable(`contract.kind=${contract.kind} 不在设计裁决范围（${designKinds.join('/')}）。`);
    }

    const failedRequirements = contract.required.filter((item) => item.status === 'failed');
    const failedRequirementIds = failedRequirements.map((item) => item.id);
    const needsReviewRequirements = contract.required.filter((item) => item.status === 'needs_review');

    // 2) 契约失败（产物未齐）→ failed，且不看 scorecard（杜绝并行覆盖）。
    if (contract.status === 'failed' || failedRequirements.length > 0) {
        const reqBlockers = failedRequirements.map(
            (item) => item.reason || `${item.label || item.id}：未完成`
        );
        const blockers = reqBlockers.length > 0
            ? reqBlockers
            : (contract.blockers && contract.blockers.length > 0
                ? contract.blockers
                : [contract.summary || '设计产物未齐，任务未完成。']);
        return {
            version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
            status: 'failed',
            source: 'contract',
            contractStatus: contract.status,
            contractFailedRequirementIds: failedRequirementIds,
            blockers,
            warnings: contract.warnings ?? [],
            summary: `产物未齐（${failedRequirementIds.join('、') || contract.status}），先补完产物再谈质量。`
        };
    }

    // 3) 契约通过但无 scorecard → 回落契约结果（向后兼容当前二元判定）。
    if (!scorecard) {
        const status: DesignVerdictStatus = needsReviewRequirements.length > 0 ? 'needs_review' : 'passed';
        return {
            version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
            status,
            source: 'contract',
            contractStatus: contract.status,
            contractFailedRequirementIds: [],
            blockers: [],
            warnings: needsReviewRequirements.map((item) => item.reason || `${item.label || item.id}：待复核`),
            summary: status === 'passed'
                ? '产物齐全（未提供质量评分卡，按契约判定通过）。'
                : '产物齐全但有待复核项（未提供质量评分卡）。'
        };
    }

    // 4) 契约通过 + 有 scorecard → 按 gate 串联。
    const overallScore = scorecard.overallScore;
    // 分级口径：仅 severity=blocker 的失败断言进 blockers（硬，触发返工）；
    // severity=major 的失败（梯度问题）与 needs_review 进 warnings（软，仅提示）。
    const blockerIds = new Set(scorecard.blockers.map((item) => item.id));
    const scorecardBlockers = scorecard.blockers.map(assertionToText);
    const majorFailureWarnings = scorecard.failedAssertions
        .filter((item) => !blockerIds.has(item.id))
        .map(assertionToText);
    const scorecardNeedsReview = scorecard.needsReview.map(assertionToText);
    const contractNeedsReviewWarnings = needsReviewRequirements.map(
        (item) => item.reason || `${item.label || item.id}：待复核`
    );

    switch (scorecard.gate) {
        case 'failed':
            if (scorecard.blockers.length > 0) {
                // 有 blocker 级红线 → 硬失败：blocker 进 blockers（下游入 summary.blockers 触发返工）。
                return {
                    version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                    status: 'failed',
                    source: 'contract+scorecard',
                    contractStatus: contract.status,
                    contractFailedRequirementIds: [],
                    scorecardGate: scorecard.gate,
                    overallScore,
                    blockers: scorecardBlockers,
                    warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                    summary: `产物齐全，但设计质量触红线（评分 ${overallScore}，${scorecard.blockers.length} 项 blocker）。`
                };
            }
            // gate=failed 但仅 major 梯度缺陷、无 blocker → 分级判软：needs_review，不进硬阻断（绝不回落出假 blocker）。
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'needs_review',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                summary: `产物齐全，设计质量有梯度缺陷需复核（评分 ${overallScore}）。`
            };
        case 'needs_review':
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'needs_review',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                summary: `产物齐全，设计质量需复核（评分 ${overallScore}）。`
            };
        case 'incomplete_verification':
        case 'insufficient_observations':
            // 红线：质量没测到，不伪造失败；标为"已交付但未验证质量"。
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'passed_unverified',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [
                    ...contractNeedsReviewWarnings,
                    `设计质量评估覆盖率不足（${scorecard.coverage.evaluated}/${scorecard.coverage.total}），质量未充分验证。`
                ],
                summary: scorecard.gate === 'insufficient_observations'
                    ? '产物齐全，但尚未充分查看实际画面，未能验证设计质量（不据此判失败）。'
                    : '产物齐全，但设计质量检查尚未覆盖完整，未能验证质量（不据此判失败）。'
            };
        case 'passed':
        default:
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: contractNeedsReviewWarnings.length > 0 ? 'needs_review' : 'passed',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: contractNeedsReviewWarnings,
                summary: `产物齐全，设计质量达标（评分 ${overallScore}）。`
            };
    }
}

/**
 * 分级口径下的"可收尾"便捷判定：唯一硬阻断是 blocker 级失败，故 deliverable ⇔ 无 blocker。
 * needs_review（major 梯度软提示）、passed_unverified（未验证）、passed、not_applicable 均不阻断收尾，
 * 只随 warnings 提示——符合"质量评分走提示、blocker 红线才返工"的既定约定与"不伪造失败"红线。
 */
export function isDesignVerdictDeliverable(verdict: DesignVerdict): boolean {
    return verdict.blockers.length === 0;
}
