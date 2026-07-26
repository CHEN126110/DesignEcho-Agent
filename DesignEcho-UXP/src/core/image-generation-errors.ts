export interface NormalizedImageGenerationError {
    message: string;
    detail: string;
    stage: string;
    code: string;
}

export function normalizeInpaintingError(errorLike: any): NormalizedImageGenerationError {
    const rawMessage = String(
        errorLike?.error ||
        errorLike?.message ||
        errorLike ||
        'Inpainting request failed'
    ).trim();
    const stage = String(errorLike?.errorStage || errorLike?.stage || '').trim();
    const code = String(errorLike?.errorCode || errorLike?.code || '').trim();
    const detailFromAgent = String(errorLike?.errorDetail || errorLike?.detail || '').trim();

    let message = '局部重绘请求失败';
    let detail = detailFromAgent || rawMessage;

    if (/econnrefused\s+::1:80|127\.0\.0\.1:80/i.test(rawMessage)) {
        message = '本地代理连接失败';
        detail = detailFromAgent || '即梦请求被导向本机代理 (::1:80) 并被拒绝连接，请检查代理设置后重试。';
    } else if (/access key id \/ secret access key 未配置|credentials are not configured/i.test(rawMessage)) {
        message = '未配置即梦AI密钥';
        detail = '请先在设置中填写即梦AI的 Access Key ID 和 Secret Access Key。';
    } else if (/鉴权失败|access key|signature|auth/i.test(rawMessage) && stage === 'provider-auth') {
        message = '即梦AI 鉴权失败';
        detail = detailFromAgent || '请检查 Access Key ID、Secret Access Key 或当前账号权限。';
    } else if (/prompt is required|提示词不能为空/i.test(rawMessage)) {
        message = '请输入重绘描述';
        detail = '当前局部重绘请求缺少提示词，模型不会开始生成。';
    } else if (/image and mask are required|请求参数不完整/i.test(rawMessage)) {
        message = '选区数据获取失败';
        detail = '请重新创建选区后再试。';
    } else if (/任务超时|timeout/i.test(rawMessage)) {
        message = '局部重绘超时';
        detail = detailFromAgent || '即梦AI 长时间没有返回结果，请稍后重试。';
    } else if (/未返回结果图|没有可用图片|result/i.test(rawMessage) && stage === 'provider-result') {
        message = '模型没有返回可用结果';
        detail = detailFromAgent || '这次局部重绘已完成，但服务端没有返回可用图片。';
    } else if (/下载失败|provider-download/i.test(rawMessage)) {
        message = '结果下载失败';
        detail = detailFromAgent || '模型已返回结果，但下载图片失败，请稍后重试。';
    } else if (/提交任务失败/i.test(rawMessage) && stage === 'provider-submit') {
        message = '模型拒绝了当前重绘请求';
        detail = detailFromAgent || rawMessage;
    } else if (/查询任务失败/i.test(rawMessage) && stage === 'provider-query') {
        message = '查询模型任务失败';
        detail = detailFromAgent || rawMessage;
    }

    return {
        message,
        detail,
        stage,
        code
    };
}

