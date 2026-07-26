import {
    buildDesignProjectFactProvenanceSummary,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';
import {
    buildInteractiveCardValidationResult,
    cleanInteractiveCardText,
    type InteractiveCardDefinition,
    type InteractiveCardValidationIssue,
    type InteractiveCardValidationResult
} from './interactive-card-contract';
import type {
    DesignProjectFactRecord,
    DesignProjectFactReviewInput,
    DesignProjectFactUpsertInput,
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';

export interface DesignProjectFactReviewCardFact {
    factId: string;
    claimType: DesignProjectFactRecord['claimType'];
    statement: string;
    sourceKinds: DesignProjectFactRecord['sources'][number]['kind'][];
    currentConfirmation: DesignProjectFactRecord['confirmation'];
}

export interface DesignProjectFactReviewCardPayload {
    version: 'design-project-fact-review-card/v0';
    projectFingerprint: string;
    stateFingerprint: string;
    facts: DesignProjectFactReviewCardFact[];
}

export interface DesignProjectFactReviewDecision {
    factId: string;
    decision: 'confirm' | 'reject' | 'needs_review';
}

export interface DesignProjectFactReviewCardValue {
    decisions: DesignProjectFactReviewDecision[];
}

export type DesignProjectFactReviewCard = InteractiveCardDefinition<DesignProjectFactReviewCardPayload>;

export function buildDesignProjectFactReviewCard(input: {
    state?: DesignProjectState | null;
    projectIdentity?: unknown;
}): DesignProjectFactReviewCard | undefined {
    const projectFingerprint = buildProjectFingerprint(input.projectIdentity);
    if (!projectFingerprint) return undefined;
    const pendingFacts = listDesignProjectFactRecords(input.state)
        .filter((fact) => fact.status === 'active' && fact.confirmation === 'unverified')
        .slice(0, 24);
    if (pendingFacts.length === 0) return undefined;
    const facts = pendingFacts.map(toCardFact);
    const stateFingerprint = buildStateFingerprint(facts);
    return {
        version: 'interactive-card/v0',
        id: `design-project-fact-review-${stateFingerprint}`,
        kind: 'design_project_fact_review',
        title: '确认项目商品事实',
        description: '这些内容目前只有候选来源。请逐条确认、驳回或保留待核验；未经确认的内容不能作为已确认商品事实或质量结论。',
        payload: {
            version: 'design-project-fact-review-card/v0',
            projectFingerprint,
            stateFingerprint,
            facts
        },
        status: 'draft',
        submitAction: 'submitDesignProjectFactReviewCard',
        memoryPolicy: {
            enabled: false,
            mode: 'none',
            reviewRequired: true
        }
    };
}

export function validateDesignProjectFactReviewCardValue(
    payload: DesignProjectFactReviewCardPayload,
    value: unknown
): InteractiveCardValidationResult<DesignProjectFactReviewCardValue> {
    const issues: InteractiveCardValidationIssue[] = [];
    const facts = Array.isArray(payload?.facts) ? payload.facts : [];
    const raw = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Partial<DesignProjectFactReviewCardValue>
        : {};
    const rawDecisions = Array.isArray(raw.decisions) ? raw.decisions : [];
    const decisionByFactId = new Map<string, DesignProjectFactReviewDecision>();
    for (const rawDecision of rawDecisions) {
        const factId = cleanInteractiveCardText(rawDecision?.factId);
        const decision = normalizeDecision(rawDecision?.decision);
        if (!factId || !decision || decisionByFactId.has(factId)) continue;
        decisionByFactId.set(factId, { factId, decision });
    }
    const normalizedDecisions = facts.map((fact) => (
        decisionByFactId.get(fact.factId) || { factId: fact.factId, decision: 'needs_review' as const }
    ));
    const knownFactIds = new Set(facts.map((fact) => fact.factId));
    if (
        payload?.version !== 'design-project-fact-review-card/v0'
        || !/^project-[a-f0-9]{16}$/.test(String(payload.projectFingerprint || ''))
        || !/^fact-review-state-[a-f0-9]{16}$/.test(String(payload.stateFingerprint || ''))
        || payload.stateFingerprint !== buildStateFingerprint(facts)
        || facts.length === 0
    ) {
        issues.push({ severity: 'error', code: 'invalid_fact_review_target', message: '事实复核对象已损坏，请重新读取项目状态。' });
    }
    if (rawDecisions.some((decision) => !knownFactIds.has(cleanInteractiveCardText(decision?.factId)))) {
        issues.push({ severity: 'error', code: 'unknown_fact_decision', message: '复核提交包含当前卡片之外的事实。' });
    }
    if (normalizedDecisions.length !== facts.length) {
        issues.push({ severity: 'error', code: 'missing_fact_decision', message: '每条事实都必须有复核结论。' });
    }
    return buildInteractiveCardValidationResult({
        normalizedValue: { decisions: normalizedDecisions },
        issues
    });
}

export function buildDesignProjectFactReviewPatch(input: {
    card: DesignProjectFactReviewCard;
    value: DesignProjectFactReviewCardValue;
}): DesignProjectStatePatch {
    const decisions = new Map(input.value.decisions.map((decision) => [decision.factId, decision.decision]));
    const upsertFacts: DesignProjectFactUpsertInput[] = input.card.payload.facts.map((fact) => ({
        claimType: fact.claimType,
        statement: fact.statement,
        source: {
            kind: fact.sourceKinds[0] || 'legacy_unattributed',
            sourceRef: `fact-review:${fact.factId}`
        }
    }));
    const reviewFacts: DesignProjectFactReviewInput[] = input.card.payload.facts.map((fact) => ({
        factId: fact.factId,
        decision: decisions.get(fact.factId) || 'needs_review'
    }));
    return {
        upsertFacts,
        reviewFacts,
        factWriteAuthority: 'user_review',
        updatedBy: 'user'
    };
}

export function isDesignProjectFactReviewCard(value: unknown): value is DesignProjectFactReviewCard {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const card = value as Partial<DesignProjectFactReviewCard>;
    return card.version === 'interactive-card/v0'
        && card.kind === 'design_project_fact_review'
        && card.payload?.version === 'design-project-fact-review-card/v0';
}

export function doesDesignProjectFactReviewCardMatchState(input: {
    card: DesignProjectFactReviewCard;
    state?: DesignProjectState | null;
    projectIdentity?: unknown;
}): boolean {
    const projectFingerprint = buildProjectFingerprint(input.projectIdentity);
    if (!projectFingerprint || projectFingerprint !== input.card.payload.projectFingerprint) return false;
    const currentCard = buildDesignProjectFactReviewCard({
        state: input.state,
        projectIdentity: input.projectIdentity
    });
    return currentCard?.payload.stateFingerprint === input.card.payload.stateFingerprint;
}

export function getDesignProjectFactReviewCardSummary(
    state: DesignProjectState | null | undefined
): string {
    const summary = buildDesignProjectFactProvenanceSummary(state);
    return `事实 ${summary.total} 条：用户确认 ${summary.userConfirmed}，来源支持 ${summary.sourceSupported}，待确认 ${summary.needsReview}，已驳回 ${summary.rejected}，已取代 ${summary.superseded}。`;
}

function toCardFact(fact: DesignProjectFactRecord): DesignProjectFactReviewCardFact {
    return {
        factId: fact.factId,
        claimType: fact.claimType,
        statement: fact.statement,
        sourceKinds: Array.from(new Set(fact.sources.map((source) => source.kind))),
        currentConfirmation: fact.confirmation
    };
}

function buildStateFingerprint(facts: DesignProjectFactReviewCardFact[]): string {
    return createStableFingerprint('fact-review-state', JSON.stringify({
        facts: facts.map((fact) => ({
            factId: fact.factId,
            claimType: fact.claimType,
            statement: fact.statement,
            confirmation: fact.currentConfirmation,
            sourceKinds: fact.sourceKinds
        })).sort((left, right) => left.factId.localeCompare(right.factId))
    }));
}

function buildProjectFingerprint(value: unknown): string {
    const identity = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
    return identity ? createStableFingerprint('project', identity) : '';
}

function normalizeDecision(value: unknown): DesignProjectFactReviewDecision['decision'] | undefined {
    if (value === 'confirm') return 'confirm';
    if (value === 'reject') return 'reject';
    if (value === 'needs_review') return 'needs_review';
    return undefined;
}

function createStableFingerprint(prefix: string, value: string): string {
    let left = 2166136261;
    let right = 3339675911;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left ^= code;
        left = Math.imul(left, 16777619);
        right ^= code + index;
        right = Math.imul(right, 2246822519);
    }
    return `${prefix}-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}
