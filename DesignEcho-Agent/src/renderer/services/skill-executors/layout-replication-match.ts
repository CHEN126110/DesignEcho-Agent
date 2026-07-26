import { executeToolCall } from '../tool-executor.service';
import type { SkillExecuteParams } from './types';
import { parseJsonObject, type MinimalDesignRepresentation } from '../../../shared/reference-replication';
import { buildCompactReferenceLayoutStructure } from '../../../shared/reference-replication-layout-structure';

export interface MatchAction {
    tool?: string;
    params?: Record<string, any>;
}

export interface MatchItem {
    refElement?: string;
    targetLayerId?: number;
    targetLayerName?: string;
    action?: MatchAction;
}

export interface LayoutMatchExecutionItem {
    refElement?: string;
    toolName?: string;
    success: boolean;
    skipped?: boolean;
    reason?: string;
}

export interface MatchResult {
    matches?: MatchItem[];
    summary?: string;
}

interface LayoutMatchValidationContext {
    currentElements?: any[];
    targetDoc?: { width: number; height: number };
}

export interface LayoutMatchActionValidation {
    valid: boolean;
    toolName?: string;
    toolParams?: Record<string, any>;
    targetLayerId?: number;
    reason?: string;
}

export interface CompactLayoutMatchContext {
    reference: Record<string, any>;
    target: { w: number; h: number };
    layers: Array<Record<string, any>>;
    omittedLayerCount: number;
}

const ALLOWED_REPLICATION_TOOLS = new Set([
    'selectLayer',
    'moveLayer',
    'setTextStyle',
    'alignLayers',
    'reorderLayer',
    'createTextLayer',
    'createRectangle',
    'addDropShadow',
    'addStroke',
    'setLayerOpacity',
    'groupLayers'
]);

const LAYER_TARGET_TOOLS = new Set([
    'moveLayer',
    'setTextStyle',
    'addDropShadow',
    'addStroke',
    'setLayerOpacity',
    'reorderLayer'
]);

const MAX_MATCH_CONTEXT_LAYERS = 160;
const MAX_MATCH_TEXT_CHARS = 64;
const MAX_MATCH_NAME_CHARS = 48;

function isPlainObject(value: any): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: any): number | undefined {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

function positiveNumber(value: any): number | undefined {
    const num = finiteNumber(value);
    return typeof num === 'number' && num > 0 ? num : undefined;
}

function roundNumber(value: any, digits = 4): number | undefined {
    const num = finiteNumber(value);
    if (typeof num !== 'number') return undefined;
    const factor = 10 ** digits;
    return Math.round(num * factor) / factor;
}

function compactText(value: any, maxChars: number): string | undefined {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function withoutUndefined<T extends Record<string, any>>(value: T): Record<string, any> {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined && item !== null && item !== '') {
            output[key] = item;
        }
    }
    return output;
}

function compactBox(box: any): Record<string, number> | undefined {
    if (!box || typeof box !== 'object') return undefined;
    const left = roundNumber(box.left ?? box.x);
    const top = roundNumber(box.top ?? box.y);
    const width = roundNumber(box.width);
    const height = roundNumber(box.height);
    const right = roundNumber(box.right);
    const bottom = roundNumber(box.bottom);
    const result = withoutUndefined({
        x: left,
        y: top,
        w: width,
        h: height,
        r: right,
        b: bottom
    });
    return Object.keys(result).length > 0 ? result as Record<string, number> : undefined;
}

function compactStyle(style: MinimalDesignRepresentation['elements'][number]['style']): Record<string, any> | undefined {
    if (!style) return undefined;
    const result = withoutUndefined({
        fill: style.fillColor,
        text: style.textColor,
        stroke: style.strokeColor,
        opacity: roundNumber(style.opacity, 3),
        radius: roundNumber(style.cornerRadius, 2),
        weight: compactText(style.fontWeight, 24),
        sizeRatio: roundNumber(style.fontSizeRatio, 4),
        effects: Array.isArray(style.effects) && style.effects.length > 0 ? style.effects.slice(0, 6) : undefined
    });
    return Object.keys(result).length > 0 ? result : undefined;
}

