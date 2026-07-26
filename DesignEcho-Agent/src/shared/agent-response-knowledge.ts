import type { DesignKnowledgeResult } from './design-knowledge-search';
import {
    selectDesignKnowledgeResultsForUse,
    type DesignKnowledgeFreshness,
    type DesignKnowledgeUsageSnapshot
} from './design-knowledge-governance';

export interface AgentResponseSkillFact {
    id: string;
    name: string;
    visibility?: string;
    enabled?: boolean;
}

export interface AgentResponsePreferenceFact {
    id: string;
    category?: string;
    value: string;
    label?: string;
    sourceType?: string;
    status?: string;
    sourceNote?: string;
}

export interface AgentResponseProjectFact {
    projectPath?: string;
    projectImageCount?: number;
    assetIndex?: {
        summary?: {
            totalImages?: number;
        };
    };
    selectedProjectImageName?: string;
    selectedProjectImagePath?: string;
}

export interface AgentResponseKnowledgeBundleInput {
    userText?: string;
    skillFacts?: AgentResponseSkillFact[];
    preferenceItems?: AgentResponsePreferenceFact[];
    knowledgeResults?: DesignKnowledgeResult[];
    projectContext?: AgentResponseProjectFact;
}

export interface AgentResponseKnowledgePreference {
    id: string;
    category: string;
    value: string;
    label: string;
    sourceNote: string;
}

export interface AgentResponseKnowledgeContextItem {
    id: string;
    title: string;
    summary: string;
    sourceType: string;
    sourceLevel: string;
    tags: string[];
    contentFingerprint: string;
    sourceRevision: string;
    freshness: DesignKnowledgeFreshness;
}

export interface AgentResponseDomainGlossaryItem {
    term: string;
    meaning: string;
    boundary: string;
}

