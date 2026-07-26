import type { DesignMemoryItem, DesignMemoryScope } from './design-memory-knowledge';
import {
    buildInteractiveCardValidationResult,
    cleanInteractiveCardText,
    stableInteractiveCardHash,
    type InteractiveCardDefinition,
    type InteractiveCardValidationIssue,
    type InteractiveCardValidationResult
} from './interactive-card-contract';
import { buildSkuComboMultisetIdentity } from './sku-combo-identity';

export interface SkuComboColorSlot {
    slot: number;
    label: string;
    colorHex?: string;
}

export interface SkuComboGroup {
    size: number;
    combos: number[][];
}

export interface SkuComboEditorValue {
    groups: SkuComboGroup[];
    colorSlots?: SkuComboColorSlot[];
    generateSelfSelectNotes?: boolean;
}

export type SkuComboEditorMutationReason =
    | 'added'
    | 'removed'
    | 'reordered'
    | 'unchanged'
    | 'updated_color'
    | 'duplicate'
    | 'invalid_combo'
    | 'invalid_color_label'
    | 'missing_color_slot'
    | 'missing_group'
    | 'invalid_index';

export interface SkuComboEditorMutationResult {
    value: SkuComboEditorValue;
    changed: boolean;
    reason: SkuComboEditorMutationReason;
}

export interface SkuComboEditorPayload {
    version: 'sku-combo-editor/v0';
    colorSlots: SkuComboColorSlot[];
    requiredSizes: number[];
    initialValue: SkuComboEditorValue;
    productHints?: {
        projectId?: string;
        productType?: string;
        style?: string;
    };
}

export type SkuComboEditorCard = InteractiveCardDefinition<SkuComboEditorPayload>;

export interface BuildSkuComboEditorInteractiveCardInput {
    id?: string;
    title?: string;
    description?: string;
    colorSlots: SkuComboColorSlot[];
    requiredSizes: number[];
    initialValue?: SkuComboEditorValue;
    projectId?: string;
    productType?: string;
    style?: string;
}

export interface BuildSkuComboApprovedRecipeMemoryInput {
    card: SkuComboEditorCard;
    value: SkuComboEditorValue;
    scope?: DesignMemoryScope;
    confirmedBy?: string;
    confirmedAt?: string | number | Date;
}

