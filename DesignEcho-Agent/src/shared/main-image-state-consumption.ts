import type {
    DesignProjectCopywritingItem,
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';
import type { MainImageReferenceHint } from './main-image-project-style-strategy';
import {
    buildDesignProjectFactProvenanceSummary,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';

export type MainImageStateVersionAction = 'strategy' | 'execute' | 'export';

export interface MainImageCompositionVersion {
    id: string;
    name: string;
    imageType: 'click' | 'conversion' | 'main-image';
    objective: string;
    mainCopy: string;
    supportingPoints: string[];
    visualDirection: string;
    layoutIntent: string;
    sourceContext: string[];
}

export interface MainImageStateContext {
    projectStateAvailable: boolean;
    targetUser: string;
    visualDirection: string;
    brandStyle: string;
    copyCandidates: string[];
    referenceHints: MainImageReferenceHint[];
    compositionVersions: MainImageCompositionVersion[];
    sourceSummary: {
        copywritingCount: number;
        sellingPointCount: number;
        painPointCount: number;
        hasVisualDirection: boolean;
        confirmedFactCount: number;
        pendingFactCount: number;
    };
}

export interface MainImageStateContextInput {
    state?: DesignProjectState | null;
    imageType?: string;
    requestedVersionCount?: number;
}

export interface MainImageStateVersionPatchInput {
    action: MainImageStateVersionAction;
    compositionVersions?: MainImageCompositionVersion[];
    selectedVersionId?: string;
    reason?: string;
    exportedFileCount?: number;
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown, limit = 12): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = cleanText(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeCopywritingItems(value: unknown): DesignProjectCopywritingItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            const record = item as Partial<DesignProjectCopywritingItem>;
            const slot = cleanText(record?.slot);
            const text = cleanText(record?.text);
            const basis = cleanText(record?.basis);
            if (!slot || !text) return null;
            return {
                slot,
                text,
                ...(basis ? { basis } : {})
            };
        })
        .filter(Boolean)
        .slice(0, 12) as DesignProjectCopywritingItem[];
}

function normalizeImageType(value: unknown): MainImageCompositionVersion['imageType'] {
    const text = cleanText(value).toLowerCase();
    if (text === 'conversion' || text.includes('转化')) return 'conversion';
    if (text === 'click' || text.includes('点击')) return 'click';
    return 'main-image';
}

function buildCopyCandidates(input: {
    copywriting: DesignProjectCopywritingItem[];
    sellingPoints: string[];
}): string[] {
    return uniqueClean([
        ...input.copywriting.map((item) => item.text),
        ...input.sellingPoints
    ], 10);
}

function buildReferenceHints(input: {
    targetUser: string;
    visualDirection: string;
    brandStyle: string;
    painPoints: string[];
}): MainImageReferenceHint[] {
    const hints: MainImageReferenceHint[] = [];
    if (input.visualDirection) {
        hints.push({
            title: '项目状态视觉方向',
            source: 'Design Project State',
            note: input.visualDirection
        });
    }
    if (input.targetUser) {
        hints.push({
            title: '目标用户',
            source: 'Design Project State',
            note: input.targetUser
        });
    }
    if (input.brandStyle) {
        hints.push({
            title: '品牌风格',
            source: 'Design Project State',
            note: input.brandStyle
        });
    }
    if (input.painPoints.length > 0) {
        hints.push({
            title: '用户痛点',
            source: 'Design Project State',
            note: input.painPoints.slice(0, 4).join(' / ')
        });
    }
    return hints;
}

function composeSourceContext(input: {
    copy?: DesignProjectCopywritingItem;
    sellingPoints: string[];
    painPoints: string[];
    targetUser: string;
    visualDirection: string;
}): string[] {
    return uniqueClean([
        input.copy?.basis,
        ...input.sellingPoints.map((point) => `卖点：${point}`),
        ...input.painPoints.map((point) => `痛点：${point}`),
        input.targetUser && `目标用户：${input.targetUser}`,
        input.visualDirection && `视觉方向：${input.visualDirection}`
    ], 8);
}

function buildLayoutIntent(input: {
    versionIndex: number;
    visualDirection: string;
    targetUser: string;
}): string {
    if (input.versionIndex === 0) {
        return `主体放大为第一视觉，短文案靠近安全区，背景服务商品识别；${input.visualDirection || '风格由素材和平台规范决定'}。`;
    }
    if (input.versionIndex === 1) {
        return `主体保持清晰，文案围绕痛点或购买理由建立对比，减少装饰堆叠；${input.targetUser ? `优先贴近${input.targetUser}。` : '优先贴近目标用户。'}`;
    }
    return `主体、留白和文字形成更强呼吸感，强调调性统一和材质真实；${input.visualDirection || '不牺牲商品可读性。'}`;
}

