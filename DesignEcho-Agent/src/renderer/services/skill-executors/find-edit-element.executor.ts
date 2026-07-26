import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

type EditAction =
    | 'locate'
    | 'select'
    | 'setText'
    | 'move'
    | 'scale'
    | 'setOpacity'
    | 'setBlendMode'
    | 'replaceImage'
    | 'hide';

interface CanvasElement {
    id: number;
    name: string;
    type: string;
    visible: boolean;
    position?: string;
    parentGroup?: string;
    textContent?: string;
}

interface RankedCandidate {
    element: CanvasElement;
    score: number;
    reason: string[];
}

const DEFAULT_MIN_SCORE = 35;
const DEFAULT_MIN_MARGIN = 8;

function tokenize(input: string): string[] {
    const tokens = (input || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]{1,}/g) || [];
    return Array.from(new Set(tokens.filter(Boolean)));
}

function containsAny(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
}

function isTextElement(element: CanvasElement): boolean {
    return (element.type || '').toLowerCase().includes('text');
}

function isSimpleOrderNumberText(value: unknown): boolean {
    return /^\s*\d{1,2}\s*$/.test(String(value || ''));
}

function isSkuCardNumberRequest(text: string): boolean {
    const value = String(text || '').toLowerCase();
    const hasCardContext = /(sku|色卡|卡片|颜色卡|配色)/i.test(value);
    const hasNumberContext = /(顺序编号|编号|序号|号码|数字|number)/i.test(value);
    return hasCardContext && hasNumberContext;
}

function extractSkuCardOrder(element: CanvasElement): number {
    const textNumber = Number(String(element.textContent || '').trim());
    if (Number.isFinite(textNumber)) return textNumber;

    const nameMatch = String(element.name || '').match(/(?:^|[^\d])(\d{1,2})(?:\s*[-_ ]|$)/);
    const nameNumber = Number(nameMatch?.[1]);
    if (Number.isFinite(nameNumber)) return nameNumber;

    const groupNumber = Number(String(element.parentGroup || '').match(/\d{1,2}/)?.[0]);
    return Number.isFinite(groupNumber) ? groupNumber : Number.MAX_SAFE_INTEGER;
}

function isSkuCardNumberLayer(element: CanvasElement): boolean {
    if (!isTextElement(element)) return false;

    const name = String(element.name || '').toLowerCase();
    const parentGroup = String(element.parentGroup || '').toLowerCase();
    const hasNumberLabel = /(编号|序号|顺序|number)/i.test(name);
    const hasCardSlot = /^(\d{1,2})(?:\s*[-_ ]|$)/.test(name) || /^\d{1,2}$/.test(parentGroup);
    const hasSimpleNumber = isSimpleOrderNumberText(element.textContent);

    return hasSimpleNumber && (hasNumberLabel || hasCardSlot);
}

function resolveBatchTargetElements(
    elements: CanvasElement[],
    action: EditAction,
    targetDescription: string
): CanvasElement[] {
    if (action !== 'hide') return [];
    if (!isSkuCardNumberRequest(targetDescription)) return [];

    const targets = elements
        .filter((element) => element.visible !== false)
        .filter(isSkuCardNumberLayer)
        .sort((a, b) => extractSkuCardOrder(a) - extractSkuCardOrder(b));

    return targets.length > 1 ? targets : [];
}

