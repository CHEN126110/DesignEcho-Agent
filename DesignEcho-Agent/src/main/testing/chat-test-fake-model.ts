import chatUiElectronBridgeTextFixtureData from './fixtures/chat-ui-electron-bridge-text.fixture.json';

type ChatTestMessage = {
    role?: string;
    content?: unknown;
    contentBlocks?: Array<{ type?: string; text?: string }>;
};

export function isChatTestFakeModelEnabled(): boolean {
    return process.env.DESIGNECHO_CHAT_TEST_FAKE_MODEL === '1';
}

type ChatTestFakeModelFixture = 'neutral' | 'chat-ui-electron-bridge';

type ChatTestFakeModelTextContext = {
    userText: string;
    normalized: string;
};

type ChatTestFakeModelTextRule = {
    id: string;
    matches: (context: ChatTestFakeModelTextContext) => boolean;
};

type ChatUiElectronBridgeTextFixture = {
    markerPrefix: string;
    footer: string;
    fallbackResponse: string;
    responses: Array<{
        id: string;
        response: string;
    }>;
};

const CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE = chatUiElectronBridgeTextFixtureData as ChatUiElectronBridgeTextFixture;

const CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE_MATCHERS: ChatTestFakeModelTextRule[] = [
    {
        id: 'response-presentation',
        matches: ({ normalized }) => /输出结构测试|结构化回复测试/.test(normalized)
    },
    {
        id: 'sku-understanding-no-tool',
        matches: ({ normalized }) => /只说明理解|不执行工具|不要执行工具|不调用工具|先别执行/.test(normalized)
            && /sku/i.test(normalized)
    },
    {
        id: 'sku-capability-answer',
        matches: ({ normalized }) => /(会|能|可以).{0,8}(做|处理).{0,8}sku|sku.{0,8}(会做|能做|可以做)/i.test(normalized)
    },
    {
        id: 'model-identity-answer',
        matches: ({ normalized }) => /什么模型|哪个模型|哪种模型|模型/.test(normalized)
    },
    {
        id: 'detail-page-split-explainer',
        matches: ({ normalized }) => /详情页.*分屏|分屏.*详情页/.test(normalized)
    },
    {
        id: 'greeting',
        matches: ({ userText }) => /你好|hello|hi/i.test(userText)
    }
];

function getChatTestFakeModelFixture(): ChatTestFakeModelFixture {
    const fixture = String(process.env.DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE || '').trim();
    return fixture === 'chat-ui-electron-bridge' ? 'chat-ui-electron-bridge' : 'neutral';
}

function buildNeutralChatTestFakeModelText(): string {
    return '测试 fixture 已收到请求；未调用真实模型或 Photoshop。';
}

function markChatUiElectronBridgeFixtureText(text: string): string {
    const markerPrefix = CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE.markerPrefix || '测试样本：';
    const footer = CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE.footer || '未调用真实模型或 Photoshop。';
    return `${markerPrefix}${text}\n\n${footer}`;
}

function getChatUiElectronBridgeFixtureResponse(id: string | undefined): string {
    const matched = CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE.responses.find((entry) => entry.id === id);
    return matched?.response || CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE.fallbackResponse;
}

function buildChatUiElectronBridgeFixtureText(context: ChatTestFakeModelTextContext): string {
    const matchedRule = CHAT_UI_ELECTRON_BRIDGE_TEXT_FIXTURE_MATCHERS.find((rule) => rule.matches(context));
    return markChatUiElectronBridgeFixtureText(getChatUiElectronBridgeFixtureResponse(matchedRule?.id));
}

function extractChatTestTextFromContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => {
                if (!block || typeof block !== 'object') return '';
                const record = block as Record<string, unknown>;
                if (typeof record.text === 'string') return record.text;
                if (typeof record.content === 'string') return record.content;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

function extractLastUserText(messages: unknown[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index] as ChatTestMessage | undefined;
        if (!message || message.role !== 'user') continue;

        const contentText = extractChatTestTextFromContent(message.content);
        if (contentText.trim()) return contentText.trim();

        const blockText = Array.isArray(message.contentBlocks)
            ? message.contentBlocks
                .filter((block) => block?.type === 'text' && typeof block.text === 'string')
                .map((block) => block.text)
                .join('\n')
            : '';
        if (blockText.trim()) return blockText.trim();
    }
    return '';
}

