/**
 * v5 渲染桥：DetailPagePlan 的归一化布局（LayoutRegion 0..1）→ 布局引擎二维区域规格。
 *
 * 补上"v5 有版面契约但没有执行路径"的缺口：R4 产出的 screen.layout.normalizedRegions
 * 经本桥转成 solveRegionLayout 可执行的 NormalizedRegionBlock[]，再走 renderLayout 的
 * 既有渲染管线（按角色建层/置图/写字/阶段分组）。
 *
 * 边界（对齐契约红线）：
 * - 本桥是 E1 侧适配层，契约文件（contracts/）保持不含渲染角色与工具耦合。
 * - 图层顺序不变量：v5 zIndex 只作参考，最终 z 仍由渲染角色决定；两者矛盾时告警不服从。
 * - 不臆造内容：区域没有可用文案/素材时如实跳过并告警，不填占位文案。
 */

import type { DetailPageScreen } from './contracts/detail-page-plan';
import type { LayoutRegion, LayoutRegionRole, ImageSlotPlan } from './contracts/common';
import type { NormalizedRegionBlock, BlockRole } from '../layout/layout-engine';

/** v5 版面区域角色 → 渲染角色（渲染角色决定建层方式与图层顺序） */
export const V5_REGION_ROLE_TO_RENDER_ROLE: Readonly<Record<LayoutRegionRole, BlockRole>> = Object.freeze({
    primary_visual: 'main-image',
    secondary_visual: 'decoration',
    headline: 'title',
    supporting_copy: 'subtitle',
    tag_cluster: 'tag',
    feature_detail: 'selling-point',
    parameters: 'subtitle',
    brand: 'tag',
    decoration: 'decoration'
});

/** 图片槽位角色 → 优先落位的 v5 区域角色（主产品图进主视觉，细节/场景/材质进次视觉） */
const IMAGE_SLOT_ROLE_TO_REGION_ROLE: Readonly<Record<ImageSlotPlan['role'], LayoutRegionRole | null>> = Object.freeze({
    main_product: 'primary_visual',
    feature_detail: 'secondary_visual',
    detail: 'secondary_visual',
    scene: 'secondary_visual',
    material: 'secondary_visual',
    background: null
});

export interface RegionRenderSpecResult {
    regions: NormalizedRegionBlock[];
    warnings: string[];
    /** 没有可用内容而被跳过的 regionId（如实上报，不静默丢弃） */
    skippedRegionIds: string[];
}

export interface BuildRegionRenderSpecInput {
    screen: DetailPageScreen;
    /** assetId → 本地文件路径（素材落盘由运行时解析后传入，桥保持纯逻辑） */
    assetPathsById?: Record<string, string>;
}

function isRenderableImagePath(value: unknown): boolean {
    return typeof value === 'string' && /\.(png|jpe?g|webp|psd|psb)$/i.test(value);
}

function resolveTextContent(role: LayoutRegionRole, screen: DetailPageScreen): string {
    const copy = screen.copy || ({} as DetailPageScreen['copy']);
    switch (role) {
        case 'headline':
            return String(copy.title || '').trim();
        case 'supporting_copy':
            return String(copy.body || copy.subtitle || '').trim();
        case 'feature_detail':
            return String(copy.subtitle || '').trim();
        case 'tag_cluster':
            return (Array.isArray(copy.tags) ? copy.tags : []).map((t) => String(t).trim()).filter(Boolean).join(' · ');
        default:
            return '';
    }
}

/**
 * 把一屏 v5 版面（归一化区域 + 文案 + 图片槽位）转成布局引擎的二维区域规格。
 * 转换只做映射与如实核对：内容缺失跳过并告警；素材路径缺失时保留区域（渲染层会出占位块）并告警。
 */
