export function getImageToImageStageLabel(stage?: string): string {
    switch (String(stage || '').trim()) {
        case 'validate-source-layer':
            return '\u9009\u62e9\u56fe\u751f\u56fe\u76ee\u6807';
        case 'capture-source-layer':
            return '\u5bfc\u51fa\u5f53\u524d\u56fe\u5c42';
        case 'validate-prompt':
            return '\u6821\u9a8c\u63d0\u793a\u8bcd';
        case 'validate-source-image':
            return '\u6821\u9a8c\u53c2\u8003\u56fe';
        case 'validate-size-preset':
            return '\u6821\u9a8c\u5206\u8fa8\u7387';
        case 'provider-auth':
            return '\u6821\u9a8c API \u914d\u7f6e';
        case 'provider-validate':
            return '\u51c6\u5907\u8bf7\u6c42';
        case 'provider-upload':
            return '\u4e0a\u4f20\u8f93\u5165\u56fe';
        case 'provider-submit':
            return '\u63d0\u4ea4\u5230\u6a21\u578b';
        case 'provider-request':
            return '\u8bf7\u6c42\u6a21\u578b\u670d\u52a1';
        case 'provider-waiting':
            return '\u7b49\u5f85\u6a21\u578b\u8fd4\u56de';
        case 'provider-download':
            return '\u4e0b\u8f7d\u7ed3\u679c';
        case 'provider-ready':
            return '\u89e3\u6790\u7ed3\u679c';
        case 'provider-result':
            return '\u6821\u9a8c\u7ed3\u679c';
        case 'provider-timeout':
            return '\u7b49\u5f85\u6a21\u578b\u8d85\u65f6';
        case 'prepare-result-file':
            return '\u5199\u5165\u7ed3\u679c\u6587\u4ef6';
        case 'apply-result':
            return '\u5e94\u7528\u5230 Photoshop';
        case 'done':
            return '\u5b8c\u6210';
        default:
            return '';
    }
}

export function getInpaintingStageLabel(stage?: string): string {
    switch (String(stage || '').trim()) {
        case 'validate':
            return '校验请求';
        case 'analyze-selection':
            return '分析选区';
        case 'crop-region':
            return '准备局部区域';
        case 'submit-model':
        case 'provider-submit':
            return '提交到模型';
        case 'provider-auth':
            return '校验 API 配置';
        case 'provider-queued':
            return '等待模型排队';
        case 'provider-generating':
            return '等待模型生成';
        case 'provider-query':
            return '查询任务状态';
        case 'provider-ready':
            return '读取结果';
        case 'provider-download':
            return '下载结果';
        case 'provider-result':
            return '校验结果';
        case 'provider-timeout':
            return '等待模型超时';
        case 'composite':
            return '合成重绘结果';
        case 'encode-result':
            return '编码最终图片';
        case 'transfer-result':
            return '传输结果';
        case 'apply-result':
            return '应用到 Photoshop';
        case 'done':
            return '完成';
        default:
            return '';
    }
}