function isChatTestAcceptanceFailurePrompt(text: string): boolean {
    const normalized = text.replace(/\s+/g, '');
    return /测试验收失败|失败报告样本|制造验收失败/.test(normalized);
}

function isChatTestReferenceParsePrompt(messages: unknown[]): boolean {
    const userText = extractLastUserText(messages);
    return /canvasSize|alignmentGroups|elements|layoutType/.test(userText)
        && /参考图|reference|layout/i.test(userText)
        && /JSON|json/.test(userText);
}

function isChatTestVisibleReasoningPrompt(text: string): boolean {
    return text.includes('公开判断')
        && text.includes('不要暴露私有链式思维')
        && text.includes('用户请求：');
}

function extractVisibleReasoningTarget(text: string): string {
    const marker = '用户请求：';
    const index = text.lastIndexOf(marker);
    if (index === -1) return '';
    return text.slice(index + marker.length).trim().split(/\r?\n/)[0].trim();
}

function buildChatTestVisibleReasoningText(text: string): string {
    const target = extractVisibleReasoningTarget(text);
    if (/关闭.*文档.*不保存|文档.*不保存.*关闭/.test(target)) {
        return '我先理解这是关闭当前 Photoshop 文档且不保存的操作，再确认是否需要调用文档管理能力。';
    }
    if (/保存.*文档|文档.*保存|保存.*psd|psd.*保存/i.test(target)) {
        return '我先理解这是保存当前 Photoshop 文档的操作，再确认保存格式和项目位置。';
    }
    if (/图层.*颜色.*浅.*深|浅.*深.*图层/.test(target)) {
        return '我先理解这是按颜色明暗重排图层顺序的请求，再确认当前图层结构是否足够执行。';
    }
    if (/复刻|参考图|同款版式/.test(target)) {
        return '我先把参考图理解成可编辑的版式结构，再判断需要创建哪些 Photoshop 图层。';
    }
    if (/sku/i.test(target)) {
        return '我先理解 SKU 规格和备注目标，再确认需要生成哪些组合与输出文件。';
    }
    return '我先理解用户的设计目标和当前上下文，再决定是否需要调用 Photoshop 能力。';
}

function buildChatTestFexReferenceParseJson(): string {
    const canvas = { width: 460, height: 460 };
    const px = (value: number, axis: 'x' | 'y' | 'w' | 'h') => {
        const denominator = axis === 'x' || axis === 'w' ? canvas.width : canvas.height;
        return Number((value / denominator).toFixed(6));
    };
    const elements = [
        ['title', 'headline', '合格证', 160, 41, 141, 45, 'bold', 40 / 460],
        ['brand', 'supporting-copy', '品牌:FEX', 38, 121, 94, 22, 'regular', 24 / 460],
        ['product-name', 'supporting-copy', '品名:袜子', 302, 121, 100, 22, 'regular', 24 / 460],
        ['style-no', 'supporting-copy', '货号:N-W210520', 37, 159, 187, 22, 'regular', 24 / 460],
        ['grade', 'supporting-copy', '等级:一等品', 300, 159, 123, 22, 'regular', 24 / 460],
        ['color', 'supporting-copy', '颜色:混色', 37, 197, 100, 22, 'regular', 24 / 460],
        ['inspector', 'supporting-copy', '检验员:018', 36, 235, 120, 22, 'regular', 24 / 460],
        ['material', 'supporting-copy', '成分:棉100%', 37, 290, 138, 22, 'regular', 24 / 460],
        ['execute-standard', 'supporting-copy', '执行标准:FZ/T73001-2016', 37, 328, 288, 22, 'regular', 24 / 460],
        ['compliance-standard', 'supporting-copy', '符合标准:GB18401-2010', 36, 366, 268, 22, 'regular', 24 / 460],
        ['safety-category', 'supporting-copy', '安全技术类别:B类可直接接触皮肤', 37, 404, 353, 22, 'regular', 24 / 460]
    ].map(([name, role, content, x, y, width, height, fontWeight, fontSizeRatio], index) => ({
        type: 'text',
        role,
        name,
        content,
        style: {
            textColor: '#111111',
            fontWeight,
            fontSizeRatio,
            effects: []
        },
        position: {
            x: px(Number(x), 'x'),
            y: px(Number(y), 'y')
        },
        size: {
            width: px(Number(width), 'w'),
            height: px(Number(height), 'h')
        },
        relationship: {
            group: index === 0 ? 'title' : index < 7 ? 'top-fields' : 'standards'
        },
        visualWeight: index === 0 ? 'primary' : 'secondary',
        zIndex: index + 1
    }));

    return JSON.stringify({
        layoutType: 'certificate-label',
        designIntent: '复刻白底黑字合格证文本排版，保留标题、左右字段列和底部标准说明。',
        canvasSize: canvas,
        composition: {
            focalPoint: 'title',
            readingOrder: elements.map((element) => element.name),
            density: 'medium',
            symmetry: 'center-title-left-right-fields'
        },
        elements,
        alignmentGroups: [
            { type: 'center-title', elementIndices: [0] },
            { type: 'left-column', elementIndices: [1, 3, 5, 6, 7, 8, 9, 10] },
            { type: 'right-column', elementIndices: [2, 4] }
        ]
    });
}

