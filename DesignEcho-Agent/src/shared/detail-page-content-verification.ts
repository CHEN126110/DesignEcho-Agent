/**
 * 详情页逐屏内容校验。
 *
 * 该契约只验证“实际执行的每一屏内容是否关联了已确认事实来源”，不生成文案、
 * 不判断审美、不读取任务文本，也不拥有最终 DesignVerdict。
 */

import type { DetailScreenPlan } from './detail-page-screen-plan';
import type { DesignProjectState } from './types/design-project-state.types';
import {
    canDesignProjectFactSupportEvaluation,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';

export type DetailPageContentFactSource =
    | 'project_product_fact'
    | 'project_selling_point';

export interface DetailPageContentFactCandidate {
    ref: string;
    source: DetailPageContentFactSource;
    statement: string;
    sourceStrength: 'user_confirmed' | 'source_supported' | 'unverified';
    evaluationEligible: boolean;
}

export type DetailPageContentScreenIssueCode =
    | 'screen_execution_failed'
    | 'screen_decision_incomplete'
    | 'applied_copy_missing'
    | 'applied_copy_not_supported'
    | 'content_support_ref_missing'
    | 'content_support_ref_unconfirmed'
    | 'content_support_ref_unknown'
    | 'content_support_ref_unsafe';

export interface DetailPageContentScreenVerification {
    screenId: number;
    status: 'passed' | 'needs_review' | 'failed';
    appliedCopyCount: number;
    supportedCopyCount: number;
    supportRefs: string[];
    sourceKinds: DetailPageContentFactSource[];
    issueCodes: DetailPageContentScreenIssueCode[];
}

export interface DetailPageContentVerification {
    version: 'detail-page-content-verification/v0';
    status: 'passed' | 'needs_review' | 'failed';
    summary: {
        screenCount: number;
        passedScreenCount: number;
        needsReviewScreenCount: number;
        failedScreenCount: number;
        linkedScreenCount: number;
        appliedCopyScreenCount: number;
        supportedCopyScreenCount: number;
        supportCoverageRatio: number;
        factCount: number;
        confirmedFactCount: number;
        unconfirmedFactCount: number;
    };
    screens: DetailPageContentScreenVerification[];
    issueCodes: DetailPageContentScreenIssueCode[];
    verificationPassed: boolean;
    boundaries: {
        executesTools: false;
        callsModel: false;
        containsFactStatements: false;
        containsPaths: false;
        performsSemanticInference: false;
        claimsDesignQuality: false;
    };
}

export interface DetailPageContentFillPlanLike {
    screenId?: number;
    supportRefs?: unknown;
    copies?: Array<{
        content?: unknown;
        generationStatus?: unknown;
    }>;
}

export interface DetailPageContentExecutionResultLike {
    screenId: number;
    status: string;
}

const SAFE_REF_PATTERN = /^detail-fact:(?:[a-z0-9-]+:[0-9]+(?::[0-9]+)?|state-record:[a-f0-9]{16})$/;

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStatement(value: unknown): string {
    return cleanText(value)
        .toLowerCase()
        .replace(/[\s，。；;、,:：!！?？"'“”‘’（）()\-_/]+/g, '');
}

function unique<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function addFact(input: {
    facts: DetailPageContentFactCandidate[];
    seen: Set<string>;
    statement: unknown;
    ref: string;
    source: DetailPageContentFactSource;
    sourceStrength: DetailPageContentFactCandidate['sourceStrength'];
    evaluationEligible: boolean;
}): void {
    const statement = cleanText(input.statement);
    const normalized = normalizeStatement(statement);
    const seenKey = `${input.source}:${normalized}`;
    if (!statement || normalized.length < 2 || input.seen.has(seenKey)) return;
    input.seen.add(seenKey);
    input.facts.push({
        ref: input.ref,
        source: input.source,
        statement,
        sourceStrength: input.sourceStrength,
        evaluationEligible: input.evaluationEligible
    });
}

export function buildDetailPageContentFactCatalog(input: {
    state?: DesignProjectState | null;
}): DetailPageContentFactCandidate[] {
    const facts: DetailPageContentFactCandidate[] = [];
    const seen = new Set<string>();
    listDesignProjectFactRecords(input.state).forEach((fact) => {
        if (fact.status !== 'active' || fact.confirmation === 'rejected') return;
        addFact({
            facts,
            seen,
            statement: fact.statement,
            ref: `detail-fact:state-record:${fact.factId.replace('project-fact-', '')}`,
            source: fact.claimType === 'selling_point' ? 'project_selling_point' : 'project_product_fact',
            sourceStrength: fact.confirmation,
            evaluationEligible: canDesignProjectFactSupportEvaluation(fact)
        });
    });
    return facts.slice(0, 80);
}

function statementsMatch(left: unknown, right: unknown): boolean {
    const normalizedLeft = normalizeStatement(left);
    const normalizedRight = normalizeStatement(right);
    if (normalizedLeft.length < 2 || normalizedRight.length < 2) return false;
    if (normalizedLeft === normalizedRight) return true;
    const minLength = Math.min(normalizedLeft.length, normalizedRight.length);
    return minLength >= 4
        && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

export function resolveDetailPageContentSupportRefs(input: {
    catalog: readonly DetailPageContentFactCandidate[];
    statements: readonly unknown[];
}): string[] {
    const refs: string[] = [];
    for (const statement of input.statements) {
        for (const fact of input.catalog) {
            if (!statementsMatch(statement, fact.statement)) continue;
            refs.push(fact.ref);
        }
    }
    return unique(refs).slice(0, 8);
}

function readSupportRefs(value: unknown): { safe: string[]; unsafeCount: number } {
    const refs = Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
    const safe = refs.filter((ref) => SAFE_REF_PATTERN.test(ref));
    return {
        safe: unique(safe).slice(0, 8),
        unsafeCount: refs.length - safe.length
    };
}

function buildScreenVerification(input: {
    screenPlan: DetailScreenPlan;
    fillPlan?: DetailPageContentFillPlanLike;
    executionStatus?: string;
    factByRef: Map<string, DetailPageContentFactCandidate>;
}): DetailPageContentScreenVerification {
    const issues: DetailPageContentScreenIssueCode[] = [];
    const planRefs = readSupportRefs(input.screenPlan.supportRefs);
    const fillRefs = readSupportRefs(input.fillPlan?.supportRefs);
    const supportRefs = unique([...planRefs.safe, ...fillRefs.safe]);
    if (planRefs.unsafeCount + fillRefs.unsafeCount > 0) issues.push('content_support_ref_unsafe');
    const unknownRefs = supportRefs.filter((ref) => !input.factByRef.has(ref));
    if (unknownRefs.length > 0) issues.push('content_support_ref_unknown');
    const knownRefs = supportRefs.filter((ref) => input.factByRef.has(ref));
    const eligibleRefs = knownRefs.filter((ref) => input.factByRef.get(ref)?.evaluationEligible === true);
    if (knownRefs.length > 0 && eligibleRefs.length === 0) issues.push('content_support_ref_unconfirmed');
    const appliedCopies = (input.fillPlan?.copies || []).filter((copy) => (
        cleanText(copy?.content)
        && cleanText(copy?.generationStatus) !== 'failed'
    ));
    const appliedCopyCount = appliedCopies.length;
    const supportedCopyCount = appliedCopies.filter((copy) => eligibleRefs.some((ref) => {
        const fact = input.factByRef.get(ref);
        return fact ? statementsMatch(copy.content, fact.statement) : false;
    })).length;
    if (String(input.executionStatus || '').startsWith('failed')) issues.push('screen_execution_failed');
    if (input.screenPlan.requiresModelDecision || cleanText(input.screenPlan.mainMessage).includes('待模型')) {
        issues.push('screen_decision_incomplete');
    }
    if (appliedCopyCount === 0) issues.push('applied_copy_missing');
    if (appliedCopyCount > 0 && eligibleRefs.length > 0 && supportedCopyCount === 0) {
        issues.push('applied_copy_not_supported');
    }
    if (knownRefs.length === 0) issues.push('content_support_ref_missing');
    const hasFailure = issues.some((issue) => [
        'screen_execution_failed',
        'screen_decision_incomplete',
        'content_support_ref_unknown',
        'content_support_ref_unsafe'
    ].includes(issue));
    const status: DetailPageContentScreenVerification['status'] = hasFailure
        ? 'failed'
        : issues.length > 0 ? 'needs_review' : 'passed';
    return {
        screenId: Number(input.screenPlan.screenId || 0),
        status,
        appliedCopyCount,
        supportedCopyCount,
        supportRefs: knownRefs,
        sourceKinds: unique(knownRefs
            .map((ref) => input.factByRef.get(ref)?.source)
            .filter((source): source is DetailPageContentFactSource => Boolean(source))),
        issueCodes: unique(issues)
    };
}

function roundRatio(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export function buildDetailPageContentVerification(input: {
    state?: DesignProjectState | null;
    screenPlans?: readonly DetailScreenPlan[];
    fillPlans?: readonly DetailPageContentFillPlanLike[];
    executionResults?: readonly DetailPageContentExecutionResultLike[];
}): DetailPageContentVerification {
    const catalog = buildDetailPageContentFactCatalog(input);
    const factByRef = new Map(catalog.map((fact) => [fact.ref, fact]));
    const fillPlanByScreenId = new Map((input.fillPlans || []).map((plan) => [Number(plan.screenId || 0), plan]));
    const executionByScreenId = new Map((input.executionResults || []).map((result) => [Number(result.screenId || 0), result.status]));
    const screens = (input.screenPlans || []).map((screenPlan) => buildScreenVerification({
        screenPlan,
        fillPlan: fillPlanByScreenId.get(Number(screenPlan.screenId || 0)),
        executionStatus: executionByScreenId.get(Number(screenPlan.screenId || 0)),
        factByRef
    }));
    const passedScreenCount = screens.filter((screen) => screen.status === 'passed').length;
    const needsReviewScreenCount = screens.filter((screen) => screen.status === 'needs_review').length;
    const failedScreenCount = screens.filter((screen) => screen.status === 'failed').length;
    const linkedScreenCount = screens.filter((screen) => screen.supportRefs.length > 0).length;
    const appliedCopyScreenCount = screens.filter((screen) => screen.appliedCopyCount > 0).length;
    const supportedCopyScreenCount = screens.filter((screen) => screen.supportedCopyCount > 0).length;
    const status: DetailPageContentVerification['status'] = failedScreenCount > 0
        ? 'failed'
        : screens.length > 0 && passedScreenCount === screens.length
            ? 'passed'
            : 'needs_review';
    return {
        version: 'detail-page-content-verification/v0',
        status,
        summary: {
            screenCount: screens.length,
            passedScreenCount,
            needsReviewScreenCount,
            failedScreenCount,
            linkedScreenCount,
            appliedCopyScreenCount,
            supportedCopyScreenCount,
            supportCoverageRatio: roundRatio(screens.length > 0 ? linkedScreenCount / screens.length : 0),
            factCount: catalog.length,
            confirmedFactCount: catalog.filter((fact) => fact.evaluationEligible).length,
            unconfirmedFactCount: catalog.filter((fact) => !fact.evaluationEligible).length
        },
        screens,
        issueCodes: unique(screens.flatMap((screen) => screen.issueCodes)),
        verificationPassed: status === 'passed',
        boundaries: {
            executesTools: false,
            callsModel: false,
            containsFactStatements: false,
            containsPaths: false,
            performsSemanticInference: false,
            claimsDesignQuality: false
        }
    };
}