export function estimatePromptTokens(text: string): number {
    return Math.ceil(String(text || '').length / 4);
}

export function buildCompactLayoutMatchContext(
    designRepresentation: MinimalDesignRepresentation,
    targetDoc: { width: number; height: number },
    currentElements: any[]
): CompactLayoutMatchContext {
    const referenceElements = (designRepresentation.elements || []).map((element) => withoutUndefined({
        id: element.id,
        kind: element.nodeKind,
        type: element.sourceType,
        role: element.role,
        name: compactText(element.name, MAX_MATCH_NAME_CHARS),
        text: compactText(element.content, MAX_MATCH_TEXT_CHARS),
        box: compactBox(element.box),
        style: compactStyle(element.style),
        group: compactText(element.relation?.group, 48),
        weight: element.visualWeight === 'unknown' ? undefined : element.visualWeight,
        z: roundNumber(element.zIndex, 0)
    }));

    const layers = (currentElements || []).slice(0, MAX_MATCH_CONTEXT_LAYERS).map((element: any) => {
        const type = compactText(element?.type ?? element?.kind, 32);
        const isTextLayer = /text|type/i.test(String(type || ''));
        return withoutUndefined({
            id: finiteNumber(element?.id),
            name: compactText(element?.name, MAX_MATCH_NAME_CHARS),
            type,
            box: compactBox(element?.bounds),
            text: isTextLayer ? compactText(element?.textContent, MAX_MATCH_TEXT_CHARS) : undefined,
            visible: typeof element?.visible === 'boolean' ? element.visible : undefined,
            locked: typeof element?.locked === 'boolean' ? element.locked : undefined
        });
    });

    const alignmentGroups = (designRepresentation.alignmentGroups || []).slice(0, 40).map((group) => withoutUndefined({
        type: compactText(group?.type, 48),
        items: Array.isArray(group?.elementIndices) ? group.elementIndices.slice(0, 30) : undefined
    }));

    return {
        reference: withoutUndefined({
            canvas: {
                w: roundNumber(designRepresentation.canvas?.width, 0),
                h: roundNumber(designRepresentation.canvas?.height, 0)
            },
            layout: withoutUndefined({
                type: compactText(designRepresentation.layout?.layoutType, 48),
                intent: compactText(designRepresentation.layout?.designIntent, 120),
                focal: compactText(designRepresentation.layout?.focalPoint, 48),
                density: compactText(designRepresentation.layout?.density, 24),
                symmetry: compactText(designRepresentation.layout?.symmetry, 24)
            }),
            elements: referenceElements,
            align: alignmentGroups.length > 0 ? alignmentGroups : undefined,
            textLayout: buildCompactReferenceLayoutStructure(designRepresentation)
        }),
        target: {
            w: Math.round(Number(targetDoc.width) || 0),
            h: Math.round(Number(targetDoc.height) || 0)
        },
        layers,
        omittedLayerCount: Math.max(0, (currentElements || []).length - layers.length)
    };
}

function isPercent(value: any): boolean {
    const num = finiteNumber(value);
    return typeof num === 'number' && num >= 0 && num <= 100;
}

function hasRgbColor(value: any): boolean {
    return isPlainObject(value)
        && ['r', 'g', 'b'].every((key) => {
            const channel = finiteNumber(value[key]);
            return typeof channel === 'number' && channel >= 0 && channel <= 255;
        });
}

function buildKnownLayerSets(currentElements?: any[]): {
    ids: Set<number>;
    names: Set<string>;
} {
    const ids = new Set<number>();
    const names = new Set<string>();
    for (const element of currentElements || []) {
        const id = finiteNumber(element?.id);
        if (typeof id === 'number') ids.add(id);
        const name = String(element?.name || '').trim();
        if (name) names.add(name);
    }
    return { ids, names };
}

function normalizeLayerIds(value: any): number[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => finiteNumber(item))
        .filter((item): item is number => typeof item === 'number');
}

