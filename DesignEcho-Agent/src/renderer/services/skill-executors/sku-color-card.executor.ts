/**
 * SKU 色卡 Skill 执行器。
 *
 * 专业方法和布局由共享契约给出；本文件只按计划调用 Photoshop 原子 Tool，
 * 每个关键写入都保留读回结果，不依赖 Photoshop Action 或 JSX 黑盒。
 */

import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';
import {
    SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
    buildInternalSkuColorCardGeometry,
    buildSkuColorCardPlan,
    isSkuColorCardClippingReadbackVerified,
    resolveSkuColorCardSources,
    type SkuColorCardExecutionReport,
    type SkuColorCardPreparedCard,
    type SkuColorCardSourceInput
} from '../../../shared/sku-color-card-skill';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep } from './skill-step-events';

interface ToolObservation {
    toolName: string;
    stage: string;
    sourceId?: string;
    result: any;
}

interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface TextFitResult {
    verified: boolean;
    fontSize: number;
    labelBounds?: LayerBounds;
    textBounds?: LayerBounds;
    error?: string;
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function normalizeSourceInputs(params: Record<string, any>): SkuColorCardSourceInput[] {
    const explicit = Array.isArray(params.sources) ? params.sources : [];
    if (explicit.length > 0) {
        return explicit.map((item: unknown) => {
            if (typeof item === 'string') return { filePath: item };
            const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            return {
                filePath: clean(source.filePath || source.path),
                colorName: clean(source.colorName || source.name) || undefined,
                relativePath: clean(source.relativePath) || undefined,
                assetId: clean(source.assetId) || undefined
            };
        });
    }

    const sourcePaths = Array.isArray(params.sourcePaths) ? params.sourcePaths : [];
    const colorNames = Array.isArray(params.colorNames) ? params.colorNames : [];
    const sourceCount = Math.max(sourcePaths.length, colorNames.length);
    return Array.from({ length: sourceCount }, (_, index) => ({
        filePath: clean(sourcePaths[index]),
        colorName: clean(colorNames[index]) || undefined
    }));
}

function readPositiveId(result: any, keys: string[]): number | undefined {
    const candidates: unknown[] = [];
    const data = result?.data;
    for (const key of keys) {
        candidates.push(result?.[key], data?.[key], result?.document?.[key], data?.document?.[key]);
    }
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.round(value);
    }
    return undefined;
}