function buildChatTestNeutralReferenceParseJson(): string {
    const canvas = { width: 600, height: 420 };
    const px = (value: number, axis: 'x' | 'y' | 'w' | 'h') => {
        const denominator = axis === 'x' || axis === 'w' ? canvas.width : canvas.height;
        return Number((value / denominator).toFixed(6));
    };
    const elements = [
        ['title', 'headline', '品质检验卡', 184, 38, 232, 48, 'bold', 40 / 420],
        ['category', 'supporting-copy', '品类:针织袜', 52, 110, 138, 28, 'regular', 25 / 420],
        ['grade', 'supporting-copy', '等级:合格品', 350, 110, 138, 28, 'regular', 25 / 420],
        ['style-no', 'supporting-copy', '货号:Q-2026-0512', 52, 150, 218, 28, 'regular', 25 / 420],
        ['color', 'supporting-copy', '颜色:自然白', 350, 150, 138, 28, 'regular', 25 / 420],
        ['material', 'supporting-copy', '成分:棉80% 锦纶17% 氨纶3%', 52, 206, 360, 28, 'regular', 25 / 420],
        ['standard', 'supporting-copy', '执行标准:FZ/T73001-2016', 52, 248, 320, 28, 'regular', 25 / 420],
        ['safety', 'supporting-copy', '安全类别:B类可直接接触皮肤', 52, 290, 360, 28, 'regular', 25 / 420],
        ['inspector', 'supporting-copy', '检验员:028', 52, 332, 126, 28, 'regular', 25 / 420]
    ].map(([name, role, content, x, y, width, height, fontWeight, fontSizeRatio], index) => ({
        type: 'text',
        role,
        name,
        content,
        style: {
            textColor: '#111111',
            fontWeight,
            fontSizeRatio,
            effects: []
        },
        position: {
            x: px(Number(x), 'x'),
            y: px(Number(y), 'y')
        },
        size: {
            width: px(Number(width), 'w'),
            height: px(Number(height), 'h')
        },
        relationship: {
            group: index === 0 ? 'title' : index < 5 ? 'top-fields' : 'standards'
        },
        visualWeight: index === 0 ? 'primary' : 'secondary',
        zIndex: index + 1
    }));

    return JSON.stringify({
        layoutType: 'neutral-quality-card-text-layout',
        designIntent: '复刻中性品质检验卡的可编辑文本排版，保留标题、左右字段列和底部说明。',
        canvasSize: canvas,
        composition: {
            focalPoint: 'title',
            readingOrder: elements.map((element) => element.name),
            density: 'medium',
            symmetry: 'center-title-left-right-fields'
        },
        elements,
        alignmentGroups: [
            { type: 'center-title', elementIndices: [0] },
            { type: 'left-column', elementIndices: [1, 3, 5, 6, 7, 8] },
            { type: 'right-column', elementIndices: [2, 4] }
        ]
    });
}

function findChatTestToolResult(
    messages: unknown[],
    callId: string
): Record<string, unknown> | undefined {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        const record = message as Record<string, unknown> | undefined;
        if (!record || record.role !== 'tool_result' || !Array.isArray(record.toolResults)) continue;
        const matched = record.toolResults.find((item) => {
            const result = item as Record<string, unknown> | undefined;
            return result?.callId === callId;
        });
        if (matched && typeof matched === 'object') {
            return matched as Record<string, unknown>;
        }
    }
    return undefined;
}