export interface AgentResponseKnowledgeBundle {
    version: 'agent-response-knowledge/v0';
    persona: {
        role: string;
        language: 'zh-Hans';
        responseStyle: string[];
    };
    capabilities: {
        enabledUserFacingSkills: string[];
        disabledOrHiddenSkillCount: number;
    };
    preferences: {
        activeExplicitPreferences: AgentResponseKnowledgePreference[];
        excludedPreferenceCount: number;
        boundary: string;
    };
    knowledge: {
        contextItems: AgentResponseKnowledgeContextItem[];
        excludedKnowledgeCount: number;
        usageSnapshot: DesignKnowledgeUsageSnapshot;
        boundary: string;
    };
    project: {
        hasProject: boolean;
        availableProjectImages: number;
        selectedProjectImage?: string;
    };
    domainGlossary: {
        items: AgentResponseDomainGlossaryItem[];
        boundary: string;
    };
    guardrails: {
        noPhotoshopExecution: true;
        noToolSimulation: true;
        noConfidence: true;
        doNotOverrideCurrentUserInstruction: true;
    };
    limitations: string[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const HARD_UNSAFE_KNOWLEDGE_MARKERS = [
    'inferred_from_operations',
    'legacy_local_preference',
    'deprecated',
    'reviewed_rejected',
    'review=rejected',
    'disabled',
    'archived',
    'direct_photoshop_action'
];

const UNREVIEWED_KNOWLEDGE_MARKERS = [
    'needs_review',
    'needs_human_review'
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown[], limit = 12): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function safeTags(value: unknown): string[] {
    return Array.isArray(value) ? uniqueClean(value, 12) : [];
}

function hasPromptContextUse(result: DesignKnowledgeResult): boolean {
    return Array.isArray(result.allowedUses) && result.allowedUses.includes('prompt_context');
}

function knowledgeText(result: DesignKnowledgeResult): string {
    return [
        result.id,
        result.title,
        result.summary,
        ...(Array.isArray(result.sourceNotes) ? result.sourceNotes : []),
        ...safeTags(result.tags),
        ...(Array.isArray(result.allowedUses) ? result.allowedUses : [])
    ].map(cleanString).join(' ').toLowerCase();
}

function isSafeResponseKnowledge(result: DesignKnowledgeResult): boolean {
    if (!result || result.sourceType !== 'local_case' || result.sourceLevel !== 'local_case') return false;
    if (!hasPromptContextUse(result)) return false;
    const text = knowledgeText(result);
    if (HARD_UNSAFE_KNOWLEDGE_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) {
        return false;
    }
    const isExplicitUserFeedback = text.includes('explicit_user_feedback')
        || text.includes('sourceType: explicit'.toLowerCase())
        || text.includes(' explicit ');
    const isApprovedDesignLearningVisualCase = text.includes('design-learning-experience')
        && (text.includes('reviewed_approved') || text.includes('review=approved'))
        && (text.includes('visual_case') || text.includes('visual-case'))
        && text.includes('imported_case');
    if (isApprovedDesignLearningVisualCase) return true;
    if (UNREVIEWED_KNOWLEDGE_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) {
        return false;
    }
    return isExplicitUserFeedback;
}

function isActiveExplicitPreference(item: AgentResponsePreferenceFact): boolean {
    return cleanString(item.sourceType) === 'explicit'
        && cleanString(item.status || 'active') === 'active'
        && Boolean(cleanString(item.value));
}

function preferenceToFact(item: AgentResponsePreferenceFact): AgentResponseKnowledgePreference {
    const value = cleanString(item.value);
    const category = cleanString(item.category) || 'unknown';
    return {
        id: cleanString(item.id) || `${category}:${value}`,
        category,
        value,
        label: cleanString(item.label) || value,
        sourceNote: cleanString(item.sourceNote) || '来自用户明确设置的偏好，只能作为回复和策略候选上下文。'
    };
}

function knowledgeToContextItem(result: DesignKnowledgeResult): AgentResponseKnowledgeContextItem {
    return {
        id: cleanString(result.id),
        title: cleanString(result.title),
        summary: cleanString(result.summary),
        sourceType: cleanString(result.sourceType),
        sourceLevel: cleanString(result.sourceLevel),
        tags: safeTags(result.tags),
        contentFingerprint: cleanString(result.governance?.contentFingerprint),
        sourceRevision: cleanString(result.governance?.sourceRevision),
        freshness: 'current'
    };
}

function enabledUserFacingSkillNames(skillFacts: AgentResponseSkillFact[] | undefined): string[] {
    return uniqueClean((skillFacts || [])
        .filter((skill) => skill.visibility === 'user-facing' && skill.enabled !== false)
        .map((skill) => skill.name || skill.id), 18);
}

function disabledOrHiddenSkillCount(skillFacts: AgentResponseSkillFact[] | undefined): number {
    return (skillFacts || [])
        .filter((skill) => skill.visibility !== 'user-facing' || skill.enabled === false)
        .length;
}

function resolveProjectImageCount(project?: AgentResponseProjectFact): number {
    return Math.max(
        0,
        Number(project?.projectImageCount || 0),
        Number(project?.assetIndex?.summary?.totalImages || 0)
    );
}

function buildDomainGlossary(): AgentResponseDomainGlossaryItem[] {
    return [
        {
            term: 'SKU 自选备注',
            meaning: '在电商袜子 SKU 场景里，“2-3-4 的自选备注”通常指 2双、3双、4双规格对应的自选备注图或备注文件，不是第 2、3、4 个自选维度编号。',
            boundary: '如果用户明确改成尺码、款式或平台字段含义，再按最新上下文解释。'
        },
        {
            term: '不改模板占位符',
            meaning: '表示保留模板现有占位符、版式结构和文本框架，不等同于“不要占位符”或“无占位符自动排版”。',
            boundary: '只有用户明确说不用占位符、不要占位符、不依赖占位符，或模板 preflight 证明没有可靠占位符，才进入无占位符路径。'
        },
        {
            term: '帮我做 SKU',
            meaning: '在电商 SKU 生产语境里，通常表示按可用 SKU 素材、配置和规格生成组合图，并为 2双及以上规格生成对应自选备注；实际执行仍以当前项目配置和用户最新指令为准。',
            boundary: '如果用户只要求查看、解释或不要执行，本轮只回答，不触发 Photoshop 写入。'
        }
    ];
}

export function buildAgentResponseKnowledgeBundle(
    input: AgentResponseKnowledgeBundleInput
): AgentResponseKnowledgeBundle {
    const preferenceItems = Array.isArray(input.preferenceItems) ? input.preferenceItems : [];
    const activeExplicitPreferences = preferenceItems
        .filter(isActiveExplicitPreference)
        .map(preferenceToFact)
        .slice(0, 8);

    const knowledgeSelection = selectDesignKnowledgeResultsForUse(input.knowledgeResults, {
        query: input.userText,
        purpose: 'prompt_context'
    });
    const safeKnowledge = knowledgeSelection.usableResults
        .filter(isSafeResponseKnowledge)
        .sort((a, b) => (Number(b.sourceRank) || 0) - (Number(a.sourceRank) || 0))
        .map(knowledgeToContextItem)
        .slice(0, 6);

    const skillNames = enabledUserFacingSkillNames(input.skillFacts);
    const projectImageCount = resolveProjectImageCount(input.projectContext);
    const selectedProjectImage = cleanString(
        input.projectContext?.selectedProjectImageName || input.projectContext?.selectedProjectImagePath
    );

    return {
        version: 'agent-response-knowledge/v0',
        persona: {
            role: '电商视觉设计师与设计搭档',
            language: 'zh-Hans',
            responseStyle: [
                '先像设计师一样理解用户想要的画面、卖点、交付物和实际使用场景。',
                'Agent/模型负责需求理解、方案规划、设计判断和工具选择，先判断怎么完成，再决定是否需要调用工具。',
                '工具是边界清晰的执行能力，按各自定义处理输入并输出结果，不替代也不限制模型的思考。',
                '用户确认主要用于偏好取舍、风险操作、不可逆写入或授权边界，不能把普通设计判断交回用户自行承担。',
                '用自然、专业、直接的中文回应，少讲系统过程，多讲设计判断和下一步。',
                '涉及设计执行前先确认素材、版式、文案、风格和验收标准，不把未完成的结果说成已完成。'
            ]
        },
        capabilities: {
            enabledUserFacingSkills: skillNames,
            disabledOrHiddenSkillCount: disabledOrHiddenSkillCount(input.skillFacts)
        },
        preferences: {
            activeExplicitPreferences,
            excludedPreferenceCount: Math.max(0, preferenceItems.length - activeExplicitPreferences.length),
            boundary: '只使用 active + explicit 用户偏好作为回复上下文；推断、待确认、禁用、归档或旧版偏好不得当作当前要求。'
        },
        knowledge: {
            contextItems: safeKnowledge,
            excludedKnowledgeCount: Math.max(0, (input.knowledgeResults || []).length - safeKnowledge.length),
            usageSnapshot: knowledgeSelection.snapshot,
            boundary: '只有当前版本且允许 prompt_context 的知识可以进入回复上下文；过期、撤回、被取代、篡改或无版本知识被排除。知识不得转换成 Photoshop 工具参数、质量结论或用户已确认事实。'
        },
        project: {
            hasProject: Boolean(cleanString(input.projectContext?.projectPath)),
            availableProjectImages: projectImageCount,
            ...(selectedProjectImage ? { selectedProjectImage } : {})
        },
        domainGlossary: {
            items: buildDomainGlossary(),
            boundary: '领域术语只帮助模型理解用户语义；不能替代当前项目读取、模板 preflight、用户最新指令或执行后验收。'
        },
        guardrails: {
            noPhotoshopExecution: true,
            noToolSimulation: true,
            noConfidence: true,
            doNotOverrideCurrentUserInstruction: true
        },
        limitations: [
            '回复知识契约不会触发 Photoshop、UXP 或文件写入。',
            '偏好和知识不能替代当前用户指令、项目素材、平台规范、视觉识别或执行后验收。',
            '如果上下文不足，应解释缺口或继续推理，不应编造已经读取到的文档状态。'
        ]
    };
}

function listOrNone(values: string[], fallback = '无'): string {
    return values.length > 0 ? values.join('、') : fallback;
}

export function renderAgentResponseKnowledgePromptSection(bundle: AgentResponseKnowledgeBundle): string {
    const preferenceLines = bundle.preferences.activeExplicitPreferences
        .map((item) => `- ${item.label || item.category}：${item.value}（来源说明：${item.sourceNote}）`)
        .slice(0, 8);
    const knowledgeLines = bundle.knowledge.contextItems
        .map((item) => `- ${item.title}: ${item.summary}`)
        .slice(0, 6);
    const glossaryLines = bundle.domainGlossary.items
        .map((item) => `- ${item.term}：${item.meaning}（${item.boundary}）`)
        .slice(0, 8);
    const projectLine = bundle.project.availableProjectImages > 0
        ? `项目素材：当前项目可参考 ${bundle.project.availableProjectImages} 张图片${bundle.project.selectedProjectImage ? `，当前关注 ${bundle.project.selectedProjectImage}` : ''}。`
        : bundle.project.hasProject
            ? '项目素材：当前项目没有可直接参考的项目图片。'
            : '项目素材：本轮问题不需要引用项目素材上下文。';
    return [
        '## 设计师回复参考',
        `角色：${bundle.persona.role}，使用简体中文。`,
        `表达方式：${bundle.persona.responseStyle.join('；')}`,
        `能力语义参考：${listOrNone(bundle.capabilities.enabledUserFacingSkills, '当前没有可参考的用户可见设计任务')}。这只是理解范围，不要在回复里逐项复述。`,
        projectLine,
        '已确认偏好：',
        preferenceLines.length ? preferenceLines.join('\n') : '- 暂无已确认偏好。',
        '可借鉴经验：',
        knowledgeLines.length ? knowledgeLines.join('\n') : '- 暂无可直接借鉴的本地设计经验。',
        '业务术语理解：',
        glossaryLines.length ? glossaryLines.join('\n') : '- 暂无业务术语补充。',
        '使用边界：这些内容只帮助你理解用户和项目；不要把参考、偏好或知识当成已经执行、已经验收或用户刚刚确认的事实。'
    ].join('\n');
}
