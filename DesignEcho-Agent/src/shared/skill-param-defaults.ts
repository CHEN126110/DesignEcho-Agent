type SkillParamDefaultsInput = {
    skillId: string;
    userInput: string;
    mode?: 'inspect' | 'execute' | null;
    params?: Record<string, any>;
};

import { getSkillById } from './skills/skill-declarations';
import { extractRequestedOutputPathParams } from './skill-routing';
import { inferSkuIntentParamsFromText, isSkuCardSourceOnlyText } from './sku-intent-params';
import { MAIN_IMAGE_DELIVERY_DOCUMENTS } from './main-image-design-core';
import { resolveMainImageWhiteBackgroundIntentDefaults } from './main-image-white-background-export-contract';
import {
    isProjectContextMainImageDeliveryIntent,
    isProjectImageAnalysisInventoryOverviewIntent
} from './project-image-analysis-intent';

const MAIN_IMAGE_DEFAULT_SIZE_KEYS = MAIN_IMAGE_DELIVERY_DOCUMENTS.map((doc) => doc.folderKey);

function extractFontName(userInput: string): string | undefined {
    const match = String(userInput || '').match(/(?:改成|换成|改为|换为)\s*([^\n，。,.!！?？]+)/i);
    const fontName = String(match?.[1] || '').trim();
    return fontName || undefined;
}

function hasOwnParam(params: Record<string, any>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(params, key);
}

function hasNonEmptyStringParam(params: Record<string, any>, key: string): boolean {
    return hasOwnParam(params, key) && String(params[key] || '').trim().length > 0;
}

function hasNonEmptyArrayParam(params: Record<string, any>, key: string): boolean {
    return hasOwnParam(params, key) && Array.isArray(params[key]) && params[key].length > 0;
}

function hasFiniteNumberParam(params: Record<string, any>, key: string): boolean {
    return hasOwnParam(params, key) && Number.isFinite(Number(params[key]));
}

function getDeclaredSkillParamDefaults(skillId: string): Record<string, any> {
    const skill = getSkillById(skillId);
    if (!skill) return {};

    return skill.parameters.reduce<Record<string, any>>((acc, param) => {
        if (param.default === undefined) return acc;
        acc[param.name] = param.default;
        return acc;
    }, {});
}

function buildModeOverrides(input: SkillParamDefaultsInput): Record<string, any> {
    if (input.skillId !== 'detail-page-design' || input.mode !== 'inspect') {
        return {};
    }

    return {
        agentMode: 'inspect',
        inspectOnly: true,
        autoFix: false,
        structureMode: 'inspect',
        visualValidation: false
    };
}

function inferMainImageExplicitSize(userInput: string): string | undefined {
    const text = String(userInput || '');
    if (/(^|[^\d])800([^\d]|$)/.test(text)) return '800';
    if (/(^|[^\d])750([^\d]|$)/.test(text)) return '750';
    if (/(^|[^\d])1200([^\d]|$)/.test(text)) return '1200';
    if (/1\s*[:：x×]\s*1|方图|方形/i.test(text)) return '800';
    if (/3\s*[:：x×]\s*4|竖版|竖图/i.test(text)) return '750';
    if (/9\s*[:：x×]\s*16|长竖图|长图/i.test(text)) return '1200';
    return undefined;
}

function inferMainImageExplicitPixelSize(userInput: string): { width: number; height: number } | undefined {
    const match = String(userInput || '').match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }
    return {
        width: Math.round(width),
        height: Math.round(height)
    };
}

function inferMainImageType(userInput: string): 'click' | 'conversion' | 'white-bg' | undefined {
    const text = String(userInput || '');
    if (/白底图|自底图|白底|white[-\s]?bg|white background/i.test(text)) return 'white-bg';
    const asksClick = /点击图|click/i.test(text);
    const asksConversion = /转化图|conversion/i.test(text);
    if (asksClick && !asksConversion) return 'click';
    if (asksConversion && !asksClick) return 'conversion';
    return undefined;
}