function validateKnownLayerReference(
    layerId: number | undefined,
    knownLayerIds: Set<number>
): string | undefined {
    if (typeof layerId !== 'number') return undefined;
    if (knownLayerIds.size > 0 && !knownLayerIds.has(layerId)) {
        return `图层不存在: ${layerId}`;
    }
    return undefined;
}

function validateCommonGeometry(params: Record<string, any>, targetDoc?: { width: number; height: number }): string | undefined {
    if (!targetDoc) return undefined;
    const width = positiveNumber(targetDoc.width);
    const height = positiveNumber(targetDoc.height);
    if (!width || !height) return undefined;

    if ('x' in params) {
        const x = finiteNumber(params.x);
        if (typeof x !== 'number') return 'x 不是有效数值';
        if (x < -width || x > width * 2) return `x 超出安全范围: ${x}`;
    }
    if ('y' in params) {
        const y = finiteNumber(params.y);
        if (typeof y !== 'number') return 'y 不是有效数值';
        if (y < -height || y > height * 2) return `y 超出安全范围: ${y}`;
    }

    return undefined;
}

function validateCreateRectangle(params: Record<string, any>, targetDoc?: { width: number; height: number }): string | undefined {
    const x = finiteNumber(params.x);
    const y = finiteNumber(params.y);
    const widthValue = positiveNumber(params.width);
    const heightValue = positiveNumber(params.height);
    if (typeof x !== 'number' || typeof y !== 'number' || !widthValue || !heightValue) {
        return 'createRectangle 缺少有效 x/y/width/height';
    }
    const commonError = validateCommonGeometry(params, targetDoc);
    if (commonError) return commonError;

    if (targetDoc?.width && x + widthValue > Number(targetDoc.width) * 1.2) {
        return 'createRectangle 宽度超出画布安全范围';
    }
    if (targetDoc?.height && y + heightValue > Number(targetDoc.height) * 1.2) {
        return 'createRectangle 高度超出画布安全范围';
    }
    return undefined;
}

function validateCreateTextLayer(params: Record<string, any>, targetDoc?: { width: number; height: number }): string | undefined {
    if (typeof params.content !== 'string' || params.content.trim().length === 0) {
        return 'createTextLayer 缺少 content';
    }
    const x = finiteNumber(params.x);
    const y = finiteNumber(params.y);
    if (typeof x !== 'number' || typeof y !== 'number') {
        return 'createTextLayer 缺少有效 x/y';
    }
    const commonError = validateCommonGeometry(params, targetDoc);
    if (commonError) return commonError;
    if ('fontSize' in params) {
        const fontSize = positiveNumber(params.fontSize);
        if (!fontSize || fontSize > 300) return 'createTextLayer fontSize 超出安全范围';
    }
    return undefined;
}