export function normalizeImageToImageError(errorLike: any): NormalizedImageGenerationError {
    const rawMessage = String(
        errorLike?.error ||
        errorLike?.message ||
        errorLike ||
        'Image-to-image request failed'
    ).trim();
    const stage = String(errorLike?.errorStage || errorLike?.stage || '').trim();
    const code = String(errorLike?.errorCode || errorLike?.code || '').trim();
    const detailFromAgent = String(errorLike?.errorDetail || errorLike?.detail || '').trim();

    let message = '\u56fe\u751f\u56fe\u8bf7\u6c42\u5931\u8d25';
    let detail = detailFromAgent || rawMessage;

    if (/gpts api key is not configured/i.test(rawMessage)) {
        message = '\u672a\u914d\u7f6e GPTs API Key';
        detail = '\u8bf7\u5148\u5728 Agent \u8bbe\u7f6e\u4e2d\u586b\u5199 GPTs API Key\uff0c\u518d\u4f7f\u7528 Gemini 3 Pro Image Preview \u56fe\u751f\u56fe\u3002';
    } else if (/jimeng.*access key|即梦ai access key id \/ secret access key 未配置/i.test(rawMessage)) {
        message = '\u672a\u914d\u7f6e\u5373\u68a6 AI Access Key';
        detail = '\u8bf7\u5148\u5728 Agent \u8bbe\u7f6e\u4e2d\u586b\u5199\u5373\u68a6 AI \u7684 Access Key ID \u548c Secret Access Key\u3002';
    } else if (/即梦图生图缺少 tos 配置|tos 上传配置不完整/i.test(rawMessage)) {
        message = '\u672a\u914d\u7f6e TOS \u56fe\u5e8a';
        detail = '\u5373\u68a6 4.6 \u56fe\u751f\u56fe\u5b98\u65b9\u53ea\u63a5\u53d7 image_urls\uff0c\u8bf7\u5148\u5728 Agent \u8bbe\u7f6e\u4e2d\u8865\u9f50 TOS Region\u3001Endpoint\u3001Bucket \u4e0e Public Base URL\u3002';
    } else if (/api key is not configured/i.test(rawMessage)) {
        message = '\u672a\u914d\u7f6e Seedream API Key';
        detail = '\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u586b\u5199\u56fe\u751f\u56fe\u5bf9\u5e94\u7684 Seedream API Key\u3002';
    } else if (/prompt is required/i.test(rawMessage)) {
        message = '\u8bf7\u8f93\u5165\u751f\u6210\u63cf\u8ff0';
        detail = '\u5f53\u524d\u8bf7\u6c42\u7f3a\u5c11\u63d0\u793a\u8bcd\uff0c\u6a21\u578b\u4e0d\u4f1a\u5f00\u59cb\u751f\u6210\u3002';
    } else if (/select exactly one layer|single layer|source layer is required/i.test(rawMessage)) {
        message = '\u8bf7\u5148\u9009\u4e2d\u4e00\u4e2a\u8981\u7f16\u8f91\u7684\u56fe\u5c42';
        detail = '\u56fe\u751f\u56fe\u73b0\u5728\u53ea\u4f1a\u9488\u5bf9\u5f53\u524d\u9009\u4e2d\u7684\u5355\u4e2a\u56fe\u5c42\u751f\u6210\uff0c\u4e0d\u518d\u81ea\u52a8\u56de\u9000\u5230\u6574\u5f20\u6587\u6863\u3002';
    } else if (/source image is required/i.test(rawMessage)) {
        message = '\u53c2\u8003\u56fe\u83b7\u53d6\u5931\u8d25';
        detail = '\u5f53\u524d\u9009\u4e2d\u56fe\u5c42\u65e0\u6cd5\u4f5c\u4e3a\u56fe\u751f\u56fe\u8f93\u5165\uff0c\u8bf7\u6362\u4e00\u4e2a\u5355\u56fe\u5c42\u540e\u518d\u8bd5\u3002';
    } else if (
        stage === 'validate-size-preset'
        || /does not support size preset|不支持分辨率档位|不支持所选输出分辨率/i.test(rawMessage)
        || /parameter [`']?size[`']?.*(?:not valid|widthxheight|supported size preset)/i.test(rawMessage)
    ) {
        message = '\u5f53\u524d\u6a21\u578b\u4e0d\u652f\u6301\u6240\u9009\u5206\u8fa8\u7387';
        detail = detailFromAgent || '\u8bf7\u5207\u6362\u5230\u8be5\u6a21\u578b\u652f\u6301\u7684\u6863\u4f4d\u540e\u518d\u8bd5\u3002';
    } else if (/output_format.+not supported by the current model/i.test(rawMessage)) {
        message = '\u5f53\u524d\u6a21\u578b\u6682\u4e0d\u652f\u6301\u8fd9\u4e00\u8f93\u51fa\u53c2\u6570';
        detail = '\u8fd9\u4e2a Seedream \u6a21\u578b\u548c\u5f53\u524d\u8f93\u51fa\u683c\u5f0f\u53c2\u6570\u4e0d\u517c\u5bb9\u3002\u7cfb\u7edf\u5df2\u8c03\u6574\u8bf7\u6c42\u65b9\u5f0f\uff0c\u8bf7\u518d\u91cd\u8bd5\u4e00\u6b21\u3002';
    } else if (/did not return any images|missing image data/i.test(rawMessage)) {
        message = '\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u7528\u56fe\u7247';
        detail = '\u8fd9\u6b21\u8bf7\u6c42\u5df2\u5b8c\u6210\uff0c\u4f46\u8fd4\u56de\u7ed3\u679c\u4e3a\u7a7a\uff0c\u5efa\u8bae\u66f4\u6362\u63d0\u793a\u8bcd\u6216\u6a21\u578b\u540e\u518d\u8bd5\u3002';
    } else if (/at least 14px|received a \\d+x\\d+px image/i.test(rawMessage)) {
        message = '\u5f53\u524d\u56fe\u5c42\u592a\u5c0f\uff0c\u65e0\u6cd5\u505a\u56fe\u751f\u56fe';
        detail = '\u8bf7\u9009\u4e2d\u4e00\u4e2a\u66f4\u5927\u7684\u56fe\u5c42\u4f5c\u4e3a\u53c2\u8003\u56fe\uff0c\u518d\u91cd\u8bd5\u3002';
    } else if (/network timeout while connecting|dns lookup failed|network route is unreachable|connection refused by remote host|connection reset by remote host/i.test(rawMessage)) {
        message = '\u65e0\u6cd5\u8fde\u63a5 GPTs API \u670d\u52a1';
        detail = '\u5f53\u524d\u8bbe\u5907\u5230 api.gptsapi.net \u7684\u7f51\u7edc\u8fde\u901a\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 DNS\u3001\u4ee3\u7406\u3001\u9632\u706b\u5899\u6216\u7f51\u7edc\u73af\u5883\u540e\u518d\u8bd5\u3002';
    } else if (/timeout|timed out|aborted/i.test(rawMessage)) {
        message = '\u56fe\u751f\u56fe\u8bf7\u6c42\u8d85\u65f6';
        detail = '\u6a21\u578b\u5904\u7406\u65f6\u95f4\u8fc7\u957f\uff0c\u8bf7\u964d\u4f4e\u5206\u8fa8\u7387\u6216\u7a0d\u540e\u91cd\u8bd5\u3002';
    } else if (/agent not connected|please connect to agent|connection/i.test(rawMessage)) {
        message = '\u8bf7\u5148\u8fde\u63a5\u5230 Agent';
        detail = '\u5f53\u524d\u684c\u9762\u7aef\u4e0e UXP \u7684\u8fde\u63a5\u672a\u5efa\u7acb\u3002';
    } else if (/tool registry not initialized|tool not initialized/i.test(rawMessage)) {
        message = '\u56fe\u751f\u56fe\u5de5\u5177\u672a\u51c6\u5907\u597d';
        detail = '\u8bf7\u91cd\u65b0\u52a0\u8f7d\u63d2\u4ef6\u540e\u518d\u8bd5\u3002';
    } else if (/request failed/i.test(rawMessage)) {
        message = '\u6a21\u578b\u670d\u52a1\u8fd4\u56de\u4e86\u9519\u8bef';
        detail = detailFromAgent || rawMessage;
    }

    return {
        message,
        detail,
        stage,
        code
    };
}
