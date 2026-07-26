/**
 * Project State 区域所有权（§6.1）。
 * 每个顶层状态区域只有唯一写入者；跨区域写入必须被 applyPatch 拒绝。
 */

import type { ProjectStateOwnerId } from './contracts';

/** owner → 该 owner 唯一可写的顶层区域（JSON-Patch path 的第一段） */
export const PROJECT_STATE_OWNER_SCOPES: Record<ProjectStateOwnerId, readonly string[]> = {
    R0: ['workflow', 'project'],
    R1: ['brief'],
    R2: ['product_analysis', 'assets', 'asset_diagnosis', 'user_insights', 'market_insights', 'purchase_objections'],
    R3: ['selling_points', 'copywriting', 'visual_direction', 'references', 'reference_transfer_plan', 'creative_strategy'],
    R4: ['layout_plan', 'canvas_spatial_model', 'image_placement_plan', 'template_selection', 'detail_page_screen_plan', 'production_plan'],
    E1: ['preview_versions', 'storyboard', 'execution_tasks', 'photoshop', 'artifacts'],
    R5: ['review', 'quality_gate', 'rollback_decision'],
    E2: ['delivery', 'learnings', 'skill_candidates', 'artifacts'],
    CAPABILITY_SERVICE: ['capabilities']
};

/** 从 JSON-Patch path（形如 /brief/product）取顶层区域段 */
export function topLevelPathSegment(path: string): string {
    return String(path || '').replace(/^\/+/, '').split('/')[0] || '';
}

/** 判断某 owner 是否可写某 path */
export function isPathOwnedBy(owner: ProjectStateOwnerId, path: string): boolean {
    const segment = topLevelPathSegment(path);
    if (!segment) return false;
    const scopes = PROJECT_STATE_OWNER_SCOPES[owner] || [];
    return scopes.includes(segment);
}
