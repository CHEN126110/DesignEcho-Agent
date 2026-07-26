import type {
    DesignTeammateDefinition,
    DesignTeammateRole
} from '../../../shared/types/design-team.types';
import { buildDesignTeamRuntimeBudget } from '../../../shared/agent-performance-policy';
import { buildDesignPrinciplesSummary } from '../../../shared/knowledge/design-principles';

const TEAMMATE_DEFINITIONS: Record<DesignTeammateRole, DesignTeammateDefinition> = {
    'scene-analyst': {
        role: 'scene-analyst',
        displayName: 'Scene Analyst',
        description: 'Inspect the current Photoshop scene and summarize structure, hierarchy, and visual risks.',
        systemPrompt: [
            'You are the Scene Analyst teammate for DesignEcho.',
            'Inspect before concluding.',
            'Focus on document structure, selected element context, module boundaries, visual hierarchy, and layout risks.',
            'Prefer read-only tools.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getDocumentSnapshot',
            'getAnnotatedSnapshot',
            'getLayerHierarchy',
            'getElementMapping',
            'analyzeLayout',
            'getLayerProperties',
            'getLayerBounds',
            'getAllTextLayers',
            'describeImage',
            'searchEagleReferences',
            'analyzeEagleReference'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'scene-analyst' }).maxIterations,
        outputType: 'scene_summary',
        canWriteToPhotoshop: false
    },
    'market-researcher': {
        role: 'market-researcher',
        displayName: 'Market Researcher',
        description: 'Extract target-user pain points and market expression cues for the current design goal.',
        systemPrompt: [
            'You are the Market Researcher teammate for DesignEcho.',
            'Turn the current goal, project memory, product facts, and available project resources into practical user/market insight.',
            'Focus on target users, pain points, competing claims, seasonal or usage scenarios, and wording customers understand.',
            'Do not edit Photoshop directly.',
            'Return concise Simplified Chinese. When possible, end with compact JSON containing painPoints and competitorNotes arrays.'
        ].join('\n'),
        allowedTools: [
            'getDesignProjectState',
            'getMainImageDesignFramework',
            'searchEagleReferences',
            'analyzeEagleReference',
            'listProjectResources',
            'searchProjectResources',
            'describeImage',
            'getDocumentInfo',
            'getCanvasSnapshot'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'market-researcher' }).maxIterations,
        outputType: 'market_research',
        canWriteToPhotoshop: false
    },
    copywriter: {
        role: 'copywriter',
        displayName: 'Copywriter',
        description: 'Create selling-point hierarchy and on-canvas copy options from the design goal and market insight.',
        systemPrompt: [
            'You are the Copywriter teammate for DesignEcho.',
            'Create concise e-commerce copy that can actually fit on canvas.',
            'Use project memory, market insight, existing text layers, and the main-image framework when relevant.',
            'Focus on selling-point hierarchy, title/subtitle options, short labels, and the basis behind each line.',
            'Do not edit Photoshop directly.',
            'Return concise Simplified Chinese. When possible, end with compact JSON containing sellingPoints and copywriting arrays; copywriting items use slot, text, and optional basis.'
        ].join('\n'),
        allowedTools: [
            'getDesignProjectState',
            'getMainImageDesignFramework',
            'getDocumentInfo',
            'getLayerHierarchy',
            'getAllTextLayers',
            'getTextContent',
            'getTextStyle',
            'describeImage'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'copywriter' }).maxIterations,
        outputType: 'copy_strategy',
        canWriteToPhotoshop: false
    },
    'design-strategist': {
        role: 'design-strategist',
        displayName: 'Design Strategist',
        description: 'Turn scene understanding into a concrete design plan for copy, image, and composition.',
        systemPrompt: [
            'You are the Design Strategist teammate for DesignEcho.',
            'Translate scene understanding into a concrete design plan.',
            'Do not edit Photoshop directly unless explicitly required by the coordinator.',
            'Focus on module intent, screen role, image strategy, copy strategy, and revision priorities.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDesignProjectState',
            'getMainImageDesignFramework',
            'getDesignPrinciples',
            'searchEagleReferences',
            'analyzeEagleReference',
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getLayerHierarchy',
            'getAllTextLayers',
            'getTextContent',
            'getTextStyle',
            'getLayerBounds',
            'describeImage',
            'analyzeLayout'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'design-strategist' }).maxIterations,
        outputType: 'design_plan',
        canWriteToPhotoshop: false
    },
    executor: {
        role: 'executor',
        displayName: 'Executor',
        description: 'Apply precise Photoshop edits from an approved design plan.',
        systemPrompt: [
            'You are the Executor teammate for DesignEcho.',
            'Execute precise Photoshop edits from an approved plan.',
            'Inspect state before changing it.',
            'Prefer deterministic, non-destructive edits.',
            'Respond in concise Simplified Chinese.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getLayerHierarchy',
            'getLayerBounds',
            'getLayerProperties',
            'selectLayer',
            'moveLayer',
            'moveLayerToGroup',
            'transformLayer',
            'quickScale',
            'alignLayers',
            'setLayerOpacity',
            'setBlendMode',
            'duplicateLayer',
            'renameLayer',
            'createRectangle',
            'createTextLayer',
            'createGroup',
            'groupLayers',
            'placeImage',
            'replaceLayerContent',
            'getTextContent',
            'setTextContent',
            'getTextStyle',
            'setTextStyle',
            'addDropShadow',
            'addStroke'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'executor' }).maxIterations,
        outputType: 'execution_report',
        canWriteToPhotoshop: true
    },
    critic: {
        role: 'critic',
        displayName: 'Critic',
        description: 'Review the current design result, identify risks, and suggest concrete revisions.',
        systemPrompt: [
            'You are the Critic teammate for DesignEcho.',
            '你是设计总监，评审的是【设计质量】，不只是位置对齐或文案是否匹配。',
            '先看真实画面（getCanvasSnapshot / getAnnotatedSnapshot / describeImage），再按下面的设计质量维度逐项评判，每项给「过 / 不过 + 具体短板」：',
            '',
            buildDesignPrinciplesSummary('self-check'),
            '',
            '硬性红线：任何一张图只要停在「产品图 + 居中文字、白底、无背景设计、无卖点视觉化」，无论位置多精确、操作多成功，一律判 needs_fix——那是排版，不是设计。',
            'Do not edit Photoshop directly.',
            'Respond in concise Simplified Chinese.',
            'At the very end of your review, output a machine-readable verdict as a single JSON object on its own lines:',
            '{"verdict":"pass"} 仅当设计质量真正达标（不只是操作完成），or',
            '{"verdict":"needs_fix","issues":[{"owner":"copy|insight|asset|layout|visual|execution|requirement","target":"图层或模块名","problem":"具体问题","suggestion":"具体修复建议"}]} 当设计质量不达标。',
            'owner 映射：copy=文案/卖点措辞，insight=用户痛点缺口，asset=素材缺失或误解，layout=构图/间距/对齐/留白，visual=色彩/视觉层次/品质/视觉冲击/背景设计，execution=Photoshop 实现错误，requirement=需求不清或冲突。视觉设计质量问题优先归 owner=visual 或 layout。',
            'List at most 5 issues, ordered by severity. Base every issue on tool results you actually inspected.'
        ].join('\n'),
        allowedTools: [
            'getDocumentInfo',
            'getCanvasSnapshot',
            'getDocumentSnapshot',
            'getAnnotatedSnapshot',
            'getLayerHierarchy',
            'getLayerBounds',
            'getAllTextLayers',
            'getTextContent',
            'describeImage',
            'getScreenSnapshots',
            'auditDetailPagePlacement',
            'getScreenSnapshotsWithOverlay'
        ],
        maxIterations: buildDesignTeamRuntimeBudget({ role: 'critic' }).maxIterations,
        outputType: 'review_report',
        canWriteToPhotoshop: false
    }
};

export const DESIGN_TEAMMATE_ROLES = Object.freeze(
    Object.keys(TEAMMATE_DEFINITIONS) as DesignTeammateRole[]
);

export function getDesignTeammateDefinition(role: DesignTeammateRole): DesignTeammateDefinition {
    return TEAMMATE_DEFINITIONS[role];
}

export function listDesignTeammateDefinitions(): DesignTeammateDefinition[] {
    return DESIGN_TEAMMATE_ROLES.map((role) => TEAMMATE_DEFINITIONS[role]);
}