export function buildRegionRenderSpecFromDetailPageScreen(
    input: BuildRegionRenderSpecInput
): RegionRenderSpecResult {
    const warnings: string[] = [];
    const skippedRegionIds: string[] = [];
    const regions: NormalizedRegionBlock[] = [];
    const screen = input.screen;
    const layoutRegions: LayoutRegion[] = Array.isArray(screen?.layout?.normalizedRegions)
        ? screen.layout.normalizedRegions
        : [];
    if (layoutRegions.length === 0) {
        return { regions, warnings: ['该屏没有 normalizedRegions，无法生成区域规格。'], skippedRegionIds };
    }
    const assetPaths = input.assetPathsById || {};
    const imageSlots: ImageSlotPlan[] = Array.isArray(screen.images) ? screen.images : [];

    // 图片槽位按角色亲和落位：每个视觉区域最多吃一个槽位，先到先得，落不下的如实告警
    const slotQueueByRegionRole = new Map<LayoutRegionRole, ImageSlotPlan[]>();
    for (const slot of imageSlots) {
        const targetRole = IMAGE_SLOT_ROLE_TO_REGION_ROLE[slot.role] ?? null;
        if (!targetRole) continue;
        const queue = slotQueueByRegionRole.get(targetRole) || [];
        queue.push(slot);
        slotQueueByRegionRole.set(targetRole, queue);
    }

    for (const region of layoutRegions) {
        const renderRole = V5_REGION_ROLE_TO_RENDER_ROLE[region.role];
        if (!renderRole) {
            skippedRegionIds.push(region.regionId);
            warnings.push(`区域 ${region.regionId} 的角色「${String(region.role)}」没有渲染映射，已跳过。`);
            continue;
        }

        let content: string | undefined;
        if (region.role === 'primary_visual' || region.role === 'secondary_visual') {
            const queue = slotQueueByRegionRole.get(region.role) || [];
            const slot = queue.shift();
            if (slot) {
                const path = slot.assetId ? assetPaths[slot.assetId] : undefined;
                if (isRenderableImagePath(path)) {
                    content = path;
                } else {
                    warnings.push(`区域 ${region.regionId} 的图片槽位 ${slot.slotId} 没有可用素材路径（assetId=${slot.assetId || '未指定'}），将渲染为占位块。`);
                }
            } else {
                warnings.push(`区域 ${region.regionId}(${region.role}) 没有匹配到图片槽位，将渲染为占位块。`);
            }
        } else if (region.role === 'decoration' || region.role === 'brand' || region.role === 'parameters') {
            // 装饰/品牌/参数：契约里内容在 ElementPlan/外部来源，v1 桥没有可靠文案来源——如实跳过
            skippedRegionIds.push(region.regionId);
            warnings.push(`区域 ${region.regionId}(${region.role}) 在 v1 渲染桥没有可靠内容来源，已跳过（不臆造内容）。`);
            continue;
        } else {
            content = resolveTextContent(region.role, screen);
            if (!content) {
                skippedRegionIds.push(region.regionId);
                warnings.push(`区域 ${region.regionId}(${region.role}) 没有可用文案，已跳过（不臆造内容）。`);
                continue;
            }
        }

        regions.push({
            id: region.regionId,
            role: renderRole,
            content,
            bounds: {
                x: Number(region.bounds?.x) || 0,
                y: Number(region.bounds?.y) || 0,
                width: Number(region.bounds?.width) || 0,
                height: Number(region.bounds?.height) || 0
            }
        });
    }

    // 未被任何区域消费的图片槽位如实上报
    for (const [regionRole, queue] of slotQueueByRegionRole) {
        for (const slot of queue) {
            warnings.push(`图片槽位 ${slot.slotId}(${slot.role}) 没有可落位的 ${regionRole} 区域，未渲染。`);
        }
    }

    // 图层顺序不变量：v5 zIndex 与渲染角色排序矛盾时告警不服从（z 最终由角色决定）
    const roleZOrder: Record<BlockRole, number> = {
        background: 0, 'main-image': 10, subtitle: 18, title: 20, 'selling-point': 22, tag: 28, decoration: 30
    };
    const planned = layoutRegions
        .filter((r) => regions.some((out) => out.id === r.regionId))
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex);
    for (let i = 1; i < planned.length; i++) {
        const prevRole = V5_REGION_ROLE_TO_RENDER_ROLE[planned[i - 1].role];
        const currRole = V5_REGION_ROLE_TO_RENDER_ROLE[planned[i].role];
        if (roleZOrder[prevRole] > roleZOrder[currRole]) {
            warnings.push(`计划 zIndex 顺序（${planned[i - 1].regionId} < ${planned[i].regionId}）与渲染角色层序矛盾；图层顺序按角色规则执行，不按计划 zIndex。`);
            break;
        }
    }

    return { regions, warnings, skippedRegionIds };
}