function scoreCandidate(
    element: CanvasElement,
    action: EditAction,
    targetTokens: string[],
    targetDescription: string = ''
): RankedCandidate {
    let score = 0;
    const reason: string[] = [];
    const searchText = `${element.name || ''} ${element.parentGroup || ''} ${element.position || ''} ${element.textContent || ''}`.toLowerCase();
    const targetText = `${targetTokens.join(' ')} ${targetDescription || ''}`.toLowerCase();

    let tokenHit = 0;
    for (const token of targetTokens) {
        if (searchText.includes(token)) tokenHit++;
    }
    if (targetTokens.length > 0) {
        const tokenScore = (tokenHit / targetTokens.length) * 45;
        score += tokenScore;
        if (tokenHit > 0) reason.push(`关键词命中 ${tokenHit}/${targetTokens.length}`);
    }

    const type = (element.type || '').toLowerCase();
    const isTextLike = type.includes('text');
    const isImageLike = type.includes('pixel') || type.includes('smart');
    const isShapeLike = type.includes('shape') || type.includes('vector');
    const nameText = (element.name || '').toLowerCase();

    if (isSkuCardNumberRequest(targetText)) {
        if (isSkuCardNumberLayer(element)) {
            score += 85;
            reason.push('色卡编号匹配');
        } else if (isTextLike || isImageLike || isShapeLike) {
            score -= 12;
        }
    }

    if ((action === 'setText') && isTextLike) {
        score += 30;
        reason.push('文本图层匹配');
    }
    if ((action === 'replaceImage') && isImageLike) {
        score += 30;
        reason.push('图片图层匹配');
    }
    if ((action === 'setOpacity' || action === 'setBlendMode' || action === 'move' || action === 'scale') && (isImageLike || isShapeLike || isTextLike)) {
        score += 10;
    }

    if (containsAny(nameText, ['icon', '图标']) && containsAny(targetTokens.join(' '), ['icon', '图标'])) {
        score += 18;
        reason.push('图标语义匹配');
    }
    if (containsAny(nameText, ['文案', '标题', 'title', 'text']) && (action === 'setText' || containsAny(targetTokens.join(' '), ['文案', '标题', 'text']))) {
        score += 15;
        reason.push('文案语义匹配');
    }
    if (containsAny(nameText, ['图片', '主图', 'image', 'photo']) && (action === 'replaceImage' || containsAny(targetTokens.join(' '), ['图片', '主图', 'image', 'photo']))) {
        score += 15;
        reason.push('图片语义匹配');
    }

    if (element.visible) {
        score += 5;
    }

    return { element, score: Math.round(score * 10) / 10, reason };
}

function normalizeAction(raw: unknown): EditAction {
    const value = String(raw || 'locate').trim();
    const lower = value.toLowerCase();
    if (lower === 'select') return 'select';
    if (lower === 'settext') return 'setText';
    if (lower === 'move') return 'move';
    if (lower === 'scale') return 'scale';
    if (lower === 'setopacity') return 'setOpacity';
    if (lower === 'setblendmode') return 'setBlendMode';
    if (lower === 'replaceimage') return 'replaceImage';
    if (lower === 'hide') return 'hide';
    return 'locate';
}

function topN(candidates: RankedCandidate[], n: number): RankedCandidate[] {
    return candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(1, n));
}