function validateToolSpecificParams(
    toolName: string,
    params: Record<string, any>,
    context: LayoutMatchValidationContext
): string | undefined {
    if (toolName === 'createRectangle') {
        return validateCreateRectangle(params, context.targetDoc);
    }
    if (toolName === 'createTextLayer') {
        return validateCreateTextLayer(params, context.targetDoc);
    }
    if (toolName === 'moveLayer') {
        const commonError = validateCommonGeometry(params, context.targetDoc);
        if (commonError) return commonError;
        if (!('x' in params) && !('y' in params)) return 'moveLayer 缺少 x 或 y';
    }
    if (toolName === 'setLayerOpacity') {
        const opacity = finiteNumber(params.opacity);
        if (typeof opacity !== 'number' || opacity < 0 || opacity > 100) {
            return 'setLayerOpacity opacity 必须在 0-100';
        }
    }
    if (toolName === 'addStroke') {
        if (!hasRgbColor(params.color)) return 'addStroke 缺少有效 RGB color';
        const size = positiveNumber(params.size);
        if (!size || size > 80) return 'addStroke size 必须在 0-80';
        if (params.position !== undefined && !['outside', 'inside', 'center'].includes(String(params.position))) {
            return 'addStroke position 必须是 outside、inside 或 center';
        }
        if (params.opacity !== undefined && !isPercent(params.opacity)) return 'addStroke opacity 必须在 0-100';
    }
    if (toolName === 'addDropShadow') {
        if (params.color !== undefined && !hasRgbColor(params.color)) return 'addDropShadow 缺少有效 RGB color';
        if (params.opacity !== undefined && !isPercent(params.opacity)) return 'addDropShadow opacity 必须在 0-100';
        if (params.spread !== undefined && !isPercent(params.spread)) return 'addDropShadow spread 必须在 0-100';
        if (params.size !== undefined) {
            const size = finiteNumber(params.size);
            if (typeof size !== 'number' || size < 0 || size > 160) return 'addDropShadow size 必须在 0-160';
        }
        if (params.distance !== undefined) {
            const distance = finiteNumber(params.distance);
            if (typeof distance !== 'number' || distance < 0 || distance > 240) return 'addDropShadow distance 必须在 0-240';
        }
        if (params.angle !== undefined) {
            const angle = finiteNumber(params.angle);
            if (typeof angle !== 'number' || angle < -180 || angle > 180) return 'addDropShadow angle 必须在 -180 到 180';
        }
    }
    if (toolName === 'setTextStyle') {
        if ('fontSize' in params) {
            const fontSize = positiveNumber(params.fontSize);
            if (!fontSize || fontSize > 300) return 'setTextStyle fontSize 超出安全范围';
        }
        if ('color' in params && typeof params.color !== 'string') return 'setTextStyle color 必须是字符串';
        if ('fontName' in params && typeof params.fontName !== 'string') return 'setTextStyle fontName 必须是字符串';
    }
    if (toolName === 'alignLayers') {
        const allowed = new Set(['left', 'center', 'right', 'top', 'middle', 'bottom']);
        if (!allowed.has(String(params.alignment || ''))) return 'alignLayers alignment 无效';
    }
    if (toolName === 'groupLayers') {
        const layerIds = normalizeLayerIds(params.layerIds);
        if (layerIds.length < 1) return 'groupLayers 缺少 layerIds';
    }
    return undefined;
}

export function validateLayoutMatchAction(
    match: MatchItem,
    context: LayoutMatchValidationContext = {}
): LayoutMatchActionValidation {
    const toolName = String(match?.action?.tool || '').trim();
    const toolParams = match?.action?.params;
    if (!toolName || !isPlainObject(toolParams)) {
        return { valid: false, reason: '缺少工具名或参数' };
    }
    if (!ALLOWED_REPLICATION_TOOLS.has(toolName)) {
        return { valid: false, toolName, reason: `未授权工具: ${toolName}` };
    }

    const { ids: knownLayerIds, names: knownLayerNames } = buildKnownLayerSets(context.currentElements);
    const targetLayerId = finiteNumber(match?.targetLayerId) ?? finiteNumber(toolParams.layerId);
    const targetLayerName = String(match?.targetLayerName || toolParams.layerName || '').trim();

    const layerIdError = validateKnownLayerReference(targetLayerId, knownLayerIds);
    if (layerIdError) {
        return { valid: false, toolName, toolParams, targetLayerId, reason: layerIdError };
    }

    if (targetLayerName && knownLayerNames.size > 0 && !knownLayerNames.has(targetLayerName)) {
        return { valid: false, toolName, toolParams, targetLayerId, reason: `图层不存在: ${targetLayerName}` };
    }

    const layerIds = normalizeLayerIds(toolParams.layerIds);
    for (const layerId of layerIds) {
        const error = validateKnownLayerReference(layerId, knownLayerIds);
        if (error) {
            return { valid: false, toolName, toolParams, targetLayerId, reason: error };
        }
    }

    if (LAYER_TARGET_TOOLS.has(toolName) && typeof targetLayerId !== 'number' && !targetLayerName) {
        return { valid: false, toolName, toolParams, reason: `${toolName} 缺少目标图层` };
    }

    const toolSpecificError = validateToolSpecificParams(toolName, toolParams, context);
    if (toolSpecificError) {
        return { valid: false, toolName, toolParams, targetLayerId, reason: toolSpecificError };
    }

    return {
        valid: true,
        toolName,
        toolParams,
        targetLayerId
    };
}

