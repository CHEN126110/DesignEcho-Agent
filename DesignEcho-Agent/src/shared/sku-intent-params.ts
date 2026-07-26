export type SkuIntentParams = {
    comboSizes?: number[];
    countPerSize?: number;
    generateNotes?: boolean;
    onlyNotes?: boolean;
    sourceOnly?: boolean;
};

const SKU_DOMAIN_TERM_PATTERN = /(?:SKU|sku|SKU\s*备注|sku\s*备注|规格备注|自选备注|备注图|组合图|SKU组合|sku组合|批量配色|批量出图|批量生成|双装|单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双)/;
const SKU_EXECUTION_ACTION_PATTERN = /(?:帮我|请|麻烦你|需要|还需要|还要|再做|再生成|补|补一下|补充|做|创建|新建|建立|整理|准备|生成|制作|处理|跑|出|出图|导出|批量生成|批量出图|开始|执行)/i;
const SKU_CONVERSATION_ONLY_DIRECTIVE_PATTERN = /(?:只|仅|先只)[^。！？!?；;\n]{0,12}(?:说明|解释|回答|分析|理解|描述|总结|复盘|聊聊|说说)/i;
const SKU_TOOL_FORBIDDEN_DIRECTIVE_PATTERN = /(?:不要|别|先别|不需要|无需|禁止|不执行|不调用|不用)[^，,。！？!?；;\n]{0,18}(?:执行|调用|使用|跑|操作|改动|修改|写入|生成|导出|处理|工具|skill|技能|photoshop|ps)/i;
const SKU_COMPLETION_SCOPED_REPORTING_PATTERN = /(?:完成后|做完后|生成后|导出后|保存后|读回后|验收后)[^。！？!?；;\n]{0,64}(?:只|仅)[^。！？!?；;\n]{0,12}(?:说明|回答|汇报|告诉|描述|总结)/i;
const SKU_PLANNING_OR_KNOWLEDGE_PATTERN = /[?？]|(?:怎么|如何|为什么|是否|能不能|能否|可不可以|可以吗|应该|方案|规划|计划|进度|还差|还缺|还剩|剩余|了解|聊聊|分析一下|边界|流程|是什么|做法|最佳实践)/i;
const SKU_IMMEDIATE_EXECUTION_PATTERN = /(?:直接|马上|现在|立即)/i;
const SKU_STAGED_EXECUTION_PATTERN = /(?:先|先把|先帮我).{0,32}(?:确认|查看|检查|分析|理解|看).{0,48}(?:再|然后).{0,48}(?:整理|执行|生成|制作|做|导出|出图)|(?:完成后|做完后|生成后|导出后).{0,32}(?:读回|检查|验收|说明哪些文件|说明结果)/i;
const SKU_DOWNSTREAM_CONTEXT_PATTERN = /(?:后续会接到|后续会接入|后续接到|后续接入|后续会|后续再|后续|之后会|之后再|之后|后面会|后面再|后面|接下来会|接下来再)[^。！？!?；;\n]*/gi;
const SKU_COMBO_CONFIRMATION_CARD_PATTERN = /(?:组合候选|候选组合|确认卡片|卡片.{0,12}确认|让我确认|确认.{0,16}(?:SKU|sku)?.{0,16}组合|(?:SKU|sku)?.{0,16}组合.{0,16}确认)/i;
const SKU_READ_ONLY_INSPECTION_PATTERN = /(?:(?:查看|看看|看一下|检查|检查一下|识别|分析|理解|统计).{0,20}(?:SKU|sku|自选备注|备注图|组合图).{0,24}(?:配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|有哪些|有什么|目录|结构)?|(?:SKU|sku|自选备注|备注图|组合图).{0,24}(?:配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|有哪些|有什么|目录|结构).{0,20}(?:查看|看看|看一下|检查|检查一下|识别|分析|理解|统计)?)/i;
const SKU_READ_ONLY_EXECUTION_NEGATIVE_PATTERN = /(?:做|生成|制作|处理|跑|出图|导出|批量生成|批量出图|开始|执行|创建|新建|建立|整理|准备|完成|交付|产出).{0,24}(?:SKU|sku|自选备注|备注图|组合图|色卡素材|排版模板|卡片模板|色卡模板)|(?:SKU|sku|自选备注|备注图|组合图|色卡素材|排版模板|卡片模板|色卡模板).{0,24}(?:做|生成|制作|处理|跑|出图|导出|开始|执行|创建|新建|建立|整理|准备|完成|交付|产出)/i;
const SKU_CAPABILITY_OR_PROCEDURE_QUESTION_PATTERN = /(?:你|agent|智能体|模型|我问你|我想问|问一下|请问).{0,16}(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持).{0,24}(?:SKU|sku|自选备注|备注图|组合图|颜色组合|规格组合|能力)|(?:SKU|sku|自选备注|备注图|组合图|颜色组合|规格组合).{0,24}(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持|怎么做|如何做|怎么处理|如何处理)|支持哪些.{0,16}(?:SKU|sku).{0,8}能力|(?:SKU|sku).{0,16}能力.{0,12}(?:哪些|有什么|支持)/i;
const SKU_CARD_SOURCE_ONLY_PATTERN = /(?:(?:创建|新建|建立|整理|准备|制作|生成|做).{0,32}(?:SKU|sku).{0,32}(?:色卡素材|色卡源|源文档|源文件|卡片源|颜色组)|(?:SKU|sku).{0,32}(?:色卡素材|色卡源文档|色卡源文件|卡片源文档|卡片素材|颜色组源文档)|(?:色卡素材|色卡源文档|卡片源文档).{0,32}(?:SKU|sku))/i;
const SKU_TEMPLATE_DESIGN_PATTERN = /(?:(?:SKU|sku).{0,32}(?:排版模板|卡片模板|色卡模板|模板设计|设计模板|模板方案|版式模板|版式设计)|(?:排版模板|卡片模板|色卡模板|模板设计|设计模板|模板方案|版式模板|版式设计).{0,32}(?:SKU|sku)|(?:做|创建|新建|建立|设计|制作|生成).{0,32}(?:模板|排版|版式).{0,32}(?:SKU|sku)|(?:做|创建|新建|建立|设计|制作|生成).{0,32}(?:SKU|sku).{0,32}(?:模板|排版|版式))/i;
const SKU_EXISTING_SOURCE_HINT_PATTERN = /(?:已有|现有|现成|已经准备好|已准备好|已准备|项目已有|项目中已有|项目中存在|项目里已有|已经有|已存在|基于已有|基于现有|基于我们项目中|基于项目中).{0,48}(?:SKU|sku).{0,48}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)|(?:存在|有|包含|包括).{0,36}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)|(?:基于|使用|复用|沿用|优先使用|用).{0,48}(?:项目中|当前项目|项目里|我们项目|已有|现有|现成|已准备|项目已有).{0,48}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源)/i;
const SKU_TEMPLATE_MISSING_OR_CREATE_PATTERN = /(?:没有|缺少|缺|无|还没|未有).{0,24}(?:模板|排版模板|卡片模板|色卡模板|版式)|(?:模板|排版模板|卡片模板|色卡模板|版式).{0,24}(?:没有|缺少|缺|无|还没|未有)|(?:需要|要|还要|还需要|先|先把).{0,24}(?:做|创建|新建|建立|设计|制作|生成).{0,24}(?:模板|排版模板|卡片模板|色卡模板|版式)/i;
const SKU_TEMPLATE_REFERENCE_ONLY_PATTERN = /(?:不要|别|不使用|不用|无需|禁止).{0,36}(?:模板|排版模板|卡片模板|色卡模板|双装模板|自选备注).{0,36}(?:作为|当作|识别为|使用为).{0,16}(?:SKU|sku).{0,12}(?:源|素材|色卡|文档)?/i;
const SKU_EXPLICIT_TEMPLATE_AUTHORING_PATTERN = /(?:(?:做|创建|新建|建立|设计|制作|生成).{0,36}(?:SKU|sku)?.{0,24}(?:排版模板|卡片模板|色卡模板|模板设计|模板方案|版式模板|版式设计|排版|版式)|(?:排版模板|卡片模板|色卡模板|模板设计|模板方案|版式模板|版式设计).{0,36}(?:做|创建|新建|建立|设计|制作|生成))/i;
const NON_SKU_DOCUMENT_TARGET_PATTERN = /(?:创建|新建|建立|制作|生成).{0,48}(?:详情页|长图|主图|首图|白底图|点击图|转化图).{0,24}(?:文档|文件|画布|psd|psb)|(?:详情页|长图|主图|首图|白底图|点击图|转化图).{0,24}(?:文档|文件|画布|psd|psb).{0,48}(?:创建|新建|建立|制作|生成)/i;
const SKU_DOCUMENT_CREATE_PATTERN = /(?:创建|新建|建立|制作|生成).{0,48}(?:SKU|sku).{0,24}(?:文档|文件|画布|psd|psb)|(?:SKU|sku).{0,24}(?:文档|文件|画布|psd|psb).{0,48}(?:创建|新建|建立|制作|生成)/i;
const SKU_PRODUCTION_DOCUMENT_HINT_PATTERN = /(?:色卡素材|色卡源|源文档|源文件|卡片源|卡片素材|排版模板|卡片模板|色卡模板|模板设计|组合图|自选备注|备注图|批量|双装|\d{1,2}\s*双)/i;