function readDocumentSize(result: any): { width: number; height: number; documentId?: number } | null {
    const document = result?.document || result?.data?.document || result?.data || result;
    const width = Number(document?.width);
    const height = Number(document?.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    return {
        width: Math.round(width),
        height: Math.round(height),
        documentId: readPositiveId(result, ['documentId', 'id'])
    };
}

function readLayerBounds(result: any): LayerBounds | null {
    const value = result?.boundsNoEffects
        || result?.data?.boundsNoEffects
        || result?.bounds
        || result?.data?.bounds;
    if (!value || typeof value !== 'object') return null;
    const left = Number(value.left);
    const top = Number(value.top);
    const right = Number(value.right);
    const bottom = Number(value.bottom);
    const width = Number.isFinite(Number(value.width)) ? Number(value.width) : right - left;
    const height = Number.isFinite(Number(value.height)) ? Number(value.height) : bottom - top;
    if (![left, top, right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }
    return { left, top, right, bottom, width, height };
}

function toolError(result: any, fallback: string): string {
    return clean(result?.error || result?.message) || fallback;
}

function isSmartObjectVerified(result: any): boolean {
    return result?.success === true && (
        result?.isSmartObject === true
        || result?.data?.isSmartObject === true
        || result?.entityType === 'smart-object'
    );
}

function buildFailureReport(input: {
    outputPath: string;
    sourceCount: number;
    preparedCards: SkuColorCardPreparedCard[];
    stage: string;
    error: string;
    indexReferenceIsolation: 'passed' | 'failed' | 'not_requested';
    finalStructureReadback?: boolean;
}): SkuColorCardExecutionReport {
    return {
        version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
        status: 'failed',
        outputPath: input.outputPath,
        sourceCount: input.sourceCount,
        preparedCards: input.preparedCards,
        checks: {
            sourceCoverage: input.preparedCards.length === input.sourceCount ? 'passed' : 'failed',
            smartObjectEditability: input.preparedCards.every((card) => card.smartObjectVerified) ? 'passed' : 'failed',
            clippingStructure: input.preparedCards.every((card) => card.clippingVerified) ? 'passed' : 'failed',
            labelTextFit: input.preparedCards.every((card) => card.labelTextFitVerified) ? 'passed' : 'failed',
            indexReferenceIsolation: input.indexReferenceIsolation,
            finalStructureReadback: input.finalStructureReadback ? 'passed' : 'failed',
            visualComposition: 'failed'
        },
        failureStage: input.stage,
        error: input.error
    };
}

export const skuColorCardExecutor: SkillExecutor = {
    skillId: 'sku-color-card',

    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        const { params, callbacks, signal, context } = executeParams;
        const requestedSources = normalizeSourceInputs(params);
        const sourceResolution = resolveSkuColorCardSources({
            sources: requestedSources,
            assetIndex: context?.projectContext?.assetIndex,
            userInput: clean(context?.userInput || params.userIntent)
        });
        const sources = sourceResolution.sources;
        const projectPath = clean(params.projectPath || context?.projectContext?.projectPath);
        const plan = buildSkuColorCardPlan({
            sources,
            projectPath,
            outputPath: clean(params.outputPath),
            outputRelativePath: clean(params.outputRelativePath),
            layout: {
                canvasWidth: params.canvasWidth,
                canvasHeight: params.canvasHeight,
                cardWidth: params.cardWidth,
                cardHeight: params.cardHeight,
                cardCornerRadius: params.cardCornerRadius,
                columnGap: params.columnGap,
                rowGap: params.rowGap,
                columns: params.columns,
                showIndexNumbers: params.showIndexNumbers
            },
            sourceResolution
        });
        const observations: ToolObservation[] = [];
        const preparedCards: SkuColorCardPreparedCard[] = [];
        let indexReferenceIsolation: 'passed' | 'failed' | 'not_requested' = plan.indexReference.enabled
            ? 'failed'
            : 'not_requested';

        function cancelled(): boolean {
            return signal?.aborted === true;
        }

        async function callTool(
            toolName: string,
            toolParams: Record<string, any>,
            stage: string,
            sourceId?: string
        ): Promise<any> {
            if (cancelled()) {
                return { success: false, cancelled: true, error: '任务已取消' };
            }
            callbacks?.onToolStart?.(toolName);
            const result = await executeToolCall(toolName, toolParams, { signal });
            callbacks?.onToolComplete?.(toolName, result);
            observations.push({ toolName, stage, sourceId, result });
            return result;
        }

        async function fitAndCenterLabelText(input: {
            sourceId: string;
            labelLayerId: number;
            textLayerId: number;
            initialFontSize: number;
        }): Promise<TextFitResult> {
            const labelBoundsResult = await callTool('getLayerBounds', {
                layerId: input.labelLayerId,
                includeEffects: false
            }, 'read-label-background-bounds', input.sourceId);
            const initialTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'read-label-text-bounds', input.sourceId);
            const labelBounds = readLayerBounds(labelBoundsResult);
            let textBounds = readLayerBounds(initialTextBoundsResult);
            if (!labelBounds || !textBounds) {
                return {
                    verified: false,
                    fontSize: input.initialFontSize,
                    error: '无法读取色名白底或文字的真实边界。'
                };
            }

            const horizontalPadding = Math.max(4, Math.round(labelBounds.width * 0.08));
            const verticalPadding = Math.max(3, Math.round(labelBounds.height * 0.12));
            const availableWidth = Math.max(1, labelBounds.width - horizontalPadding * 2);
            const availableHeight = Math.max(1, labelBounds.height - verticalPadding * 2);
            const fitScale = Math.min(1, availableWidth / textBounds.width, availableHeight / textBounds.height);
            let fittedFontSize = input.initialFontSize;

            if (fitScale < 0.995) {
                fittedFontSize = Math.max(8, Math.floor(input.initialFontSize * fitScale));
                const resizeResult = await callTool('setTextStyle', {
                    layerId: input.textLayerId,
                    fontSize: fittedFontSize
                }, 'fit-label-text-size', input.sourceId);
                if (!resizeResult?.success) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        textBounds,
                        error: toolError(resizeResult, '色名文字无法按白底宽度缩放。')
                    };
                }
                const resizedTextBoundsResult = await callTool('getLayerBounds', {
                    layerId: input.textLayerId,
                    includeEffects: false
                }, 'read-fitted-label-text-bounds', input.sourceId);
                textBounds = readLayerBounds(resizedTextBoundsResult);
                if (!textBounds) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        error: '色名缩放后无法读回真实文字边界。'
                    };
                }
            }

            const targetX = Math.round(labelBounds.left + (labelBounds.width - textBounds.width) / 2);
            const targetY = Math.round(labelBounds.top + (labelBounds.height - textBounds.height) / 2);
            const moveResult = await callTool('moveLayer', {
                layerId: input.textLayerId,
                x: targetX,
                y: targetY,
                relative: false
            }, 'center-label-text', input.sourceId);
            if (!moveResult?.success) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    textBounds,
                    error: toolError(moveResult, '色名文字无法移动到白底中心。')
                };
            }

            const finalTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'verify-centered-label-text', input.sourceId);
            const finalTextBounds = readLayerBounds(finalTextBoundsResult);
            if (!finalTextBounds) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    error: '色名文字居中后无法读回最终边界。'
                };
            }

            const tolerance = 2;
            const labelCenterX = labelBounds.left + labelBounds.width / 2;
            const labelCenterY = labelBounds.top + labelBounds.height / 2;
            const textCenterX = finalTextBounds.left + finalTextBounds.width / 2;
            const textCenterY = finalTextBounds.top + finalTextBounds.height / 2;
            const inside = finalTextBounds.left >= labelBounds.left + horizontalPadding - tolerance
                && finalTextBounds.right <= labelBounds.right - horizontalPadding + tolerance
                && finalTextBounds.top >= labelBounds.top + verticalPadding - tolerance
                && finalTextBounds.bottom <= labelBounds.bottom - verticalPadding + tolerance;
            const centered = Math.abs(labelCenterX - textCenterX) <= tolerance
                && Math.abs(labelCenterY - textCenterY) <= tolerance;
            return {
                verified: inside && centered,
                fontSize: fittedFontSize,
                labelBounds,
                textBounds: finalTextBounds,
                ...(!inside || !centered ? { error: '色名文字最终边界没有同时满足白底内收纳与水平/垂直居中。' } : {})
            };
        }

        function fail(stage: string, error: string): AgentResult {
            const report = buildFailureReport({
                outputPath: plan.outputPath,
                sourceCount: plan.slots.length,
                preparedCards,
                stage,
                error,
                indexReferenceIsolation
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: 'SKU 色卡未完成',
                detail: error,
                status: 'error',
                percent: 100,
                issue: stage
            });
            return {
                success: false,
                message: `SKU 色卡没有完成：${error}`,
                error,
                cancelled: cancelled(),
                toolResults: observations,
                data: { plan, report, sourceResolution }
            };
        }

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '检查 SKU 色卡输入与结构',
            detail: `输入图片 ${sources.length} 张；目标文档 ${plan.documentName}；画布 ${plan.canvas.width}×${plan.canvas.height}。`,
            status: plan.canExecute ? 'success' : 'error',
            percent: 6,
            issue: plan.canExecute ? undefined : plan.status
        });
        if (!plan.canExecute) {
            return fail(plan.status, plan.blockers.join('；'));
        }

        callbacks?.onProgress?.('创建 SKU 色卡文档', 10);
        const createDocumentResult = await callTool('createDocument', {
            name: plan.documentName,
            width: plan.canvas.width,
            height: plan.canvas.height,
            backgroundColor: plan.canvas.backgroundColor
        }, 'create-document');
        if (!createDocumentResult?.success) {
            return fail('create-document', toolError(createDocumentResult, '创建 SKU 文档失败。'));
        }
        const mainDocumentId = readPositiveId(createDocumentResult, ['documentId', 'id']);
        if (!mainDocumentId) {
            return fail('create-document-readback', 'SKU 文档创建后没有返回可用文档 ID。');
        }

        for (let slotIndex = 0; slotIndex < plan.slots.length; slotIndex += 1) {
            const slot = plan.slots[slotIndex];
            const sourceId = slot.source.sourceId;
            const progressBase = 14 + Math.round((slotIndex / plan.slots.length) * 68);
            callbacks?.onProgress?.(`制作色卡：${slot.source.colorName}`, progressBase);
            emitSkillStep(callbacks, {
                kind: 'tool_planned',
                title: `制作色卡 ${slot.index}/${plan.slots.length}`,
                detail: `${slot.source.colorName} ← ${slot.source.filePath}`,
                status: 'running',
                percent: progressBase
            });

            const groupResult = await callTool('createGroup', {
                groupName: slot.groupName
            }, 'create-color-group', sourceId);
            const groupId = readPositiveId(groupResult, ['layerId', 'createdLayerId', 'id']);
            if (!groupResult?.success || !groupId) {
                return fail('create-color-group', toolError(groupResult, `颜色组“${slot.groupName}”创建失败。`));
            }
            const normalizeGroupRootResult = await callTool('moveLayerToGroup', {
                layerId: groupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-color-group-root', sourceId);
            if (!normalizeGroupRootResult?.success) {
                return fail(
                    'normalize-color-group-root',
                    toolError(normalizeGroupRootResult, `颜色组“${slot.groupName}”无法归位到文档根级。`)
                );
            }

            const rectangleResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-圆角占位`,
                ...slot.cardBounds,
                fillColorHex: plan.cardStyle.fillColorHex,
                cornerRadius: plan.cardStyle.cornerRadius
            }, 'create-rounded-placeholder', sourceId);
            const rectangleLayerId = readPositiveId(rectangleResult, ['layerId', 'createdLayerId']);
            if (!rectangleResult?.success || !rectangleLayerId) {
                return fail('create-rounded-placeholder', toolError(rectangleResult, `“${slot.source.colorName}”圆角占位创建失败。`));
            }

            const convertResult = await callTool('convertToSmartObject', {
                layerIds: [rectangleLayerId],
                name: slot.smartObjectName
            }, 'convert-placeholder-to-smart-object', sourceId);
            const smartObjectLayerId = readPositiveId(convertResult, ['layerId', 'createdLayerId']);
            if (!convertResult?.success || !smartObjectLayerId) {
                return fail('convert-placeholder-to-smart-object', toolError(convertResult, `“${slot.source.colorName}”占位转智能对象失败。`));
            }

            const editResult = await callTool('editSmartObjectContents', {
                layerId: smartObjectLayerId
            }, 'open-smart-object', sourceId);
            const internalDocumentId = readPositiveId(editResult, ['documentId', 'id']);
            if (!editResult?.success || !internalDocumentId) {
                return fail('open-smart-object', toolError(editResult, `“${slot.source.colorName}”智能对象内容无法打开。`));
            }

            const internalInfoResult = await callTool('getDocumentInfo', {}, 'read-smart-object-document', sourceId);
            const internalSize = readDocumentSize(internalInfoResult);
            if (!internalInfoResult?.success || !internalSize) {
                return fail('read-smart-object-document', toolError(internalInfoResult, `无法读取“${slot.source.colorName}”智能对象内部尺寸。`));
            }
            const internalGeometry = buildInternalSkuColorCardGeometry({
                width: internalSize.width,
                height: internalSize.height,
                recipe: plan.cardStyle.internalLabel,
                labelText: slot.source.colorName
            });

            const imageResult = await callTool('placeImage', {
                filePath: slot.source.filePath,
                name: `${slot.source.colorName}-商品图`,
                targetBounds: internalGeometry.image,
                targetFit: 'contain',
                layerOrder: 'front'
            }, 'place-product-image-draft', sourceId);
            const imageLayerId = readPositiveId(imageResult, ['layerId', 'placedLayerId', 'createdLayerId']);
            if (!imageResult?.success || !imageLayerId) {
                return fail('place-product-image', toolError(imageResult, `“${slot.source.colorName}”图片置入失败。`));
            }

            const clippingResult = await callTool('createClippingMask', {
                layerId: imageLayerId
            }, 'clip-product-image', sourceId);
            if (!clippingResult?.success) {
                return fail('clip-product-image', toolError(clippingResult, `“${slot.source.colorName}”图片剪切蒙版创建失败。`));
            }
            const clippingReadback = await callTool('getClippingMaskInfo', {
                layerId: imageLayerId
            }, 'verify-product-clipping', sourceId);
            const clippingVerified = isSkuColorCardClippingReadbackVerified(clippingReadback);
            if (!clippingVerified) {
                return fail('verify-product-clipping', toolError(clippingReadback, `“${slot.source.colorName}”图片未读回为剪切蒙版。`));
            }

            const labelResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-色名白底`,
                ...internalGeometry.label,
                fillColorHex: plan.cardStyle.labelFillColorHex,
                cornerRadius: internalGeometry.label.cornerRadius
            }, 'create-color-label-background', sourceId);
            const labelBackgroundLayerId = readPositiveId(labelResult, ['layerId', 'createdLayerId']);
            if (!labelResult?.success || !labelBackgroundLayerId) {
                return fail('create-color-label-background', toolError(labelResult, `“${slot.source.colorName}”白色色名底创建失败。`));
            }

            const textResult = await callTool('createTextLayer', {
                content: slot.source.colorName,
                name: `${slot.source.colorName}-色名`,
                ...internalGeometry.text,
                colorHex: plan.cardStyle.labelTextColorHex,
                alignment: 'left'
            }, 'create-color-label-text', sourceId);
            const labelTextLayerId = readPositiveId(textResult, ['layerId', 'createdLayerId']);
            if (!textResult?.success || !labelTextLayerId) {
                return fail('create-color-label-text', toolError(textResult, `“${slot.source.colorName}”色名文字创建失败。`));
            }

            const textFitResult = await fitAndCenterLabelText({
                sourceId,
                labelLayerId: labelBackgroundLayerId,
                textLayerId: labelTextLayerId,
                initialFontSize: internalGeometry.text.fontSize
            });
            if (!textFitResult.verified) {
                return fail(
                    'verify-label-text-fit',
                    `“${slot.source.colorName}”色名文字适配未通过：${textFitResult.error || '未知原因'}`
                );
            }

            const closeResult = await callTool('closeDocument', {
                documentId: internalDocumentId,
                save: true
            }, 'save-and-close-smart-object', sourceId);
            if (!closeResult?.success) {
                return fail('save-and-close-smart-object', toolError(closeResult, `“${slot.source.colorName}”智能对象保存失败。`));
            }

            const switchMainResult = await callTool('switchDocument', {
                documentId: mainDocumentId,
                documentName: plan.documentName
            }, 'return-to-main-document', sourceId);
            if (!switchMainResult?.success) {
                return fail('return-to-main-document', toolError(switchMainResult, '无法返回 SKU 主文档。'));
            }

            const moveSmartObjectResult = await callTool('moveLayerToGroup', {
                layerId: smartObjectLayerId,
                targetGroupId: groupId,
                position: 'inside'
            }, 'group-smart-object', sourceId);
            if (!moveSmartObjectResult?.success) {
                return fail('group-smart-object', toolError(moveSmartObjectResult, `“${slot.source.colorName}”智能对象无法移入颜色组。`));
            }

            const smartObjectInfo = await callTool('getSmartObjectInfo', {
                layerId: smartObjectLayerId
            }, 'verify-smart-object', sourceId);
            const smartObjectVerified = isSmartObjectVerified(smartObjectInfo);
            if (!smartObjectVerified) {
                return fail('verify-smart-object', toolError(smartObjectInfo, `“${slot.source.colorName}”未读回为可编辑智能对象。`));
            }

            preparedCards.push({
                sourceId,
                colorName: slot.source.colorName,
                sourcePath: slot.source.filePath,
                groupId,
                smartObjectLayerId,
                internalDocumentId,
                internalCanvas: { width: internalSize.width, height: internalSize.height },
                imageLayerId,
                labelBackgroundLayerId,
                labelTextLayerId,
                clippingVerified,
                smartObjectVerified,
                labelTextFitVerified: textFitResult.verified
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: `色卡结构已确认：${slot.source.colorName}`,
                detail: '已读回智能对象、商品图剪切关系，以及色名文字的真实边界与居中结果。',
                status: 'success',
                percent: progressBase + 8
            });
        }

        if (plan.indexReference.enabled) {
            const referenceGroupResult = await callTool('createGroup', {
                groupName: plan.indexReference.groupName
            }, 'create-index-reference-group');
            const referenceGroupId = readPositiveId(referenceGroupResult, ['layerId', 'createdLayerId', 'id']);
            if (!referenceGroupResult?.success || !referenceGroupId) {
                return fail(
                    'create-index-reference-group',
                    toolError(referenceGroupResult, '序号参考组创建失败。')
                );
            }
            const normalizeReferenceGroupResult = await callTool('moveLayerToGroup', {
                layerId: referenceGroupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-index-reference-group-root');
            if (!normalizeReferenceGroupResult?.success) {
                return fail(
                    'normalize-index-reference-group-root',
                    toolError(normalizeReferenceGroupResult, '序号参考组无法归位到文档根层级。')
                );
            }

            for (const slot of plan.slots) {
                if (!slot.indexText) continue;
                const indexTextResult = await callTool('createTextLayer', {
                    content: slot.indexText.content,
                    name: slot.indexLayerName,
                    x: slot.indexText.x,
                    y: slot.indexText.y,
                    fontSize: slot.indexText.fontSize,
                    colorHex: '#111111',
                    alignment: 'center'
                }, 'create-index-reference-text', slot.source.sourceId);
                const indexLayerId = readPositiveId(indexTextResult, ['layerId', 'createdLayerId']);
                if (!indexTextResult?.success || !indexLayerId) {
                    return fail(
                        'create-index-reference-text',
                        toolError(indexTextResult, `“${slot.source.colorName}”参考序号创建失败。`)
                    );
                }
                const moveIndexResult = await callTool('moveLayerToGroup', {
                    layerId: indexLayerId,
                    targetGroupId: referenceGroupId,
                    position: 'inside'
                }, 'move-index-to-reference-group', slot.source.sourceId);
                if (!moveIndexResult?.success) {
                    return fail(
                        'move-index-to-reference-group',
                        toolError(moveIndexResult, `“${slot.source.colorName}”参考序号无法移入参考组。`)
                    );
                }
            }
            indexReferenceIsolation = 'passed';
        }

        const finalDocumentInfo = await callTool('getDocumentInfo', {}, 'verify-main-document');
        const finalDocumentSize = readDocumentSize(finalDocumentInfo);
        if (!finalDocumentInfo?.success
            || !finalDocumentSize
            || finalDocumentSize.documentId !== mainDocumentId
            || finalDocumentSize.width !== plan.canvas.width
            || finalDocumentSize.height !== plan.canvas.height) {
            return fail('verify-main-document', '最终活动文档不是预期的 SKU 画布，已停止保存。');
        }

        const snapshotResult = await callTool('getAcceptanceSnapshot', {
            includeHidden: true,
            includeText: true,
            includeBounds: true,
            maxLayers: 240
        }, 'final-structure-readback');
        if (!snapshotResult?.success) {
            return fail('final-structure-readback', toolError(snapshotResult, 'SKU 色卡完成后无法读回图层结构。'));
        }

        const draftVisualSnapshot = await callTool('getCanvasSnapshot', {
            maxSize: 1500
        }, 'draft-visual-snapshot');
        if (!draftVisualSnapshot?.success) {
            return fail('draft-visual-snapshot', toolError(draftVisualSnapshot, 'SKU 色卡结构草稿创建后无法取得视觉快照。'));
        }

        const saveResult = await callTool('saveDocument', {
            format: 'psb',
            path: plan.outputPath,
            saveAs: true
        }, 'save-output');
        if (!saveResult?.success) {
            return fail('save-output', toolError(saveResult, `SKU 色卡无法保存到 ${plan.outputPath}。`));
        }

        const report: SkuColorCardExecutionReport = {
            version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
            status: 'structure_ready',
            outputPath: plan.outputPath,
            documentId: mainDocumentId,
            sourceCount: plan.slots.length,
            preparedCards,
            checks: {
                sourceCoverage: preparedCards.length === plan.slots.length ? 'passed' : 'failed',
                smartObjectEditability: preparedCards.every((card) => card.smartObjectVerified) ? 'passed' : 'failed',
                clippingStructure: preparedCards.every((card) => card.clippingVerified) ? 'passed' : 'failed',
                labelTextFit: preparedCards.every((card) => card.labelTextFitVerified) ? 'passed' : 'failed',
                indexReferenceIsolation,
                finalStructureReadback: 'passed',
                visualComposition: 'needs_review'
            }
        };
        const visualAdjustmentHandoff = {
            version: 'sku-color-card-visual-adjustment-handoff/v0' as const,
            status: 'needs_visual_review' as const,
            mainDocumentId,
            outputPath: plan.outputPath,
            cards: preparedCards.map((card) => ({
                colorName: card.colorName,
                sourcePath: card.sourcePath,
                smartObjectLayerId: card.smartObjectLayerId,
                imageLayerId: card.imageLayerId,
                labelBackgroundLayerId: card.labelBackgroundLayerId,
                labelTextLayerId: card.labelTextLayerId,
                internalCanvas: card.internalCanvas
            })),
            reviewQuestions: [
                '商品主体是否足够突出，且没有因原图留白显得偏小？',
                '主体重心和裁切是否适合卡片，而不是机械居中或机械铺满？',
                '色名标签是否遮挡关键商品细节，整体位置是否需要微调？'
            ],
            nextSteps: [
                '只打开尚未复核的色卡智能对象并取得真实画布快照；不要移动 SKU 主文档中的颜色组或重新编排卡片。',
                '由视觉模型判断主体大小、重心和裁切；主体检测可靠时调用 fitLayerSubjectToRegion。',
                '若主体检测失败或超时，不重复阻塞调用：由视觉模型给出放大/缩小和移动方向，使用 transformLayer/moveLayer 小步调整。',
                '只有画面确实需要修改时才执行一次小步调整；每次调整后重新取得快照复核，再保存关闭智能对象并返回 SKU 主文档。',
                '同一对象的写后验收未通过时停止重复动作，改用其他方法或如实说明阻塞原因。',
                '全部色卡复核后保存主文档，并读取最终画面与结构；视觉未复核时不得声明设计完成。'
            ]
        };
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: 'SKU 色卡结构草稿已生成',
            detail: `已创建 ${preparedCards.length} 个可编辑颜色卡；下一步需要 Agent 看图并调整商品主体大小与裁切。`,
            status: 'running',
            percent: 88
        });
        callbacks?.onProgress?.('SKU 色卡结构草稿已生成，等待视觉调整', 88);

        return {
            success: true,
            message: `SKU 色卡结构草稿已生成：${preparedCards.length} 个颜色，已保存到 ${plan.outputPath}；商品主体缩放和裁切仍需 Agent 看图调整。`,
            toolResults: observations,
            data: {
                plan,
                report,
                snapshot: draftVisualSnapshot.snapshot,
                snapshotResult,
                draftVisualSnapshot,
                saveResult,
                sourceResolution,
                visualAdjustmentHandoff,
                agentReActContinuation: {
                    status: 'needs_decision',
                    summary: 'SKU 色卡可编辑结构草稿已生成，但商品主体的视觉大小、重心和裁切尚未由 Agent 看图确认。',
                    details: [
                        `已创建 ${preparedCards.length} 个可编辑色卡智能对象。`,
                        '色名文字已按 Photoshop 真实 bounds 完成宽度适配和水平/垂直居中。',
                        '已取得 SKU 主文档写后视觉快照。'
                    ],
                    warnings: [
                        '当前只保存了结构草稿；固定 contain 置入不是最终设计，不得直接宣称视觉完成。',
                        '视觉复核只处理智能对象内部商品图，不得移动主文档颜色组或重复执行验收未通过的相同动作。'
                    ],
                    nextAction: 'decide_next',
                    sourceStatus: 'structure_ready'
                }
            }
        };
    }
};
