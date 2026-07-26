/**
 * 动态模型用途分类（Capability Governance）。
 *
 * Provider 的“列模型”接口通常混合返回对话、图片生成、Embedding、重排、音视频等模型。
 * 模型存在不等于能通过 chat/completions 工作，更不等于能作为 Agent 主模型或视觉理解模型。
 * 本模块集中解释供应商元数据；UI、运行时和动态注册表不得各自维护一套散乱黑名单。
 */

export type ModelUsageKind =
    | 'conversation'
    | 'image-generation'
    | 'embedding'
    | 'reranking'
    | 'audio-processing'
    | 'video-generation'
    | 'moderation';

export type ModelUsageConfidence = 'declared' | 'metadata' | 'inferred' | 'assumed';

export interface ModelUsageClassificationInput {
    apiModelId: string;
    /** Provider 明确给出的用途字段，例如 model_type / task / type。 */
    declaredKind?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    capabilityNames?: string[];
    supportedMethods?: string[];
}

export interface ModelUsageClassification {
    kind: ModelUsageKind;
    confidence: ModelUsageConfidence;
    reason: string;
}

function normalizeTokens(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => value.length > 0);
}

function tokenText(values: string[]): string {
    return values.join(' ');
}

function normalizeDeclaredKind(value: string | undefined): ModelUsageKind | undefined {
    const kind = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!kind || kind === 'model') return undefined;
    if (/chat|conversation|text-generation|completion|language-model|llm/.test(kind)) return 'conversation';
    if (kind === 'image' || /image-generation|text-to-image|image-to-image|image-edit|image-model/.test(kind)) return 'image-generation';
    if (/embedding|feature-extraction/.test(kind)) return 'embedding';
    if (/rerank|ranking/.test(kind)) return 'reranking';
    if (kind === 'audio' || /audio|speech|transcri|tts/.test(kind)) return 'audio-processing';
    if (kind === 'video' || /video-generation|text-to-video|video-model/.test(kind)) return 'video-generation';
    if (/moderation|safety|guard/.test(kind)) return 'moderation';
    return undefined;
}

function classifyFromMetadata(input: ModelUsageClassificationInput): ModelUsageClassification | undefined {
    const declared = normalizeDeclaredKind(input.declaredKind);
    if (declared) {
        return { kind: declared, confidence: 'declared', reason: `provider declared ${input.declaredKind}` };
    }

    const outputs = normalizeTokens(input.outputModalities);
    const methods = normalizeTokens(input.supportedMethods);
    const capabilities = normalizeTokens(input.capabilityNames);
    const combined = tokenText([...methods, ...capabilities]);
    const outputsText = tokenText(outputs);
    const canReturnText = outputs.length === 0 || outputs.some((value) => /text|json/.test(value));

    if (/embed|feature-extraction/.test(combined) && !/generatecontent|chat|completion/.test(combined)) {
        return { kind: 'embedding', confidence: 'metadata', reason: 'provider exposes embedding methods' };
    }
    if (/rerank|ranking/.test(combined)) {
        return { kind: 'reranking', confidence: 'metadata', reason: 'provider exposes reranking methods' };
    }
    if (/moderation|content-safety|safety-classif/.test(combined)) {
        return { kind: 'moderation', confidence: 'metadata', reason: 'provider exposes moderation capabilities' };
    }
    if (/image-generation|text-to-image|image-to-image/.test(combined)
        || (/image/.test(outputsText) && !canReturnText)) {
        return { kind: 'image-generation', confidence: 'metadata', reason: 'provider exposes image-generation metadata' };
    }
    if (/video-generation|text-to-video/.test(combined)
        || (/video/.test(outputsText) && !canReturnText)) {
        return { kind: 'video-generation', confidence: 'metadata', reason: 'provider exposes video-generation metadata' };
    }
    if (/text-to-speech|speech-to-text|transcri|tts/.test(combined)
        || (/audio/.test(outputsText) && !canReturnText)) {
        return { kind: 'audio-processing', confidence: 'metadata', reason: 'provider exposes audio-processing metadata' };
    }
    if (/generatecontent|streamgeneratecontent|chat|completion|text-generation/.test(combined) || outputs.some((value) => /text|json/.test(value))) {
        return { kind: 'conversation', confidence: 'metadata', reason: 'provider exposes conversational text output' };
    }
    return undefined;
}

function classifyFromModelId(apiModelId: string): ModelUsageClassification | undefined {
    const id = String(apiModelId || '').trim().toLowerCase();
    if (!id) return undefined;

    if (/(^|[\/_:.-])(rerank|reranker|ranking)([\/_:.-]|$)/.test(id)) {
        return { kind: 'reranking', confidence: 'inferred', reason: 'model family indicates reranking' };
    }
    if (/(^|[\/_:.-])((text-)?embed(ding)?|bge-(m3|small|base|large)|e5-(small|base|large))([\/_:.-]|$)/.test(id)) {
        return { kind: 'embedding', confidence: 'inferred', reason: 'model family indicates embedding' };
    }
    if (/(^|[\/_:.-])(dall-e|gpt-image|imagen(?:-[0-9]|$)|imagegen|seedream|flux(?:[.-][0-9]|$)|stable-diffusion|stable-image|sdxl|recraft|ideogram|kolors|hidream|qwen-image|z-image|nano-banana)([\/_:.-]|$)/.test(id)
        || /gemini[^/]*-image-(preview|generation|edit)/.test(id)) {
        return { kind: 'image-generation', confidence: 'inferred', reason: 'model family indicates image generation' };
    }
    if (/(^|[\/_:.-])(veo|sora|kling|hailuo)([\/_:.-]|$)|text-to-video|video-generation/.test(id)) {
        return { kind: 'video-generation', confidence: 'inferred', reason: 'model family indicates video generation' };
    }
    if (/(^|[\/_:.-])(whisper|tts)([\/_:.-]|$)|speech-to-text|text-to-speech|transcri/.test(id)) {
        return { kind: 'audio-processing', confidence: 'inferred', reason: 'model family indicates audio processing' };
    }
    if (/(^|[\/_:.-])(moderation|guard)([\/_:.-]|$)/.test(id)) {
        return { kind: 'moderation', confidence: 'inferred', reason: 'model family indicates moderation' };
    }
    return undefined;
}

/**
 * 分类优先级：Provider 明确声明 > 模态/方法元数据 > 保守的非对话模型族提示 > 对话假设。
 * 最后一层保留新对话模型的可用性，但会以 assumed 标记，UI 可明确提示能力尚未由接口确认。
 */
export function classifyModelUsage(input: ModelUsageClassificationInput): ModelUsageClassification {
    return classifyFromMetadata(input)
        || classifyFromModelId(input.apiModelId)
        || {
            kind: 'conversation',
            confidence: 'assumed',
            reason: 'provider did not expose enough metadata; conversation capability is provisional'
        };
}

export function isConversationUsageKind(kind: ModelUsageKind | undefined): boolean {
    return kind === undefined || kind === 'conversation';
}