function normalizePositiveInt(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function normalizeColorSlots(value: unknown): SkuComboColorSlot[] {
    const raw = Array.isArray(value) ? value : [];
    const slots = raw
        .map((item): SkuComboColorSlot | null => {
            const record = item && typeof item === 'object' ? item as Partial<SkuComboColorSlot> : {};
            const slot = normalizePositiveInt(record.slot);
            const label = cleanInteractiveCardText(record.label || slot);
            if (!slot || !label) return null;
            const colorHex = cleanInteractiveCardText(record.colorHex);
            return {
                slot,
                label,
                ...(colorHex ? { colorHex } : {})
            };
        })
        .filter((item): item is SkuComboColorSlot => Boolean(item));
    const seen = new Set<number>();
    return slots.filter((slot) => {
        if (seen.has(slot.slot)) return false;
        seen.add(slot.slot);
        return true;
    }).sort((a, b) => a.slot - b.slot);
}

function normalizeRequiredSizes(value: unknown): number[] {
    const raw = Array.isArray(value) ? value : [];
    return Array.from(new Set(raw
        .map(normalizePositiveInt)
        .filter((item): item is number => item !== null)))
        .sort((a, b) => a - b);
}

function parseComboTextLine(line: string): number[] {
    const tokens = String(line || '')
        .split(/[+＋,，/、\s]+/g)
        .map((item) => item.trim())
        .filter(Boolean);
    const slots = tokens.map((item) => Number(item));
    if (slots.some((item) => !Number.isInteger(item) || item <= 0)) return [];
    return slots;
}

export function stringifySkuCombo(combo: number[]): string {
    return combo.join('+');
}

function buildSlotComboIdentity(combo: number[]): string {
    return buildSkuComboMultisetIdentity(combo, (slot) => String(slot));
}

export function addSkuComboToEditorValue(
    value: SkuComboEditorValue,
    size: number,
    combo: number[]
): SkuComboEditorMutationResult {
    const normalizedSize = normalizePositiveInt(size);
    const normalizedCombo = Array.isArray(combo)
        ? combo.map(normalizePositiveInt).filter((slot): slot is number => slot !== null)
        : [];
    if (!normalizedSize || normalizedCombo.length !== normalizedSize) {
        return { value, changed: false, reason: 'invalid_combo' };
    }

    const groupIndex = value.groups.findIndex((group) => group.size === normalizedSize);
    if (groupIndex < 0) {
        return { value, changed: false, reason: 'missing_group' };
    }

    const group = value.groups[groupIndex];
    const comboIdentity = buildSlotComboIdentity(normalizedCombo);
    if (group.combos.some((existing) => buildSlotComboIdentity(existing) === comboIdentity)) {
        return { value, changed: false, reason: 'duplicate' };
    }

    return {
        value: {
            ...value,
            groups: value.groups.map((item, index) => index === groupIndex
                ? { ...item, combos: [...item.combos, [...normalizedCombo]] }
                : item)
        },
        changed: true,
        reason: 'added'
    };
}

export function removeSkuComboFromEditorValue(
    value: SkuComboEditorValue,
    size: number,
    comboIndex: number
): SkuComboEditorMutationResult {
    const normalizedSize = normalizePositiveInt(size);
    const groupIndex = value.groups.findIndex((group) => group.size === normalizedSize);
    if (groupIndex < 0) {
        return { value, changed: false, reason: 'missing_group' };
    }

    const group = value.groups[groupIndex];
    if (!Number.isInteger(comboIndex) || comboIndex < 0 || comboIndex >= group.combos.length) {
        return { value, changed: false, reason: 'invalid_index' };
    }

    return {
        value: {
            ...value,
            groups: value.groups.map((item, index) => index === groupIndex
                ? { ...item, combos: item.combos.filter((_, indexToKeep) => indexToKeep !== comboIndex) }
                : item)
        },
        changed: true,
        reason: 'removed'
    };
}

/**
 * 在同一双装组内把某个组合从 fromIndex 移动到 toIndex（组合顺序=出图/命名次序，用户可拖拽调整）。
 * 只在组内重排，不跨双装移动（不同双装的颜色数量不同）。保持不可变更新。
 */
export function moveSkuComboInEditorValue(
    value: SkuComboEditorValue,
    size: number,
    fromIndex: number,
    toIndex: number
): SkuComboEditorMutationResult {
    const normalizedSize = normalizePositiveInt(size);
    const groupIndex = value.groups.findIndex((group) => group.size === normalizedSize);
    if (groupIndex < 0) {
        return { value, changed: false, reason: 'missing_group' };
    }

    const group = value.groups[groupIndex];
    const comboCount = group.combos.length;
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= comboCount
        || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= comboCount) {
        return { value, changed: false, reason: 'invalid_index' };
    }
    if (fromIndex === toIndex) {
        return { value, changed: false, reason: 'unchanged' };
    }

    const reordered = [...group.combos];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    return {
        value: {
            ...value,
            groups: value.groups.map((item, index) => index === groupIndex
                ? { ...item, combos: reordered }
                : item)
        },
        changed: true,
        reason: 'reordered'
    };
}

export function updateSkuComboColorSlotLabel(
    value: SkuComboEditorValue,
    slot: number,
    label: string
): SkuComboEditorMutationResult {
    const normalizedSlot = normalizePositiveInt(slot);
    const normalizedLabel = cleanInteractiveCardText(label);
    if (!normalizedSlot || !normalizedLabel) {
        return { value, changed: false, reason: 'invalid_color_label' };
    }

    const colorSlots = Array.isArray(value.colorSlots) ? value.colorSlots : [];
    const colorIndex = colorSlots.findIndex((item) => item.slot === normalizedSlot);
    if (colorIndex < 0) {
        return { value, changed: false, reason: 'missing_color_slot' };
    }
    if (colorSlots[colorIndex].label === normalizedLabel) {
        return { value, changed: false, reason: 'updated_color' };
    }

    return {
        value: {
            ...value,
            colorSlots: colorSlots.map((item, index) => index === colorIndex
                ? { ...item, label: normalizedLabel }
                : item)
        },
        changed: true,
        reason: 'updated_color'
    };
}

export function parseSkuComboText(text: string, size: number): number[][] {
    return String(text || '')
        .split(/[\n\r;；]+/g)
        .map((line) => parseComboTextLine(line))
        .filter((combo) => combo.length > 0)
        .filter((combo) => !size || combo.length === size);
}

