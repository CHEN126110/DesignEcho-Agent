import {
    buildSkuComboEditorInteractiveCard,
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboEditorValue,
    type SkuComboColorSlot
} from './sku-combo-interactive-card';
import { cleanInteractiveCardText } from './interactive-card-contract';

export type SkuComboConfirmationSource = 'algorithm' | 'project-config' | 'explicit';
export type SkuComboConfirmationStatus = 'pending_user_confirmation' | 'blocked_invalid_candidate';

export interface SkuComboConfirmationReview {
    version: 'sku-combo-confirmation-review/v0';
    status: SkuComboConfirmationStatus;
    source: SkuComboConfirmationSource;
    colorSlotCount: number;
    requiredSizes: number[];
    comboCount: number;
    summary: string;
    blockers: string[];
    warnings: string[];
}

export interface SkuComboConfirmationRequest {
    status: SkuComboConfirmationStatus;
    card?: SkuComboEditorCard;
    review: SkuComboConfirmationReview;
}

export interface BuildSkuComboConfirmationRequestInput {
    availableColors: string[];
    requiredSizes: number[];
    combosBySize: Record<number, string[][]>;
    generateSelfSelectNotes: boolean;
    source?: SkuComboConfirmationSource;
    projectId?: string;
    productType?: string;
    style?: string;
}

function normalizeColorKey(value: unknown): string {
    return cleanInteractiveCardText(value)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[._-]+/g, '');
}

function normalizePositiveInt(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function uniqueSortedSizes(value: unknown): number[] {
    const raw = Array.isArray(value) ? value : [];
    return Array.from(new Set(raw
        .map(normalizePositiveInt)
        .filter((item): item is number => item !== null)))
        .sort((a, b) => a - b);
}

export function buildSkuComboColorSlots(availableColors: string[]): SkuComboColorSlot[] {
    const labels = (Array.isArray(availableColors) ? availableColors : [])
        .map(cleanInteractiveCardText)
        .filter(Boolean);
    const parsedNumericSlots = labels.map((label) => (/^\d+$/.test(label) ? Number(label) : null));
    const numericSlots = parsedNumericSlots.every((slot): slot is number => slot !== null && Number.isInteger(slot) && slot > 0)
        ? parsedNumericSlots
        : [];
    const useNumericSlots = numericSlots.length > 0
        && new Set(numericSlots).size === numericSlots.length;

    return labels.map((label, index) => ({
        slot: useNumericSlots ? Number(numericSlots[index]) : index + 1,
        label
    }));
}

function buildColorSlotLookup(colorSlots: SkuComboColorSlot[]): Map<string, number> {
    const lookup = new Map<string, number>();
    for (const slot of colorSlots) {
        const aliases = [
            slot.label,
            String(slot.slot),
            `颜色${slot.slot}`,
            `色号${slot.slot}`,
            `编号${slot.slot}`
        ];
        for (const alias of aliases) {
            const key = normalizeColorKey(alias);
            if (key && !lookup.has(key)) lookup.set(key, slot.slot);
        }
    }
    return lookup;
}

function convertColorComboToSlotCombo(
    combo: string[],
    lookup: Map<string, number>
): { slots: number[]; dropped: string[] } {
    const slots: number[] = [];
    const dropped: string[] = [];
    for (const color of Array.isArray(combo) ? combo : []) {
        const key = normalizeColorKey(color);
        const slot = lookup.get(key);
        if (slot) {
            slots.push(slot);
        } else {
            dropped.push(cleanInteractiveCardText(color));
        }
    }
    return { slots, dropped };
}

function hasRepeatedSlot(combo: number[]): boolean {
    return new Set(combo).size < combo.length;
}

function formatGroupSummary(value: SkuComboEditorValue): string {
    return value.groups
        .map((group) => `${group.size}双 ${group.combos.length} 组`)
        .join('，');
}

export function buildSkuComboConfirmationRequest(
    input: BuildSkuComboConfirmationRequestInput
): SkuComboConfirmationRequest {
    const colorSlots = buildSkuComboColorSlots(input.availableColors);
    const lookup = buildColorSlotLookup(colorSlots);
    const requiredSizes = uniqueSortedSizes(input.requiredSizes);
    const droppedColors: string[] = [];
    const repeatedColorCombos: string[] = [];

    const initialValue: SkuComboEditorValue = {
        groups: requiredSizes.map((size) => {
            const rawCombos = Array.isArray(input.combosBySize?.[size]) ? input.combosBySize[size] : [];
            const combos = rawCombos
                .map((combo) => {
                    const converted = convertColorComboToSlotCombo(combo, lookup);
                    droppedColors.push(...converted.dropped);
                    if (hasRepeatedSlot(converted.slots)) {
                        repeatedColorCombos.push(converted.slots.join('+'));
                    }
                    return converted.slots;
                })
                .filter((combo) => combo.length > 0);
            return { size, combos };
        }),
        generateSelfSelectNotes: input.generateSelfSelectNotes !== false
    };

    const card = buildSkuComboEditorInteractiveCard({
        title: '确认 SKU 组合',
        description: '我先生成候选组合，请确认或修改后再继续出图。',
        colorSlots,
        requiredSizes,
        initialValue,
        projectId: input.projectId,
        productType: input.productType,
        style: input.style
    });
    const validation = validateSkuComboEditorValue(card.payload, initialValue);
    const warnings = [
        ...validation.warnings,
        ...Array.from(new Set(droppedColors)).map((color) => `候选组合里有无法匹配的颜色：${color}。`),
        repeatedColorCombos.length > 0
            ? `候选组合包含同色多双：${Array.from(new Set(repeatedColorCombos)).slice(0, 4).join('，')}，请确认是否符合运营需求。`
            : ''
    ].filter(Boolean);
    const status: SkuComboConfirmationStatus = validation.canSubmit
        ? 'pending_user_confirmation'
        : 'blocked_invalid_candidate';
    const review: SkuComboConfirmationReview = {
        version: 'sku-combo-confirmation-review/v0',
        status,
        source: input.source || 'algorithm',
        colorSlotCount: colorSlots.length,
        requiredSizes,
        comboCount: initialValue.groups.reduce((sum, group) => sum + group.combos.length, 0),
        summary: formatGroupSummary(initialValue),
        blockers: validation.blockers,
        warnings
    };

    return {
        status,
        card: validation.canSubmit ? card : undefined,
        review
    };
}