function buildCompositionVersions(input: {
    imageType: MainImageCompositionVersion['imageType'];
    copywriting: DesignProjectCopywritingItem[];
    sellingPoints: string[];
    painPoints: string[];
    targetUser: string;
    visualDirection: string;
    requestedVersionCount?: number;
}): MainImageCompositionVersion[] {
    const hasStateSignal = input.copywriting.length > 0
        || input.sellingPoints.length > 0
        || input.painPoints.length > 0
        || Boolean(input.visualDirection)
        || Boolean(input.targetUser);
    if (!hasStateSignal) return [];

    const count = Math.max(2, Math.min(3, Math.round(Number(input.requestedVersionCount || 3))));
    const copyCandidates: DesignProjectCopywritingItem[] = input.copywriting.length > 0
        ? input.copywriting
        : input.sellingPoints.map((point, index) => ({ slot: `卖点 ${index + 1}`, text: point }));

    return Array.from({ length: count }).map((_, index) => {
        const copy = copyCandidates[index % Math.max(1, copyCandidates.length)];
        const mainCopy = cleanText(copy?.text) || input.sellingPoints[index % Math.max(1, input.sellingPoints.length)] || '待模型基于项目状态确定主文案';
        const supportingPoints = uniqueClean([
            copy?.basis,
            input.sellingPoints[index],
            input.sellingPoints[(index + 1) % Math.max(1, input.sellingPoints.length)],
            input.painPoints[index],
            input.targetUser
        ], 5);
        const imageType = index === 1 && input.imageType === 'click'
            ? 'conversion'
            : input.imageType;
        return {
            id: `state-main-image-v${index + 1}`,
            name: index === 0 ? '主体点击方案' : index === 1 ? '痛点转化方案' : '调性延展方案',
            imageType,
            objective: index === 0
                ? '先抓点击，确保用户第一眼识别商品和核心卖点。'
                : index === 1
                    ? '解释购买理由，把卖点和用户顾虑连接起来。'
                    : '延展视觉调性，为同款多尺寸和系列图保持统一。',
            mainCopy,
            supportingPoints,
            visualDirection: input.visualDirection,
            layoutIntent: buildLayoutIntent({
                versionIndex: index,
                visualDirection: input.visualDirection,
                targetUser: input.targetUser
            }),
            sourceContext: composeSourceContext({
                copy: copy as DesignProjectCopywritingItem | undefined,
                sellingPoints: input.sellingPoints,
                painPoints: input.painPoints,
                targetUser: input.targetUser,
                visualDirection: input.visualDirection
            })
        };
    });
}

export function buildMainImageStateContext(input: MainImageStateContextInput): MainImageStateContext {
    const state = input.state || null;
    const copywriting = normalizeCopywritingItems(state?.copywriting);
    const factRecords = listDesignProjectFactRecords(state);
    const sellingPoints = uniqueClean(factRecords
        .filter((fact) => fact.claimType === 'selling_point' && fact.status === 'active' && fact.confirmation !== 'rejected')
        .map((fact) => fact.statement), 8);
    const factSummary = buildDesignProjectFactProvenanceSummary(state);
    const painPoints = uniqueClean(state?.painPoints, 6);
    const targetUser = cleanText(state?.targetUser);
    const visualDirection = cleanText(state?.visualDirection);
    const brandStyle = cleanText(state?.brandStyle);
    const imageType = normalizeImageType(input.imageType);
    const copyCandidates = buildCopyCandidates({ copywriting, sellingPoints });
    const referenceHints = buildReferenceHints({
        targetUser,
        visualDirection,
        brandStyle,
        painPoints
    });
    const compositionVersions = buildCompositionVersions({
        imageType,
        copywriting,
        sellingPoints,
        painPoints,
        targetUser,
        visualDirection,
        requestedVersionCount: input.requestedVersionCount
    });

    return {
        projectStateAvailable: Boolean(state),
        targetUser,
        visualDirection,
        brandStyle,
        copyCandidates,
        referenceHints,
        compositionVersions,
        sourceSummary: {
            copywritingCount: copywriting.length,
            sellingPointCount: sellingPoints.length,
            painPointCount: painPoints.length,
            hasVisualDirection: Boolean(visualDirection),
            confirmedFactCount: factSummary.userConfirmed + factSummary.sourceSupported,
            pendingFactCount: factSummary.needsReview
        }
    };
}

export function mergeMainImageStateCopyCandidates(
    currentCandidates: unknown,
    stateContext: MainImageStateContext | null | undefined,
    limit = 5
): string[] {
    return uniqueClean([
        ...uniqueClean(currentCandidates, limit),
        ...(stateContext?.copyCandidates || [])
    ], limit);
}

export function mergeMainImageStateReferenceHints(
    currentHints: unknown,
    stateContext: MainImageStateContext | null | undefined,
    limit = 8
): MainImageReferenceHint[] {
    const existing = Array.isArray(currentHints) ? currentHints : [];
    const merged = [
        ...existing,
        ...(stateContext?.referenceHints || [])
    ];
    const seen = new Set<string>();
    const result: MainImageReferenceHint[] = [];
    for (const hint of merged) {
        const record = hint as MainImageReferenceHint;
        const key = [
            cleanText(record.title),
            cleanText(record.source),
            cleanText(record.url),
            cleanText(record.note)
        ].filter(Boolean).join('|');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(record);
        if (result.length >= limit) break;
    }
    return result;
}

function formatActionLabel(action: MainImageStateVersionAction): string {
    switch (action) {
        case 'execute':
            return '主图执行';
        case 'export':
            return '主图导出';
        default:
            return '主图多版本方案';
    }
}

export function buildMainImageStateVersionPatch(input: MainImageStateVersionPatchInput): DesignProjectStatePatch | null {
    const versions = Array.isArray(input.compositionVersions) ? input.compositionVersions : [];
    const selected = input.selectedVersionId
        ? versions.find((version) => version.id === input.selectedVersionId)
        : versions[0];
    const reasonParts = [
        formatActionLabel(input.action),
        versions.length > 0 ? `候选 ${versions.length} 个` : '',
        selected?.name ? `选用 ${selected.name}` : '',
        cleanText(input.reason),
        Number(input.exportedFileCount || 0) > 0 ? `导出 ${Number(input.exportedFileCount)} 个文件` : ''
    ].filter(Boolean);
    if (reasonParts.length === 0) return null;
    return {
        appendVersion: {
            reason: reasonParts.join('；')
        },
        updatedBy: 'main-image-design'
    };
}
