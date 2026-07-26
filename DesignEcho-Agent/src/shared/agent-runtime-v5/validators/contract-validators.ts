/**
 * 契约跨字段业务校验（GPT 定稿 2026-06-24）。
 *
 * JSON Schema 负责字段存在性、类型与范围；本模块负责 schema 表达不了的跨字段语义：
 * - LayoutRegion / ElementPlan：归一化范围（禁像素坐标）、x+width<=1、y+height<=1、
 *   regionId / elementId 唯一、ElementPlan.regionId 必须存在、zIndex 非负、
 *   styleTokenRefs 必须在 Theme Registry（传入 knownStyleTokens 时校验）。
 * - 上游引用必填：CreativeStrategy 需 contextSnapshotRef；DetailPagePlan 需
 *   contextSnapshotRef + creativeStrategyRef；ReviewReport 需 subjectRef。
 *
 * 入参按 unknown 稳健处理（Validator 的职责就是面对可能非法的数据）。
 */

import { V5_ARTIFACT_TYPES } from '../contracts/index';

export interface ValidationIssue {
    code: string;
    path: string;
    message: string;
}

export interface ValidationResult {
    ok: boolean;
    issues: ValidationIssue[];
}

export interface DetailPagePlanValidationOptions {
    /** Theme Registry 已知样式 token；提供时校验 styleTokenRefs 必须命中，否则跳过该项 */
    knownStyleTokens?: ReadonlySet<string>;
}

