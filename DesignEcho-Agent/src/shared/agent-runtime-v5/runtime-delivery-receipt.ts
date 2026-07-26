/**
 * E2 交付收据契约。
 *
 * 复合 Skill 可以声明自己真实形成了哪些交付物；Runtime 仍会独立核对目标文档、
 * 文件提交时的源 Host 版本、已复核全图和 Manifest 要求。普通 success、旧收据、
 * 同文档不同 revision 或未读图截图都不能直接推进 E2。
 */

import {
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../photoshop-history-state-ref';
import {
    sameRuntimeExecutionDocument,
    type RuntimeExecutionTargetAnchor
} from './runtime-execution-target';

export const RUNTIME_DELIVERY_RECEIPT_VERSION = 'runtime-delivery-receipt/v1' as const;
const LEGACY_RUNTIME_DELIVERY_RECEIPT_VERSION = 'runtime-delivery-receipt/v0' as const;

export interface RuntimeDeliveryReceipt {
    version: typeof RUNTIME_DELIVERY_RECEIPT_VERSION;
    status: 'ready' | 'incomplete';
    outputs: string[];
    resultRefs: string[];
    issues: string[];
    /** 实际保存/导出边界所读取的源 Photoshop 文档版本；不是普通观察信用。 */
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    boundaries: {
        workflowDeclaredOnly: true;
        targetVerifiedByRuntime: false;
        previewVerifiedByRuntime: false;
        sourceHistoryDeclaredOnly: true;
        sourceHistoryVerifiedByRuntime: false;
        grantsPermission: false;
        changesQualityVerdict: false;
        completesDeliveryByItself: false;
    };
}

export interface RuntimeDeliveryVerification {
    version: 'runtime-delivery-verification/v1';
    status: 'passed' | 'incomplete';
    requiredOutputs: string[];
    confirmedOutputs: string[];
    missingOutputs: string[];
    targetBound: boolean;
    reviewedPreviewBound: boolean;
    sourceHistoryStateBound: boolean;
    boundaries: {
        manifestRequirementsOnly: true;
        explicitReceiptRequired: true;
        sameTargetPreviewRequired: true;
        exactSourceHistoryRequired: true;
        qualityVerdictAuthority: false;
        grantsPermission: false;
        executesTools: false;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueIdentifiers(values: readonly unknown[], limit = 32): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value))))
        .slice(0, limit);
}

function uniqueText(values: readonly unknown[], limit = 24): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter(Boolean)))
        .slice(0, limit);
}

export function buildRuntimeDeliveryReceipt(input: {
    status: RuntimeDeliveryReceipt['status'];
    outputs: readonly string[];
    resultRefs: readonly string[];
    issues?: readonly string[];
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeDeliveryReceipt {
    const outputs = uniqueIdentifiers(input.outputs);
    const resultRefs = uniqueIdentifiers(input.resultRefs, 48);
    const issues = uniqueText(input.issues || []);
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef({
        sourceHistoryStateRef: input.sourceHistoryStateRef
    });
    const ready = input.status === 'ready'
        && outputs.length > 0
        && resultRefs.length > 0
        && Boolean(sourceHistoryStateRef)
        && issues.length === 0;
    return {
        version: RUNTIME_DELIVERY_RECEIPT_VERSION,
        status: ready ? 'ready' : 'incomplete',
        outputs,
        resultRefs,
        issues,
        ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
        boundaries: {
            workflowDeclaredOnly: true,
            targetVerifiedByRuntime: false,
            previewVerifiedByRuntime: false,
            sourceHistoryDeclaredOnly: true,
            sourceHistoryVerifiedByRuntime: false,
            grantsPermission: false,
            changesQualityVerdict: false,
            completesDeliveryByItself: false
        }
    };
}

export function readRuntimeDeliveryReceipt(toolResult: unknown): RuntimeDeliveryReceipt | undefined {
    if (!isRecord(toolResult) || !isRecord(toolResult.data)) return undefined;
    const candidate = toolResult.data.runtimeDeliveryReceipt;
    if (!isRecord(candidate)
        || (candidate.version !== RUNTIME_DELIVERY_RECEIPT_VERSION
            && candidate.version !== LEGACY_RUNTIME_DELIVERY_RECEIPT_VERSION)
        || (candidate.status !== 'ready' && candidate.status !== 'incomplete')
        || !Array.isArray(candidate.outputs)
        || !Array.isArray(candidate.resultRefs)
        || !Array.isArray(candidate.issues)) {
        return undefined;
    }
    return buildRuntimeDeliveryReceipt({
        // v0 没有源 Host 版本，只能作为 legacy/incomplete 读取，绝不能推进 E2。
        status: candidate.version === RUNTIME_DELIVERY_RECEIPT_VERSION
            ? candidate.status
            : 'incomplete',
        outputs: candidate.outputs,
        resultRefs: candidate.resultRefs,
        issues: candidate.issues,
        sourceHistoryStateRef: readPhotoshopSourceHistoryStateRef(candidate)
    });
}

export function verifyRuntimeDelivery(input: {
    requiredOutputs: readonly string[];
    receipt: RuntimeDeliveryReceipt | undefined;
    receiptTarget: RuntimeExecutionTargetAnchor | undefined;
    reviewedPreviewTarget?: RuntimeExecutionTargetAnchor;
    reviewedPreviewHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeDeliveryVerification {
    const requiredOutputs = uniqueIdentifiers(input.requiredOutputs);
    const targetBound = Boolean(input.receiptTarget);
    const reviewedPreviewBound = sameRuntimeExecutionDocument(
        input.receiptTarget,
        input.reviewedPreviewTarget
    );
    const sourceHistoryStateBound = reviewedPreviewBound
        && samePhotoshopHistoryStateRef(
            input.receipt?.sourceHistoryStateRef,
            input.reviewedPreviewHistoryStateRef
        );
    const confirmedOutputs = input.receipt?.status === 'ready'
        && targetBound
        && sourceHistoryStateBound
        ? uniqueIdentifiers([
            ...input.receipt.outputs,
            'delivery_record',
            'preview'
        ])
        : [];
    const missingOutputs = requiredOutputs.filter((output) => !confirmedOutputs.includes(output));
    return {
        version: 'runtime-delivery-verification/v1',
        status: input.receipt?.status === 'ready'
            && targetBound
            && sourceHistoryStateBound
            && requiredOutputs.length > 0
            && missingOutputs.length === 0
            ? 'passed'
            : 'incomplete',
        requiredOutputs,
        confirmedOutputs,
        missingOutputs,
        targetBound,
        reviewedPreviewBound,
        sourceHistoryStateBound,
        boundaries: {
            manifestRequirementsOnly: true,
            explicitReceiptRequired: true,
            sameTargetPreviewRequired: true,
            exactSourceHistoryRequired: true,
            qualityVerdictAuthority: false,
            grantsPermission: false,
            executesTools: false
        }
    };
}