function isMainImageWhiteBackgroundExecuteRequest(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text) return false;
    if (!/白底图|自底图|白底|white[-\s]?bg|white background/i.test(text)) return false;
    if (!/sku/i.test(text)) return false;
    if (/(怎么|如何|为什么|是什么|能不能|可以吗|规则|规范|方案|思路|解释|分析一下|看看)/.test(text)) {
        return false;
    }
    return /(帮我|请|需要|给我|做|制作|生成|导出|输出|保存|放到|到主图目录)/.test(text);
}

function shouldEnableSkuCardSourcePreparation(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(userInput)) return true;
    if (shouldPreferExistingSkuCardSource(userInput)) return false;
    if (/(怎么|如何|为什么|是什么|能不能|可以吗|规则|规范|方案|思路|解释|分析一下|看看|检查|查看)/.test(text)) {
        return false;
    }
    const asksSkuOutput = /(帮我|请|需要|给我|做|制作|生成|导出|输出|批量|出图|考试|创建|新建|建立|整理|准备|完成|交付|产出)/.test(text);
    if (!asksSkuOutput) return false;
    return /(卡片式|卡片|色卡|项目素材|当前项目|原始图|原始图片|平铺图|单品图|单只|从.+图片.+sku|sku.+图片|sku.+素材)/i.test(text);
}

function hasCurrentSkuDocumentSourceHint(text: string): boolean {
    return /(?:当前|打开的|当前打开的)?\s*(?:Photoshop|PS|ps).{0,32}(?:名为|名称为|叫做|叫)?\s*SKU.{0,24}(?:文档|文件|psd|psb)/i.test(text)
        || /(?:名为|名称为|叫做|叫)\s*SKU.{0,16}(?:文档|文件|psd|psb).{0,24}(?:作为|当作|用作).{0,16}(?:SKU|色卡源|色卡素材|卡片源)/i.test(text)
        || /SKU.{0,16}(?:文档|文件|psd|psb).{0,24}(?:作为|当作|用作).{0,16}(?:SKU|色卡源|色卡素材|卡片源)/i.test(text);
}

function hasNoRegenerateSkuSourceHint(text: string): boolean {
    return /(?:不要|不需要|无需|别|不用).{0,24}(?:重新|再).{0,24}(?:选图|制作色卡|做色卡|创建色卡|整理色卡|生成色卡|准备色卡|制作素材|准备素材)/i.test(text)
        || /(?:不要|不需要|无需|别|不用).{0,24}(?:重新|再).{0,32}(?:做|制作|创建|整理|生成|准备).{0,24}(?:SKU|sku)?.{0,16}(?:色卡|卡片源|色卡源|色卡素材|源素材|素材)/i.test(text);
}

function hasSkuComboTemplateProductionHint(text: string): boolean {
    if (!/sku/i.test(text)) return false;
    const hasCombo = /(组合图|规格组合|颜色组合|自选备注|备注图|2\s*双装.{0,36}3\s*双装.{0,36}4\s*双装|2\s*[-/、，,]\s*3\s*[-/、，,]\s*4\s*双|\d+\s*双装)/i.test(text);
    if (!hasCombo) return false;
    return /(帮我|请|需要|给我|做|制作|生成|导出|输出|批量|出图|考试|创建|建立|完成|交付|产出)/.test(text);
}

function shouldPreferExistingSkuCardSource(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text || !/sku/i.test(text)) return false;

    return /(?:已有|现有|现成|已经准备好|已准备好|已准备|项目已有|项目中已有|已经有|已存在).{0,36}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)/i.test(text)
        || /(?:存在|有|包含|包括).{0,36}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)/i.test(text)
        || /(?:基于|使用|复用|沿用|优先使用|用).{0,48}(?:项目中|当前项目|项目里|我们项目|已有|现有|现成|已准备|项目已有).{0,48}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源)/i.test(text)
        || hasCurrentSkuDocumentSourceHint(text)
        || hasNoRegenerateSkuSourceHint(text);
}