function normalizeSkuComboGroups(value: unknown): SkuComboGroup[] {
    const rawGroups = Array.isArray((value as any)?.groups) ? (value as any).groups : [];
    return rawGroups
        .map((group: any): SkuComboGroup | null => {
            const size = normalizePositiveInt(group?.size);
            if (!size) return null;
            const combos = Array.isArray(group?.combos)
                ? group.combos
                    .map((combo: unknown) => Array.isArray(combo)
                        ? combo.map(normalizePositiveInt).filter((item): item is number => item !== null)
                        : typeof combo === 'string'
                            ? parseComboTextLine(combo)
                            : [])
                    .filter((combo: number[]) => combo.length > 0)
                : typeof group?.comboText === 'string'
                    ? parseSkuComboText(group.comboText, size)
                    : [];
            return { size, combos };
        })
        .filter((item): item is SkuComboGroup => Boolean(item))
        .sort((a, b) => a.size - b.size);
}

function normalizeEditorColorSlots(
    value: unknown,
    fallbackColorSlots: SkuComboColorSlot[]
): SkuComboColorSlot[] {
    const rawColorSlots = Array.isArray((value as any)?.colorSlots)
        ? (value as any).colorSlots as unknown[]
        : null;
    if (!rawColorSlots) return fallbackColorSlots.map((slot) => ({ ...slot }));

    const overrideBySlot = new Map<number, Partial<SkuComboColorSlot>>();
    for (const rawSlot of rawColorSlots) {
        const record = rawSlot && typeof rawSlot === 'object'
            ? rawSlot as Partial<SkuComboColorSlot>
            : {};
        const slot = normalizePositiveInt(record.slot);
        if (!slot || overrideBySlot.has(slot)) continue;
        overrideBySlot.set(slot, record);
    }

    return fallbackColorSlots.map((fallback) => {
        const override = overrideBySlot.get(fallback.slot);
        if (!override) return { ...fallback };
        const label = Object.prototype.hasOwnProperty.call(override, 'label')
            ? cleanInteractiveCardText(override.label)
            : fallback.label;
        const colorHex = Object.prototype.hasOwnProperty.call(override, 'colorHex')
            ? cleanInteractiveCardText(override.colorHex)
            : fallback.colorHex;
        return {
            slot: fallback.slot,
            label,
            ...(colorHex ? { colorHex } : {})
        };
    });
}

function normalizeSkuComboEditorValue(
    value: unknown,
    requiredSizes: number[],
    fallbackColorSlots: SkuComboColorSlot[]
): SkuComboEditorValue {
    const groupsBySize = new Map<number, SkuComboGroup>();
    for (const group of normalizeSkuComboGroups(value)) {
        groupsBySize.set(group.size, {
            size: group.size,
            combos: group.combos
        });
    }
    const normalizedGroups = requiredSizes.map((size) => groupsBySize.get(size) || { size, combos: [] });
    return {
        groups: normalizedGroups,
        colorSlots: normalizeEditorColorSlots(value, fallbackColorSlots),
        generateSelfSelectNotes: (value as any)?.generateSelfSelectNotes !== false
    };
}

function buildDefaultValue(requiredSizes: number[], colorSlots: SkuComboColorSlot[]): SkuComboEditorValue {
    return {
        groups: requiredSizes.map((size) => ({
            size,
            combos: colorSlots.slice(0, Math.max(1, size)).length >= size
                ? [colorSlots.slice(0, size).map((slot) => slot.slot)]
                : []
        })),
        colorSlots: colorSlots.map((slot) => ({ ...slot })),
        generateSelfSelectNotes: true
    };
}

