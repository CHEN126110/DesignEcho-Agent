export type SkuSelfSelectNoteDecision = {
    shouldGenerate: boolean;
    reason: 'requested' | 'not-requested' | 'single-pair-covered-by-sku';
    message: string;
};

export function decideSkuSelfSelectNoteGeneration(input: {
    comboSize: number;
    notesRequested: boolean;
    onlyNotes: boolean;
}): SkuSelfSelectNoteDecision {
    const comboSize = Number(input.comboSize);

    if (comboSize === 1) {
        return {
            shouldGenerate: false,
            reason: 'single-pair-covered-by-sku',
            message: '1双 SKU 已经按全部颜色逐个生成，不需要额外生成自选备注'
        };
    }

    if (input.notesRequested || input.onlyNotes) {
        return {
            shouldGenerate: true,
            reason: 'requested',
            message: '按用户要求生成自选备注'
        };
    }

    return {
        shouldGenerate: false,
        reason: 'not-requested',
        message: '用户没有要求生成自选备注'
    };
}
