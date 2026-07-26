import type { ProjectAssetIndex, ProjectAssetIndexAsset } from './project-asset-index';
import type { SkuCardAssetCandidateReport } from './sku-card-asset-candidates';
import type { SkuCardSourcePreparationPlan } from './sku-card-source-preparation-plan';
import type { SkuCardTemplatePreparationPlan } from './sku-card-template-preparation-plan';

export type SkuCardExamReadinessVersion = 'sku-card-exam-readiness/v0';
export type SkuCardExamReadinessStatus =
    | 'ready_for_execution'
    | 'needs_visual_confirmation'
    | 'blocked_no_candidates'
    | 'blocked_missing_execution_assets';

export interface SkuCardExamReadinessCheck {
    id: string;
    ready: boolean;
    summary: string;
    missing?: string[];
}

export interface SkuCardExamReadiness {
    version: SkuCardExamReadinessVersion;
    status: SkuCardExamReadinessStatus;
    readyForExecution: boolean;
    checks: SkuCardExamReadinessCheck[];
    blockers: string[];
    warnings: string[];
}

export interface SkuCardRuntimeTemplateReadiness {
    source?: string;
    dirs?: string[];
    templateCount?: number;
    comboSizes?: number[];
    noteSizes?: number[];
    warnings?: string[];
}

export interface BuildSkuCardExamReadinessInput {
    skuCardAssetCandidateReport?: SkuCardAssetCandidateReport | null;
    assetIndex?: ProjectAssetIndex | null;
    referenceAssetIndex?: ProjectAssetIndex | null;
    skuCardSourcePreparationPlan?: SkuCardSourcePreparationPlan | null;
    skuCardTemplatePreparationPlan?: SkuCardTemplatePreparationPlan | null;
    runtimeTemplateReadiness?: SkuCardRuntimeTemplateReadiness | null;
    allowDynamicSkuConfig?: boolean;
    requirePreparedSourceDocument?: boolean;
    requiredSizes?: number[];
}

const DEFAULT_REQUIRED_SIZES = [2, 3, 4];

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function trimSentenceEnd(value: unknown): string {
    return normalizeText(value).replace(/[。.!！?？]+$/g, '');
}

function assetsOf(assetIndex?: ProjectAssetIndex | null): ProjectAssetIndexAsset[] {
    return Array.isArray(assetIndex?.assets) ? assetIndex.assets : [];
}

function assetText(asset: ProjectAssetIndexAsset): string {
    return [
        asset.relativePath,
        asset.path,
        asset.name,
        asset.role,
        asset.folderRole
    ].map(normalizePath).join(' ');
}

function hasSkuSourceDocument(assetIndex?: ProjectAssetIndex | null): boolean {
    return assetsOf(assetIndex).some((asset) => {
        const text = assetText(asset);
        return /(?:^|\/|\s)PSD\/SKU\.(?:psb|psd)(?:\s|$)/i.test(text)
            || (
                asset.role === 'psd'
                && normalizeText(asset.folderRole).toLowerCase() === 'psd'
                && /(?:^|\/|\s)SKU\.(?:psb|psd)(?:\s|$)/i.test(text)
            );
    });
}

function templateAvailable(assetIndex: ProjectAssetIndex | null | undefined, label: string): boolean {
    return assetsOf(assetIndex).some((asset) => {
        if (asset.role !== 'template' && normalizeText(asset.folderRole).toLowerCase() !== 'template') return false;
        const text = assetText(asset);
        const fileText = `${normalizePath(asset.relativePath)} ${normalizePath(asset.path)} ${normalizePath(asset.name)}`;
        return text.includes(label) && /\.(?:psd|psb|tif|tiff)(?:\s|$)/i.test(fileText);
    });
}

function missingSkuTemplates(assetIndex: ProjectAssetIndex | null | undefined, requiredSizes: number[]): string[] {
    const missing: string[] = [];
    for (const size of requiredSizes) {
        const combo = `${size}双装`;
        const note = `${size}双自选备注`;
        if (!templateAvailable(assetIndex, combo)) missing.push(combo);
        if (!templateAvailable(assetIndex, note)) missing.push(note);
    }
    return missing;
}

function hasSkuConfig(assetIndex?: ProjectAssetIndex | null): boolean {
    if (Number(assetIndex?.summary?.skuConfigCount || 0) > 0) return true;
    return assetsOf(assetIndex).some((asset) => {
        const text = assetText(asset);
        return (asset.role === 'config' || normalizeText(asset.folderRole).toLowerCase() === 'config')
            && /\.csv$/i.test(text);
    });
}

function normalizeSizes(values?: number[] | null): number[] {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
    )).sort((a, b) => a - b);
}