export interface SemanticLayoutValidationInput {
    regions: unknown;
    elements: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function isNormalized(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonEmptyRef(value: unknown): boolean {
    return isObject(value)
        && typeof value.artifactId === 'string' && value.artifactId.length > 0
        && typeof value.artifactType === 'string' && value.artifactType.length > 0
        && typeof value.contentHash === 'string' && value.contentHash.length > 0;
}

/** 校验单个归一化矩形；越界即视为疑似像素坐标。 */
function validateBounds(bounds: unknown, path: string, issues: ValidationIssue[]): void {
    if (!isObject(bounds)) {
        issues.push({ code: 'bounds_missing', path, message: '缺少归一化 bounds（NormalizedRect）。' });
        return;
    }
    const { x, y, width, height } = bounds as Record<string, unknown>;
    for (const [key, val] of [['x', x], ['y', y], ['width', width], ['height', height]] as const) {
        if (!isNormalized(val)) {
            issues.push({
                code: 'coordinate_not_normalized',
                path: `${path}.${key}`,
                message: `${key}=${String(val)} 不在 0..1 归一化范围内（DetailPagePlan 禁止像素坐标）。`
            });
        }
    }
    if (typeof width === 'number' && (width as number) <= 0) {
        issues.push({ code: 'width_not_positive', path: `${path}.width`, message: 'width 必须 > 0。' });
    }
    if (typeof height === 'number' && (height as number) <= 0) {
        issues.push({ code: 'height_not_positive', path: `${path}.height`, message: 'height 必须 > 0。' });
    }
    if (isNormalized(x) && isNormalized(width) && (x as number) + (width as number) > 1 + 1e-9) {
        issues.push({ code: 'x_plus_width_overflow', path, message: `x + width = ${(x as number) + (width as number)} 超出 1。` });
    }
    if (isNormalized(y) && isNormalized(height) && (y as number) + (height as number) > 1 + 1e-9) {
        issues.push({ code: 'y_plus_height_overflow', path, message: `y + height = ${(y as number) + (height as number)} 超出 1。` });
    }
}

/**
 * 校验 DetailPagePlan payload 的跨字段语义。
 * regionId / elementId 在 plan 内全局唯一；element.regionId 必须存在于同屏 region。
 */
export function validateDetailPagePlanPayload(
    payload: unknown,
    options: DetailPagePlanValidationOptions = {}
): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (!isObject(payload)) {
        return { ok: false, issues: [{ code: 'payload_not_object', path: 'payload', message: 'payload 不是对象。' }] };
    }

    const screens = asArray(payload.screens);
    const seenRegionIds = new Set<string>();
    const seenElementIds = new Set<string>();

    screens.forEach((screenRaw, si) => {
        const screen = isObject(screenRaw) ? screenRaw : {};
        const screenPath = `payload.screens[${si}]`;
        const layout = isObject(screen.layout) ? screen.layout : {};
        const regions = asArray(layout.normalizedRegions);
        const regionIdsInScreen = new Set<string>();

        regions.forEach((regionRaw, ri) => {
            const region = isObject(regionRaw) ? regionRaw : {};
            const regionPath = `${screenPath}.layout.normalizedRegions[${ri}]`;
            const regionId = typeof region.regionId === 'string' ? region.regionId : '';
            if (!regionId) {
                issues.push({ code: 'region_id_missing', path: `${regionPath}.regionId`, message: 'regionId 缺失。' });
            } else {
                if (seenRegionIds.has(regionId)) {
                    issues.push({ code: 'region_id_duplicate', path: `${regionPath}.regionId`, message: `regionId 重复：${regionId}` });
                }
                seenRegionIds.add(regionId);
                regionIdsInScreen.add(regionId);
            }
            validateBounds(region.bounds, `${regionPath}.bounds`, issues);
            if (typeof region.zIndex === 'number' && region.zIndex < 0) {
                issues.push({ code: 'z_index_negative', path: `${regionPath}.zIndex`, message: 'zIndex 不得为负。' });
            }
        });

        asArray(screen.elements).forEach((elementRaw, ei) => {
            const element = isObject(elementRaw) ? elementRaw : {};
            const elementPath = `${screenPath}.elements[${ei}]`;
            const elementId = typeof element.elementId === 'string' ? element.elementId : '';
            if (!elementId) {
                issues.push({ code: 'element_id_missing', path: `${elementPath}.elementId`, message: 'elementId 缺失。' });
            } else {
                if (seenElementIds.has(elementId)) {
                    issues.push({ code: 'element_id_duplicate', path: `${elementPath}.elementId`, message: `elementId 重复：${elementId}` });
                }
                seenElementIds.add(elementId);
            }

            const regionId = typeof element.regionId === 'string' ? element.regionId : '';
            if (!regionId) {
                issues.push({ code: 'element_region_missing', path: `${elementPath}.regionId`, message: 'ElementPlan.regionId 缺失。' });
            } else if (!regionIdsInScreen.has(regionId)) {
                issues.push({
                    code: 'element_region_not_found',
                    path: `${elementPath}.regionId`,
                    message: `ElementPlan.regionId 引用了不存在的 region：${regionId}`
                });
            }

            validateElementTransform(element.transform, `${elementPath}.transform`, issues);

            if (options.knownStyleTokens) {
                asArray(element.styleTokenRefs).forEach((tokenRaw, ti) => {
                    if (typeof tokenRaw === 'string' && !options.knownStyleTokens!.has(tokenRaw)) {
                        issues.push({
                            code: 'style_token_unknown',
                            path: `${elementPath}.styleTokenRefs[${ti}]`,
                            message: `styleTokenRef 未在 Theme Registry 注册：${tokenRaw}`
                        });
                    }
                });
            }
        });
    });

    return { ok: issues.length === 0, issues };
}

/**
 * 通用 R4 语义布局校验入口。
 *
 * LayoutRegion / ElementPlan 本身是跨品类契约；复用既有跨字段校验，避免新的
 * Action Plan、海报或其它设计能力直接依赖业务 Plan API，也避免复制第二套规则。
 */
export function validateSemanticLayout(
    input: SemanticLayoutValidationInput,
    options: DetailPagePlanValidationOptions = {}
): ValidationResult {
    return validateDetailPagePlanPayload({
        screens: [{
            layout: { normalizedRegions: input.regions },
            elements: input.elements
        }]
    }, options);
}

function validateElementTransform(transform: unknown, path: string, issues: ValidationIssue[]): void {
    if (transform === undefined) return;
    if (!isObject(transform)) {
        issues.push({ code: 'transform_not_object', path, message: 'transform 不是对象。' });
        return;
    }
    const { offsetX, offsetY, scale, rotationDeg } = transform as Record<string, unknown>;
    // GPT 要求：transform 数值必须为有限数（禁 NaN / Infinity），再做范围校验
    if (typeof offsetX === 'number' && (!Number.isFinite(offsetX) || offsetX < -1 || offsetX > 1)) {
        issues.push({ code: 'offset_out_of_range', path: `${path}.offsetX`, message: 'offsetX 必须为有限数且在 -1..1。' });
    }
    if (typeof offsetY === 'number' && (!Number.isFinite(offsetY) || offsetY < -1 || offsetY > 1)) {
        issues.push({ code: 'offset_out_of_range', path: `${path}.offsetY`, message: 'offsetY 必须为有限数且在 -1..1。' });
    }
    if (typeof scale === 'number' && (!Number.isFinite(scale) || scale <= 0)) {
        issues.push({ code: 'scale_not_positive', path: `${path}.scale`, message: 'scale 必须为有限数且 > 0。' });
    }
    if (typeof rotationDeg === 'number' && (!Number.isFinite(rotationDeg) || rotationDeg < -180 || rotationDeg > 180)) {
        issues.push({ code: 'rotation_out_of_range', path: `${path}.rotationDeg`, message: 'rotationDeg 必须为有限数且在 -180..180。' });
    }
}

/**
 * 上游引用必填校验（GPT smoke #1/#2/#12）。
 * 不在合法 owner 集合内的 artifactType 返回 ok（不归本校验管）。
 */
export function validateUpstreamRefs(artifactType: string, payload: unknown): ValidationResult {
    const issues: ValidationIssue[] = [];
    const body = isObject(payload) ? payload : {};

    const requireRef = (field: string) => {
        if (!isNonEmptyRef(body[field])) {
            issues.push({ code: 'upstream_ref_missing', path: `payload.${field}`, message: `缺少上游引用 ${field}。` });
        }
    };

    if (artifactType === V5_ARTIFACT_TYPES.creativeStrategy) {
        requireRef('contextSnapshotRef');
    } else if (artifactType === V5_ARTIFACT_TYPES.detailPagePlan) {
        requireRef('contextSnapshotRef');
        requireRef('creativeStrategyRef');
    } else if (artifactType === V5_ARTIFACT_TYPES.reviewReport) {
        requireRef('subjectRef');
    }

    return { ok: issues.length === 0, issues };
}