async function runEditAction(action: EditAction, layerId: number, params: Record<string, any>, callbacks?: SkillExecuteParams['callbacks']): Promise<any> {
    switch (action) {
        case 'locate':
        case 'select':
            return executeObservedSkillTool(callbacks, 'selectLayer', { layerId }, executeToolCall, '选中目标图层。');
        case 'setText': {
            const content = String(params.text ?? params.content ?? '').trim();
            if (!content) {
                return { success: false, error: '缺少 text/content 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setTextContent', {
                updates: [{ layerId, content }]
            }, executeToolCall, '写入目标图层文本。');
        }
        case 'move': {
            const hasDelta = Number.isFinite(Number(params.dx)) || Number.isFinite(Number(params.dy));
            if (hasDelta) {
                return executeObservedSkillTool(callbacks, 'moveLayer', {
                    layerId,
                    x: Number(params.dx) || 0,
                    y: Number(params.dy) || 0,
                    relative: true
                }, executeToolCall, '移动目标图层。');
            }
            if (!Number.isFinite(Number(params.x)) || !Number.isFinite(Number(params.y))) {
                return { success: false, error: 'move 缺少坐标参数（x/y 或 dx/dy）' };
            }
            return executeObservedSkillTool(callbacks, 'moveLayer', {
                layerId,
                x: Number(params.x),
                y: Number(params.y),
                relative: false
            }, executeToolCall, '移动目标图层。');
        }
        case 'scale': {
            const percent = Number(params.scalePercent ?? params.percent);
            if (!Number.isFinite(percent)) {
                return { success: false, error: 'scale 缺少 scalePercent/percent 参数' };
            }
            return executeObservedSkillTool(callbacks, 'transformLayer', { layerId, scaleUniform: percent }, executeToolCall, '缩放目标图层。');
        }
        case 'setOpacity': {
            const opacity = Number(params.opacity);
            if (!Number.isFinite(opacity)) {
                return { success: false, error: 'setOpacity 缺少 opacity 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setLayerOpacity', { layerId, opacity }, executeToolCall, '调整目标图层透明度。');
        }
        case 'hide':
            return executeObservedSkillTool(callbacks, 'setLayerOpacity', { layerId, opacity: 0 }, executeToolCall, '隐藏目标图层。');
        case 'setBlendMode': {
            const blendMode = String(params.blendMode || '').trim();
            if (!blendMode) {
                return { success: false, error: 'setBlendMode 缺少 blendMode 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setBlendMode', { layerId, blendMode }, executeToolCall, '调整目标图层混合模式。');
        }
        case 'replaceImage': {
            const filePath = String(params.filePath || '').trim();
            if (!filePath) {
                return { success: false, error: 'replaceImage 缺少 filePath 参数' };
            }
            return executeObservedSkillTool(callbacks, 'replaceLayerContent', { layerId, filePath }, executeToolCall, '替换目标图层内容。');
        }
        default:
            return { success: false, error: `不支持的操作: ${action}` };
    }
}

async function runEditActionForLayers(
    action: EditAction,
    layerIds: number[],
    params: Record<string, any>,
    callbacks?: SkillExecuteParams['callbacks']
): Promise<any> {
    const layerResults: Array<{ layerId: number; result: any }> = [];
    for (const layerId of layerIds) {
        const result = await runEditAction(action, layerId, params, callbacks);
        layerResults.push({ layerId, result });
        if (result?.success === false) {
            return {
                success: false,
                error: result.error || `图层 ${layerId} 操作失败`,
                layerResults
            };
        }
    }
    return { success: true, layerResults };
}

export const findEditElementExecutor: SkillExecutor = {
    skillId: 'find-and-edit-element',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = normalizeAction(params.action);
        const targetDescription = String(
            params.targetDescription || params.target || params.query || ''
        ).trim();
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备定位画布元素',
            detail: `动作: ${action}；目标描述: ${targetDescription || '按明确目标定位'}；定位方式：${Number.isFinite(Number(params.layerId)) ? '已指定目标' : '按描述查找'}`,
            status: 'running',
            percent: 8
        });

        if (!targetDescription && !Number.isFinite(Number(params.layerId))) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '缺少目标元素描述',
                detail: '没有目标描述，也没有明确目标，不能安全选择或修改图层。',
                status: 'error',
                issue: 'Missing target description'
            });
            return {
                success: false,
                message: '缺少目标描述。请告诉我要改哪个元素，例如“右上角价格文案”。',
                error: 'Missing target description'
            };
        }

        callbacks?.onProgress?.('定位画布元素', 16);
        callbacks?.onMessage?.('正在定位画布元素。');

        const docInfo = await executeObservedSkillTool(callbacks, 'getDocumentInfo', {}, executeToolCall, '确认当前 Photoshop 文档是否可用。');
        if (!docInfo?.success) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '无法读取当前文档',
                detail: docInfo?.error || '当前没有可用 Photoshop 文档。',
                status: 'error',
                toolName: 'getDocumentInfo',
                issue: 'No document open'
            });
            return {
                success: false,
                message: '请先打开 Photoshop 文档。',
                error: 'No document open'
            };
        }

        const elementResult = await executeObservedSkillTool(callbacks, 'getElementMapping', {
            includeHidden: true,
            includeGroups: true,
            sortBy: 'position'
        }, executeToolCall, '读取画布元素、图层关系和可编辑对象映射。');
        const elements: CanvasElement[] = Array.isArray(elementResult?.elements)
            ? elementResult.elements
            : [];

        if (!elementResult?.success || elements.length === 0) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '没有找到可编辑图层',
                detail: elementResult?.error || '元素映射为空。',
                status: 'error',
                toolName: 'getElementMapping',
                issue: elementResult?.error || 'No elements'
            });
            return {
                success: false,
                message: '没有找到可编辑图层。',
                error: elementResult?.error || 'No elements'
            };
        }

        // —— 文案查找替换优先路径（决定性完成，不退回模糊打分甩回用户）——
        // 用户改文案时通常已给出原文（targetDescription 就是要找的文字）+ 新文。直接对「内容包含原文」的
        // 可见文字层做子串替换（X→Y）：唯一就改一处、多处相同就一并改；只在原文锚点在画面上完全找不到时，
        // 才落到下面的模糊打分（targetDescription 可能是位置/语义描述，如「右上角价格文案」）。
        if (action === 'setText' && targetDescription && !Number.isFinite(Number(params.layerId))) {
            const newText = String(params.text ?? params.content ?? '').trim();
            // 剥离前导指令/填充词（把/将/帮我/文案/标题…），尽量还原"要找的那段原文"，让「把小狗刺绣」也能命中「小狗刺绣」
            const strippedTarget = targetDescription
                .replace(/^(?:请|帮我|帮忙|麻烦|把|将|给|这个|那个|当前|文档里的|文档中的|页面上的|画面上的|文案|文字|文本|标题|副标题|内容)+/g, '')
                .trim();
            // 锚点优先级：整段描述 → 去前导词后的原文 → 最长的、足够具体（≥2 字符）的 token
            const anchorCandidates = [
                targetDescription,
                strippedTarget,
                ...tokenize(targetDescription).filter((t) => t.length >= 2).sort((a, b) => b.length - a.length)
            ].filter((value, index, arr) => value && arr.indexOf(value) === index);
            let matchNeedle = '';
            let contentMatches: Array<{ el: CanvasElement; newContent: string }> = [];
            if (newText) {
                for (const anchor of anchorCandidates) {
                    const matches: Array<{ el: CanvasElement; newContent: string }> = [];
                    for (const el of elements) {
                        if (!isTextElement(el) || el.visible === false) continue;
                        const original = String(el.textContent || '');
                        if (!original) continue;
                        if (original.includes(anchor)) {
                            // 图层含原文 → 整层就是原文则整体替换；原文是子串则只替换该子串、保留其余文字
                            matches.push({ el, newContent: original === anchor ? newText : original.split(anchor).join(newText) });
                        } else if (anchor.length >= 4 && original.length >= 3 && anchor.includes(original)) {
                            // 反向：锚点带「详情页中的文案…」等上下文词、且无空格切不出 token 时，锚点包含图层整段文字
                            // → 该图层整段就是要改的文案，整体替换（≥3 字避免误命中"文案/标题"等短填充词）
                            matches.push({ el, newContent: newText });
                        }
                    }
                    if (matches.length > 0) { matchNeedle = anchor; contentMatches = matches; break; }
                }
            }
            if (contentMatches.length > 0) {
                const updates = contentMatches.map(({ el, newContent }) => ({
                    layerId: el.id,
                    content: newContent,
                    baselineContent: String(el.textContent || '')
                }));
                const shownOriginals = Array.from(new Set(
                    contentMatches.map(({ el }) => String(el.textContent || '').replace(/\s+/g, '').slice(0, 20)).filter(Boolean)
                ));
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: contentMatches.length > 1 ? '按内容命中多处文案' : '按内容命中目标文案',
                    detail: contentMatches.length > 1
                        ? `找到 ${contentMatches.length} 处目标文字，一并改为「${newText}」。`
                        : `已定位目标文字层「${contentMatches[0].el.name || ''}」，改为「${newText}」。`,
                    status: 'success',
                    percent: 60
                });
                const setResult = await executeObservedSkillTool(
                    callbacks, 'setTextContent', { updates }, executeToolCall, '按内容替换文案。'
                );
                if (setResult?.success === false) {
                    return {
                        success: false,
                        message: `改文案失败：${setResult.error || '未知错误'}`,
                        error: setResult.error || 'setTextContent failed'
                    };
                }
                const doneMessage = contentMatches.length > 1
                    ? `已把 ${contentMatches.length} 处文案改为「${newText}」（原文：${shownOriginals.map((t) => `「${t}」`).join('、')}）。`
                    : `已把「${shownOriginals[0] || matchNeedle}」改为「${newText}」。`;
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '文案已替换',
                    detail: doneMessage,
                    status: 'success',
                    percent: 100
                });
                return {
                    success: true,
                    message: doneMessage,
                    toolResults: [{ toolName: 'setTextContent', result: setResult }],
                    data: {
                        action,
                        targetDescription,
                        matchedText: matchNeedle,
                        replacedLayerIds: contentMatches.map(({ el }) => el.id),
                        replacedCount: contentMatches.length
                    }
                };
            }
            // 找不到就明说（不落回模糊打分甩回"候选不唯一"）：目标是具体原文（不含方位/色卡这类描述词）却没有任何
            // 文字层包含它 → 诚实报"没找到"并列出现有文字，让用户确认；带方位描述词的（如"右上角价格文案"）仍走下面模糊定位。
            const hasPositionalDescriptor = /左上角|右上角|左下角|右下角|顶部|底部|中间|中心|左侧|右侧|上方|下方|色卡|卡片|配色/.test(targetDescription);
            if (newText && !hasPositionalDescriptor) {
                const textSamples = elements
                    .filter((el) => isTextElement(el) && el.visible !== false)
                    .map((el) => String(el.textContent || '').replace(/\s+/g, '').slice(0, 20))
                    .filter(Boolean)
                    .slice(0, 8);
                const anchorShown = strippedTarget || targetDescription;
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '没找到目标文案',
                    detail: `文档里没有包含「${anchorShown}」的文字。`,
                    status: 'error',
                    issue: 'text content not found',
                    percent: 100
                });
                return {
                    success: false,
                    message: `没有找到包含「${anchorShown}」的文案。当前文档里的文字有：${textSamples.map((t) => `「${t}」`).join('、')}。请确认要改哪一处，或告诉我准确的原文。`,
                    error: 'text content not found',
                    data: { action, targetDescription, notFound: true, availableTexts: textSamples }
                };
            }
        }

        const tokens = tokenize(targetDescription);
        const ranked = topN(elements.map(el => scoreCandidate(el, action, tokens, targetDescription)), 5);
        const top = ranked[0];
        const second = ranked[1];

        const hasExplicitLayerId = Number.isFinite(Number(params.layerId));
        const batchTargets = hasExplicitLayerId ? [] : resolveBatchTargetElements(elements, action, targetDescription);
        const selectedLayerIds = batchTargets.length > 1
            ? batchTargets.map((element) => element.id)
            : [];
        let selectedLayerId = hasExplicitLayerId ? Number(params.layerId) : (selectedLayerIds[0] || top?.element?.id);
        const minScore = Number.isFinite(Number(params.minScore)) ? Number(params.minScore) : DEFAULT_MIN_SCORE;
        const minMargin = Number.isFinite(Number(params.minMargin)) ? Number(params.minMargin) : DEFAULT_MIN_MARGIN;
        const margin = top && second ? top.score - second.score : (top?.score || 0);
        const selectionMode = String(params.selectionMode || 'auto').toLowerCase();

        if (selectedLayerIds.length > 1) {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '同类目标已识别',
                detail: `识别到 ${selectedLayerIds.length} 个色卡编号，按同一类视觉元素一起处理。`,
                status: 'success',
                percent: 48
            });
        }

        const needUserSelection =
            selectedLayerIds.length === 0 &&
            !hasExplicitLayerId &&
            (selectionMode === 'suggest' || (selectionMode !== 'force' && ((top?.score || 0) < minScore || margin < minMargin)));
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '候选图层已排序',
            detail: needUserSelection
                ? '已找到多个可能目标，需要确认后再修改。'
                : '已选出可执行的目标图层。',
            status: needUserSelection ? 'error' : 'success',
            percent: 54,
            issue: needUserSelection ? 'candidate_confirmation_required' : undefined
        });

        if (needUserSelection) {
            // 出口治理（2026-07-07 真机病例）：曾只回一句「候选图层不唯一」——候选数据明明在
            // data 里却不给用户/模型看，无从确认。拒绝必须带候选清单与下一步指路。
            const candidatePreview = ranked.slice(0, 5).map((c, idx) => {
                const where = [c.element.parentGroup, c.element.position].filter(Boolean).join(' · ');
                return `${idx + 1}. 「${c.element.name}」(${c.element.type}${where ? `，${where}` : ''})`;
            });
            return {
                success: false,
                message: [
                    `找到 ${ranked.length} 个可能的目标图层，需要确认改哪个：`,
                    ...candidatePreview,
                    ranked.length > candidatePreview.length ? `…（共 ${ranked.length} 个候选）` : '',
                    '请回复序号或图层名，并说明要改成什么内容；也可以描述得更具体（如「第三屏的标题」）。'
                ].filter(Boolean).join('\n'),
                data: {
                    selectionRequired: true,
                    action,
                    targetDescription,
                    threshold: { minScore, minMargin },
                    candidates: ranked.map((c, idx) => ({
                        rank: idx + 1,
                        layerId: c.element.id,
                        layerName: c.element.name,
                        layerType: c.element.type,
                        parentGroup: c.element.parentGroup,
                        position: c.element.position,
                        score: c.score,
                        reason: c.reason.join('；')
                    }))
                }
            };
        }

        if (!selectedLayerId) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '没有可用目标图层',
                detail: '候选排序没有得到可执行目标。',
                status: 'error',
                issue: 'No selected layer id'
            });
            return {
                success: false,
                message: '没有找到可用图层。',
                error: 'No selected layer id'
            };
        }

        callbacks?.onProgress?.('选中目标图层', 68);
        const selectParams = selectedLayerIds.length > 1
            ? { layerIds: selectedLayerIds }
            : { layerId: selectedLayerId };
        const selectResult = await executeObservedSkillTool(callbacks, 'selectLayer', selectParams, executeToolCall, '选中目标图层。');
        if (selectResult?.success === false) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '选中目标图层失败',
                detail: selectResult.error || '未知错误',
                status: 'error',
                toolName: 'selectLayer',
                issue: selectResult.error || 'Select layer failed'
            });
            return {
                success: false,
                message: '选中图层失败，请确认目标图层仍然存在后重试。',
                error: selectResult.error || 'Select layer failed',
                data: {
                    selectedLayerId,
                    selectedLayerName: top?.element?.name
                }
            };
        }

        callbacks?.onProgress?.('执行元素操作', 82);
        const actionResult = selectedLayerIds.length > 1
            ? await runEditActionForLayers(action, selectedLayerIds, params, callbacks)
            : await runEditAction(action, selectedLayerId, params, callbacks);
        if (actionResult?.success === false) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '元素操作失败',
                detail: actionResult.error || '未知错误',
                status: 'error',
                issue: actionResult.error || 'Action failed'
            });
            return {
                success: false,
                message: '元素操作没有完成，请确认目标图层仍然存在且可以编辑后重试。',
                error: actionResult.error || 'Action failed',
                data: {
                    selectedLayerId,
                    selectedLayerName: top?.element?.name
                }
            };
        }

        const selected = batchTargets[0] || ranked.find(c => c.element.id === selectedLayerId)?.element || top?.element;
        const successLine = action === 'locate' || action === 'select'
            ? '已定位并选中目标图层。'
            : action === 'hide' && selectedLayerIds.length > 1
                ? `已隐藏 ${selectedLayerIds.length} 个目标元素。`
                : action === 'hide'
                    ? '已隐藏目标元素。'
                    : '已完成元素修改。';
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '元素定位与操作完成',
            detail: selectedLayerIds.length > 1
                ? `图层：${batchTargets.map((element) => element.name).join('、')}；动作：${action}`
                : `图层：${selected?.name || '目标图层'}；动作：${action}`,
            status: 'success',
            percent: 100
        });

        const selectedName = selectedLayerIds.length > 1
            ? `${selectedLayerIds.length} 个目标元素`
            : String(selected?.name || '').trim();
        return {
            success: true,
            message: selectedName ? `${successLine}\n\n图层：${selectedName}` : successLine,
            toolResults: [
                { toolName: 'selectLayer', result: selectResult },
                { toolName: action, result: actionResult }
            ],
            data: {
                action,
                targetDescription,
                selectedLayerId,
                selectedLayerIds: selectedLayerIds.length > 1 ? selectedLayerIds : undefined,
                selectedLayerName: selected?.name,
                selectedLayerNames: selectedLayerIds.length > 1 ? batchTargets.map((element) => element.name) : undefined,
                score: ranked.find(c => c.element.id === selectedLayerId)?.score,
                topCandidates: ranked.map((c, idx) => ({
                    rank: idx + 1,
                    layerId: c.element.id,
                    layerName: c.element.name,
                    layerType: c.element.type,
                    score: c.score
                }))
            }
        };
    }
};