function shouldRequireSkuComboConfirmation(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(userInput)) return false;
    if (/(?:我已确认|已确认|确认使用|确认后的组合|基于确认后的组合).{0,48}(?:SKU|sku)?.{0,32}(?:组合|配方)/i.test(text)) {
        return false;
    }
    if (/(?:无需|不用|不需要|不要|跳过).{0,18}(?:确认组合|组合确认|确认卡片|卡片确认)/i.test(text)) {
        return false;
    }
    if (/(?:只|仅|单独).{0,16}(?:自选备注|备注图|备注)/.test(text) && !/(?:组合图|组合|配色)/.test(text)) {
        return false;
    }

    const asksSkuOutput = /(帮我|请|需要|给我|做|制作|生成|导出|输出|批量|出图|考试|创建|建立)/.test(text);
    if (!asksSkuOutput) return false;

    // 治理2026-07-01：任何真实的 SKU 出图请求默认都要先出"带组合的确认卡"让用户确认/编辑组合，
    // 不再只对含"卡片式/色卡/组合图/2双装3双装"等关键词的请求才要确认——裸的"帮我做SKU"也要确认卡。
    // 前面的早退分支已排除：只做色卡源/已确认续跑/明确说不用确认/只做自选备注 这些不该弹卡的场景。
    return true;
}

function shouldRequireSkuCardTemplateDesignConfirmation(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(userInput)) return false;
    if (/(?:我已确认|已确认|确认使用|确认后的|基于确认后的).{0,48}(?:SKU|sku)?.{0,32}(?:色卡模板|卡片模板|排版模板|模板设计|模板方案)/i.test(text)) {
        return false;
    }
    if (/(?:无需|不用|不需要|不要|跳过).{0,18}(?:模板确认|确认模板|模板设计确认|设计确认|确认卡片)/i.test(text)) {
        return false;
    }
    if (/(怎么|如何|为什么|是什么|能不能|可以吗|规则|规范|方案|思路|解释|分析一下|看看|检查|查看)/.test(text)) {
        return false;
    }

    const asksSkuOutput = /(帮我|请|需要|给我|做|制作|生成|导出|输出|批量|出图|考试|创建|建立)/.test(text);
    if (!asksSkuOutput) return false;

    return /(?:色卡模板|卡片模板|排版模板|模板设计|模板方案|SKU.{0,16}模板|模板.{0,16}SKU)/i.test(text)
        || (/(卡片式|卡片|色卡)/i.test(text) && /(模板|版式|排版|组合图)/i.test(text))
        || (/(卡片式.{0,12}SKU|SKU.{0,12}卡片式)/i.test(text) && /(规格|双装|组合|自选备注|生成|导出|出图|完成)/.test(text))
        || (shouldPreferExistingSkuCardSource(userInput) && hasSkuComboTemplateProductionHint(text));
}

