import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import {
    buildControlledPhotoshopLayerLightnessSortPlan,
    buildControlledPhotoshopLayerLightnessSortToolCallPlan,
    buildControlledPhotoshopScriptBenchmarkReport,
    executeControlledPhotoshopToolCallPlan
} from '../../../shared/photoshop-controlled-script-execution';
import type {
    ControlledPhotoshopScriptExecutionAdapter,
    ControlledPhotoshopScriptLayerTarget
} from '../../../shared/photoshop-controlled-script-execution';

type LayerAction =
    | 'select'
    | 'rename'
    | 'delete'
    | 'duplicate'
    | 'group'
    | 'ungroup'
    | 'move-to-group'
    | 'reorder'
    | 'inspect';

type ReorderAction = 'up' | 'down' | 'top' | 'bottom' | 'above' | 'below';
type LightnessDirection = 'light-to-dark' | 'dark-to-light';

interface LayerRef {
    id?: number;
    name: string;
    kind?: string;
    visible?: boolean;
    parentName?: string;
    depth: number;
    raw: any;
}

interface LightnessLayer extends LayerRef {
    lightness: number;
    lightnessReason: string;
}

interface DocumentRef {
    id?: number;
    name: string;
    isActive?: boolean;
    raw: any;
}

interface TextLayerRef {
    id?: number;
    name: string;
    textContent: string;
    visible?: boolean;
    parentName?: string;
    raw: any;
}