function isReasonableSkuSize(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 50;
}

function uniqueSorted(values: number[]): number[] {
    return Array.from(new Set(values.filter(isReasonableSkuSize))).sort((a, b) => a - b);
}

export function extractSkuComboSizesFromText(input: string): number[] {
    const text = String(input || '');
    const matched: number[] = [];

    const explicitDuals = text.match(/(\d{1,2})\s*双/g) || [];
    for (const token of explicitDuals) {
        const value = Number(String(token).match(/\d+/)?.[0] || 0);
        if (isReasonableSkuSize(value)) matched.push(value);
    }

    const grouped = text.match(/\d+(?:\s*[-/、，,]\s*\d+)+/g) || [];
    for (const token of grouped) {
        const parts = token.match(/\d+/g) || [];
        for (const part of parts) {
            const value = Number(part);
            if (isReasonableSkuSize(value)) matched.push(value);
        }
    }

    if (/(?:单|一)\s*双(?:装|自选备注|备注|sku|SKU)?/.test(text)) {
        matched.push(1);
    }

    return uniqueSorted(matched);
}

export function hasSkuNoteRequest(input: string): boolean {
    const text = String(input || '');
    return /自选备注|备注图|(?:SKU|sku)\s*备注|备注\s*(?:SKU|sku)|规格备注|(?:单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双(?:装)?)\s*(?:SKU|sku)?\s*备注/.test(text);
}