export function validateSkuComboEditorValue(
    payload: SkuComboEditorPayload,
    value: unknown
): InteractiveCardValidationResult<SkuComboEditorValue> {
    const payloadColorSlots = normalizeColorSlots(payload.colorSlots);
    const requiredSizes = normalizeRequiredSizes(payload.requiredSizes);
    const normalizedValue = normalizeSkuComboEditorValue(value, requiredSizes, payloadColorSlots);
    const colorSlots = normalizedValue.colorSlots || payloadColorSlots;
    const validSlotSet = new Set(payloadColorSlots.map((slot) => slot.slot));
    const issues: InteractiveCardValidationIssue[] = [];

    if (payloadColorSlots.length === 0) {
        issues.push({
            severity: 'error',
            code: 'missing_color_slots',
            message: '还没有可用颜色，不能确认 SKU 组合。'
        });
    }

    const rawColorSlots = Array.isArray((value as any)?.colorSlots) ? (value as any).colorSlots : [];
    const seenOverrideSlots = new Set<number>();
    for (const rawSlot of rawColorSlots) {
        const slot = normalizePositiveInt(rawSlot?.slot);
        if (!slot) continue;
        if (!validSlotSet.has(slot)) {
            issues.push({
                severity: 'error',
                code: 'unsupported_color_slot',
                message: `颜色编号 ${slot} 不属于本次 SKU 卡片。`,
                path: `colorSlots.${slot}`
            });
        }
        if (seenOverrideSlots.has(slot)) {
            issues.push({
                severity: 'error',
                code: 'duplicate_color_slot',
                message: `颜色编号 ${slot} 被重复定义。`,
                path: `colorSlots.${slot}`
            });
        }
        seenOverrideSlots.add(slot);
    }

    const seenColorLabels = new Set<string>();
    for (const colorSlot of colorSlots) {
        const label = cleanInteractiveCardText(colorSlot.label);
        if (!label) {
            issues.push({
                severity: 'error',
                code: 'empty_color_label',
                message: `颜色编号 ${colorSlot.slot} 还没有名称。`,
                path: `colorSlots.${colorSlot.slot}.label`
            });
            continue;
        }
        const labelKey = label.toLocaleLowerCase('zh-CN');
        if (seenColorLabels.has(labelKey)) {
            issues.push({
                severity: 'error',
                code: 'duplicate_color_label',
                message: `颜色名称「${label}」重复，请为每个颜色保留可区分的名称。`,
                path: `colorSlots.${colorSlot.slot}.label`
            });
        }
        seenColorLabels.add(labelKey);
    }
    if (requiredSizes.length === 0) {
        issues.push({
            severity: 'error',
            code: 'missing_required_sizes',
            message: '还没有规格要求，不能确认 SKU 组合。'
        });
    }

    const groupSizes = new Set(normalizedValue.groups.map((group) => group.size));
    for (const size of requiredSizes) {
        if (!groupSizes.has(size)) {
            issues.push({
                severity: 'error',
                code: 'missing_size_group',
                message: `${size}双装缺少组合。`,
                path: `groups.${size}`
            });
        }
    }

    for (const group of normalizedValue.groups) {
        if (!requiredSizes.includes(group.size)) {
            issues.push({
                severity: 'error',
                code: 'unsupported_size_group',
                message: `${group.size}双装不是本次需要的规格。`,
                path: `groups.${group.size}`
            });
        }
        if (group.combos.length === 0) {
            issues.push({
                severity: 'error',
                code: 'empty_size_group',
                message: `${group.size}双装至少需要 1 个组合。`,
                path: `groups.${group.size}`
            });
        }

        const seenCombos = new Set<string>();
        group.combos.forEach((combo, comboIndex) => {
            if (combo.length !== group.size) {
                issues.push({
                    severity: 'error',
                    code: 'combo_size_mismatch',
                    message: `${group.size}双装的「${stringifySkuCombo(combo)}」包含 ${combo.length} 个颜色，应为 ${group.size} 个。`,
                    path: `groups.${group.size}.combos.${comboIndex}`
                });
            }
            const unknownSlots = combo.filter((slot) => !validSlotSet.has(slot));
            if (unknownSlots.length > 0) {
                issues.push({
                    severity: 'error',
                    code: 'unknown_color_slot',
                    message: `组合「${stringifySkuCombo(combo)}」包含不存在的颜色编号：${Array.from(new Set(unknownSlots)).join('、')}。`,
                    path: `groups.${group.size}.combos.${comboIndex}`
                });
            }
            const comboKey = buildSlotComboIdentity(combo);
            if (seenCombos.has(comboKey)) {
                issues.push({
                    severity: 'error',
                    code: 'duplicate_combo',
                    message: `${group.size}双装重复填写了同一颜色组合「${stringifySkuCombo(combo)}」。`,
                    path: `groups.${group.size}.combos.${comboIndex}`
                });
            }
            seenCombos.add(comboKey);
        });
    }

    return buildInteractiveCardValidationResult({
        normalizedValue,
        issues
    });
}