function hasChatTestToolResult(messages: unknown[], callId: string): boolean {
    return Boolean(findChatTestToolResult(messages, callId));
}

function hasChatTestTool(tools: unknown[], toolName: string): boolean {
    return tools.some((tool) => {
        const record = tool as Record<string, unknown> | undefined;
        const providerFunction = record?.function as Record<string, unknown> | undefined;
        return record?.name === toolName || providerFunction?.name === toolName;
    });
}

function getChatTestToolInputSchema(
    tools: unknown[],
    toolName: string
): Record<string, unknown> | undefined {
    const matched = tools.find((tool) => {
        const record = tool as Record<string, unknown> | undefined;
        const providerFunction = record?.function as Record<string, unknown> | undefined;
        return record?.name === toolName || providerFunction?.name === toolName;
    }) as Record<string, unknown> | undefined;
    if (!matched) return undefined;
    const providerFunction = matched.function as Record<string, unknown> | undefined;
    const schema = matched.inputSchema
        || matched.parameters
        || providerFunction?.inputSchema
        || providerFunction?.parameters;
    return schema && typeof schema === 'object'
        ? schema as Record<string, unknown>
        : undefined;
}

function readChatTestSchemaStringEnum(
    tools: unknown[],
    toolName: string,
    path: string[]
): string[] {
    let value: unknown = getChatTestToolInputSchema(tools, toolName);
    for (const key of path) {
        if (!value || typeof value !== 'object') return [];
        value = (value as Record<string, unknown>)[key];
    }
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

function selectChatTestAllowedValues(allowed: string[], preferred: string[]): string[] {
    if (allowed.length === 0) return [...preferred];
    return preferred.filter((value) => allowed.includes(value));
}

function buildChatTestReferenceDesignBrief(tools: unknown[]): Record<string, unknown> {
    const allowedContextRefs = readChatTestSchemaStringEnum(
        tools,
        'declareDesignBrief',
        ['properties', 'contextRefs', 'items', 'enum']
    );
    const contextRefs = selectChatTestAllowedValues(allowedContextRefs, [
        'context:user_goal',
        'context:attached_images',
        'context:skill_manifest'
    ]);
    return {
        taskGoal: '依据用户附带的参考图生成同款可编辑版式，并在写入后读取画布复核。',
        deliverables: ['editable_design_document', 'preview', 'replication_report'],
        targetAudience: '需要快速理解版式信息并继续编辑的目标用户。',
        channel: '可编辑视觉设计',
        outputRequirements: ['结果必须可编辑', '执行后必须读取画面并进入评价'],
        constraints: ['参考方法不得改写交付物身份', '不得把工具成功当作质量通过'],
        inputCoverage: [
            {
                inputKey: 'goal',
                status: 'provided',
                contextRefs: selectChatTestAllowedValues(allowedContextRefs, ['context:user_goal'])
            },
            {
                inputKey: 'reference_image',
                status: 'provided',
                contextRefs: selectChatTestAllowedValues(allowedContextRefs, ['context:attached_images'])
            }
        ],
        contextRefs
    };
}

function buildChatTestReferenceDesignStrategy(tools: unknown[]): Record<string, unknown> {
    const allowedContextRefs = readChatTestSchemaStringEnum(
        tools,
        'declareDesignStrategy',
        ['properties', 'contextRefs', 'items', 'enum']
    );
    return {
        stageGoal: '提取参考图的信息层级与结构关系，形成可编辑的同款版式。',
        objective: {
            primaryGoal: '保持参考图的阅读顺序与版式关系。',
            secondaryGoals: ['保留文本可编辑性', '维持用户要求的交付物身份'],
            targetAudienceSummary: '需要快速识别核心信息并继续编辑的目标用户。'
        },
        messageArchitecture: {
            primaryMessage: '按参考图阅读顺序组织标题和支撑信息。',
            supportingMessages: ['辅助信息服务主层级，不争夺第一视觉焦点。'],
            supportingFacts: ['用户目标和附带参考图已经进入当前任务上下文。'],
            objectionsToResolve: ['参考元素是否覆盖完整', '结果是否保持可编辑']
        },
        copyDirection: {
            toneKeywords: ['清晰', '可信'],
            headlineOptions: ['保持参考标题层级'],
            subtitleOptions: [],
            tagOptions: [],
            prohibitedClaims: ['未经事实支持的效果承诺']
        },
        visualDirection: {
            moodKeywords: ['克制', '清晰'],
            paletteIntent: ['保留参考图的主要色彩关系。'],
            typographyIntent: ['保留标题、说明和辅助信息的层级。'],
            compositionIntent: ['复用参考图结构关系，但不改变用户要求的交付物身份。'],
            imageTreatment: ['只提取可验证结构，不伪造商品或品牌事实。'],
            density: 'medium'
        },
        constraints: ['保留可编辑文本层。'],
        contextRefs: selectChatTestAllowedValues(allowedContextRefs, [
            'context:user_goal',
            'context:attached_images',
            'context:design_brief'
        ]),
        assumptions: [],
        missingInputs: []
    };
}

function buildChatTestReferenceActionPlan(tools: unknown[]): Record<string, unknown> | undefined {
    const toolName = 'declareRuntimeActionPlan';
    const allowedContextRefs = readChatTestSchemaStringEnum(
        tools,
        toolName,
        ['properties', 'contextRefs', 'items', 'enum']
    );
    const capabilityRefs = readChatTestSchemaStringEnum(
        tools,
        toolName,
        ['properties', 'steps', 'items', 'properties', 'capabilityRefs', 'items', 'enum']
    );
    const skillRef = capabilityRefs.find((value) => value.includes('layout-replication'))
        || capabilityRefs.find((value) => value.startsWith('skill.'));
    const readRef = capabilityRefs.find((value) => value.includes('getVisualSnapshot'))
        || capabilityRefs.find((value) => value.includes('getDocumentSummary'));
    if (!skillRef || !readRef) return undefined;
    const contextRefs = selectChatTestAllowedValues(allowedContextRefs, [
        'context:user_goal',
        'context:design_strategy'
    ]);
    const stepContextRefs = contextRefs.includes('context:design_strategy')
        ? ['context:design_strategy']
        : contextRefs.slice(0, 1);
    return {
        planGoal: '调用参考复刻 Skill 生成可编辑版式，并读取写入后的画布完成复核。',
        strategyRef: 'current:r3_design_strategy',
        contextRefs,
        steps: [
            {
                stepId: 'execute-reference-layout',
                kind: 'mutate',
                goal: '调用当前 Manifest 对应的参考复刻 Skill 完成可编辑版式。',
                dependsOn: [],
                capabilityRefs: [skillRef],
                inputContextRefs: stepContextRefs,
                expectedOutcomes: ['document_change'],
                completionCriteria: ['Skill 返回结构化写入结果。'],
                failurePolicy: 'retry_after_observation'
            },
            {
                stepId: 'readback-reference-layout',
                kind: 'verify',
                goal: '读取复刻后的画布结果。',
                dependsOn: ['execute-reference-layout'],
                capabilityRefs: [readRef],
                inputContextRefs: stepContextRefs,
                expectedOutcomes: ['readback'],
                completionCriteria: ['写后画布读回已经记录。'],
                failurePolicy: 'enter_reflexion'
            }
        ],
        missingInputs: []
    };
}

function didChatTestToolResultSucceed(toolResult: Record<string, unknown> | undefined): boolean {
    if (!toolResult || toolResult.success === false) return false;
    return getChatTestToolOutput(toolResult)?.success !== false;
}

function buildChatTestToolCallResponse(
    content: string,
    id: string,
    name: string,
    args: Record<string, unknown>
) {
    return {
        content,
        toolCalls: [{ id, name, arguments: args }],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'tool_use'
    };
}

function getChatTestToolOutput(
    toolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    const output = toolResult?.output;
    return output && typeof output === 'object'
        ? output as Record<string, unknown>
        : undefined;
}

function readChatTestToolOutputMessage(
    toolResult: Record<string, unknown> | undefined
): string {
    const output = getChatTestToolOutput(toolResult);
    return typeof output?.message === 'string' ? output.message.trim() : '';
}

function hasChatTestLayoutApplyResult(
    toolResult: Record<string, unknown> | undefined
): boolean {
    const output = getChatTestToolOutput(toolResult);
    const data = output?.data;
    if (!data || typeof data !== 'object') return false;
    const dataRecord = data as Record<string, unknown>;
    return Boolean(dataRecord.applyResult || dataRecord.completionContract);
}

function getChatTestLayoutOutputIntent(
    toolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    const data = getChatTestToolOutput(toolResult)?.data;
    if (!data || typeof data !== 'object') return undefined;
    const dataRecord = data as Record<string, unknown>;
    const applyResult = dataRecord.applyResult as Record<string, unknown> | undefined;
    const outputIntent = dataRecord.outputIntent || applyResult?.outputIntent;
    return outputIntent && typeof outputIntent === 'object'
        ? outputIntent as Record<string, unknown>
        : undefined;
}

function getChatTestLayoutApplyResult(
    toolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    const data = getChatTestToolOutput(toolResult)?.data;
    if (!data || typeof data !== 'object') return undefined;
    const applyResult = (data as Record<string, unknown>).applyResult;
    return applyResult && typeof applyResult === 'object'
        ? applyResult as Record<string, unknown>
        : undefined;
}

function isChatTestPosterFromDetailReferenceRequest(messages: unknown[]): boolean {
    const userIntent = getChatTestReferenceUserIntent(messages);
    return /详情页/.test(userIntent)
        && /(?:做成|改成|复刻成|转换成|转成|设计|制作|生成|创作|产出|输出|交付|做|画)\s*(?:一张|一个|一版|一幅|个|张|版)?\s*海报/.test(userIntent);
}

function buildChatTestVerifiedReferenceMessage(layoutMessage: string): string {
    const coverage = layoutMessage.match(/元素覆盖:\s*(\d+\s*\/\s*\d+)/)?.[1]?.replace(/\s+/g, '');
    const neutralReview = process.env.DESIGNECHO_CHAT_TEST_REFERENCE_CASE === 'neutral-text-layout';
    const lines = [
        neutralReview ? '参考图复刻需复核' : '参考图复刻基础验收通过',
        neutralReview
            ? '结论: 已生成可编辑结果并完成画布读回；当前通过结构检查，但仍不能判定为高保真复刻。'
            : '结论: 已生成可编辑结果，并完成当前画布读回检查。',
        '检查结果:',
        coverage ? `- 元素覆盖: ${coverage}` : '- 元素覆盖: 已完成结构覆盖检查',
        '- 视觉检查: 已采集并完成画布读回，截图 1 张',
        '- 交付: 可编辑文本层和版式结构'
    ];
    if (neutralReview) {
        lines.push('说明: 当前结果保留人工审美复核边界，不能判定为高保真复刻。');
    }
    return lines.join('\n');
}

function buildChatTestReferenceFinalMessage(
    messages: unknown[],
    layoutResult: Record<string, unknown>,
    layoutMessage: string
): string {
    const verifiedMessage = buildChatTestVerifiedReferenceMessage(layoutMessage);
    if (!isChatTestPosterFromDetailReferenceRequest(messages)) return verifiedMessage;
    const outputIntent = getChatTestLayoutOutputIntent(layoutResult);
    const applyResult = getChatTestLayoutApplyResult(layoutResult);
    const artifactKind = String(outputIntent?.artifactKind || '');
    const topology = String(outputIntent?.topology || '');
    const rootGroupName = String(applyResult?.rootGroupName || '');
    const surfaceCount = Number(applyResult?.surfaceCount);
    if (artifactKind !== 'poster'
        || topology !== 'single_canvas'
        || surfaceCount !== 1
        || !rootGroupName.startsWith('海报复刻骨架')
        || /详情页/.test(rootGroupName)) {
        return [
            '交付物身份校验未通过：目标应为海报单画布，且只能生成一个海报根图层组。',
            '',
            verifiedMessage
        ].join('\n');
    }
    return [
        `交付结构: 海报（单画布）；根图层组: ${rootGroupName}`,
        '',
        verifiedMessage
    ].join('\n');
}

function getChatTestReferenceUserIntent(messages: unknown[]): string {
    for (const message of messages) {
        const record = message as ChatTestMessage | undefined;
        if (!record || record.role !== 'user') continue;
        const text = extractChatTestTextFromContent(record.content)
            || (Array.isArray(record.contentBlocks)
                ? record.contentBlocks
                    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
                    .map((block) => block.text)
                    .join('\n')
                : '');
        if (/参考|复刻|照着|同款/.test(text)) return text.trim();
    }
    return extractLastUserText(messages);
}

function isChatTestReferenceToolLoopCase(): boolean {
    const value = String(process.env.DESIGNECHO_CHAT_TEST_REFERENCE_CASE || '').trim();
    return value === 'fex-text-layout' || value === 'neutral-text-layout';
}

function isChatTestReferenceToolLoopRequest(messages: unknown[]): boolean {
    return /参考|复刻|照着|同款/.test(getChatTestReferenceUserIntent(messages));
}

export function buildChatTestFakeModelText(modelId: string, messages: unknown[]): string {
    if (isChatTestReferenceParsePrompt(messages)) {
        if (process.env.DESIGNECHO_CHAT_TEST_REFERENCE_CASE === 'neutral-text-layout') {
            return buildChatTestNeutralReferenceParseJson();
        }
        return buildChatTestFexReferenceParseJson();
    }

    const userText = extractLastUserText(messages);
    const normalized = userText.replace(/\s+/g, '');

    if (isChatTestVisibleReasoningPrompt(userText)) {
        return buildChatTestVisibleReasoningText(userText);
    }

    if (isChatTestAcceptanceFailurePrompt(userText)) {
        return JSON.stringify({
            route: 'autonomous_agent',
            skillId: null,
            mode: 'execute',
            skillParams: {},
            confidence: 0.86,
            intentSummary: '执行受控验收失败样本，用于验证用户页面不会把失败伪装成完成。'
        });
    }

    if (getChatTestFakeModelFixture() !== 'chat-ui-electron-bridge') {
        return buildNeutralChatTestFakeModelText();
    }

    return buildChatUiElectronBridgeFixtureText({ userText, normalized });
}

export function buildChatTestFakeModelWithTools(modelId: string, messages: unknown[], tools: unknown[]) {
    const userText = extractLastUserText(messages);
    const acceptanceFailureCallId = 'chat-test-acceptance-failed-1';
    const referenceLayoutCallId = 'chat-test-reference-layout-1';
    const referenceSnapshotCallId = 'chat-test-reference-snapshot-1';
    const referenceBriefCallId = 'chat-test-reference-brief-1';
    const referenceStrategyCallId = 'chat-test-reference-strategy-1';
    const referenceActionPlanCallId = 'chat-test-reference-action-plan-1';

    if (isChatTestAcceptanceFailurePrompt(userText)) {
        if (tools.length === 0 || hasChatTestToolResult(messages, acceptanceFailureCallId)) {
            return {
                content: '已完成并验证。',
                toolCalls: [],
                usage: {
                    inputTokens: 0,
                    outputTokens: 0
                },
                stopReason: 'end_turn'
            };
        }

        return {
            content: '',
            toolCalls: [
                {
                    id: acceptanceFailureCallId,
                    name: 'getDocumentInfo',
                    arguments: {
                        __chatTestAcceptanceFailed: true
                    }
                }
            ],
            usage: {
                inputTokens: 0,
                outputTokens: 0
            },
            stopReason: 'tool_use'
        };
    }

    if (isChatTestReferenceToolLoopCase() && isChatTestReferenceToolLoopRequest(messages)) {
        const briefResult = findChatTestToolResult(messages, referenceBriefCallId);
        const strategyResult = findChatTestToolResult(messages, referenceStrategyCallId);
        const actionPlanResult = findChatTestToolResult(messages, referenceActionPlanCallId);
        const layoutResult = findChatTestToolResult(messages, referenceLayoutCallId);
        const snapshotResult = findChatTestToolResult(messages, referenceSnapshotCallId);

        if (!briefResult && hasChatTestTool(tools, 'declareDesignBrief')) {
            return buildChatTestToolCallResponse(
                '我先把用户目标、参考图和可编辑交付要求整理成设计简报。',
                referenceBriefCallId,
                'declareDesignBrief',
                buildChatTestReferenceDesignBrief(tools)
            );
        }
        if (briefResult && !didChatTestToolResultSucceed(briefResult)) {
            return {
                content: '设计简报未通过校验，本轮不能越过输入条件执行版式写入。',
                toolCalls: [],
                usage: { inputTokens: 0, outputTokens: 0 },
                stopReason: 'end_turn'
            };
        }

        if (!strategyResult && hasChatTestTool(tools, 'declareDesignStrategy')) {
            return buildChatTestToolCallResponse(
                '参考图已经完成视觉观察，我会先确定信息层级、版式关系和可编辑边界。',
                referenceStrategyCallId,
                'declareDesignStrategy',
                buildChatTestReferenceDesignStrategy(tools)
            );
        }
        if (strategyResult && !didChatTestToolResultSucceed(strategyResult)) {
            return {
                content: '设计策略未通过校验，本轮不会把未确认的方向直接写入 Photoshop。',
                toolCalls: [],
                usage: { inputTokens: 0, outputTokens: 0 },
                stopReason: 'end_turn'
            };
        }

        if (!actionPlanResult && hasChatTestTool(tools, 'declareRuntimeActionPlan')) {
            const actionPlan = buildChatTestReferenceActionPlan(tools);
            if (!actionPlan) {
                return {
                    content: '当前运行时没有同时提供参考复刻与写后读回能力，暂不能形成可验证的执行计划。',
                    toolCalls: [],
                    usage: { inputTokens: 0, outputTokens: 0 },
                    stopReason: 'end_turn'
                };
            }
            return buildChatTestToolCallResponse(
                '策略已经明确，我会把版式写入和写后读回绑定到同一份执行计划。',
                referenceActionPlanCallId,
                'declareRuntimeActionPlan',
                actionPlan
            );
        }
        if (actionPlanResult && !didChatTestToolResultSucceed(actionPlanResult)) {
            return {
                content: '执行计划未通过 Capability 校验，本轮不会绕过计划直接修改画布。',
                toolCalls: [],
                usage: { inputTokens: 0, outputTokens: 0 },
                stopReason: 'end_turn'
            };
        }

        if (!layoutResult) {
            if (hasChatTestTool(tools, 'layout-replication')) {
                return buildChatTestToolCallResponse(
                    '我会按参考图提取版式结构并生成可编辑骨架，再读取画布复核结果。',
                    referenceLayoutCallId,
                    'layout-replication',
                    {
                        outputMode: 'apply',
                        autoCreateDocument: true,
                        preserveReferenceCanvasSize: true,
                        userIntent: getChatTestReferenceUserIntent(messages)
                    }
                );
            }
        }

        const layoutMessage = readChatTestToolOutputMessage(layoutResult)
            || '参考版式已处理，当前结果仍需画布复核。';
        if (!hasChatTestLayoutApplyResult(layoutResult)) {
            return {
                content: `${layoutMessage}\n\n没有形成可复核的版式结果，本轮不能宣称完成。`,
                toolCalls: [],
                usage: {
                    inputTokens: 0,
                    outputTokens: 0
                },
                stopReason: 'end_turn'
            };
        }

        const snapshotToolName = [
            'getCanvasSnapshot',
            'getAnnotatedSnapshot',
            'getAcceptanceSnapshot',
            'getDocumentSnapshot'
        ].find((name) => hasChatTestTool(tools, name));
        if (!snapshotResult && snapshotToolName) {
            return {
                content: '可编辑版式骨架已经生成，我现在读取当前画布完成视觉复核。',
                toolCalls: [
                    {
                        id: referenceSnapshotCallId,
                        name: snapshotToolName,
                        arguments: {
                            maxSize: 1600
                        }
                    }
                ],
                usage: {
                    inputTokens: 0,
                    outputTokens: 0
                },
                stopReason: 'tool_use'
            };
        }

        const snapshotOutput = getChatTestToolOutput(snapshotResult);
        const snapshotSucceeded = Boolean(
            snapshotResult
            && snapshotOutput
            && snapshotResult.success !== false
            && snapshotOutput.success !== false
        );
        const verifiedLayoutMessage = layoutResult
            ? buildChatTestReferenceFinalMessage(messages, layoutResult, layoutMessage)
            : layoutMessage;
        return {
            content: snapshotSucceeded
                ? verifiedLayoutMessage
                : `${layoutMessage}\n\n画布快照未完成，最终画面仍需复核。`,
            toolCalls: [],
            usage: {
                inputTokens: 0,
                outputTokens: 0
            },
            stopReason: 'end_turn'
        };
    }

    return {
        content: buildChatTestFakeModelText(modelId, messages),
        toolCalls: [],
        usage: {
            inputTokens: 0,
            outputTokens: 0
        },
        stopReason: 'end_turn'
    };
}
