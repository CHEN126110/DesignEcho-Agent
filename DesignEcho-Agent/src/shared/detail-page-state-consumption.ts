import type {
    DetailScreenAgentDecision,
    DetailScreenPlanInput
} from './detail-page-screen-plan';
import {
    buildDetailPageContentFactCatalog,
    resolveDetailPageContentSupportRefs,
    type DetailPageContentFactCandidate
} from './detail-page-content-verification';
import type {
    DesignProjectCopywritingItem,
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';
import {
    buildDesignProjectFactProvenanceSummary,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';

export type DetailPageStateAction = 'fill' | 'export' | 'screen-redo';

export interface DetailPageStateContext {
    projectStateAvailable: boolean;
    agentDecisions: DetailScreenAgentDecision[];
    stylePrompts: string[];
    redoScreenIds: number[];
    sourceSummary: {
        copywritingCount: number;
        sellingPointCount: number;
        hasVisualDirection: boolean;
        reviewIssueCount: number;
        confirmedFactCount: number;
        pendingFactCount: number;
    };
}

export interface DetailPageStateContextInput {
    state?: DesignProjectState | null;
    screens?: DetailScreenPlanInput[];
}

export interface DetailPageRedoInput {
    state?: DesignProjectState | null;
    screens?: DetailScreenPlanInput[];
}

export interface DetailPageVersionPatchInput {
    action: DetailPageStateAction;
    screens?: Array<{ id?: number; name?: string }>;
    reason?: string;
    exportedFileCount?: number;
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown, limit = 8): string[] {
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

function normalizeForMatch(value: unknown): string {
    return cleanText(value).toLowerCase().replace(/\s+/g, '');
}

function buildScreenMatchTokens(screen: DetailScreenPlanInput): string[] {
    const name = cleanText(screen.name);
    const type = cleanText(screen.type);
    const tokens = [
        String(screen.id || ''),
        name,
        type,
        ...type.split(/[_\-\s]+/g),
        ...name.split(/[_\-\s]+/g)
    ];

    if (name.length >= 2) tokens.push(name.slice(0, 2));
    if (name.length >= 4) tokens.push(name.slice(0, 4));

    return Array.from(new Set(
        tokens
            .map(normalizeForMatch)
            .filter((token) => token.length >= 2)
    ));
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

function copywritingMatchesScreen(copy: DesignProjectCopywritingItem, screen: DetailScreenPlanInput): boolean {
    const haystack = normalizeForMatch(`${copy.slot} ${copy.basis || ''}`);
    const tokens = buildScreenMatchTokens(screen);
    return tokens.some((token) => haystack.includes(token));
}

function pickScreenCopy(
    copywriting: DesignProjectCopywritingItem[],
    screen: DetailScreenPlanInput
): DesignProjectCopywritingItem | null {
    return copywriting.find((copy) => copywritingMatchesScreen(copy, screen)) || null;
}

function buildSupportingPoints(params: {
    matchedCopy: DesignProjectCopywritingItem | null;
    sellingPoints: string[];
    copywriting: DesignProjectCopywritingItem[];
}): string[] {
    const points = [
        params.matchedCopy?.basis,
        ...params.sellingPoints,
        ...params.copywriting.map((copy) => copy.text)
    ];
    return uniqueStrings(points, 6);
}

function buildStateDecision(params: {
    screen: DetailScreenPlanInput;
    copywriting: DesignProjectCopywritingItem[];
    sellingPoints: string[];
    visualDirection: string;
    factCatalog: DetailPageContentFactCandidate[];
}): DetailScreenAgentDecision | null {
    const matchedCopy = pickScreenCopy(params.copywriting, params.screen);
    const firstCopy = params.copywriting[0] || null;
    const selectedCopy = matchedCopy || firstCopy;
    const firstSellingPoint = params.sellingPoints[0] || '';
    const mainMessage = cleanText(selectedCopy?.text || firstSellingPoint);
    const supportingPoints = buildSupportingPoints({
        matchedCopy,
        sellingPoints: params.sellingPoints,
        copywriting: params.copywriting
    });

    if (!mainMessage && supportingPoints.length === 0 && !params.visualDirection) {
        return null;
    }

    const rationale = [
        '来自项目状态的详情页文案与卖点输入',
        params.visualDirection ? `视觉方向：${params.visualDirection}` : ''
    ].filter(Boolean);
    const supportRefs = resolveDetailPageContentSupportRefs({
        catalog: params.factCatalog,
        statements: [selectedCopy?.basis, mainMessage]
    });

    return {
        screenId: params.screen.id,
        screenName: params.screen.name,
        ...(mainMessage ? { mainMessage } : {}),
        ...(supportingPoints.length > 0 ? { supportingPoints } : {}),
        ...(rationale.length > 0 ? { rationale } : {}),
        ...(supportRefs.length > 0 ? { supportRefs } : {})
    };
}

export function selectDetailPageScreensForStateRedo(input: DetailPageRedoInput): DetailScreenPlanInput[] {
    const screens = Array.isArray(input.screens) ? input.screens : [];
    const issues = Array.isArray(input.state?.reviewResult?.issues) ? input.state?.reviewResult?.issues || [] : [];
    if (screens.length === 0 || issues.length === 0) return [];

    const targetTexts = issues
        .map((issue) => normalizeForMatch(issue?.target))
        .filter((target) => target.length >= 2);
    if (targetTexts.length === 0) return [];

    return screens.filter((screen) => {
        const tokens = buildScreenMatchTokens(screen);
        return targetTexts.some((target) => tokens.some((token) => target.includes(token)));
    });
}

export function buildDetailPageStateContext(input: DetailPageStateContextInput): DetailPageStateContext {
    const state = input.state || null;
    const screens = Array.isArray(input.screens) ? input.screens : [];
    const copywriting = normalizeCopywritingItems(state?.copywriting);
    const factRecords = listDesignProjectFactRecords(state);
    const sellingPoints = uniqueStrings(factRecords
        .filter((fact) => fact.claimType === 'selling_point' && fact.status === 'active' && fact.confirmation !== 'rejected')
        .map((fact) => fact.statement), 8);
    const factSummary = buildDesignProjectFactProvenanceSummary(state);
    const visualDirection = cleanText(state?.visualDirection);
    const factCatalog = buildDetailPageContentFactCatalog({ state });

    const agentDecisions = screens
        .map((screen) => buildStateDecision({
            screen,
            copywriting,
            sellingPoints,
            visualDirection,
            factCatalog
        }))
        .filter(Boolean) as DetailScreenAgentDecision[];

    const stylePrompts = [
        visualDirection ? `视觉方向：${visualDirection}` : '',
        cleanText(state?.brandStyle) ? `品牌风格：${cleanText(state?.brandStyle)}` : ''
    ].filter(Boolean);

    const redoScreens = selectDetailPageScreensForStateRedo({ state, screens });

    return {
        projectStateAvailable: Boolean(state),
        agentDecisions,
        stylePrompts,
        redoScreenIds: redoScreens.map((screen) => Number(screen.id || 0)).filter((id) => id > 0),
        sourceSummary: {
            copywritingCount: copywriting.length,
            sellingPointCount: sellingPoints.length,
            hasVisualDirection: Boolean(visualDirection),
            reviewIssueCount: Array.isArray(state?.reviewResult?.issues) ? state?.reviewResult?.issues?.length || 0 : 0,
            confirmedFactCount: factSummary.userConfirmed + factSummary.sourceSupported,
            pendingFactCount: factSummary.needsReview
        }
    };
}

function formatScreenLabel(screens: DetailPageVersionPatchInput['screens']): string {
    const normalized = (Array.isArray(screens) ? screens : [])
        .map((screen) => cleanText(screen?.name) || (screen?.id ? `屏 ${screen.id}` : ''))
        .filter(Boolean);
    if (normalized.length === 0) return '全部屏';
    if (normalized.length <= 3) return normalized.join('、');
    return `${normalized.slice(0, 3).join('、')} 等 ${normalized.length} 屏`;
}

function formatActionLabel(action: DetailPageStateAction): string {
    switch (action) {
        case 'export':
            return '详情页导出';
        case 'screen-redo':
            return '详情页单屏重做';
        default:
            return '详情页填充';
    }
}

export function buildDetailPageVersionPatch(input: DetailPageVersionPatchInput): DesignProjectStatePatch | null {
    const actionLabel = formatActionLabel(input.action);
    const screenLabel = formatScreenLabel(input.screens);
    const reasonParts = [
        `${actionLabel}: ${screenLabel}`,
        cleanText(input.reason),
        Number(input.exportedFileCount || 0) > 0 ? `导出 ${Number(input.exportedFileCount)} 个文件` : ''
    ].filter(Boolean);

    if (reasonParts.length === 0) return null;

    return {
        appendVersion: {
            reason: reasonParts.join('；')
        },
        updatedBy: 'detail-page-design'
    };
}
