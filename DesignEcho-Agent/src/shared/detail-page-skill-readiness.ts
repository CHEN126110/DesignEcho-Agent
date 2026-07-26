
export type DetailPageSkillReadinessMode = 'inspect' | 'execute';
export type DetailPageSkillReadinessStatus = 'inspect_only' | 'ready' | 'needs_context' | 'blocked';
export type DetailPageSkillReadinessSectionStatus = 'ready' | 'needs_context' | 'blocked' | 'not_required';

export interface DetailPageSkillTemplateContext {
    parseSuccess?: boolean;
    screenCount?: number;
    readinessMode?: string;
    issueCount?: number;
    crossScreenRiskCount?: number;
    copyPlaceholderCount?: number;
    imagePlaceholderCount?: number;
}

export interface DetailPageSkillProjectContext {
    projectPathKnown?: boolean;
    assetImageCount?: number;
    visualCandidateCount?: number;
    selectedCandidateCount?: number;
    visualInsightCount?: number;
    shouldAnalyzeCount?: number;
}

export interface DetailPageSkillReadinessSection {
    status: DetailPageSkillReadinessSectionStatus;
    summary: string;
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
}

export interface DetailPageSkillReadiness {
    readinessVersion: 'detail-page-skill-readiness/v0';
    mode: DetailPageSkillReadinessMode;
    status: DetailPageSkillReadinessStatus;
    canInspect: boolean;
    canExecute: boolean;
    recommendedAction: 'inspect_template' | 'execute_with_review' | 'request_context' | 'stop';
    sections: {
        template: DetailPageSkillReadinessSection;
        projectVisualContext: DetailPageSkillReadinessSection;
        imagePlacement: DetailPageSkillReadinessSection;
        verification: DetailPageSkillReadinessSection;
    };
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
    limitations: string[];
}

export interface BuildDetailPageSkillReadinessInput {
    mode?: DetailPageSkillReadinessMode;
    template?: DetailPageSkillTemplateContext | null;
    project?: DetailPageSkillProjectContext | null;
    imagePlacementCoreAvailable?: boolean;
    verificationToolsAvailable?: boolean;
}

