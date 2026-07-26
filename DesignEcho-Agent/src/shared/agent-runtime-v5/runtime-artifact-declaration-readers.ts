/**
 * Runtime Artifact 声明的环境无关严格读取器。
 *
 * R1/R3/R4 的上下文校验器仍是声明生成时的第一真相源；这里用候选声明自身可证明的
 * Context/Capability 集合重放同一套结构校验，再要求结果与候选逐字段一致。这样发布边界
 * 不会把空壳、未知嵌套字段、失真的 readiness/graph/boundaries 当成已校验声明。
 */

import type { DesignVerdict } from '../design-quality-verdict-bundle';
import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './capability-provider-identities';
import type {
    SkillRuntimeInputSourceKind,
    SkillRuntimeInputSourceMap
} from './contracts';
import {
    validateRuntimeActionPlanDeclaration,
    type RuntimeActionPlanDeclaration
} from './runtime-action-plan-declaration';
import type { RuntimeActionPlanResumeFreshness } from './runtime-action-plan-resume-freshness';
import type { RuntimeDeliveryVerification } from './runtime-delivery-receipt';
import {
    validateRuntimeDesignBriefDeclaration,
    type RuntimeDesignBriefDeclaration,
    type RuntimeDesignBriefResolvedInput
} from './runtime-design-brief-declaration';
import {
    validateRuntimeDesignStrategyDeclaration,
    type RuntimeDesignStrategyDeclaration,
    type RuntimeDesignStrategyDigest
} from './runtime-design-strategy-declaration';

const INPUT_SOURCE_KINDS: readonly SkillRuntimeInputSourceKind[] = Object.freeze([
    'user_goal',
    'structured_input',
    'attached_image',
    'project_asset',
    'selected_project_asset',
    'project_product',
    'project_sku',
    'project_template',
    'project_context',
    'photoshop_document',
    'photoshop_target'
]);

const EVALUATION_STATUSES = Object.freeze([
    'passed',
    'failed',
    'needs_review',
    'passed_unverified',
    'not_applicable'
]);
const EVALUATION_SOURCES = Object.freeze(['contract', 'scorecard', 'contract+scorecard', 'none']);
const SCORECARD_GATES = Object.freeze([
    'passed',
    'failed',
    'needs_review',
    'incomplete_verification',
    'insufficient_observations'
]);
const DELIVERY_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
    value: Record<string, unknown>,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = []
): boolean {
    const actual = Object.keys(value);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
        && actual.every((key) => allowed.has(key));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => sameJsonValue(item, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => (
            Object.prototype.hasOwnProperty.call(right, key)
            && sameJsonValue(left[key], right[key])
        ));
}

function readStringArray(
    value: unknown,
    maximum: number,
    options: { identifiersOnly?: boolean; allowDuplicates?: boolean } = {}
): string[] | undefined {
    if (!Array.isArray(value) || value.length > maximum) return undefined;
    const values: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string' || !item || item.length > 1000) return undefined;
        if (options.identifiersOnly && !DELIVERY_IDENTIFIER_PATTERN.test(item)) return undefined;
        values.push(item);
    }
    if (!options.allowDuplicates && new Set(values).size !== values.length) return undefined;
    return values;
}

function readBriefInputSource(
    inputKey: string,
    contextRef: string
): SkillRuntimeInputSourceKind | undefined {
    const prefix = `input:${inputKey}:`;
    if (!contextRef.startsWith(prefix)) return undefined;
    const sourceKind = contextRef.slice(prefix.length) as SkillRuntimeInputSourceKind;
    return INPUT_SOURCE_KINDS.includes(sourceKind) ? sourceKind : undefined;
}