function shouldEnableSkuCardTemplatePreparation(userInput: string): boolean {
    if (isSkuCardSourceOnlyText(userInput)) return false;
    const text = String(userInput || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (/(怎么|如何|为什么|是什么|能不能|可以吗|规则|规范|方案|思路|解释|分析一下|看看|检查|查看)/.test(text)) {
        return false;
    }
    const asksSkuOutput = /(帮我|请|需要|给我|做|制作|生成|导出|输出|批量|出图|考试)/.test(text);
    if (!asksSkuOutput) return false;
    return shouldEnableSkuCardSourcePreparation(userInput)
        || /(卡片式|卡片|排版模板|模板)/i.test(text)
        || (shouldPreferExistingSkuCardSource(userInput) && hasSkuComboTemplateProductionHint(text));
}

function shouldDispatchEcommerceSocksChildren(userInput: string): boolean {
    const text = String(userInput || '').trim();
    if (!text) return false;
    if (/(规划|计划|方案|怎么|如何|为什么|是否|能不能|可不可以|要不要|先看看|先分析|只说明|仅说明|不要执行|别执行|先别执行|不执行)/i.test(text)) {
        return false;
    }

    const hasMainImage = /主图|首图|main\s*image/i.test(text);
    const hasDetailPage = /详情页|长图|detail\s*page/i.test(text);
    const hasSku = /sku|SKU|规格图|组合图|自选备注/i.test(text);
    if (!hasMainImage || !hasDetailPage || !hasSku) return false;

    return /(完整完成|全部完成|都要做|都做|全套|整套|一套|完成|交付|产出|生成|制作|做完|跑完|自主跑完)/i.test(text);
}

function buildMainImageFallbacks(input: SkillParamDefaultsInput): Record<string, any> {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const fallback: Record<string, any> = {};
    const hasSizeParam = hasOwnParam(params, 'size') || hasOwnParam(params, 'sizes');
    const hasCustomSizeParam = hasOwnParam(params, 'customSize');
    const inferredPixelSize = inferMainImageExplicitPixelSize(input.userInput);
    const inferredSize = inferMainImageExplicitSize(input.userInput);

    if (!hasSizeParam) {
        if (inferredPixelSize) {
            fallback.size = 'custom';
            if (!hasCustomSizeParam) {
                fallback.customSize = inferredPixelSize;
            }
        } else if (inferredSize) {
            fallback.size = inferredSize;
        } else {
            fallback.sizes = [...MAIN_IMAGE_DEFAULT_SIZE_KEYS];
        }
    } else if (!hasCustomSizeParam && inferredPixelSize && params.size === 'custom') {
        fallback.customSize = inferredPixelSize;
    }

    if (!hasOwnParam(params, 'imageType')) {
        const inferredImageType = inferMainImageType(input.userInput);
        if (inferredImageType) {
            fallback.imageType = inferredImageType;
        }
    }

    if (input.mode === 'execute' && isMainImageWhiteBackgroundExecuteRequest(input.userInput)) {
        if (!hasOwnParam(params, 'mainImageExecutionMode')) {
            fallback.mainImageExecutionMode = 'product-disposable-live';
        }
    }

    if (input.mode === 'execute' && isProjectContextMainImageDeliveryIntent(input.userInput)) {
        if (!hasOwnParam(params, 'mainImageExecutionMode')) {
            fallback.mainImageExecutionMode = 'product-disposable-live';
        }
        if (!hasOwnParam(params, 'executionScope')) {
            fallback.executionScope = 'disposable-document';
        }
        if (!hasOwnParam(params, 'sourceAssetKind')) {
            fallback.sourceAssetKind = 'selected-project-image';
        }
        if (!hasOwnParam(params, 'outputDirPolicy')) {
            fallback.outputDirPolicy = 'project-main-image-dir';
        }
        if (!hasOwnParam(params, 'enableVisionPreflight')) {
            fallback.enableVisionPreflight = true;
        }
        if (!hasOwnParam(params, 'maxVisionCandidates')) {
            fallback.maxVisionCandidates = 1;
        }
    }

    return {
        ...fallback,
        ...resolveMainImageWhiteBackgroundIntentDefaults({
            userIntent: input.userInput,
            params: {
                ...fallback,
                ...params
            }
        })
    };
}

function buildSkillSpecificFallbacks(input: SkillParamDefaultsInput): Record<string, any> {
    const skillId = String(input.skillId || '').trim();
    if (skillId === 'sku-batch') {
        const sourceOnly = isSkuCardSourceOnlyText(input.userInput);
        const preferExistingSkuSource = !sourceOnly && shouldPreferExistingSkuCardSource(input.userInput);
        const enableSkuCardSourcePreparation = shouldEnableSkuCardSourcePreparation(input.userInput);
        const enableSkuCardTemplatePreparation = shouldEnableSkuCardTemplatePreparation(input.userInput);
        const requireSkuComboConfirmation = shouldRequireSkuComboConfirmation(input.userInput);
        const requireSkuCardTemplateDesignConfirmation = shouldRequireSkuCardTemplateDesignConfirmation(input.userInput);
        const fallback: Record<string, any> = {
            countPerSize: sourceOnly ? 0 : 5,
            generateNotes: sourceOnly ? false : true,
            ...(sourceOnly ? { sourceOnly: true } : {})
        };
        if (requireSkuComboConfirmation) {
            fallback.requireSkuComboConfirmation = true;
        }
        if (requireSkuCardTemplateDesignConfirmation) {
            fallback.requireSkuCardTemplateDesignConfirmation = true;
        }
        if (preferExistingSkuSource) {
            fallback.preferExistingSkuSourceForCardPreparation = true;
            fallback.skuSourcePreparationMode = 'disabled';
            fallback.allowSkuCardSourcePreparation = false;
            fallback.runSkuCardVisualConfirmationBeforeSourcePreparation = false;
        }
        if (enableSkuCardSourcePreparation) {
            fallback.skuSourcePreparationMode = 'card-source-from-project-images';
            fallback.allowSkuCardSourcePreparation = true;
            fallback.skuSourceOutputRelativePath = 'PSD/SKU-card-source.psb';
            fallback.skuSourceCandidateLimit = 8;
            fallback.runSkuCardVisualConfirmationBeforeSourcePreparation = true;
            fallback.skuCardVisualConfirmationMaxCandidates = 8;
            fallback.enableBusinessVisualObservationRefresh = true;
            fallback.runBusinessVisualObservationRefreshBeforeExecution = true;
            fallback.visualObservationRefreshMaxCandidates = 8;
        }
        if (enableSkuCardTemplatePreparation) {
            fallback.skuTemplatePreparationMode = 'card-placeholder-templates';
            fallback.allowSkuCardTemplatePreparation = true;
            fallback.skuTemplateOutputRelativeDir = '模板文件';
            fallback.skuTemplateNotePlaceholderCount = 8;
        }
        return fallback;
    }

    if (skillId === 'main-image-design') {
        return buildMainImageFallbacks(input);
    }

    if (skillId === 'ecommerce-socks-design' && shouldDispatchEcommerceSocksChildren(input.userInput)) {
        return {
            executeChildren: true,
            confirmChildDispatch: true,
            enableChildDispatch: true,
            dryRunChildDispatch: false
        };
    }

    return {};
}

function buildIntentBoundParams(input: SkillParamDefaultsInput): Record<string, any> {
    const skill = getSkillById(input.skillId);
    if (!skill) return {};

    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const paramNames = new Set(skill.parameters.map((param) => param.name));
    const userInput = String(input.userInput || '').trim();
    const bound: Record<string, any> = {};

    if (paramNames.has('userIntent') && !hasNonEmptyStringParam(params, 'userIntent')) {
        bound.userIntent = userInput;
    }

    if (paramNames.has('templateIntent') && !hasNonEmptyStringParam(params, 'templateIntent')) {
        bound.templateIntent = userInput;
    }

    const requestedOutput = extractRequestedOutputPathParams(userInput);
    if (paramNames.has('outputPath')
        && !hasNonEmptyStringParam(params, 'outputPath')
        && requestedOutput.outputPath) {
        bound.outputPath = requestedOutput.outputPath;
    }
    if (paramNames.has('outputRelativePath')
        && !hasNonEmptyStringParam(params, 'outputRelativePath')
        && requestedOutput.outputRelativePath) {
        bound.outputRelativePath = requestedOutput.outputRelativePath;
    }

    if (input.skillId === 'agent-panel-bridge' && paramNames.has('goal') && !hasOwnParam(params, 'goal')) {
        bound.goal = userInput;
    }

    if (input.skillId === 'text-font-replace' && paramNames.has('fontName') && !String(params.fontName || '').trim()) {
        const inferredFontName = extractFontName(userInput);
        if (inferredFontName) {
            bound.fontName = inferredFontName;
        }
    }

    if (input.skillId === 'sku-batch') {
        const inferred = inferSkuIntentParamsFromText(userInput);
        const hasOriginalUserInput = userInput.length > 0;
        const preferExistingSkuSource = !inferred.sourceOnly && shouldPreferExistingSkuCardSource(userInput);
        const cardSourcePreparationIntent = shouldEnableSkuCardSourcePreparation(userInput);
        const cardTemplatePreparationIntent = shouldEnableSkuCardTemplatePreparation(userInput);
        const requireSkuComboConfirmation = shouldRequireSkuComboConfirmation(userInput);
        const requireSkuCardTemplateDesignConfirmation = shouldRequireSkuCardTemplateDesignConfirmation(userInput);
        const cardSourceOnlyIntent = isSkuCardSourceOnlyText(userInput);

        if (hasOriginalUserInput && paramNames.has('userIntent')) {
            bound.userIntent = userInput;
        }

        if (paramNames.has('comboSizes') && inferred.comboSizes?.length) {
            bound.comboSizes = inferred.comboSizes;
        }

        if (paramNames.has('countPerSize') && typeof inferred.countPerSize === 'number') {
            bound.countPerSize = inferred.countPerSize;
        }

        if (hasOriginalUserInput && paramNames.has('generateNotes')) {
            bound.generateNotes = inferred.generateNotes === true;
        }

        if (hasOriginalUserInput && paramNames.has('onlyNotes')) {
            bound.onlyNotes = inferred.onlyNotes === true;
        }

        if (hasOriginalUserInput && paramNames.has('sourceOnly')) {
            bound.sourceOnly = inferred.sourceOnly === true;
        }

        if (requireSkuComboConfirmation && paramNames.has('requireSkuComboConfirmation')) {
            bound.requireSkuComboConfirmation = true;
        }
        if (requireSkuCardTemplateDesignConfirmation && paramNames.has('requireSkuCardTemplateDesignConfirmation')) {
            bound.requireSkuCardTemplateDesignConfirmation = true;
        }

        if (preferExistingSkuSource) {
            if (paramNames.has('preferExistingSkuSourceForCardPreparation')) {
                bound.preferExistingSkuSourceForCardPreparation = true;
            }
            if (paramNames.has('skuSourcePreparationMode')) {
                bound.skuSourcePreparationMode = 'disabled';
            }
            if (paramNames.has('allowSkuCardSourcePreparation')) {
                bound.allowSkuCardSourcePreparation = false;
            }
            if (paramNames.has('runSkuCardVisualConfirmationBeforeSourcePreparation')) {
                bound.runSkuCardVisualConfirmationBeforeSourcePreparation = false;
            }
        } else if (cardSourcePreparationIntent) {
            if (paramNames.has('skuSourcePreparationMode')) {
                bound.skuSourcePreparationMode = 'card-source-from-project-images';
            }
            if (paramNames.has('allowSkuCardSourcePreparation')) {
                bound.allowSkuCardSourcePreparation = true;
            }
            if (paramNames.has('runSkuCardVisualConfirmationBeforeSourcePreparation')) {
                bound.runSkuCardVisualConfirmationBeforeSourcePreparation = true;
            }
            if (paramNames.has('skuCardVisualConfirmationMaxCandidates')) {
                bound.skuCardVisualConfirmationMaxCandidates = 8;
            }
            if (paramNames.has('skuSourceOutputRelativePath')) {
                bound.skuSourceOutputRelativePath = 'PSD/SKU-card-source.psb';
            }
        }

        if (cardTemplatePreparationIntent) {
            if (paramNames.has('skuTemplatePreparationMode')) {
                bound.skuTemplatePreparationMode = cardSourceOnlyIntent ? 'disabled' : 'card-placeholder-templates';
            }
            if (paramNames.has('allowSkuCardTemplatePreparation')) {
                bound.allowSkuCardTemplatePreparation = cardSourceOnlyIntent ? false : true;
            }
            if (paramNames.has('skuTemplateOutputRelativeDir')) {
                bound.skuTemplateOutputRelativeDir = '模板文件';
            }
        }
    }

    if (input.skillId === 'project-image-analysis'
        && isProjectImageAnalysisInventoryOverviewIntent(userInput)) {
        if (paramNames.has('analysisMode')) {
            bound.analysisMode = 'inventory';
        }
        if (paramNames.has('sampleSize')) {
            bound.sampleSize = 0;
        }
        if (paramNames.has('focus')) {
            bound.focus = 'inventory';
        }
    }

    return bound;
}

export function applySharedSkillParamDefaults(input: SkillParamDefaultsInput): Record<string, any> {
    const skillId = String(input.skillId || '').trim();
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const declaredDefaults = getDeclaredSkillParamDefaults(skillId);
    const modeOverrides = buildModeOverrides(input);
    const skillSpecificFallbacks = buildSkillSpecificFallbacks({
        ...input,
        skillId
    });
    const intentBoundParams = buildIntentBoundParams(input);

    return {
        ...declaredDefaults,
        ...modeOverrides,
        ...skillSpecificFallbacks,
        ...params,
        ...intentBoundParams
    };
}