export function hasSkuNoteDisableIntent(input: string): boolean {
    const text = String(input || '');
    return /不需要自选备注|不要自选备注|无需自选备注|不用自选备注|不生成(?:自选)?备注|仅组合|只要组合|不要备注图/.test(text);
}

function hasSkuComboWorkRequest(input: string): boolean {
    const text = String(input || '');
    if (!text.trim()) return false;

    if (/组合图|颜色组合|配色组合|SKU组合|sku组合|组合|批量配色|批量出图|批量生成/.test(text)) {
        return true;
    }

    if (/(?:排版模板|卡片模板|色卡模板|SKU\s*模板|sku\s*模板|模板).{0,24}(?:规格|双装|组合|自选备注|备注图)|(?:规格|双装|组合|自选备注|备注图).{0,24}(?:排版模板|卡片模板|色卡模板|SKU\s*模板|sku\s*模板|模板)/i.test(text)) {
        return true;
    }

    if (/(?:规格|规格是|规格为|需要|目标).{0,24}\d+(?:\s*[-/、，,]\s*\d+)+\s*双(?:装)?/i.test(text)) {
        return true;
    }

    if (/每(?:个规格|规格|个|款)?(?:需要|生成|做|出)?\s*\d{1,3}\s*(?:个|组|张|款)/.test(text)) {
        return true;
    }

    if (/(?:做|生成|制作|处理|跑|出|创建|新建|建立|整理|准备|导出|出图|完成|交付|产出).{0,12}(?:SKU|sku)(?!\s*(?:自选备注|备注图|备注))/.test(text)) {
        return true;
    }

    if (/(?:SKU|sku).{0,12}(?:批量|组合|配色|出图|每个规格|每规格)/.test(text)) {
        return true;
    }

    return false;
}