function buildBriefReplayContext(payload: Record<string, unknown>, readiness: unknown): {
    requiredInputKeys: string[];
    optionalInputKeys: string[];
    inputSources: SkillRuntimeInputSourceMap;
    resolvedInputs: RuntimeDesignBriefResolvedInput[];
} | undefined {
    if (!Array.isArray(payload.inputCoverage)) return undefined;
    const inputKeys: string[] = [];
    const nonProvidedInputKeys: string[] = [];
    const inputSources: SkillRuntimeInputSourceMap = {};
    const resolvedInputs: RuntimeDesignBriefResolvedInput[] = [];
    for (const candidate of payload.inputCoverage) {
        if (!isRecord(candidate) || typeof candidate.inputKey !== 'string') return undefined;
        const inputKey = candidate.inputKey;
        if (!inputKey || inputKeys.includes(inputKey)) return undefined;
        inputKeys.push(inputKey);
        if (candidate.status !== 'provided') nonProvidedInputKeys.push(inputKey);
        if (candidate.status !== 'provided') continue;
        if (!Array.isArray(candidate.contextRefs)) return undefined;
        for (const contextRef of candidate.contextRefs) {
            if (typeof contextRef !== 'string') return undefined;
            const sourceKind = readBriefInputSource(inputKey, contextRef);
            if (!sourceKind) return undefined;
            const kinds = inputSources[inputKey] || [];
            if (!kinds.includes(sourceKind)) inputSources[inputKey] = [...kinds, sourceKind];
            resolvedInputs.push({ inputKey, sourceKind, contextRef });
        }
    }
    if (readiness === 'needs_input' && nonProvidedInputKeys.length === 0) return undefined;
    const requiredInputKeys = readiness === 'needs_input' ? nonProvidedInputKeys.slice(0, 1) : [];
    return {
        requiredInputKeys,
        optionalInputKeys: inputKeys.filter((key) => !requiredInputKeys.includes(key)),
        inputSources,
        resolvedInputs
    };
}

export function readStrictRuntimeDesignBriefDeclaration(
    value: unknown
): RuntimeDesignBriefDeclaration | undefined {
    if (!isRecord(value) || !isRecord(value.payload)) return undefined;
    const replayContext = buildBriefReplayContext(value.payload, value.readiness);
    if (!replayContext) return undefined;
    const allowedContextRefs = Array.isArray(value.payload.contextRefs)
        ? value.payload.contextRefs.filter((item): item is string => typeof item === 'string')
        : [];
    const validation = validateRuntimeDesignBriefDeclaration({
        value: value.payload,
        requiredInputKeys: replayContext.requiredInputKeys,
        optionalInputKeys: replayContext.optionalInputKeys,
        allowedContextRefs,
        inputSources: replayContext.inputSources,
        resolvedInputs: replayContext.resolvedInputs,
        workModeRequired: false
    });
    if (!validation.ok || !validation.declaration) return undefined;
    return sameJsonValue(validation.declaration, value) ? validation.declaration : undefined;
}

export function readStrictRuntimeDesignStrategyDeclaration(
    value: unknown
): RuntimeDesignStrategyDeclaration | undefined {
    if (!isRecord(value) || !isRecord(value.payload)) return undefined;
    const allowedContextRefs = Array.isArray(value.payload.contextRefs)
        ? value.payload.contextRefs.filter((item): item is string => typeof item === 'string')
        : [];
    const validation = validateRuntimeDesignStrategyDeclaration({
        value: value.payload,
        allowedContextRefs
    });
    if (!validation.ok || !validation.declaration) return undefined;
    return sameJsonValue(validation.declaration, value) ? validation.declaration : undefined;
}

function readActionPlanReplayContext(value: Record<string, unknown>): {
    allowedContextRefs: string[];
    discoveredCapabilityRefs: string[];
    activeActionCapabilityRefs: string[];
    onDemandActionCapabilityRefs: string[];
    priorStepIds: string[];
} | undefined {
    if (!isRecord(value.payload)
        || !Array.isArray(value.payload.contextRefs)
        || !Array.isArray(value.payload.steps)
        || !Array.isArray(value.missingCapabilityRefs)) {
        return undefined;
    }
    const allowedContextRefs = value.payload.contextRefs
        .filter((item): item is string => typeof item === 'string');
    const discoveredCapabilityRefs: string[] = [];
    const priorStepIds: string[] = [];
    for (const step of value.payload.steps) {
        if (!isRecord(step)
            || !Array.isArray(step.capabilityRefs)
            || !Array.isArray(step.inputContextRefs)) {
            return undefined;
        }
        for (const ref of step.capabilityRefs) {
            if (typeof ref !== 'string') return undefined;
            if (!discoveredCapabilityRefs.includes(ref)) discoveredCapabilityRefs.push(ref);
        }
        for (const ref of step.inputContextRefs) {
            if (typeof ref !== 'string') return undefined;
            if (!allowedContextRefs.includes(ref)) allowedContextRefs.push(ref);
        }
        if (step.resumeMapping !== undefined) {
            if (!isRecord(step.resumeMapping) || typeof step.resumeMapping.priorStepId !== 'string') {
                return undefined;
            }
            priorStepIds.push(step.resumeMapping.priorStepId);
        }
    }
    const onDemandActionCapabilityRefs = value.missingCapabilityRefs
        .filter((item): item is string => typeof item === 'string');
    return {
        allowedContextRefs,
        discoveredCapabilityRefs,
        activeActionCapabilityRefs: discoveredCapabilityRefs
            .filter((ref) => !onDemandActionCapabilityRefs.includes(ref)),
        onDemandActionCapabilityRefs,
        priorStepIds
    };
}

