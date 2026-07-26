export function normalizeProjectImageAnalysisIntentText(text?: string): string {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

export function isProjectImageAnalysisInventoryOverviewIntent(text?: string): boolean {
    const normalized = normalizeProjectImageAnalysisIntentText(text);
    if (!normalized) return false;

    if (/(款式|特征|卖点|风格|描述|总结|识别|判断|构图|详情页|这些图片是什么|图片是什么)/.test(normalized)) {
        return false;
    }

    return /(都有什么|都有些什么|都有啥|有些什么|有什么|有哪些|包含什么|包括什么|项目内容|项目资源|素材列表|资源列表|目录结构|项目结构|文件夹)/.test(normalized);
}

export function isProjectIdentityConversationIntent(text?: string): boolean {
    const normalized = normalizeProjectImageAnalysisIntentText(text);
    if (!normalized) return false;

    if (/(项目中的图片|项目里的图片|项目图片|图片资源|图片内容|图片是什么|这些图片|这些图|这些照片|这些素材|项目素材|项目原图|原图|素材|资源|都有什么|都有些什么|都有啥|有些什么|有什么|有哪些|包含什么|包括什么|项目内容|项目资源|素材列表|资源列表|目录结构|项目结构|文件夹|款式|特征|卖点|风格|描述|总结|识别|判断|构图|详情页|品类|类目)/.test(normalized)) {
        return false;
    }

    return /(?:当前|这个)(?:是个什么|是个|是|是什么|什么)(?:项目|project)/.test(normalized)
        || /(?:当前|这个)?(?:项目|project)(?:是|是什么|什么项目)$/.test(normalized)
        || /(?:帮我)?(?:看看|看一下)(?:当前|这个)(?:是个什么|是个|是什么|什么)(?:项目|project)/.test(normalized);
}

export function isProjectImageAnalysisDeliveryIntent(text?: string): boolean {
    const normalized = normalizeProjectImageAnalysisIntentText(text);
    if (!normalized) return false;

    const hasProjectImageSource = /(?:当前|这个)?项目.{0,48}(?:图片|素材|原图|照片|资源)|项目(?:图片|素材|原图|照片|资源)|这些(?:图|图片|照片|素材)|(?:使用|用|基于|根据|读取).{0,48}(?:当前|这个)?项目.{0,48}(?:图片|素材|原图|照片|资源)|(?:使用|用|基于|根据|读取).{0,48}(?:图片|素材|原图|照片|资源)/.test(normalized);
    if (!hasProjectImageSource) return false;

    const hasDeliverableTarget = /(主图|首图|详情页|长图|sku|组合图|自选备注|备注图|白底图|点击图|转化图|海报|banner|设计稿|成品图)/i.test(normalized);
    if (!hasDeliverableTarget) return false;

    return /(完成|生成|制作|创建|新建|导出|输出|保存|出图|交付|验收|画布|文档|请把结果|结果导出|做一张|做一个|做一版|设计一张|设计一个|设计一版|做主图|做详情页|做sku|制作sku|生成sku)/i.test(normalized);
}

export function isProjectContextMainImageDeliveryIntent(text?: string): boolean {
    const normalized = normalizeProjectImageAnalysisIntentText(text);
    if (!normalized) return false;

    if (/(只说明|只讨论|不要执行|别执行|不执行工具|先解释|先分析|先看看|能不能|可以吗|是否|怎么|如何|为什么)/.test(normalized)) {
        return false;
    }

    const hasProjectImageSource = /(当前|这个)?项目.{0,16}(图片|素材|原图|照片|资源)|项目(图片|素材|原图|照片|资源)|使用.{0,16}(项目|当前项目).{0,16}(图片|素材|原图|照片)|用.{0,16}(项目|当前项目).{0,16}(图片|素材|原图|照片)|这些(图|图片|照片|素材)/.test(normalized);
    if (!hasProjectImageSource) return false;

    if (!/(主图|首图|淘宝商品首图|电商袜子主图|mainimage)/i.test(normalized)) return false;

    const hasDeliveryAction = /(完成|生成|制作|创建|新建|导出|输出|保存|出图|交付|验收|可验收|请把结果|结果导出|做一张|做一个|做一版|设计一张|设计一个|设计一版)/i.test(normalized);
    const hasOutputBoundary = /(主图目录|["“”]?主图["“”]?目录|导出文件|读回|验收|画布|800x800|800×800|800\*800)/i.test(normalized);
    return hasDeliveryAction && hasOutputBoundary;
}