function hasGenericSkuBatchIntent(input: string): boolean {
    const text = String(input || '');
    if (!/(?:SKU|sku|批量配色|批量出图|组合图|双装|单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双)/.test(text)) {
        return false;
    }
    return !isSkuNoteOnlyText(text);
}

function hasSkuDomainTerm(input: string): boolean {
    return SKU_DOMAIN_TERM_PATTERN.test(String(input || ''));
}

export function stripSkuDownstreamContextText(input: string): string {
    return String(input || '')
        .replace(SKU_DOWNSTREAM_CONTEXT_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isSkuSourceForNonSkuDocumentTargetText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (!NON_SKU_DOCUMENT_TARGET_PATTERN.test(text)) return false;
    return /(?:SKU|sku).{0,24}(?:素材|色卡素材|源文件|来源|作为|当作)|(?:基于|使用|用|复用|沿用).{0,36}(?:SKU|sku)/i.test(text);
}

export function isPlainSkuDocumentCreateText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (!SKU_DOCUMENT_CREATE_PATTERN.test(text)) return false;
    return !SKU_PRODUCTION_DOCUMENT_HINT_PATTERN.test(text);
}

function hasSkuNoToolDirective(input: string): boolean {
    const text = String(input || '');
    if (
        SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)
        && !/(?:不要|别|无需|不用|禁止|不执行|不调用).{0,18}(?:执行|调用|工具|skill|技能|photoshop|ps|操作|改动|修改|写入)/i.test(text)
    ) {
        return false;
    }
    if (SKU_TOOL_FORBIDDEN_DIRECTIVE_PATTERN.test(text)) return true;
    if (!SKU_CONVERSATION_ONLY_DIRECTIVE_PATTERN.test(text)) return false;
    return !SKU_COMPLETION_SCOPED_REPORTING_PATTERN.test(text);
}

function hasSkuExecutionActionNearDomainTerm(input: string): boolean {
    const text = String(input || '');
    if (!SKU_EXECUTION_ACTION_PATTERN.test(text)) return false;
    return new RegExp(`${SKU_EXECUTION_ACTION_PATTERN.source}.{0,32}${SKU_DOMAIN_TERM_PATTERN.source}`, 'i').test(text)
        || new RegExp(`${SKU_DOMAIN_TERM_PATTERN.source}.{0,32}${SKU_EXECUTION_ACTION_PATTERN.source}`, 'i').test(text);
}

export function isSkuReadOnlyInspectionText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    if (!SKU_READ_ONLY_INSPECTION_PATTERN.test(text)) return false;
    return !SKU_READ_ONLY_EXECUTION_NEGATIVE_PATTERN.test(text);
}

export function isSkuCardSourceOnlyText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)) return false;
    if (!SKU_CARD_SOURCE_ONLY_PATTERN.test(text)) return false;
    return /(?:不生成|不导出|不继续|不要|无需|只做|仅做|本轮只做|单独)(?:[^。！？!?；;\n]{0,24})(?:组合图|成品\s*SKU|自选备注|备注图|批量出图|导出成品|生成\s*\d{1,2}\s*双)/i.test(text)
        || /(?:源文档|源文件|色卡素材|卡片源).{0,24}(?:保存|读回|验收快照|文档信息)/i.test(text);
}

export function isSkuTemplateDesignRequestText(input: string): boolean {
    const text = stripSkuDownstreamContextText(String(input || '').trim());
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(text)) return false;
    if (hasSkuNoToolDirective(text)) return false;
    if (isPlainSkuDocumentCreateText(text)) return false;

    const hasTemplateDesignTarget = SKU_TEMPLATE_DESIGN_PATTERN.test(text);
    const hasExistingSourceAndMissingTemplate =
        SKU_EXISTING_SOURCE_HINT_PATTERN.test(text)
        && SKU_TEMPLATE_MISSING_OR_CREATE_PATTERN.test(text);
    if (
        hasTemplateDesignTarget
        && !hasExistingSourceAndMissingTemplate
        && SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)
        && SKU_TEMPLATE_REFERENCE_ONLY_PATTERN.test(text)
        && !SKU_EXPLICIT_TEMPLATE_AUTHORING_PATTERN.test(text)
    ) {
        return false;
    }

    if (!hasTemplateDesignTarget && !hasExistingSourceAndMissingTemplate) {
        return false;
    }

    return /(?:帮我|请|需要|还需要|要|做|创建|新建|建立|设计|制作|生成|处理|完成|交付|产出)/i.test(text);
}