function buildVerifiedResumeFreshness(priorStepIds: readonly string[]): RuntimeActionPlanResumeFreshness {
    return {
        version: 'runtime-action-plan-resume-freshness/v0',
        sourceRunId: 'strict-shape-replay',
        status: 'verified',
        documentMatch: 'matched',
        projectStateMatch: 'not_required',
        verifiedCompletedStepIds: Array.from(new Set(priorStepIds)),
        invalidatedCompletedStepIds: [],
        verifiedCompletedSteps: [],
        invalidatedCompletedSteps: [],
        verifiedResumeStepIds: [],
        invalidatedResumeStepIds: [],
        reasons: [],
        boundaries: {
            observationOnly: true,
            advisoryOnly: true,
            taskRelatednessModelOwned: true,
            executesTools: false,
            executesWrites: false,
            blocksTask: false,
            autoSkipsSteps: false,
            autoRecoversSteps: false,
            schedulerAuthority: false,
            grantsPermission: false,
            countsAsTaskProgress: false,
            countsAsQualityPass: false
        }
    };
}

function buildReadyStrategyDigest(): RuntimeDesignStrategyDigest {
    return {
        version: 'runtime-design-strategy-digest/v0',
        readiness: 'ready',
        stageGoal: 'strict-shape-replay',
        primaryGoal: 'strict-shape-replay',
        targetAudienceSummary: 'strict-shape-replay',
        primaryMessage: 'strict-shape-replay',
        moodKeywords: [],
        compositionIntent: [],
        contextRefs: ['context:design_strategy'],
        constraintCount: 0,
        assumptionCount: 0,
        missingInputCount: 0,
        boundaries: {
            digestOnly: true,
            modelAuthored: true,
            artifactPublished: false,
            changesTaskResult: false
        }
    };
}

export function readStrictRuntimeActionPlanDeclaration(
    value: unknown
): RuntimeActionPlanDeclaration | undefined {
    if (!isRecord(value)) return undefined;
    const replayContext = readActionPlanReplayContext(value);
    if (!replayContext || !isRecord(value.payload)) return undefined;
    const validation = validateRuntimeActionPlanDeclaration({
        value: value.payload,
        strategyDigest: buildReadyStrategyDigest(),
        allowedContextRefs: replayContext.allowedContextRefs,
        capabilityContext: {
            discoveredCapabilityRefs: replayContext.discoveredCapabilityRefs,
            activeActionCapabilityRefs: replayContext.activeActionCapabilityRefs,
            onDemandActionCapabilityRefs: replayContext.onDemandActionCapabilityRefs
        },
        ...(replayContext.priorStepIds.length > 0
            ? { resumeFreshness: buildVerifiedResumeFreshness(replayContext.priorStepIds) }
            : {})
    });
    if (!validation.ok || !validation.declaration) return undefined;
    return sameJsonValue(validation.declaration, value) ? validation.declaration : undefined;
}