export function buildLayoutMatchPrompt(
    designRepresentation: MinimalDesignRepresentation,
    targetDoc: { width: number; height: number },
    currentElements: any[]
): string {
    const compactContext = buildCompactLayoutMatchContext(designRepresentation, targetDoc, currentElements);
    return [
        '你是 Photoshop 布局复刻专家。根据紧凑上下文输出可执行 JSON。',
        '只能使用工具：selectLayer, moveLayer, setTextStyle, alignLayers, reorderLayer, createTextLayer, createRectangle, addDropShadow, addStroke, setLayerOpacity, groupLayers。',
        'matches[].refElement 必须等于 context.reference.elements[].id 原始值，不能写中文描述、图层名或元素内容。',
        '优先匹配已有图层；没有合适图层时才创建占位层；不要返回不存在的工具名。',
        '输出格式: {"matches":[{"refElement":"","targetLayerId":1,"targetLayerName":"","action":{"tool":"moveLayer","params":{}}}],"summary":"","risks":[]}',
        '只输出 JSON。',
        '',
        `context=${JSON.stringify(compactContext)}`
    ].join('\n');
}

export async function requestLayoutMatchPlan(args: {
    modelId: string;
    designRepresentation: MinimalDesignRepresentation;
    targetDoc: { width: number; height: number };
    currentElements: any[];
}): Promise<MatchResult | null> {
    const matchPrompt = buildLayoutMatchPrompt(args.designRepresentation, args.targetDoc, args.currentElements);
    const matchResponse = await window.designEcho.chat(
        args.modelId,
        [
            { role: 'system', content: '你是 Photoshop 布局专家，只输出 JSON。' },
            { role: 'user', content: matchPrompt }
        ],
        { maxTokens: 4096, temperature: 0.1 }
    );

    return parseJsonObject(matchResponse?.text || '') as MatchResult | null;
}

export async function executeLayoutMatchPlan(args: {
    matchResult: MatchResult;
    currentElements?: any[];
    targetDoc?: { width: number; height: number };
    callbacks?: SkillExecuteParams['callbacks'];
    signal?: AbortSignal;
}): Promise<{ cancelled?: boolean; successCount: number; failCount: number; results: LayoutMatchExecutionItem[] }> {
    let successCount = 0;
    let failCount = 0;
    const results: LayoutMatchExecutionItem[] = [];

    for (const match of args.matchResult.matches || []) {
        if (args.signal?.aborted) {
            return { cancelled: true, successCount, failCount, results };
        }

        const validation = validateLayoutMatchAction(match, {
            currentElements: args.currentElements,
            targetDoc: args.targetDoc
        });
        if (!validation.valid || !validation.toolName || !validation.toolParams) {
            failCount++;
            results.push({
                refElement: match.refElement,
                success: false,
                skipped: true,
                reason: validation.reason || '未知原因'
            });
            args.callbacks?.onMessage?.(`跳过不安全匹配动作: ${validation.reason || '未知原因'}`);
            continue;
        }

        const { toolName, toolParams, targetLayerId } = validation;

        args.callbacks?.onToolStart?.(toolName);
        if (typeof targetLayerId === 'number' && toolName !== 'selectLayer' && !('layerId' in toolParams)) {
            const selectResult = await executeToolCall('selectLayer', { layerId: targetLayerId });
            if (selectResult?.success === false) {
                failCount++;
                results.push({
                    refElement: match.refElement,
                    toolName,
                    success: false,
                    reason: `无法选中目标图层: ${targetLayerId}`
                });
                args.callbacks?.onMessage?.(`无法选中目标图层: ${targetLayerId}`);
                continue;
            }
        }
        const actionResult = await executeToolCall(toolName, toolParams);
        if (actionResult?.success) {
            successCount++;
            results.push({
                refElement: match.refElement,
                toolName,
                success: true
            });
            args.callbacks?.onToolComplete?.(toolName, actionResult);
        } else {
            failCount++;
            results.push({
                refElement: match.refElement,
                toolName,
                success: false,
                reason: actionResult?.error || '工具执行失败'
            });
        }

        await new Promise(resolve => setTimeout(resolve, 80));
    }

    return { successCount, failCount, results };
}