export function buildSkuComboEditorInteractiveCard(
    input: BuildSkuComboEditorInteractiveCardInput
): SkuComboEditorCard {
    const colorSlots = normalizeColorSlots(input.colorSlots);
    const requiredSizes = normalizeRequiredSizes(input.requiredSizes);
    const initialValue = input.initialValue
        ? normalizeSkuComboEditorValue(input.initialValue, requiredSizes, colorSlots)
        : buildDefaultValue(requiredSizes, colorSlots);
    const projectId = cleanInteractiveCardText(input.projectId);
    const payload: SkuComboEditorPayload = {
        version: 'sku-combo-editor/v0',
        colorSlots,
        requiredSizes,
        initialValue,
        productHints: {
            ...(projectId ? { projectId } : {}),
            ...(cleanInteractiveCardText(input.productType) ? { productType: cleanInteractiveCardText(input.productType) } : {}),
            ...(cleanInteractiveCardText(input.style) ? { style: cleanInteractiveCardText(input.style) } : {})
        }
    };
    const id = cleanInteractiveCardText(input.id)
        || `sku-combo-editor-${stableInteractiveCardHash({ colorSlots, requiredSizes, projectId })}`;

    return {
        version: 'interactive-card/v0',
        id,
        kind: 'sku_combo_editor',
        title: cleanInteractiveCardText(input.title) || '确认 SKU 组合',
        description: cleanInteractiveCardText(input.description) || '确认或修改组合后继续生成 SKU。',
        payload,
        status: 'draft',
        submitAction: 'submitInteractiveCard',
        memoryPolicy: {
            enabled: true,
            mode: 'approved_recipe',
            scope: projectId ? { type: 'project', id: projectId } : { type: 'user' },
            reviewRequired: false
        }
    };
}

function formatSkuComboGroups(groups: SkuComboGroup[]): string {
    return groups
        .map((group) => `${group.size}双：${group.combos.map(stringifySkuCombo).join('，')}`)
        .join('；');
}

function normalizeConfirmedAt(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanInteractiveCardText(value);
    const parsed = text ? Date.parse(text) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export function buildSkuComboApprovedRecipeMemory(
    input: BuildSkuComboApprovedRecipeMemoryInput
): DesignMemoryItem {
    const validation = validateSkuComboEditorValue(input.card.payload, input.value);
    const value = validation.normalizedValue;
    const colorSlots = value.colorSlots || input.card.payload.colorSlots;
    const scope = input.scope || input.card.memoryPolicy?.scope || { type: 'user' as const };
    const confirmedAt = normalizeConfirmedAt(input.confirmedAt);
    const colorSummary = colorSlots
        .map((slot) => `${slot.slot}:${slot.label}`)
        .join('，');
    const comboSummary = formatSkuComboGroups(value.groups);
    const id = `sku-combo-recipe-${stableInteractiveCardHash({
        scope,
        colors: colorSlots.map((slot) => ({ slot: slot.slot, label: slot.label })),
        sizes: input.card.payload.requiredSizes,
        combos: value.groups
    })}`;

    return {
        id,
        kind: 'approved_recipe',
        scope,
        status: 'active',
        source: 'accepted_output',
        title: `SKU 组合配方：${input.card.payload.requiredSizes.join('、')}双装`,
        summary: [
            `颜色：${colorSummary}`,
            `组合：${comboSummary}`,
            value.generateSelfSelectNotes === false ? '不生成自选备注' : '生成自选备注'
        ].map(cleanInteractiveCardText).filter(Boolean).join('；'),
        sourceNotes: [{
            source: 'interactive-card-confirmation',
            summary: [
                `card=${input.card.id}`,
                `confirmed_by=${cleanInteractiveCardText(input.confirmedBy) || 'user'}`,
                `confirmed_at=${confirmedAt}`
            ].join('; '),
            status: 'active'
        }],
        tags: ['sku', 'sku-combo', 'interactive-card', 'approved-recipe'],
        appliesTo: ['recipe'],
        allowedUses: ['prompt_context', 'recipe_hint', 'user_reference'],
        sourceRank: 82,
        createdAt: confirmedAt,
        updatedAt: confirmedAt
    };
}
