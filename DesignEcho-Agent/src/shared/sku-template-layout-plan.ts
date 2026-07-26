export type SkuTemplateLayoutMode =
    | 'ordered_slots'
    | 'legacy_single_region'
    | 'legacy_multi_regions'
    | 'none';

export type SkuTemplatePlacementMethod = 'one_to_one_slots' | 'region_composition' | 'unresolved';

export type SkuTemplateLayoutConfidence = 'high' | 'medium' | 'low';

export type SkuTemplateLayoutPlanStatus = 'ready' | 'needs_visual_confirmation' | 'blocked';

export type SkuTemplateLayoutSlot = {
    layerId?: number;
    name: string;
    kind: string;
    sourceType?: 'group_slot' | 'rectangle_region' | 'reference_group' | 'unknown';
    panelIndex: number;
    declaredCapacity?: number;
    bounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
};

export type SkuTemplateLayoutPlan = {
    schema: 'sku-template-layout-plan/v0';
    mode: SkuTemplateLayoutMode;
    placementMethod: SkuTemplatePlacementMethod;
    expectedItemCount: number;
    slotCount: number;
    regionCapacities: number[];
    capacitySource: 'one_to_one' | 'single_region' | 'template_metadata' | 'geometry_weight' | 'unresolved';
    confidence: SkuTemplateLayoutConfidence;
    status: SkuTemplateLayoutPlanStatus;
    requiresVisualConfirmation: boolean;
    readingOrder: 'photoshop_panel_top_to_bottom';
    slots: SkuTemplateLayoutSlot[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        writesPhotoshop: false;
        grantsToolPermission: false;
        claimsDesignQuality: false;
    };
};

type BuildSkuTemplateLayoutPlanInput = {
    inspection?: Record<string, unknown> | null;
    expectedItemCount: number;
};

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveInteger(value: unknown): number | null {
    const parsed = readNumber(value);
    if (parsed === null || parsed <= 0 || !Number.isInteger(parsed)) return null;
    return parsed;
}

function readMode(value: unknown): SkuTemplateLayoutMode {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ordered_slots') return 'ordered_slots';
    if (normalized === 'legacy_single_region') return 'legacy_single_region';
    if (normalized === 'legacy_multi_regions') return 'legacy_multi_regions';
    return 'none';
}

function readBounds(value: unknown): SkuTemplateLayoutSlot['bounds'] | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const left = readNumber(record.left);
    const top = readNumber(record.top);
    const right = readNumber(record.right);
    const bottom = readNumber(record.bottom);
    const width = readNumber(record.width) ?? (left !== null && right !== null ? right - left : null);
    const height = readNumber(record.height) ?? (top !== null && bottom !== null ? bottom - top : null);
    if (left === null || top === null || right === null || bottom === null || width === null || height === null) {
        return null;
    }
    if (width <= 0 || height <= 0) return null;
    return { left, top, right, bottom, width, height };
}

function readDeclaredCapacity(slot: Record<string, unknown>): number | undefined {
    const direct = readPositiveInteger(slot.declaredCapacity);
    if (direct !== null) return direct;
    const name = String(slot.name || '').trim();
    const match = name.match(/(?:容量|capacity|cap)[\s:：=_-]*(\d{1,2})/i);
    return match ? readPositiveInteger(match[1]) ?? undefined : undefined;
}

function readSlots(value: unknown): SkuTemplateLayoutSlot[] {
    if (!Array.isArray(value)) return [];
    const slots: SkuTemplateLayoutSlot[] = [];
    value.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const record = item as Record<string, unknown>;
        const bounds = readBounds(record.bounds);
        if (!bounds) return;
        const source = String(record.sourceType || '').trim();
        const sourceType: SkuTemplateLayoutSlot['sourceType'] =
            source === 'group_slot' || source === 'rectangle_region' || source === 'reference_group'
                ? source
                : 'unknown';
        const layerId = readPositiveInteger(record.layerId);
        const declaredCapacity = readDeclaredCapacity(record);
        slots.push({
            ...(layerId !== null ? { layerId } : {}),
            name: String(record.name || `区域${index + 1}`).trim(),
            kind: String(record.kind || '').trim(),
            sourceType,
            panelIndex: index,
            ...(declaredCapacity ? { declaredCapacity } : {}),
            bounds
        });
    });
    return slots;
}

function allocateByGeometry(slots: SkuTemplateLayoutSlot[], expectedItemCount: number): {
    capacities: number[];
    confidence: SkuTemplateLayoutConfidence;
} | null {
    if (slots.length === 0 || expectedItemCount < slots.length) return null;
    const weights = slots.map((slot) => slot.bounds.width * slot.bounds.height);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

    const ideal = weights.map((weight) => expectedItemCount * weight / totalWeight);
    const capacities = slots.map(() => 1);
    const remaining = expectedItemCount - slots.length;
    if (remaining > 0) {
        const rawExtra = weights.map((weight) => remaining * weight / totalWeight);
        const floorExtra = rawExtra.map((value) => Math.floor(value));
        floorExtra.forEach((value, index) => {
            capacities[index] += value;
        });
        let remainder = remaining - floorExtra.reduce((sum, value) => sum + value, 0);
        const ranked = rawExtra
            .map((value, index) => ({ index, fraction: value - floorExtra[index] }))
            .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
        for (let index = 0; index < ranked.length && remainder > 0; index += 1) {
            capacities[ranked[index].index] += 1;
            remainder -= 1;
        }
    }

    const maxDeviation = Math.max(...capacities.map((value, index) => Math.abs(value - ideal[index])));
    let confidence: SkuTemplateLayoutConfidence = 'low';
    if (maxDeviation <= 0.2) {
        confidence = 'high';
    } else if (maxDeviation <= 0.5) {
        confidence = 'medium';
    }
    return { capacities, confidence };
}