export function readStrictDesignVerdict(value: unknown): DesignVerdict | undefined {
    if (!isRecord(value)
        || !hasExactKeys(
            value,
            ['version', 'status', 'source', 'contractFailedRequirementIds', 'blockers', 'warnings', 'summary'],
            ['contractStatus', 'scorecardGate', 'overallScore']
        )
        || value.version !== DESIGN_QUALITY_VERDICT_CAPABILITY_ID
        || typeof value.status !== 'string'
        || !EVALUATION_STATUSES.includes(value.status)
        || typeof value.source !== 'string'
        || !EVALUATION_SOURCES.includes(value.source)
        || typeof value.summary !== 'string'
        || !value.summary
        || value.summary.length > 2000) {
        return undefined;
    }
    const failedIds = readStringArray(value.contractFailedRequirementIds, 64, { allowDuplicates: true });
    const blockers = readStringArray(value.blockers, 64, { allowDuplicates: true });
    const warnings = readStringArray(value.warnings, 64, { allowDuplicates: true });
    if (!failedIds || !blockers || !warnings) return undefined;
    if (value.contractStatus !== undefined
        && (typeof value.contractStatus !== 'string' || !value.contractStatus || value.contractStatus.length > 120)) {
        return undefined;
    }
    if (value.scorecardGate !== undefined
        && (typeof value.scorecardGate !== 'string' || !SCORECARD_GATES.includes(value.scorecardGate))) {
        return undefined;
    }
    if (value.overallScore !== undefined
        && (typeof value.overallScore !== 'number'
            || !Number.isFinite(value.overallScore)
            || value.overallScore < 0
            || value.overallScore > 100)) {
        return undefined;
    }
    if ((value.scorecardGate === undefined) !== (value.overallScore === undefined)) return undefined;
    if (value.status === 'failed' && blockers.length === 0) return undefined;
    if (value.status !== 'failed' && blockers.length > 0) return undefined;
    if (value.source === 'none'
        && (value.status !== 'not_applicable'
            || failedIds.length > 0
            || blockers.length > 0
            || value.scorecardGate !== undefined)) {
        return undefined;
    }
    return value as unknown as DesignVerdict;
}

export function readStrictRuntimeDeliveryVerification(
    value: unknown
): RuntimeDeliveryVerification | undefined {
    if (!isRecord(value)
        || !hasExactKeys(value, [
            'version',
            'status',
            'requiredOutputs',
            'confirmedOutputs',
            'missingOutputs',
            'targetBound',
            'reviewedPreviewBound',
            'sourceHistoryStateBound',
            'boundaries'
        ])
        || value.version !== 'runtime-delivery-verification/v1'
        || (value.status !== 'passed' && value.status !== 'incomplete')
        || typeof value.targetBound !== 'boolean'
        || typeof value.reviewedPreviewBound !== 'boolean'
        || typeof value.sourceHistoryStateBound !== 'boolean'
        || !isRecord(value.boundaries)
        || !hasExactKeys(value.boundaries, [
            'manifestRequirementsOnly',
            'explicitReceiptRequired',
            'sameTargetPreviewRequired',
            'exactSourceHistoryRequired',
            'qualityVerdictAuthority',
            'grantsPermission',
            'executesTools'
        ])) {
        return undefined;
    }
    const requiredOutputs = readStringArray(value.requiredOutputs, 32, { identifiersOnly: true });
    const confirmedOutputs = readStringArray(value.confirmedOutputs, 32, { identifiersOnly: true });
    const missingOutputs = readStringArray(value.missingOutputs, 32, { identifiersOnly: true });
    if (!requiredOutputs || !confirmedOutputs || !missingOutputs) return undefined;
    const expectedMissing = requiredOutputs.filter((output) => !confirmedOutputs.includes(output));
    if (!sameJsonValue(expectedMissing, missingOutputs)
        || (value.reviewedPreviewBound && !value.targetBound)
        || (value.sourceHistoryStateBound && !value.reviewedPreviewBound)
        || (value.status === 'passed'
            && (requiredOutputs.length === 0
                || missingOutputs.length > 0
                || !value.targetBound
                || !value.reviewedPreviewBound
                || !value.sourceHistoryStateBound))) {
        return undefined;
    }
    const boundaries = value.boundaries;
    if (boundaries.manifestRequirementsOnly !== true
        || boundaries.explicitReceiptRequired !== true
        || boundaries.sameTargetPreviewRequired !== true
        || boundaries.exactSourceHistoryRequired !== true
        || boundaries.qualityVerdictAuthority !== false
        || boundaries.grantsPermission !== false
        || boundaries.executesTools !== false) {
        return undefined;
    }
    return value as unknown as RuntimeDeliveryVerification;
}