export function isSkuExecutionRequestText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    const currentTaskText = stripSkuDownstreamContextText(text);
    if (isSkuSourceForNonSkuDocumentTargetText(text)) return false;
    if (isPlainSkuDocumentCreateText(text)) return false;
    if (SKU_CAPABILITY_OR_PROCEDURE_QUESTION_PATTERN.test(currentTaskText)) return false;
    if (hasSkuNoToolDirective(currentTaskText)) return false;
    if (isSkuReadOnlyInspectionText(currentTaskText)) return false;

    const cardSourceOnly = isSkuCardSourceOnlyText(currentTaskText);
    const hasExecutionAction = hasSkuExecutionActionNearDomainTerm(currentTaskText) || cardSourceOnly;
    if (!hasExecutionAction) return false;

    if (
        SKU_PLANNING_OR_KNOWLEDGE_PATTERN.test(currentTaskText)
        && !SKU_IMMEDIATE_EXECUTION_PATTERN.test(text)
        && !SKU_STAGED_EXECUTION_PATTERN.test(text)
        && !cardSourceOnly
    ) {
        return false;
    }

    return true;
}

export function isSkuNoteOnlyText(input: string): boolean {
    const text = String(input || '');
    if (!hasSkuNoteRequest(text)) return false;
    if (hasSkuNoteDisableIntent(text)) return false;
    const hasComboWork = hasSkuComboWorkRequest(text);
    const explicitOnly = /(?:只|仅|单独)(?:做|生成|要)?(?:\s*\d+(?:\s*[-/、，,]\s*\d+)*\s*双?)?(?:的)?(?:(?:SKU|sku)\s*)?(?:自选备注|备注图|备注)|(?:补|补一下|补充|还需要|还要|需要|再补|再做|再生成|对应)(?:.{0,16})?(?:(?:SKU|sku)\s*)?(?:自选备注|备注图|备注)/.test(text)
        && /(?:SKU|sku|自选备注|备注图|规格备注|单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双)/.test(text);
    if (hasComboWork) return false;
    if (explicitOnly) return true;
    return /(?:自选备注|备注图|(?:SKU|sku)\s*备注|规格备注)$/.test(text);
}

export function extractSkuCountPerSizeFromText(input: string): number | undefined {
    const text = String(input || '');
    const patterns = [
        /每(?:个规格|个|规格|款|双)?(?:需要|生成|做|出)?\s*(\d{1,3})\s*(?:个|组|张|款)/,
        /(?:需要|生成|做|出)\s*(\d{1,3})\s*(?:个|组|张|款)/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
            return Math.max(1, Math.floor(value));
        }
    }

    return undefined;
}

export function inferSkuIntentParamsFromText(input: string): SkuIntentParams {
    const text = String(input || '');
    const sourceOnly = isSkuCardSourceOnlyText(text);
    const comboSizes = sourceOnly ? [] : extractSkuComboSizesFromText(text);
    const countPerSize = extractSkuCountPerSizeFromText(text);
    const noteRequested = hasSkuNoteRequest(text);
    const noteDisabled = hasSkuNoteDisableIntent(text);
    const onlyNotes = isSkuNoteOnlyText(text);
    const genericSkuBatch = hasGenericSkuBatchIntent(text);

    return {
        ...(comboSizes.length > 0 ? { comboSizes } : {}),
        ...(typeof countPerSize === 'number' ? { countPerSize } : {}),
        generateNotes: sourceOnly ? false : !noteDisabled && (noteRequested || genericSkuBatch),
        onlyNotes,
        ...(sourceOnly ? { sourceOnly: true } : {})
    };
}