function missingSizes(requiredSizes: number[], availableSizes?: number[] | null): number[] {
    const available = new Set(normalizeSizes(availableSizes));
    return requiredSizes.filter((size) => !available.has(size));
}

function missingRuntimeTemplateLabels(
    runtimeTemplateReadiness: SkuCardRuntimeTemplateReadiness | null | undefined,
    requiredSizes: number[]
): string[] {
    if (!runtimeTemplateReadiness) return requiredSizes.flatMap((size) => [`${size}双装`, `${size}双自选备注`]);
    return [
        ...missingSizes(requiredSizes, runtimeTemplateReadiness.comboSizes).map((size) => `${size}双装`),
        ...missingSizes(requiredSizes, runtimeTemplateReadiness.noteSizes).map((size) => `${size}双自选备注`)
    ];
}

function hasReferenceSkuExamples(referenceAssetIndex?: ProjectAssetIndex | null): boolean {
    return assetsOf(referenceAssetIndex).some((asset) => asset.role === 'sku-output')
        || Number(referenceAssetIndex?.summary?.roleCounts?.['sku-output'] || 0) > 0;
}

function buildCheck(id: string, ready: boolean, summary: string, missing?: string[]): SkuCardExamReadinessCheck {
    return {
        id,
        ready,
        summary,
        ...(missing && missing.length > 0 ? { missing } : {})
    };
}

