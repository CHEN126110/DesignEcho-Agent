export type SkuDeliveryStatus = 'completed' | 'partial' | 'failed';

export interface SkuDeliveryComboGroup {
    size: number;
    comboCount: number;
    noteGenerated: boolean;
    noteSkipped: boolean;
    previewCombos: string[];
    hiddenComboCount: number;
}

export interface SkuDeliverySummary {
    version: 'sku-delivery-summary/v0';
    status: SkuDeliveryStatus;
    skuDocName: string;
    processedSizes: string[];
    totalCombos: number;
    noteCount: number;
    skippedNoteCount: number;
    exportCount: number;
    warningCount: number;
    comboGroups: SkuDeliveryComboGroup[];
    exportedFileNames: string[];
    warnings: string[];
    compactText: string;
    detailText: string;
    rawPayloadRedacted: true;
}

export interface BuildSkuDeliverySummaryInput {
    status: SkuDeliveryStatus;
    skuDocName?: string;
    processedSizes?: string[];
    completedCombosBySize?: Record<string, string[][]>;
    generatedNoteSizes?: Iterable<number>;
    skippedNoteSizes?: Iterable<number>;
    exportedFileNames?: string[];
    warnings?: string[];
    maxPreviewCombosPerSize?: number;
}

function toBasename(value: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.split(/[/\\]/).pop() || text;
}

function normalizeTextList(values: unknown[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeNumberSet(values: Iterable<number> | undefined): Set<number> {
    const result = new Set<number>();
    if (!values) return result;
    for (const value of values) {
        const numberValue = Number(value);
        if (Number.isFinite(numberValue)) {
            result.add(numberValue);
        }
    }
    return result;
}

function formatCombo(combo: string[]): string {
    const colors = normalizeTextList(combo);
    const counts = new Map<string, number>();
    for (const color of colors) {
        counts.set(color, (counts.get(color) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([color, count]) => count > 1 ? `${color}x${count}` : color)
        .join('+') || '未命名组合';
}

function formatCount(value: number, unit: string): string {
    return `${Math.max(0, value)}${unit}`;
}

function buildNoteText(noteCount: number, skippedNoteCount: number): string {
    const parts: string[] = [];
    if (noteCount > 0) parts.push(`${noteCount}个自选备注`);
    if (skippedNoteCount > 0) parts.push(`${skippedNoteCount}个自选备注已跳过`);
    return parts.length > 0 ? `，${parts.join('，')}` : '';
}

function buildCompactText(summary: {
    status: SkuDeliveryStatus;
    skuDocName: string;
    processedSizes: string[];
    totalCombos: number;
    noteCount: number;
    skippedNoteCount: number;
    exportCount: number;
    warningCount: number;
}): string {
    const statusLabel = summary.status === 'completed'
        ? 'SKU 已完成'
        : summary.status === 'partial'
            ? 'SKU 部分完成'
            : 'SKU 未完成';
    const sizeCount = summary.processedSizes.length;
    const lines = [
        `${statusLabel}：${formatCount(sizeCount, '个规格')}，${formatCount(summary.totalCombos, '个组合')}${buildNoteText(summary.noteCount, summary.skippedNoteCount)}，已导出${formatCount(summary.exportCount, '张')}。`
    ];
    if (summary.skuDocName) {
        lines.push(`素材：${summary.skuDocName}`);
    }
    if (summary.processedSizes.length > 0) {
        lines.push(`规格：${summary.processedSizes.join('、')}`);
    }
    if (summary.warningCount > 0) {
        lines.push(`注意：有${summary.warningCount}条问题需要复核。`);
    }
    lines.push(summary.exportCount > 0 ? '导出清单已收起，可展开查看。' : '未检测到导出文件。');
    return lines.join('\n');
}

function buildDetailText(input: {
    comboGroups: SkuDeliveryComboGroup[];
    exportedFileNames: string[];
    warnings: string[];
}): string {
    const sections: string[] = [];
    if (input.comboGroups.length > 0) {
        const comboLines = input.comboGroups.map((group) => {
            const lines = [`${group.size}双装（${group.comboCount}组）`];
            group.previewCombos.forEach((combo, index) => {
                lines.push(`${index + 1}. ${combo}`);
            });
            if (group.hiddenComboCount > 0) {
                lines.push(`另有 ${group.hiddenComboCount} 组已收起`);
            }
            if (group.noteGenerated) {
                lines.push('已生成自选备注');
            } else if (group.noteSkipped) {
                lines.push('已跳过自选备注');
            }
            return lines.join('\n');
        });
        sections.push(comboLines.join('\n\n'));
    }
    if (input.exportedFileNames.length > 0) {
        sections.push([
            `导出文件（${input.exportedFileNames.length}张）`,
            ...input.exportedFileNames.map((fileName) => `- ${fileName}`)
        ].join('\n'));
    }
    if (input.warnings.length > 0) {
        sections.push([
            `需要复核（${input.warnings.length}条）`,
            ...input.warnings.map((warning) => `- ${warning}`)
        ].join('\n'));
    }
    return sections.join('\n\n') || '暂无明细。';
}

export function buildSkuDeliverySummary(input: BuildSkuDeliverySummaryInput): SkuDeliverySummary {
    const processedSizes = normalizeTextList(input.processedSizes);
    const generatedNoteSizes = normalizeNumberSet(input.generatedNoteSizes);
    const skippedNoteSizes = normalizeNumberSet(input.skippedNoteSizes);
    const maxPreviewCombosPerSize = Math.max(1, Math.floor(input.maxPreviewCombosPerSize || 5));
    const completedCombosBySize = input.completedCombosBySize || {};
    const comboGroups = Object.entries(completedCombosBySize)
        .map(([sizeText, combos]) => {
            const size = Number(sizeText);
            const comboList = Array.isArray(combos) ? combos : [];
            const previewCombos = comboList.slice(0, maxPreviewCombosPerSize).map(formatCombo);
            return {
                size: Number.isFinite(size) ? size : 0,
                comboCount: comboList.length,
                noteGenerated: generatedNoteSizes.has(size),
                noteSkipped: skippedNoteSizes.has(size),
                previewCombos,
                hiddenComboCount: Math.max(0, comboList.length - previewCombos.length)
            } satisfies SkuDeliveryComboGroup;
        })
        .filter((group) => group.size > 0)
        .sort((a, b) => a.size - b.size);
    const exportedFileNames = normalizeTextList(input.exportedFileNames).map(toBasename).filter(Boolean);
    const warnings = normalizeTextList(input.warnings);
    const totalCombos = comboGroups.reduce((sum, group) => sum + group.comboCount, 0);
    const noteCount = generatedNoteSizes.size;
    const skippedNoteCount = skippedNoteSizes.size;
    const warningCount = warnings.length;
    const skuDocName = toBasename(input.skuDocName || '');
    const status = input.status;
    const compactText = buildCompactText({
        status,
        skuDocName,
        processedSizes,
        totalCombos,
        noteCount,
        skippedNoteCount,
        exportCount: exportedFileNames.length,
        warningCount
    });
    const detailText = buildDetailText({
        comboGroups,
        exportedFileNames,
        warnings
    });

    return {
        version: 'sku-delivery-summary/v0',
        status,
        skuDocName,
        processedSizes,
        totalCombos,
        noteCount,
        skippedNoteCount,
        exportCount: exportedFileNames.length,
        warningCount,
        comboGroups,
        exportedFileNames,
        warnings,
        compactText,
        detailText,
        rawPayloadRedacted: true
    };
}