function toNumber(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function buildSection(
    status: DetailPageSkillReadinessSectionStatus,
    summary: string,
    options: {
        blockers?: string[];
        warnings?: string[];
        requiredNextChecks?: string[];
    } = {}
): DetailPageSkillReadinessSection {
    return {
        status,
        summary,
        blockers: unique(options.blockers || []),
        warnings: unique(options.warnings || []),
        requiredNextChecks: unique(options.requiredNextChecks || [])
    };
}

function assessTemplateSection(template: DetailPageSkillTemplateContext | null): DetailPageSkillReadinessSection {
    const parseSuccess = template?.parseSuccess === true;
    const screenCount = toNumber(template?.screenCount);
    const copyPlaceholderCount = toNumber(template?.copyPlaceholderCount);
    const imagePlaceholderCount = toNumber(template?.imagePlaceholderCount);
    const issueCount = toNumber(template?.issueCount);
    const crossScreenRiskCount = toNumber(template?.crossScreenRiskCount);

    if (!parseSuccess || screenCount <= 0) {
        return buildSection(
            'blocked',
            '当前没有可靠的详情页模板解析结果。',
            {
                blockers: ['需要先通过 parseDetailPageTemplate 读取当前 Photoshop 文档结构。'],
                requiredNextChecks: ['parseDetailPageTemplate success result', 'parsed detail-page screens']
            }
        );
    }

    const warnings: string[] = [];
    if (copyPlaceholderCount <= 0) warnings.push('模板缺少可识别文案占位，后续文案填充会不稳定。');
    if (imagePlaceholderCount <= 0) warnings.push('模板缺少可识别图片区占位，后续图片置入会不稳定。');
    if (issueCount > 0) warnings.push(`模板还有 ${issueCount} 个结构或版式问题需要执行前复核。`);
    if (crossScreenRiskCount > 0) warnings.push(`检测到 ${crossScreenRiskCount} 个跨屏图层风险。`);

    return buildSection(
        warnings.length > 0 ? 'needs_context' : 'ready',
        `已解析 ${screenCount} 屏；模板模式 ${template?.readinessMode || 'unknown'}。`,
        {
            warnings,
            requiredNextChecks: warnings.length > 0 ? ['template structure review'] : []
        }
    );
}

function assessProjectSection(
    mode: DetailPageSkillReadinessMode,
    project: DetailPageSkillProjectContext | null
): DetailPageSkillReadinessSection {
    if (mode === 'inspect') {
        return buildSection('not_required', '模板检查模式不需要项目素材。');
    }

    const projectPathKnown = project?.projectPathKnown === true;
    const assetImageCount = toNumber(project?.assetImageCount);
    const visualCandidateCount = toNumber(project?.visualCandidateCount);
    const selectedCandidateCount = toNumber(project?.selectedCandidateCount);
    const visualInsightCount = toNumber(project?.visualInsightCount);
    const shouldAnalyzeCount = toNumber(project?.shouldAnalyzeCount);

    if (!projectPathKnown && assetImageCount <= 0) {
        return buildSection(
            'blocked',
            '详情页执行缺少项目路径或可用图片素材。',
            {
                blockers: ['需要项目路径、用户选图或项目素材索引，不能凭空选择产品图片。'],
                requiredNextChecks: ['ContextSnapshot', 'ProjectAssetIndex or selected images']
            }
        );
    }

    if (visualCandidateCount <= 0 && selectedCandidateCount <= 0) {
        return buildSection(
            'needs_context',
            '项目里还没有适合详情页设计的视觉候选。',
            {
                warnings: ['需要刷新项目素材索引或让用户选择图片，避免 Agent 随机取图。'],
                requiredNextChecks: ['detail-page visual candidates']
            }
        );
    }

    if (visualInsightCount <= 0 || shouldAnalyzeCount > 0) {
        return buildSection(
            'needs_context',
            '已有候选图片，但素材理解还不完整。',
            {
                warnings: ['需要视觉模型分析或人工确认图片款式、材质、场景和卖点。'],
                requiredNextChecks: ['VisualInsightCache or visual model analysis']
            }
        );
    }

    return buildSection('ready', `项目素材已可用于详情页设计：图片 ${assetImageCount} 张，候选 ${visualCandidateCount} 个，洞察 ${visualInsightCount} 条。`);
}

function assessImagePlacementSection(
    mode: DetailPageSkillReadinessMode,
    imagePlacementCoreAvailable: boolean | undefined
): DetailPageSkillReadinessSection {
    if (mode === 'inspect') {
        return buildSection('not_required', '模板检查模式不执行图片置入。');
    }
    if (imagePlacementCoreAvailable !== true) {
        return buildSection(
            'needs_context',
            '图片置入能力还需要执行前确认。',
            {
                warnings: ['详情页设计需要先知道图片放多大、放哪里、如何避免主体裁切和变形。'],
                requiredNextChecks: ['ImagePlacementPlan', 'placement verification result']
            }
        );
    }
    return buildSection('ready', '图片置入能力已就绪。');
}

function assessVerificationSection(
    mode: DetailPageSkillReadinessMode,
    verificationToolsAvailable: boolean | undefined
): DetailPageSkillReadinessSection {
    if (mode === 'inspect') {
        return buildSection('ready', '模板检查可通过结构解析和问题列表验收。');
    }
    if (verificationToolsAvailable !== true) {
        return buildSection(
            'needs_context',
            '详情页执行结果还需要完整验收。',
            {
                warnings: ['执行后至少需要结构回读、放置审计、文案布局风险和必要截图检查。'],
                requiredNextChecks: ['parseDetailPageTemplate live audit', 'auditDetailPagePlacement', 'copy layout audit']
            }
        );
    }
    return buildSection('ready', '详情页执行验收工具已就绪。');
}

function resolveStatus(input: {
    mode: DetailPageSkillReadinessMode;
    template: DetailPageSkillReadinessSection;
    projectVisualContext: DetailPageSkillReadinessSection;
    imagePlacement: DetailPageSkillReadinessSection;
    verification: DetailPageSkillReadinessSection;
}): DetailPageSkillReadinessStatus {
    if (input.template.status === 'blocked') return 'blocked';
    if (input.mode === 'inspect') return 'inspect_only';
    const sections = [input.projectVisualContext, input.imagePlacement, input.verification];
    if (sections.some((section) => section.status === 'blocked')) return 'blocked';
    if (sections.some((section) => section.status === 'needs_context')) return 'needs_context';
    return 'ready';
}

function resolveRecommendedAction(status: DetailPageSkillReadinessStatus): DetailPageSkillReadiness['recommendedAction'] {
    switch (status) {
        case 'inspect_only':
            return 'inspect_template';
        case 'ready':
            return 'execute_with_review';
        case 'needs_context':
            return 'request_context';
        case 'blocked':
        default:
            return 'stop';
    }
}

export function buildDetailPageSkillReadiness(
    input: BuildDetailPageSkillReadinessInput
): DetailPageSkillReadiness {
    const mode = input.mode || 'execute';
    const template = assessTemplateSection(input.template || null);
    const projectVisualContext = assessProjectSection(mode, input.project || null);
    const imagePlacement = assessImagePlacementSection(mode, input.imagePlacementCoreAvailable);
    const verification = assessVerificationSection(mode, input.verificationToolsAvailable);
    const status = resolveStatus({ mode, template, projectVisualContext, imagePlacement, verification });
    const sections = { template, projectVisualContext, imagePlacement, verification };
    const allSections = Object.values(sections);
    const blockers = unique(allSections.flatMap((section) => section.blockers));
    const warnings = unique(allSections.flatMap((section) => section.warnings));
    const requiredNextChecks = unique(allSections.flatMap((section) => section.requiredNextChecks));

    return {
        readinessVersion: 'detail-page-skill-readiness/v0',
        mode,
        status,
        canInspect: template.status !== 'blocked',
        canExecute: status === 'ready',
        recommendedAction: resolveRecommendedAction(status),
        sections,
        blockers,
        warnings,
        requiredNextChecks,
        limitations: [
            '该 readiness 只说明详情页 skill 的上下文准备度，不等于设计质量通过。',
            '该 readiness 不读取或暴露原始图像载荷、像素数据或截图内容。',
            '业务执行策略、文案策略、图片置入算法和 Photoshop 写入顺序必须由后续业务阶段单独接入。'
        ]
    };
}