interface LayerBoundsRef {
    left: number;
    top: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

function normalizeAction(value: unknown): LayerAction {
    const text = String(value || '').trim().toLowerCase();
    if (['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect'].includes(text)) {
        return text as LayerAction;
    }
    return 'inspect';
}

function normalizeReorderAction(value: unknown): ReorderAction | undefined {
    const text = String(value || '').trim().toLowerCase();
    if (['up', 'down', 'top', 'bottom', 'above', 'below'].includes(text)) {
        return text as ReorderAction;
    }
    return undefined;
}

function getResultLayers(result: any): any[] {
    const candidates = [
        result?.layers,
        result?.data?.layers,
        result?.hierarchy,
        result?.data?.hierarchy,
        result?.layerTree,
        result?.data?.layerTree
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function getResultDocuments(result: any): DocumentRef[] {
    const candidates = [
        result?.documents,
        result?.data?.documents,
        result?.items,
        result?.data?.items
    ];
    const documents = candidates.find((candidate) => Array.isArray(candidate)) || [];
    return documents
        .map((document: any) => {
            const id = Number(document?.id ?? document?.documentId);
            return {
                id: Number.isFinite(id) ? id : undefined,
                name: String(document?.name || document?.documentName || '').trim(),
                isActive: document?.isActive === true || document?.active === true,
                raw: document
            };
        })
        .filter((document: DocumentRef) => document.name || Number.isFinite(document.id));
}

function getResultTextLayers(result: any): any[] {
    const candidates = [
        result?.layers,
        result?.data?.layers,
        result?.textLayers,
        result?.data?.textLayers,
        result?.items,
        result?.data?.items
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function getLayerId(layer: any): number | undefined {
    const id = Number(layer?.id ?? layer?.layerId ?? layer?._id);
    return Number.isFinite(id) ? id : undefined;
}

function getChildren(layer: any): any[] {
    for (const key of ['children', 'layers', 'items']) {
        const value = layer?.[key];
        if (Array.isArray(value)) return value;
    }
    return [];
}

function flattenLayers(layers: any[], parentName?: string, depth = 0): LayerRef[] {
    const flat: LayerRef[] = [];
    for (const layer of layers || []) {
        const ref: LayerRef = {
            id: getLayerId(layer),
            name: String(layer?.name || layer?.layerName || '').trim(),
            kind: String(layer?.kind || layer?.type || layer?.layerKind || '').trim(),
            visible: layer?.visible !== false,
            parentName,
            depth,
            raw: layer
        };
        if (ref.name || Number.isFinite(ref.id)) {
            flat.push(ref);
        }
        const children = getChildren(layer);
        if (children.length > 0) {
            flat.push(...flattenLayers(children, ref.name || parentName, depth + 1));
        }
    }
    return flat;
}

function compactText(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getTextLayerContent(layer: any): string {
    return String(
        layer?.textContent
        ?? layer?.content
        ?? layer?.text
        ?? layer?.value
        ?? layer?.data?.textContent
        ?? layer?.data?.content
        ?? ''
    ).trim();
}

function normalizeTextLayers(layers: any[]): TextLayerRef[] {
    return layers
        .map((layer) => ({
            id: getLayerId(layer),
            name: String(layer?.name || layer?.layerName || '').trim(),
            textContent: getTextLayerContent(layer),
            visible: layer?.visible !== false,
            parentName: String(layer?.parentName || layer?.parentGroup || layer?.groupName || '').trim() || undefined,
            raw: layer
        }))
        .filter((layer: TextLayerRef) => layer.textContent || layer.name || Number.isFinite(layer.id));
}

function findTextLayerByContent(textLayers: TextLayerRef[], query: string): TextLayerRef | undefined {
    const compactQuery = compactText(query);
    if (!compactQuery) return undefined;

    return textLayers.find((layer) => compactText(layer.textContent) === compactQuery)
        || textLayers.find((layer) => compactText(layer.textContent).includes(compactQuery))
        || textLayers.find((layer) => compactQuery.includes(compactText(layer.textContent)) && compactText(layer.textContent).length >= 3)
        || textLayers.find((layer) => compactText(layer.name) === compactQuery)
        || textLayers.find((layer) => compactText(layer.name).includes(compactQuery));
}

function resolveLayerFromHierarchy(layers: LayerRef[], textLayer: TextLayerRef): LayerRef | undefined {
    if (textLayer.id !== undefined) {
        const byId = layers.find((layer) => layer.id === textLayer.id);
        if (byId) return byId;
    }
    const compactName = compactText(textLayer.name);
    if (!compactName) return undefined;
    return layers.find((layer) => compactText(layer.name) === compactName)
        || layers.find((layer) => compactText(layer.name).includes(compactName));
}

function extractRequestedTextContent(params: Record<string, any>): string {
    return String(
        params.textContent
        ?? params.text
        ?? params.content
        ?? params.targetText
        ?? params.targetDescription
        ?? ''
    ).trim();
}

function normalizeLayerBounds(result: any): LayerBoundsRef | undefined {
    const raw = result?.bounds
        ?? result?.data?.bounds
        ?? result?.layer?.bounds
        ?? result?.data?.layer?.bounds
        ?? result;
    const left = Number(raw?.left ?? raw?.x);
    const top = Number(raw?.top ?? raw?.y);
    const right = Number(raw?.right);
    const bottom = Number(raw?.bottom);
    const width = Number(raw?.width);
    const height = Number(raw?.height);

    if (!Number.isFinite(left) || !Number.isFinite(top)) return undefined;

    let resolvedWidth: number | undefined;
    if (Number.isFinite(width)) {
        resolvedWidth = width;
    } else if (Number.isFinite(right)) {
        resolvedWidth = right - left;
    }

    let resolvedHeight: number | undefined;
    if (Number.isFinite(height)) {
        resolvedHeight = height;
    } else if (Number.isFinite(bottom)) {
        resolvedHeight = bottom - top;
    }

    return {
        left,
        top,
        ...(Number.isFinite(right) ? { right } : {}),
        ...(Number.isFinite(bottom) ? { bottom } : {}),
        ...(Number.isFinite(resolvedWidth) ? { width: resolvedWidth } : {}),
        ...(Number.isFinite(resolvedHeight) ? { height: resolvedHeight } : {})
    };
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatBounds(bounds: LayerBoundsRef | undefined): string {
    if (!bounds) return '未读取到文本框边界';
    const parts = [
        `x=${formatNumber(bounds.left)}`,
        `y=${formatNumber(bounds.top)}`
    ];
    if (Number.isFinite(bounds.width)) parts.push(`宽=${formatNumber(Number(bounds.width))}`);
    if (Number.isFinite(bounds.height)) parts.push(`高=${formatNumber(Number(bounds.height))}`);
    return parts.join('，');
}

function formatChineseSentence(prefix: string, value: string): string {
    const text = `${prefix}${value}`;
    return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function findLayer(layers: LayerRef[], params: Record<string, any>, keyPrefix = ''): LayerRef | undefined {
    const layerId = Number(params[`${keyPrefix}layerId`] ?? params.layerId);
    if (Number.isFinite(layerId)) {
        return layers.find((layer) => layer.id === layerId);
    }

    const name = String(params[`${keyPrefix}layerName`] ?? params.layerName ?? '').trim();
    if (name) {
        const compactName = compactText(name);
        return layers.find((layer) => compactText(layer.name) === compactName)
            || layers.find((layer) => compactText(layer.name).includes(compactName));
    }

    const description = String(params.targetDescription || '').trim();
    if (description) {
        const compactDescription = compactText(description);
        return layers.find((layer) => compactText(layer.name).includes(compactDescription));
    }

    return undefined;
}

function findTargetGroup(layers: LayerRef[], params: Record<string, any>): LayerRef | undefined {
    const groupId = Number(params.targetGroupId ?? params.targetLayerId);
    if (Number.isFinite(groupId)) {
        return layers.find((layer) => layer.id === groupId);
    }

    const name = String(params.targetGroupName ?? params.targetLayerName ?? params.groupName ?? '').trim();
    if (!name) return undefined;
    const compactName = compactText(name);
    return layers.find((layer) => compactText(layer.name) === compactName)
        || layers.find((layer) => compactText(layer.name).includes(compactName));
}

function uniqueLayerIds(params: Record<string, any>): number[] {
    const ids = Array.isArray(params.layerIds) ? params.layerIds : [];
    const normalized = ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
    const single = Number(params.layerId);
    if (Number.isFinite(single)) normalized.push(single);
    return Array.from(new Set(normalized));
}

function shouldUseCurrentSelection(params: Record<string, any>): boolean {
    return params.useCurrentSelection === true
        || /当前选中|当前选择|选中的|已选中|当前图层/.test(String(params.userIntent || ''));
}

function isToolFailure(result: any): boolean {
    return result?.success === false;
}

function getToolError(result: any, fallback: string): string {
    return String(result?.error || fallback);
}

function normalizeLightnessDirection(value: unknown): LightnessDirection {
    return value === 'dark-to-light' ? 'dark-to-light' : 'light-to-dark';
}

function formatLightnessDirection(direction: LightnessDirection): string {
    return direction === 'light-to-dark' ? '从浅到深' : '从深到浅';
}

function uniqueStrings(items: string[]): string[] {
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractRequestedLayerNames(params: Record<string, any>): string[] {
    const directValues = [
        params.layerName
    ];
    const listValues = [
        ...(Array.isArray(params.layerNames) ? params.layerNames : [])
    ];
    const names = [...directValues, ...listValues]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    const intent = String(params.userIntent || params.originalUserInput || params.task || '').trim();
    const quotedPatterns = [
        /[“"]([^“”"]{1,80})[”"]/g,
        /'([^']{1,80})'/g,
        /「([^」]{1,80})」/g,
        /『([^』]{1,80})』/g
    ];
    for (const pattern of quotedPatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(intent))) {
            const value = String(match[1] || '').trim();
            if (value) names.push(value);
        }
    }

    return uniqueStrings(names).filter((name) =>
        !/\.(?:psd|psb|png|jpe?g|tiff?|pdf)$/i.test(name)
        && !/^Agent真实基础工具链验证-反馈修复$/.test(name)
    );
}

function extractTargetDocumentId(params: Record<string, any>): number | undefined {
    const directId = Number(params.documentId ?? params.targetDocumentId);
    if (Number.isFinite(directId)) return directId;

    const intent = String(params.userIntent || params.originalUserInput || params.task || '').trim();
    if (!/(文档|document)/i.test(intent)) return undefined;

    const patterns = [
        /(?:文档|document)\s*(?:id|ID)?\s*[:：#]?\s*(\d{1,10})/i,
        /(?:切换|切到|switch).{0,24}(?:id|ID)\s*[:：#]?\s*(\d{1,10})/i
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(intent);
        const id = Number(match?.[1]);
        if (Number.isFinite(id)) return id;
    }

    return undefined;
}

function formatLayerPath(layer: LayerRef): string {
    const self = layer.name || `#${layer.id}`;
    return layer.parentName ? `${layer.parentName}/${self}` : self;
}

function formatToolResultSummary(toolResults: Array<{ toolName: string; result: any }>): string {
    return toolResults
        .map((item) => `${item.toolName}：${isToolFailure(item.result) ? `失败（${getToolError(item.result, 'unknown error')}）` : '成功'}`)
        .join('；');
}

function resolveDocumentName(docInfo: any, hierarchy: any): string {
    return String(
        hierarchy?.documentName
        || hierarchy?.document?.name
        || hierarchy?.data?.documentName
        || hierarchy?.data?.document?.name
        || docInfo?.documentName
        || docInfo?.name
        || docInfo?.document?.name
        || ''
    ).trim();
}

function buildRequestedLayerChecks(layers: LayerRef[], requestedNames: string[]): Array<{
    name: string;
    found: boolean;
    layerId?: number;
    layerName?: string;
    path?: string;
    kind?: string;
}> {
    return requestedNames.map((name) => {
        const compactName = compactText(name);
        const matched = layers.find((layer) => compactText(layer.name) === compactName)
            || layers.find((layer) => compactText(layer.name).includes(compactName));
        return {
            name,
            found: Boolean(matched),
            layerId: matched?.id,
            layerName: matched?.name,
            path: matched ? formatLayerPath(matched) : undefined,
            kind: matched?.kind
        };
    });
}

function buildLayerInspectMessage(input: {
    layers: LayerRef[];
    requestedNames: string[];
    toolResults: Array<{ toolName: string; result: any }>;
    documentName: string;
}): string {
    void input.toolResults;
    const checks = buildRequestedLayerChecks(input.layers, input.requestedNames);
    const lines = [
        `已看过当前文档的图层结构${input.documentName ? `：${input.documentName}` : ''}。`
    ];

    if (checks.length > 0) {
        const found = checks.filter((check) => check.found);
        const missing = checks.filter((check) => !check.found);
        if (found.length > 0) {
            lines.push(`已找到：${found.map((check) => check.layerName || check.name).join('、')}。`);
        }
        if (missing.length > 0) {
            lines.push(`没有找到：${missing.map((check) => check.name).join('、')}。`);
        }
        lines.push('如果要继续移动、改名或调整顺序，可以直接说下一步动作。');
        return lines.join('\n');
    }

    lines.push(`共看到 ${input.layers.length} 个图层。`);
    return lines.join('\n');
}

function compareLightnessLayers(direction: LightnessDirection): (a: LightnessLayer, b: LightnessLayer) => number {
    return direction === 'light-to-dark'
        ? (a, b) => b.lightness - a.lightness
        : (a, b) => a.lightness - b.lightness;
}

function buildSelectLayerParams(layerIds: number[], selectedLayerId: number | undefined, layerName: unknown): Record<string, any> {
    if (layerIds.length > 1) return { layerIds };
    if (selectedLayerId) return { layerId: selectedLayerId };

    const normalizedLayerName = String(layerName || '').trim();
    if (normalizedLayerName) return { layerName: normalizedLayerName };

    return {};
}

function formatGroupSuccessMessage(layerCount: number): string {
    return layerCount > 0 ? `已编组 ${layerCount} 个图层。` : '已编组当前选中的图层。';
}

function lightnessFromName(name: string): { lightness: number; reason: string } | null {
    const text = compactText(name);
    if (!text) return null;
    if (/背景|矩形选取|选区|蒙版|mask|参考|guide/.test(text)) return null;

    let base: number | null = null;
    let reason = '';

    if (/黑|black/.test(text)) {
        base = 5;
        reason = '黑色系';
    } else if (/藏青|navy/.test(text)) {
        base = 18;
        reason = '藏青/海军蓝色系';
    } else if (/白|奶|米|乳|象牙|white|ivory|cream/.test(text)) {
        base = 94;
        reason = '白色/浅白色系';
    } else if (/卡其|khaki/.test(text)) {
        base = 70;
        reason = '卡其色系';
    } else if (/灰|grey|gray/.test(text)) {
        base = 58;
        reason = '灰色系';
    } else if (/黄|杏|beige|yellow/.test(text)) {
        base = 72;
        reason = '黄色/米杏色系';
    } else if (/粉|pink|rose/.test(text)) {
        base = 66;
        reason = '粉色系';
    } else if (/蓝|blue/.test(text)) {
        base = 56;
        reason = '蓝色系';
    } else if (/青|cyan|teal/.test(text)) {
        base = 45;
        reason = '青色系';
    } else if (/绿|green/.test(text)) {
        base = 50;
        reason = '绿色系';
    } else if (/棕|咖|褐|brown|coffee/.test(text)) {
        base = 36;
        reason = '棕咖色系';
    }

    if (base === null) return null;

    if (/浅|淡|light/.test(text)) {
        base = Math.max(base, 78);
        reason = `浅色修饰：${reason}`;
    }
    if (/中|medium/.test(text)) {
        base = Math.min(base, 55);
        reason = `中色修饰：${reason}`;
    }
    if (/深|dark/.test(text)) {
        base = Math.min(base, 28);
        reason = `深色修饰：${reason}`;
    }

    return { lightness: base, reason };
}

function inferSortableLightnessLayers(layers: LayerRef[]): LightnessLayer[] {
    const sortable: LightnessLayer[] = [];
    for (const layer of layers) {
        if (!layer.name || !Number.isFinite(layer.id)) continue;
        const inferred = lightnessFromName(layer.name);
        if (!inferred) continue;
        sortable.push({
            ...layer,
            lightness: inferred.lightness,
            lightnessReason: inferred.reason
        });
    }
    return sortable;
}

function buildColorLayerReport(layers: LayerRef[], direction: LightnessDirection = 'light-to-dark'): {
    colorLayers: LightnessLayer[];
    skippedLayers: LayerRef[];
    hiddenCount: number;
    visibleCount: number;
} {
    const colorLayers = inferSortableLightnessLayers(layers)
        .sort(compareLightnessLayers(direction));
    const colorIds = new Set(colorLayers.map((layer) => layer.id));
    const skippedLayers = layers.filter((layer) => !colorIds.has(layer.id));
    return {
        colorLayers,
        skippedLayers,
        hiddenCount: colorLayers.filter((layer) => layer.visible === false).length,
        visibleCount: colorLayers.filter((layer) => layer.visible !== false).length
    };
}

function buildControlledLayerTargets(layers: LightnessLayer[]): ControlledPhotoshopScriptLayerTarget[] {
    return layers.map((layer) => ({
        layerId: Number(layer.id),
        layerName: layer.name,
        lightness: layer.lightness,
        lightnessSource: 'inferred-layer-name',
        locked: layer.raw?.locked === true || layer.raw?.allLocked === true,
        visible: layer.visible !== false,
        parentPath: layer.parentName ? [layer.parentName] : []
    }));
}

function getTargetTopToBottomLayerIds(layers: LayerRef[], targetLayerIds: number[]): number[] {
    const targetIdSet = new Set(targetLayerIds.map(Number));
    return layers
        .filter((layer) => layer.id !== undefined && targetIdSet.has(Number(layer.id)))
        .map((layer) => Number(layer.id));
}

async function callTool(callbacks: SkillExecuteParams['callbacks'], toolName: string, params: Record<string, any>, detail: string): Promise<any> {
    return executeObservedSkillTool(callbacks, toolName, params, executeToolCall, detail);
}

async function verifyLayerState(callbacks: SkillExecuteParams['callbacks'], detail: string): Promise<any> {
    return callTool(callbacks, 'getAcceptanceSnapshot', {
        includeHidden: true,
        includeText: false,
        includeBounds: false,
        maxLayers: 120
    }, detail);
}

function createControlledLayerReorderAdapter(
    callbacks: SkillExecuteParams['callbacks'],
    toolResults: Array<{ toolName: string; result: any }>,
    targetLayerIds: number[]
): ControlledPhotoshopScriptExecutionAdapter {
    return {
        runToolCall: async (toolCall) => {
            const result = await callTool(
                callbacks,
                toolCall.tool,
                toolCall.params,
                '按计划调整图层顺序。'
            );
            toolResults.push({ toolName: toolCall.tool, result });
            return {
                success: !isToolFailure(result),
                error: isToolFailure(result) ? getToolError(result, `${toolCall.tool} failed`) : undefined,
                data: result
            };
        },
        readTargetTopToBottomLayerIds: async () => {
            const result = await callTool(callbacks, 'getLayerHierarchy', {
                includeHidden: true
            }, '调整后重新读取图层层级。');
            toolResults.push({ toolName: 'getLayerHierarchy', result });
            if (isToolFailure(result)) {
                throw new Error(getToolError(result, 'getLayerHierarchy failed'));
            }
            return getTargetTopToBottomLayerIds(flattenLayers(getResultLayers(result)), targetLayerIds);
        }
    };
}


export const layerManagementExecutor: SkillExecutor = {
    skillId: 'layer-management',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = normalizeAction(params.action);
        const toolResults: Array<{ toolName: string; result: any }> = [];

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备图层管理操作',
            detail: `动作: ${action}`,
            status: 'running',
            percent: 8
        });

        const targetDocumentId = extractTargetDocumentId(params);
        if (targetDocumentId !== undefined) {
            const documentsResult = await callTool(callbacks, 'listDocuments', { includeDetails: true }, '列出当前已打开文档，确认目标文档可切换。');
            toolResults.push({ toolName: 'listDocuments', result: documentsResult });
            if (isToolFailure(documentsResult)) {
                return {
                    success: false,
                    message: '无法列出当前打开的 Photoshop 文档，本轮没有继续读取图层。',
                    error: getToolError(documentsResult, 'listDocuments failed'),
                    toolResults
                };
            }

            const documents = getResultDocuments(documentsResult);
            if (documents.length > 0 && !documents.some((document) => document.id === targetDocumentId)) {
                return {
                    success: false,
                    message: `没有找到已打开的文档 id ${targetDocumentId}，本轮没有切换或读取图层。`,
                    error: `Document ${targetDocumentId} is not open`,
                    toolResults,
                    data: {
                        requestedDocumentId: targetDocumentId,
                        openDocuments: documents.map((document) => ({
                            id: document.id,
                            name: document.name,
                            isActive: document.isActive
                        }))
                    }
                };
            }

            const switchResult = await callTool(callbacks, 'switchDocument', { documentId: targetDocumentId }, `切换到文档 id ${targetDocumentId}。`);
            toolResults.push({ toolName: 'switchDocument', result: switchResult });
            if (isToolFailure(switchResult)) {
                return {
                    success: false,
                    message: `切换到文档 id ${targetDocumentId} 失败，本轮没有继续读取图层。`,
                    error: getToolError(switchResult, 'switchDocument failed'),
                    toolResults,
                    data: {
                        requestedDocumentId: targetDocumentId,
                        openDocuments: documents.map((document) => ({
                            id: document.id,
                            name: document.name,
                            isActive: document.isActive
                        }))
                    }
                };
            }
        }

        const docInfo = await callTool(callbacks, 'getDocumentInfo', {}, '确认当前 Photoshop 文档状态。');
        toolResults.push({ toolName: 'getDocumentInfo', result: docInfo });
        if (!docInfo?.success) {
            return {
                success: false,
                message: '请先打开 Photoshop 文档后再操作图层。',
                error: docInfo?.error || 'No document open',
                toolResults
            };
        }

        const hierarchy = await callTool(callbacks, 'getLayerHierarchy', { includeHidden: true }, '读取图层层级，避免盲改。');
        toolResults.push({ toolName: 'getLayerHierarchy', result: hierarchy });
        const layers = flattenLayers(getResultLayers(hierarchy));
        if (!hierarchy?.success || layers.length === 0) {
            return {
                success: false,
                message: '没有读取到可操作的图层层级。',
                error: hierarchy?.error || 'No layers',
                toolResults
            };
        }

        if (action === 'inspect' && params.inspectMode === 'text-layer-location') {
            const requestedText = extractRequestedTextContent(params);
            if (!requestedText) {
                return {
                    success: false,
                    message: '请告诉我要定位哪一段文案，我会在当前文档的文本图层里查找它的位置。',
                    error: 'textContent missing',
                    toolResults
                };
            }

            const textLayersResult = await callTool(callbacks, 'getAllTextLayers', {}, '读取当前文档中的文本图层。');
            toolResults.push({ toolName: 'getAllTextLayers', result: textLayersResult });
            if (isToolFailure(textLayersResult)) {
                return {
                    success: false,
                    message: '读取文本图层失败，请确认当前 Photoshop 文档仍然打开后重试。',
                    error: getToolError(textLayersResult, 'getAllTextLayers failed'),
                    toolResults
                };
            }

            const textLayers = normalizeTextLayers(getResultTextLayers(textLayersResult));
            if (textLayers.length === 0) {
                return {
                    success: false,
                    message: '当前文档里没有读取到文本图层。',
                    error: 'No text layers',
                    toolResults,
                    data: {
                        requestedText,
                        textLayerCount: 0
                    }
                };
            }

            const matchedTextLayer = findTextLayerByContent(textLayers, requestedText);
            if (!matchedTextLayer) {
                const samples = textLayers
                    .map((layer) => layer.textContent || layer.name)
                    .filter(Boolean)
                    .slice(0, 8);
                return {
                    success: false,
                    message: `没有在当前文档的文本图层里找到「${requestedText}」。`,
                    error: 'text content not found',
                    toolResults,
                    data: {
                        requestedText,
                        availableTextSamples: samples
                    }
                };
            }

            let bounds: LayerBoundsRef | undefined;
            let boundsResult: any;
            if (matchedTextLayer.id !== undefined) {
                boundsResult = await callTool(callbacks, 'getLayerBounds', {
                    layerId: matchedTextLayer.id,
                    includeEffects: true
                }, '读取目标文本图层的位置边界。');
                toolResults.push({ toolName: 'getLayerBounds', result: boundsResult });
                if (!isToolFailure(boundsResult)) {
                    bounds = normalizeLayerBounds(boundsResult);
                }
            }

            const hierarchyLayer = resolveLayerFromHierarchy(layers, matchedTextLayer);
            let layerPath = matchedTextLayer.name || requestedText;
            if (hierarchyLayer) {
                layerPath = formatLayerPath(hierarchyLayer);
            } else if (matchedTextLayer.parentName) {
                layerPath = `${matchedTextLayer.parentName}/${matchedTextLayer.name || requestedText}`;
            }
            const textShown = matchedTextLayer.textContent || requestedText;
            const messageLines = [
                `找到了，「${requestedText}」在文本图层「${matchedTextLayer.name || textShown}」里。`,
                formatChineseSentence('所在层级：', layerPath),
                `位置：${formatBounds(bounds)}。`
            ];

            return {
                success: true,
                message: messageLines.join('\n'),
                toolResults,
                data: {
                    inspectMode: 'text-layer-location',
                    requestedText,
                    matchedTextLayer: {
                        layerId: matchedTextLayer.id,
                        layerName: matchedTextLayer.name,
                        textContent: matchedTextLayer.textContent,
                        visible: matchedTextLayer.visible !== false,
                        path: layerPath
                    },
                    bounds,
                    boundsRead: Boolean(bounds),
                    boundsError: boundsResult && isToolFailure(boundsResult)
                        ? getToolError(boundsResult, 'getLayerBounds failed')
                        : undefined
                }
            };
        }

        if (action === 'inspect' && params.inspectMode === 'color-layers') {
            const report = buildColorLayerReport(layers);
            return {
                success: true,
                message: `已读取颜色图层，共 ${report.colorLayers.length} 个；其中可见 ${report.visibleCount} 个，隐藏 ${report.hiddenCount} 个。`,
                toolResults,
                data: {
                    inspectMode: 'color-layers',
                    colorLayerCount: report.colorLayers.length,
                    visibleColorLayerCount: report.visibleCount,
                    hiddenColorLayerCount: report.hiddenCount,
                    colorLayers: report.colorLayers.map((layer, index) => ({
                        order: index + 1,
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        lightness: layer.lightness,
                        reason: layer.lightnessReason
                    })),
                    skippedLayers: report.skippedLayers.slice(0, 40).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        kind: layer.kind
                    }))
                }
            };
        }

        if (action === 'inspect') {
            const requestedNames = extractRequestedLayerNames(params);
            const requestedLayerChecks = buildRequestedLayerChecks(layers, requestedNames);
            return {
                success: true,
                message: buildLayerInspectMessage({
                    layers,
                    requestedNames,
                    toolResults,
                    documentName: resolveDocumentName(docInfo, hierarchy)
                }),
                toolResults,
                data: {
                    layerCount: layers.length,
                    documentName: resolveDocumentName(docInfo, hierarchy),
                    requestedLayerChecks,
                    layers: layers.slice(0, 60)
                }
            };
        }

        if (action === 'reorder' && params.sortBy === 'lightness') {
            const direction = normalizeLightnessDirection(params.sortDirection);
            const colorReport = buildColorLayerReport(layers, direction);
            const sortable = colorReport.colorLayers;

            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '颜色图层已识别',
                detail: `可排序图层: ${sortable.length}；方向: ${direction}`,
                status: sortable.length >= 2 ? 'success' : 'error',
                percent: 42
            });

            if (sortable.length < 2) {
                return {
                    success: false,
                    message: '没有足够的可排序颜色图层。请确认图层名称包含颜色，或先选中需要排序的图层。',
                    error: 'Not enough sortable color layers',
                    toolResults,
                    data: {
                        sortableCandidates: sortable.map((layer) => ({
                            layerId: layer.id,
                            layerName: layer.name,
                            lightness: layer.lightness,
                            reason: layer.lightnessReason
                        }))
                    }
                };
            }

            const controlledDryRun = buildControlledPhotoshopLayerLightnessSortPlan({
                kind: 'layer-lightness-sort',
                direction,
                userIntent: params.userIntent,
                layers: buildControlledLayerTargets(sortable)
            });
            const controlledToolCallPlan = buildControlledPhotoshopLayerLightnessSortToolCallPlan(controlledDryRun);
            if (controlledToolCallPlan.status !== 'ready_tool_call_plan') {
                return {
                    success: false,
                    message: '图层排序暂时不能执行。请确认颜色图层可识别，或先选中需要排序的图层。',
                    error: controlledToolCallPlan.blockers.join('; ') || controlledDryRun.blockers.join('; ') || 'controlled layer order plan blocked',
                    toolResults,
                    data: {
                        action,
                        sortBy: 'lightness',
                        sortDirection: direction,
                        controlledDryRun,
                        controlledToolCallPlan,
                        sortedLayers: sortable
                    }
                };
            }

            const controlledExecution = await executeControlledPhotoshopToolCallPlan(
                controlledToolCallPlan,
                createControlledLayerReorderAdapter(
                    callbacks,
                    toolResults,
                    controlledToolCallPlan.verificationPlan.expectedTopToBottomLayerIds
                ),
                { liveExecutionApproved: true, executionTarget: 'user-approved-document' }
            );
            const controlledBenchmark = buildControlledPhotoshopScriptBenchmarkReport(
                controlledDryRun,
                controlledToolCallPlan,
                controlledExecution
            );
            if (controlledExecution.status !== 'completed_verified') {
                return {
                    success: false,
                    message: '图层排序复核未通过，本轮没有继续调整。',
                    error: controlledExecution.blockers.join('; ') || controlledExecution.status,
                    toolResults,
                    data: {
                        action,
                        sortBy: 'lightness',
                        sortDirection: direction,
                        controlledDryRun,
                        controlledToolCallPlan,
                        controlledExecution,
                        controlledBenchmark,
                        sortedLayers: sortable
                    }
                };
            }

            return {
                success: true,
                message: `已按${formatLightnessDirection(direction)}调整 ${sortable.length} 个颜色图层的堆叠顺序；其中隐藏颜色图层 ${colorReport.hiddenCount} 个。`,
                toolResults,
                data: {
                    action,
                    sortBy: 'lightness',
                    sortDirection: direction,
                    hiddenColorLayerCount: colorReport.hiddenCount,
                    visibleColorLayerCount: colorReport.visibleCount,
                    sortedLayers: sortable.map((layer, index) => ({
                        order: index + 1,
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        lightness: layer.lightness,
                        reason: layer.lightnessReason
                    })),
                    skippedLayers: colorReport.skippedLayers.slice(0, 40).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        kind: layer.kind
                    })),
                    controlledDryRun,
                    controlledToolCallPlan,
                    controlledExecution,
                    controlledBenchmark,
                    reorderResults: controlledExecution.toolResults.map((result) => result.data)
                }
            };
        }

        const selected = findLayer(layers, params);
        const selectedLayerId = selected?.id;
        const layerIds = uniqueLayerIds(params);
        if (selectedLayerId && !layerIds.includes(selectedLayerId)) {
            layerIds.push(selectedLayerId);
        }
        const primaryLayerId = selectedLayerId ?? layerIds[0];
        const useCurrentSelection = shouldUseCurrentSelection(params);

        if (['rename', 'delete', 'duplicate', 'ungroup', 'move-to-group', 'reorder'].includes(action) && !primaryLayerId && !useCurrentSelection) {
            return {
                success: false,
                message: '目标图层不明确。请提供图层名称，或先在 Photoshop 中选中目标图层。',
                error: 'Target layer missing',
                toolResults,
                data: {
                    candidates: layers.slice(0, 20).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        parentName: layer.parentName,
                        kind: layer.kind
                    }))
                }
            };
        }

        if (action === 'select') {
            const selectParams = buildSelectLayerParams(layerIds, selectedLayerId, params.layerName);
            const result = await callTool(callbacks, 'selectLayer', selectParams, '选中目标图层。');
            toolResults.push({ toolName: 'selectLayer', result });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '选中图层失败，请确认目标图层仍然存在后重试。' : '已选中目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'selectLayer failed') : undefined,
                toolResults,
                data: { selectedLayerIds: layerIds }
            };
        }

        if (action === 'rename') {
            const newName = String(params.newName || '').trim();
            if (!newName) {
                return { success: false, message: '重命名图层需要提供新名称。', error: 'newName missing', toolResults };
            }
            const result = await callTool(callbacks, 'renameLayer', { layerId: primaryLayerId, newName, useCurrentSelection }, `重命名图层为「${newName}」。`);
            toolResults.push({ toolName: 'renameLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层重命名结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '重命名失败，请确认目标图层仍然可编辑后重试。' : `已重命名图层为「${newName}」。`,
                error: isToolFailure(result) ? getToolError(result, 'renameLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'delete') {
            const result = await callTool(callbacks, 'deleteLayer', { layerId: primaryLayerId, useCurrentSelection }, '删除目标图层。');
            toolResults.push({ toolName: 'deleteLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层删除结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '删除图层失败，请确认目标图层仍然可编辑后重试。' : '已删除目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'deleteLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'duplicate') {
            if (primaryLayerId) {
                const selectResult = await callTool(callbacks, 'selectLayer', { layerId: primaryLayerId }, '先选中需要复制的图层。');
                toolResults.push({ toolName: 'selectLayer', result: selectResult });
                if (isToolFailure(selectResult)) {
                    return { success: false, message: '选中图层失败，请确认目标图层仍然存在后重试。', error: getToolError(selectResult, 'selectLayer failed'), toolResults };
                }
            }
            const result = await callTool(callbacks, 'duplicateLayer', { layerId: primaryLayerId, newName: params.newName, useCurrentSelection }, '复制目标图层。');
            toolResults.push({ toolName: 'duplicateLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层复制结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '复制图层失败，请确认目标图层仍然可编辑后重试。' : '已复制目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'duplicateLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'group') {
            const ids = layerIds.length > 0 ? layerIds : uniqueLayerIds(params);
            if (ids.length === 0 && !useCurrentSelection) {
                return { success: false, message: '编组需要先多选图层，或说明要编组哪些图层。', error: 'layerIds missing', toolResults };
            }
            const result = await callTool(callbacks, 'groupLayers', {
                ...(ids.length > 0 ? { layerIds: ids } : {}),
                ...(useCurrentSelection ? { useCurrentSelection: true } : {}),
                groupName: params.newName || params.groupName
            }, ids.length > 0 ? `编组 ${ids.length} 个图层。` : '编组当前选中的图层。');
            toolResults.push({ toolName: 'groupLayers', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层编组结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            const layerCount = ids.length || Number(result?.group?.layerCount) || Number(result?.layerCount) || 0;
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '图层编组失败，请确认所选图层仍然可编辑后重试。' : formatGroupSuccessMessage(layerCount),
                error: isToolFailure(result) ? getToolError(result, 'groupLayers failed') : undefined,
                toolResults
            };
        }

        if (action === 'ungroup') {
            const result = await callTool(callbacks, 'ungroupLayers', { groupId: primaryLayerId, useCurrentSelection }, '解除目标图层组。');
            toolResults.push({ toolName: 'ungroupLayers', result });
            const snapshot = await verifyLayerState(callbacks, '复核解除编组结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '解除编组失败，请确认目标图层组仍然可编辑后重试。' : '已解除目标图层组。',
                error: isToolFailure(result) ? getToolError(result, 'ungroupLayers failed') : undefined,
                toolResults
            };
        }

        if (action === 'move-to-group') {
            const targetGroup = findTargetGroup(layers, params);
            if (!targetGroup?.id) {
                return {
                    success: false,
                    message: '目标图层组不明确。请提供图层组名称，或说明要移入哪个组。',
                    error: 'Target group missing',
                    toolResults,
                    data: {
                        candidates: layers
                            .filter((layer) => layer.kind?.toLowerCase().includes('group') || getChildren(layer.raw).length > 0)
                            .slice(0, 20)
                            .map((layer) => ({
                                layerId: layer.id,
                                layerName: layer.name,
                                parentName: layer.parentName,
                                kind: layer.kind
                            }))
                    }
                };
            }

            const result = await callTool(callbacks, 'moveLayerToGroup', {
                layerId: primaryLayerId,
                targetGroupId: targetGroup.id,
                position: params.position || 'inside'
            }, `将目标图层移动到「${targetGroup.name}」组内。`);
            toolResults.push({ toolName: 'moveLayerToGroup', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层父子层级调整结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '移动到图层组失败，请确认目标图层和图层组仍然可编辑后重试。' : `已将图层移动到「${targetGroup.name}」组内。`,
                error: isToolFailure(result) ? getToolError(result, 'moveLayerToGroup failed') : undefined,
                toolResults,
                data: { layerId: primaryLayerId, targetGroupId: targetGroup.id }
            };
        }

        if (action === 'reorder') {
            const reorderAction = normalizeReorderAction(params.reorderAction) || 'top';
            const targetLayer = findLayer(layers, {
                layerId: params.targetLayerId,
                layerName: params.targetLayerName
            });
            const payload: Record<string, any> = {
                layerId: primaryLayerId,
                action: reorderAction,
                useCurrentSelection
            };
            if ((reorderAction === 'above' || reorderAction === 'below') && targetLayer?.id) {
                payload.targetLayerId = targetLayer.id;
            }
            const result = await callTool(callbacks, 'reorderLayer', payload, `执行图层堆叠顺序调整: ${reorderAction}。`);
            toolResults.push({ toolName: 'reorderLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层顺序调整结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? '图层顺序调整失败，请确认目标图层仍然可编辑后重试。' : '已调整图层堆叠顺序。',
                error: isToolFailure(result) ? getToolError(result, 'reorderLayer failed') : undefined,
                toolResults,
                data: { layerId: primaryLayerId, reorderAction, targetLayerId: targetLayer?.id }
            };
        }

        return {
            success: false,
            message: `不支持的图层管理动作: ${action}`,
            error: `Unsupported layer action: ${action}`,
            toolResults
        };
    }
};