function makePlan(input: Omit<SkuTemplateLayoutPlan, 'schema' | 'readingOrder' | 'boundaries'>): SkuTemplateLayoutPlan {
    return {
        schema: 'sku-template-layout-plan/v0',
        ...input,
        readingOrder: 'photoshop_panel_top_to_bottom',
        boundaries: {
            writesPhotoshop: false,
            grantsToolPermission: false,
            claimsDesignQuality: false
        }
    };
}

export function buildSkuTemplateLayoutPlan(input: BuildSkuTemplateLayoutPlanInput): SkuTemplateLayoutPlan {
    const expectedItemCount = Math.max(0, Math.round(Number(input.expectedItemCount || 0)));
    const inspection = input.inspection && typeof input.inspection === 'object' ? input.inspection : {};
    const mode = readMode(inspection.mode);
    const slots = readSlots(inspection.slots);
    const slotCount = slots.length || Math.max(0, Math.round(Number(inspection.slotCount || 0)));

    if (expectedItemCount <= 0) {
        return makePlan({
            mode,
            placementMethod: 'unresolved',
            expectedItemCount,
            slotCount,
            regionCapacities: [],
            capacitySource: 'unresolved',
            confidence: 'low',
            status: 'blocked',
            requiresVisualConfirmation: false,
            slots,
            blockers: ['SKU 模板布局计划缺少有效的颜色数量。'],
            warnings: []
        });
    }

    if (mode === 'ordered_slots') {
        const matched = slotCount === expectedItemCount;
        return makePlan({
            mode,
            placementMethod: 'one_to_one_slots',
            expectedItemCount,
            slotCount,
            regionCapacities: matched ? Array.from({ length: slotCount }, () => 1) : [],
            capacitySource: matched ? 'one_to_one' : 'unresolved',
            confidence: matched ? 'high' : 'low',
            status: matched ? 'ready' : 'blocked',
            requiresVisualConfirmation: false,
            slots,
            blockers: matched ? [] : [`顺序占位模板需要 ${expectedItemCount} 个一色一槽，占位数实际为 ${slotCount}。`],
            warnings: []
        });
    }

    if (mode === 'legacy_single_region') {
        return makePlan({
            mode,
            placementMethod: 'region_composition',
            expectedItemCount,
            slotCount,
            regionCapacities: slotCount === 1 ? [expectedItemCount] : [],
            capacitySource: slotCount === 1 ? 'single_region' : 'unresolved',
            confidence: slotCount === 1 ? 'high' : 'low',
            status: slotCount === 1 ? 'ready' : 'blocked',
            requiresVisualConfirmation: false,
            slots,
            blockers: slotCount === 1 ? [] : ['单区域组合模板没有识别到唯一矩形区域。'],
            warnings: expectedItemCount >= 5 ? ['单区域承载颜色较多，执行后必须复核主体间距与遮挡。'] : []
        });
    }

    if (mode === 'legacy_multi_regions') {
        if (slotCount === 0 || slots.length !== slotCount) {
            return makePlan({
                mode,
                placementMethod: 'region_composition',
                expectedItemCount,
                slotCount,
                regionCapacities: [],
                capacitySource: 'unresolved',
                confidence: 'low',
                status: 'blocked',
                requiresVisualConfirmation: false,
                slots,
                blockers: ['旧版多区域模板缺少完整的矩形 bounds，不能推导每区容量。'],
                warnings: []
            });
        }

        const declared = slots.map((slot) => slot.declaredCapacity ?? 0);
        const declaredValid = declared.every((capacity) => capacity > 0)
            && declared.reduce((sum, capacity) => sum + capacity, 0) === expectedItemCount;
        if (declaredValid) {
            return makePlan({
                mode,
                placementMethod: 'region_composition',
                expectedItemCount,
                slotCount,
                regionCapacities: declared,
                capacitySource: 'template_metadata',
                confidence: 'high',
                status: 'ready',
                requiresVisualConfirmation: false,
                slots,
                blockers: [],
                warnings: []
            });
        }

        const geometryPlan = allocateByGeometry(slots, expectedItemCount);
        if (!geometryPlan) {
            return makePlan({
                mode,
                placementMethod: 'region_composition',
                expectedItemCount,
                slotCount,
                regionCapacities: [],
                capacitySource: 'unresolved',
                confidence: 'low',
                status: 'blocked',
                requiresVisualConfirmation: false,
                slots,
                blockers: [`${expectedItemCount} 个颜色无法分配到 ${slotCount} 个必须非空的矩形区域。`],
                warnings: []
            });
        }

        const requiresVisualConfirmation = geometryPlan.confidence !== 'high';
        return makePlan({
            mode,
            placementMethod: 'region_composition',
            expectedItemCount,
            slotCount,
            regionCapacities: geometryPlan.capacities,
            capacitySource: 'geometry_weight',
            confidence: geometryPlan.confidence,
            status: requiresVisualConfirmation ? 'needs_visual_confirmation' : 'ready',
            requiresVisualConfirmation,
            slots,
            blockers: [],
            warnings: requiresVisualConfirmation
                ? [`矩形面积只能给出候选容量 ${geometryPlan.capacities.join('+')}，需要结合模板画面确认阅读顺序与每区承载数。`]
                : []
        });
    }

    return makePlan({
        mode: 'none',
        placementMethod: 'unresolved',
        expectedItemCount,
        slotCount,
        regionCapacities: [],
        capacitySource: 'unresolved',
        confidence: 'low',
        status: 'blocked',
        requiresVisualConfirmation: false,
        slots,
        blockers: ['模板没有识别到图层组槽位或矩形组合区域。'],
        warnings: []
    });
}