export function buildSkuCardExamReadiness(input: BuildSkuCardExamReadinessInput): SkuCardExamReadiness {
    const requiredSizes = (input.requiredSizes || DEFAULT_REQUIRED_SIZES)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0);
    const report = input.skuCardAssetCandidateReport || null;
    const sourcePreparationReady = input.skuCardSourcePreparationPlan?.status === 'ready_for_preparation';
    const projectSkuSourceReady = input.requirePreparedSourceDocument === true
        ? false
        : hasSkuSourceDocument(input.assetIndex);
    const candidateDiscoveryReady = projectSkuSourceReady || Number(report?.candidateCount || 0) > 0;
    const confirmedPrimaryCandidateReady = report?.status === 'ready_for_selection'
        && (report.candidates || []).some((candidate) => (
            candidate.recommendedUse === 'primary_sku_card'
            && candidate.needsVisualConfirmation === false
        ));
    const visualSelectionReady = projectSkuSourceReady || confirmedPrimaryCandidateReady || sourcePreparationReady;
    const skuSourceReady = input.requirePreparedSourceDocument === true
        ? sourcePreparationReady
        : projectSkuSourceReady || sourcePreparationReady;
    const missingProjectTemplates = missingSkuTemplates(input.assetIndex, requiredSizes);
    const projectTemplatesReady = missingProjectTemplates.length === 0;
    const missingRuntimeTemplates = missingRuntimeTemplateLabels(input.runtimeTemplateReadiness, requiredSizes);
    const runtimeTemplatesReady = Boolean(input.runtimeTemplateReadiness) && missingRuntimeTemplates.length === 0;
    const templatePreparationReady = input.skuCardTemplatePreparationPlan?.status === 'ready_for_preparation';
    const templatesReady = projectTemplatesReady || runtimeTemplatesReady || templatePreparationReady;
    const projectConfigReady = hasSkuConfig(input.assetIndex);
    const dynamicConfigReady = input.allowDynamicSkuConfig === true;
    const configReady = projectConfigReady || dynamicConfigReady;
    const referenceReady = hasReferenceSkuExamples(input.referenceAssetIndex);

    const checks = [
        buildCheck(
            'sku-card-candidates',
            candidateDiscoveryReady,
            projectSkuSourceReady
                ? '当前项目已有 SKU 源文档，本轮不需要从项目图片重新挑选色卡候选。'
                : candidateDiscoveryReady
                ? `已发现 ${report?.candidateCount || 0} 个 SKU 卡片候选。`
                : '项目素材中没有可用 SKU 卡片候选。'
        ),
        buildCheck(
            'visual-selection',
            visualSelectionReady,
            projectSkuSourceReady
                ? '已有 SKU 源文档，本轮不需要把项目图片候选作为执行源。'
                : sourcePreparationReady
                ? 'SKU 卡片已具备足够的已确认源素材，额外候选可后续复核。'
                : visualSelectionReady
                ? 'SKU 卡片候选已有可执行的视觉确认。'
                : 'SKU 卡片候选仍停留在路径/尺寸候选阶段，不能直接执行。',
        ),
        buildCheck(
            'sku-source-document',
            skuSourceReady,
            input.requirePreparedSourceDocument === true && sourcePreparationReady
                ? '本轮要求从项目图片准备卡片式 SKU 源文档，Agent 已有可执行源素材准备计划。'
                : input.requirePreparedSourceDocument === true
                    ? '本轮要求从项目图片准备卡片式 SKU 源文档，不能直接复用旧 SKU.psb。'
                    : projectSkuSourceReady
                ? '当前项目已有 PSD/SKU.psb 或等价 SKU 源文档。'
                : sourcePreparationReady
                    ? '当前项目缺少 PSD/SKU.psb，但 Agent 可根据已确认素材准备 SKU 源文档。'
                    : '当前项目缺少 PSD/SKU.psb SKU 源文档。'
        ),
        buildCheck(
            'sku-templates',
            templatesReady,
            projectTemplatesReady
                ? `当前项目已有 ${requiredSizes.join('/')} 双装和自选备注模板。`
                : runtimeTemplatesReady
                    ? `运行时备用 SKU 模板已覆盖 ${requiredSizes.join('/')} 双装和自选备注模板。`
                    : templatePreparationReady
                        ? `当前项目缺少 SKU 模板，但 Agent 可准备 ${requiredSizes.join('/')} 双装和自选备注占位模板。`
                        : '当前项目模板文件不完整，运行时备用模板也没有覆盖所需规格。',
            templatesReady
                ? undefined
                : Array.from(new Set([...missingProjectTemplates, ...missingRuntimeTemplates]))
        ),
        buildCheck(
            'sku-config',
            configReady,
            projectConfigReady
                ? '当前项目已有可解析的 SKU CSV 配置。'
                : dynamicConfigReady
                    ? '当前项目没有 SKU CSV，但执行器可根据颜色图层动态生成 SKU 组合。'
                    : '当前项目配置文件夹缺少可用 SKU CSV 配置文件。'
        ),
        buildCheck(
            'reference-sku-examples',
            referenceReady,
            referenceReady
                ? '参考项目提供了 SKU 成品样例，可用于风格和规格对照。'
                : '参考项目没有发现 SKU 成品样例。'
        )
    ];

    const blockers: string[] = [];
    if (!candidateDiscoveryReady) blockers.push('项目素材中没有识别到 SKU 卡片候选图。');
    if (!visualSelectionReady) blockers.push('SKU 卡片候选还没有完成视觉确认，不能把路径候选直接当作可执行选图。');
    if (!skuSourceReady) {
        const planBlockers = input.skuCardSourcePreparationPlan?.blockers || [];
        blockers.push(
            planBlockers.length > 0
                ? `当前还不能准备 SKU 源文档：${planBlockers.map(trimSentenceEnd).filter(Boolean).join('；')}。`
                : '当前项目缺少 PSD/SKU.psb SKU 源文档，且还没有可执行的 Agent 源素材准备计划。'
        );
    }
    if (!templatesReady) {
        const templatePlanBlockers = input.skuCardTemplatePreparationPlan?.blockers || [];
        blockers.push(
            templatePlanBlockers.length > 0
                ? `当前还不能准备 SKU 模板：${templatePlanBlockers.map(trimSentenceEnd).filter(Boolean).join('；')}。`
                : `当前项目模板和运行时备用模板都没有覆盖所需规格，缺少：${Array.from(new Set([...missingProjectTemplates, ...missingRuntimeTemplates])).join('、')}。`
        );
    }
    if (!configReady) blockers.push('当前项目配置文件夹缺少可用 SKU CSV 配置文件，且本轮没有启用动态组合生成。');

    const missingExecutionAssets = !skuSourceReady || !templatesReady || !configReady;
    const status: SkuCardExamReadinessStatus = !candidateDiscoveryReady
        ? 'blocked_no_candidates'
        : missingExecutionAssets
            ? 'blocked_missing_execution_assets'
            : !visualSelectionReady
                ? 'needs_visual_confirmation'
                : 'ready_for_execution';

    const readyForExecution = status === 'ready_for_execution';

    return {
        version: 'sku-card-exam-readiness/v0',
        status,
        readyForExecution,
        checks,
        blockers,
        warnings: [
            !referenceReady ? '没有参考 SKU 成品样例，卡片风格只能依赖当前项目或用户说明。' : '',
            report?.status === 'needs_visual_confirmation' && !sourcePreparationReady
                ? '候选图需要视觉模型或人工确认主体完整度、颜色清晰度和裁切风险。'
                : '',
            report?.status === 'needs_visual_confirmation' && sourcePreparationReady
                ? '已有足够 SKU 色卡源可进入执行；额外候选仍可作为后续补充复核。'
                : '',
            ...(input.runtimeTemplateReadiness?.warnings || [])
        ].filter(Boolean)
    };
}
