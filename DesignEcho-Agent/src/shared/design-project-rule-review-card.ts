import {
    buildDesignProjectRulePolicy,
    listDesignProjectRuleRecords
} from './design-project-rule-governance';
import {
    buildInteractiveCardValidationResult,
    cleanInteractiveCardText,
    type InteractiveCardDefinition,
    type InteractiveCardValidationIssue,
    type InteractiveCardValidationResult
} from './interactive-card-contract';
import type {
    DesignProjectRuleRecord,
    DesignProjectRuleReviewInput,
    DesignProjectRuleUpsertInput,
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';

export interface DesignProjectRuleReviewCardRule {
    ruleId: string;
    ruleKind: DesignProjectRuleRecord['ruleKind'];
    statement: string;
    constraintKey?: string;
    enforcement: DesignProjectRuleRecord['enforcement'];
    applicability: DesignProjectRuleRecord['applicability'];
    sourceKinds: DesignProjectRuleRecord['sources'][number]['kind'][];
}

export interface DesignProjectRuleReviewCardPayload {
    version: 'design-project-rule-review-card/v0';
    projectFingerprint: string;
    stateFingerprint: string;
    rules: DesignProjectRuleReviewCardRule[];
}

export interface DesignProjectRuleReviewCardValue {
    decisions: Array<{ ruleId: string; decision: 'confirm' | 'reject' | 'needs_review' }>;
}

export type DesignProjectRuleReviewCard = InteractiveCardDefinition<DesignProjectRuleReviewCardPayload>;

export function buildDesignProjectRuleReviewCard(input: {
    state?: DesignProjectState | null;
    projectIdentity?: unknown;
}): DesignProjectRuleReviewCard | undefined {
    const projectFingerprint = buildProjectFingerprint(input.projectIdentity);
    if (!projectFingerprint) return undefined;
    const rules = listDesignProjectRuleRecords(input.state)
        .filter((rule) => rule.status === 'active' && rule.confirmation === 'unverified')
        .slice(0, 24)
        .map(toCardRule);
    if (rules.length === 0) return undefined;
    const stateFingerprint = buildStateFingerprint(rules);
    return {
        version: 'interactive-card/v0',
        id: `design-project-rule-review-${stateFingerprint}`,
        kind: 'design_project_rule_review',
        title: '确认项目与品牌规则',
        description: '请确认哪些内容只是设计参考，哪些是质量门禁或交付前需审批的规则。未经确认的候选不会自动成为执行约束。',
        payload: {
            version: 'design-project-rule-review-card/v0',
            projectFingerprint,
            stateFingerprint,
            rules
        },
        status: 'draft',
        submitAction: 'submitDesignProjectRuleReviewCard',
        memoryPolicy: { enabled: false, mode: 'none', reviewRequired: true }
    };
}

export function validateDesignProjectRuleReviewCardValue(
    payload: DesignProjectRuleReviewCardPayload,
    value: unknown
): InteractiveCardValidationResult<DesignProjectRuleReviewCardValue> {
    const issues: InteractiveCardValidationIssue[] = [];
    const rules = Array.isArray(payload?.rules) ? payload.rules : [];
    const raw = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Partial<DesignProjectRuleReviewCardValue>
        : {};
    const rawDecisions = Array.isArray(raw.decisions) ? raw.decisions : [];
    const decisionByRuleId = new Map<string, DesignProjectRuleReviewCardValue['decisions'][number]>();
    for (const rawDecision of rawDecisions) {
        const ruleId = cleanInteractiveCardText(rawDecision?.ruleId);
        const decision = normalizeDecision(rawDecision?.decision);
        if (ruleId && decision && !decisionByRuleId.has(ruleId)) decisionByRuleId.set(ruleId, { ruleId, decision });
    }
    const normalizedDecisions = rules.map((rule) => (
        decisionByRuleId.get(rule.ruleId) || { ruleId: rule.ruleId, decision: 'needs_review' as const }
    ));
    const knownRuleIds = new Set(rules.map((rule) => rule.ruleId));
    if (
        payload?.version !== 'design-project-rule-review-card/v0'
        || !/^project-[a-f0-9]{16}$/.test(String(payload.projectFingerprint || ''))
        || !/^rule-review-state-[a-f0-9]{16}$/.test(String(payload.stateFingerprint || ''))
        || payload.stateFingerprint !== buildStateFingerprint(rules)
        || rules.length === 0
    ) {
        issues.push({ severity: 'error', code: 'invalid_rule_review_target', message: '规则复核对象已损坏，请重新读取项目状态。' });
    }
    if (rawDecisions.some((decision) => !knownRuleIds.has(cleanInteractiveCardText(decision?.ruleId)))) {
        issues.push({ severity: 'error', code: 'unknown_rule_decision', message: '复核提交包含当前卡片之外的规则。' });
    }
    return buildInteractiveCardValidationResult({ normalizedValue: { decisions: normalizedDecisions }, issues });
}

export function buildDesignProjectRuleReviewPatch(input: {
    card: DesignProjectRuleReviewCard;
    value: DesignProjectRuleReviewCardValue;
}): DesignProjectStatePatch {
    const decisions = new Map(input.value.decisions.map((item) => [item.ruleId, item.decision]));
    const upsertRules: DesignProjectRuleUpsertInput[] = input.card.payload.rules.map((rule) => ({
        ruleKind: rule.ruleKind,
        statement: rule.statement,
        constraintKey: rule.constraintKey,
        enforcement: rule.enforcement,
        applicability: rule.applicability,
        source: { kind: rule.sourceKinds[0] || 'agent_inference', sourceRef: `rule-review:${rule.ruleId}` }
    }));
    const reviewRules: DesignProjectRuleReviewInput[] = input.card.payload.rules.map((rule) => ({
        ruleId: rule.ruleId,
        decision: decisions.get(rule.ruleId) || 'needs_review'
    }));
    return { upsertRules, reviewRules, ruleWriteAuthority: 'user_review', updatedBy: 'user' };
}

export function isDesignProjectRuleReviewCard(value: unknown): value is DesignProjectRuleReviewCard {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const card = value as Partial<DesignProjectRuleReviewCard>;
    return card.version === 'interactive-card/v0'
        && card.kind === 'design_project_rule_review'
        && card.payload?.version === 'design-project-rule-review-card/v0';
}

export function doesDesignProjectRuleReviewCardMatchState(input: {
    card: DesignProjectRuleReviewCard;
    state?: DesignProjectState | null;
    projectIdentity?: unknown;
}): boolean {
    const current = buildDesignProjectRuleReviewCard({ state: input.state, projectIdentity: input.projectIdentity });
    return current?.payload.projectFingerprint === input.card.payload.projectFingerprint
        && current?.payload.stateFingerprint === input.card.payload.stateFingerprint;
}

export function getDesignProjectRuleReviewCardSummary(state: DesignProjectState | null | undefined): string {
    const policy = buildDesignProjectRulePolicy(state);
    return `规则 ${listDesignProjectRuleRecords(state).length} 条：已生效 ${policy.applicableRules.length}，待确认 ${policy.pendingRuleCount}，冲突 ${policy.conflicts.length}，交付前需审批 ${policy.approvalRequiredRules.length}。`;
}

function toCardRule(rule: DesignProjectRuleRecord): DesignProjectRuleReviewCardRule {
    return {
        ruleId: rule.ruleId,
        ruleKind: rule.ruleKind,
        statement: rule.statement,
        constraintKey: rule.constraintKey,
        enforcement: rule.enforcement,
        applicability: rule.applicability,
        sourceKinds: Array.from(new Set(rule.sources.map((source) => source.kind)))
    };
}

function buildStateFingerprint(rules: DesignProjectRuleReviewCardRule[]): string {
    return createStableFingerprint('rule-review-state', JSON.stringify(rules.map((rule) => ({
        ruleId: rule.ruleId,
        statement: rule.statement,
        constraintKey: rule.constraintKey,
        enforcement: rule.enforcement,
        applicability: rule.applicability,
        sourceKinds: rule.sourceKinds
    })).sort((left, right) => left.ruleId.localeCompare(right.ruleId))));
}

function buildProjectFingerprint(value: unknown): string {
    const identity = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
    return identity ? createStableFingerprint('project', identity) : '';
}

function normalizeDecision(value: unknown): 'confirm' | 'reject' | 'needs_review' | undefined {
    if (value === 'confirm' || value === 'reject' || value === 'needs_review') return value;
    return undefined;
}

function createStableFingerprint(prefix: string, value: string): string {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193) >>> 0;
        right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
    }
    return `${prefix}-${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}
