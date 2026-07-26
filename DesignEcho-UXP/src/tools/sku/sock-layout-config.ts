/**
 * Unified configuration model for the legacy 6.0 sock layout workflow.
 *
 * This module is pure and intentionally has no Photoshop/UXP side effects.
 * The write path remains in skuLayout; this layer turns scattered ScriptUI
 * fields, CSV files, naming rules and quality settings into one execution plan.
 */

export type SockLayoutMode = 'combo' | 'self_select_note';

export interface SockLayoutProjectPaths {
    projectRoot?: string;
    cardAssetDir?: string;
    skuSourcePath?: string;
    templateDir?: string;
    configDir?: string;
    colorCsvPath?: string;
    outputDir?: string;
}

export interface SockColorConfigRow {
    rowNumber: number;
    slot: number;
    name: string;
    exValue?: string;
}

export interface SockLayoutCsvRow {
    rowNumber: number;
    templateFileName: string;
    templateName: string;
    size: number | null;
    mode: SockLayoutMode;
    rawColorExpression: string;
    regions: number[][];
}

export interface SockLayoutPlanItem {
    id: string;
    rowNumber: number;
    templateFileName: string;
    templateName: string;
    size: number | null;
    mode: SockLayoutMode;
    slotRegions: number[][];
    regions: string[][];
    colorNames: string[];
    outputRelativePath: string;
    outputFullPath?: string;
}

export interface SockLayoutQualityConfig {
    quality: number;
    autoAdjustQuality: boolean;
    targetSizeMb: number | null;
}

/**
 * 按模板聚合的执行分组。
 *
 * combos 是颜色名数组的数组，形状与 skuLayout.execute 的 combos 参数一致，
 * 因此本计划可以直接交给执行链批量生成，无需再做槽位编号映射。
 */
export interface SockLayoutTemplateGroup {
    templateFileName: string;
    templateName: string;
    mode: SockLayoutMode;
    size: number | null;
    matchedRealTemplate: boolean;
    combos: string[][];
    items: SockLayoutPlanItem[];
}

export type SockLayoutInputMode = 'combos' | 'csv';

export interface SockLayoutExecutionPlan {
    schema: 'sock-layout-execution-plan/v0';
    status: 'ready' | 'blocked';
    inputMode: SockLayoutInputMode;
    paths: SockLayoutProjectPaths;
    outputPattern: string;
    quality: SockLayoutQualityConfig;
    colorRows: SockColorConfigRow[];
    layoutRows: SockLayoutCsvRow[];
    items: SockLayoutPlanItem[];
    templateGroups: SockLayoutTemplateGroup[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        readOnly: true;
        writesPhotoshop: false;
        writesProjectOutputDir: false;
        claimsSkuCompletion: false;
        claimsDesignQuality: false;
    };
}

export interface BuildSockLayoutExecutionPlanInput {
    projectRoot?: string;
    paths?: Partial<SockLayoutProjectPaths>;
    /**
     * 组合优先输入：每行一组颜色（颜色名用 + / | / 、 / 空格 分隔）。
     * 传入后走"只填颜色组合"路径，颜色数自动匹配 N双装 模板，不再需要槽位编号。
     */
    comboText?: string;
    /** 预解析的颜色组合，优先级高于 comboText，便于程序化调用。 */
    combos?: string[][];
    /**
     * 可选：全局模板覆盖（模板文件名或名称）。
     * 留空则按每组颜色数自动匹配 N双装；填入"自选备注"类模板名时全部按备注模式处理。
     */
    templateName?: string;
    /** 可选：项目模板目录里实际存在的模板文件名，用于精确匹配并对缺失模板给出提醒。 */
    availableTemplates?: string[];
    layoutCsvText?: string;
    colorCsvText?: string;
    outputPattern?: string;
    quality?: number;
    autoAdjustQuality?: boolean;
    targetSizeMb?: number;
}

const DEFAULT_OUTPUT_PATTERN = '%模板%/%文件序号%%素材%';

const READY_BOUNDARIES: SockLayoutExecutionPlan['boundaries'] = {
    readOnly: true,
    writesPhotoshop: false,
    writesProjectOutputDir: false,
    claimsSkuCompletion: false,
    claimsDesignQuality: false
};

function stripBom(input: string): string {
    return String(input || '').replace(/^\uFEFF/, '');
}

function normalizePath(input: string): string {
    return String(input || '')
        .trim()
        .replace(/^file:\/+/i, '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
}

function joinPath(...parts: Array<string | undefined>): string {
    return parts
        .filter((part): part is string => Boolean(part && String(part).trim()))
        .map((part, index) => {
            const normalized = normalizePath(part);
            if (index === 0) return normalized.replace(/\/$/, '');
            return normalized.replace(/^\/+|\/+$/g, '');
        })
        .filter(Boolean)
        .join('/');
}

function stripExtension(fileName: string): string {
    return String(fileName || '').trim().replace(/\.[^.]+$/, '');
}

function getPathBaseName(input: string): string {
    const normalized = normalizePath(input);
    return normalized.split('/').filter(Boolean).pop() || normalized;
}

function getPathDirName(input: string): string {
    const parts = normalizePath(input).split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (char === ',' && !quoted) {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }

    cells.push(current.trim());
    return cells;
}

function parseCsvTable(text: string): { headers: string[]; rows: Array<{ rowNumber: number; cells: string[]; row: Record<string, string> }> } {
    const lines = stripBom(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return { headers: [], rows: [] };
    }

    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map((line, index) => {
        const cells = parseCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, cellIndex) => {
            row[header] = cells[cellIndex] || '';
        });
        return {
            rowNumber: index + 2,
            cells,
            row
        };
    });

    return { headers, rows };
}

function hasHeader(headers: string[], expected: string): boolean {
    return headers.some((header) => header.trim() === expected);
}

function normalizeSlotExpression(input: string): string {
    return String(input || '')
        .trim()
        .replace(/｜/g, '|')
        .replace(/＋/g, '+')
        .replace(/[，、；;,]/g, '+')
        .replace(/\s+/g, '+');
}

function parseOrderedColorSlotSequence(expression: string): number[] {
    const normalized = normalizeSlotExpression(expression);
    if (!normalized) return [];

    const parts = /[+|]/.test(normalized)
        ? normalized.split(/[+|]+/)
        : /^\d+$/.test(normalized)
            ? normalized.split('')
            : [normalized];

    return parts
        .map((part) => Number(String(part || '').trim()))
        .filter((slot) => Number.isFinite(slot) && slot > 0)
        .map((slot) => Math.round(slot));
}

function parseColorSlotRegions(expression: string): number[][] {
    const sequence = parseOrderedColorSlotSequence(expression);
    return sequence.length > 0 ? [sequence] : [];
}

function extractSockSize(templateFileName: string): number | null {
    const match = String(templateFileName || '').match(/(\d{1,2})\s*双/);
    const size = match ? Number(match[1]) : NaN;
    return Number.isFinite(size) && size > 0 ? Math.round(size) : null;
}

function classifyTemplateMode(templateFileName: string): SockLayoutMode {
    return /自选备注/.test(String(templateFileName || '')) ? 'self_select_note' : 'combo';
}

function sanitizeOutputSegment(input: string): string {
    return String(input || '')
        .replace(/[<>:"\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeOutputRelativePath(input: string): string {
    const normalized = String(input || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((segment) => sanitizeOutputSegment(segment))
        .filter(Boolean)
        .join('/');
    return normalized || '未命名';
}

function flattenRegions(regions: string[][]): string[] {
    const output: string[] = [];
    for (const region of regions) {
        output.push(...region);
    }
    return output;
}

function getQualityConfig(input: BuildSockLayoutExecutionPlanInput): SockLayoutQualityConfig {
    const rawQuality = Number(input.quality);
    const quality = Number.isFinite(rawQuality)
        ? Math.max(1, Math.min(12, Math.round(rawQuality)))
        : 12;

    const rawTargetSize = Number(input.targetSizeMb);
    const targetSizeMb = Number.isFinite(rawTargetSize) && rawTargetSize > 0
        ? rawTargetSize
        : null;

    return {
        quality,
        autoAdjustQuality: input.autoAdjustQuality === true,
        targetSizeMb
    };
}

export function inferSockLayoutProjectPaths(projectRoot?: string, overrides: Partial<SockLayoutProjectPaths> = {}): SockLayoutProjectPaths {
    const root = projectRoot ? normalizePath(projectRoot) : normalizePath(overrides.projectRoot || '');
    const configDir = overrides.configDir
        ? normalizePath(overrides.configDir)
        : root
            ? joinPath(root, '配置文件')
            : undefined;

    return {
        projectRoot: root || undefined,
        cardAssetDir: overrides.cardAssetDir
            ? normalizePath(overrides.cardAssetDir)
            : root
                ? joinPath(root, '卡片素材')
                : undefined,
        skuSourcePath: overrides.skuSourcePath
            ? normalizePath(overrides.skuSourcePath)
            : root
                ? joinPath(root, 'PSD', 'SKU.psb')
                : undefined,
        templateDir: overrides.templateDir
            ? normalizePath(overrides.templateDir)
            : root
                ? joinPath(root, '模板文件')
                : undefined,
        configDir,
        colorCsvPath: overrides.colorCsvPath
            ? normalizePath(overrides.colorCsvPath)
            : configDir
                ? joinPath(configDir, '颜色配置.csv')
                : undefined,
        outputDir: overrides.outputDir
            ? normalizePath(overrides.outputDir)
            : root
                ? joinPath(root, 'SKU')
                : undefined
    };
}

export function parseSockColorCsv(text: string): SockColorConfigRow[] {
    const table = parseCsvTable(text);
    if (table.headers.length === 0) return [];

    const hasColorHeader = hasHeader(table.headers, '颜色');
    const hasSlotHeader = hasHeader(table.headers, '编号');
    const hasExValueHeader = hasHeader(table.headers, 'exValue');

    const sourceRows = hasColorHeader
        ? table.rows
        : [
            {
                rowNumber: 1,
                cells: table.headers,
                row: {} as Record<string, string>
            },
            ...table.rows
        ];

    return sourceRows
        .map((entry, index) => {
            const name = hasColorHeader
                ? String(entry.row['颜色'] || '').trim()
                : String(entry.cells[0] || '').trim();
            const slotRaw = hasSlotHeader ? Number(entry.row['编号']) : index + 1;
            const slot = Number.isFinite(slotRaw) && slotRaw > 0 ? Math.round(slotRaw) : index + 1;
            const exValue = hasExValueHeader
                ? String(entry.row['exValue'] || '').trim()
                : String(entry.cells[1] || '').trim();

            return {
                rowNumber: entry.rowNumber,
                slot,
                name,
                exValue: exValue || undefined
            };
        })
        .filter((row) => row.name);
}

export function parseSockLayoutCsv(text: string): SockLayoutCsvRow[] {
    const table = parseCsvTable(text);
    if (!hasHeader(table.headers, '模板') || !hasHeader(table.headers, '配色')) {
        return [];
    }

    return table.rows
        .map((entry) => {
            const templateFileName = String(entry.row['模板'] || '').trim();
            const rawColorExpression = String(entry.row['配色'] || '').trim();
            return {
                rowNumber: entry.rowNumber,
                templateFileName,
                templateName: stripExtension(templateFileName),
                size: extractSockSize(templateFileName),
                mode: classifyTemplateMode(templateFileName),
                rawColorExpression,
                regions: parseColorSlotRegions(rawColorExpression)
            };
        })
        .filter((row) => row.templateFileName && row.regions.length > 0);
}

function parseColorComboLine(line: string): string[] {
    const normalized = String(line || '')
        .trim()
        .replace(/｜/g, '|')
        .replace(/＋/g, '+')
        .replace(/[，、；;,]/g, '+')
        .replace(/\s+/g, '+');
    if (!normalized) return [];
    return normalized
        .split(/[+|]+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * 解析组合优先输入：每行一组颜色，返回颜色名数组的数组。
 * 与槽位表达式不同，颜色名不做"123→[1,2,3]"的拆分，只按分隔符切分。
 */
export function parseSockColorCombos(text: string): string[][] {
    return stripBom(text)
        .split(/\r?\n/)
        .flatMap((line) => splitComboSegmentsFromLine(line))
        .map((seg) => parseColorComboLine(seg))
        .filter((combo) => combo.length > 0);
}

/** 单组合最大颜色数（超过判定为解析错乱，如把整段规格文本当成一个组合）。 */
const MAX_COLORS_PER_COMBO = 8;

/**
 * 把一行拆成多个组合段：真机上用户常把整段确认文本一行传入
 * （"2双装：双层边+木耳边 / 水晶丝+花苞；3双装：..."），旧 parseColorComboLine 不切
 * "/"、不切规格分号、也不剥"N双装："表头，导致整段塌成一个 ~57 色的组合。
 * 这里先按"/"与规格分隔（；;）切段，再逐段剥掉"N双(装)?：/:"表头。
 */
function splitComboSegmentsFromLine(line: string): string[] {
    const raw = String(line || '').trim();
    if (!raw) return [];
    // 组合之间的分隔：斜杠与分号（规格分段）。组合内部颜色用「+」连接，不受此切分影响。
    return raw
        .split(/[／/；;]+/)
        .map((seg) => seg.replace(/^\s*\d+\s*双装?\s*[:：]?\s*/, '').trim())
        .filter(Boolean);
}

/**
 * 带校验的组合解析：解析后逐组合检查规模合理性（2..MAX），
 * 任一组合超上限（很可能是整段文本被当成一个组合的错乱）即返回错误 + 期望格式示例，
 * 不静默产出垃圾组合（真机曾解析出 size=57 还报成功）。
 */
export function parseSockColorCombosValidated(
    text: string
): { combos: string[][]; error?: string } {
    const combos = parseSockColorCombos(text);
    const formatHint = '正确格式：每行（或用「/」分隔）一个组合，颜色名用「+」连接，如「双层边+木耳边 / 水晶丝+花苞」；可带「2双装：」表头。';
    if (combos.length === 0) {
        return { combos: [], error: `未能从输入解析出任何 SKU 组合。${formatHint}` };
    }
    const oversized = combos.find((c) => c.length > MAX_COLORS_PER_COMBO);
    if (oversized) {
        return {
            combos: [],
            error: `解析出的某个组合含 ${oversized.length} 个颜色，超过单组合上限 ${MAX_COLORS_PER_COMBO}——通常是整段规格文本被误当成一个组合。${formatHint}`
        };
    }
    return { combos };
}

function isNoteTemplateName(name: string): boolean {
    return /自选备注/.test(String(name || ''));
}

function countMatchesTemplateName(name: string, count: number): boolean {
    return new RegExp(`(^|[^0-9])${count}\\s*双`).test(String(name || ''));
}

function findRealTemplateByCount(availableTemplates: string[] | undefined, count: number, wantNote: boolean): string | null {
    const list = Array.isArray(availableTemplates) ? availableTemplates : [];
    const candidate = list.find((name) => countMatchesTemplateName(name, count) && isNoteTemplateName(name) === wantNote);
    return candidate || null;
}

interface ResolvedTemplate {
    templateFileName: string;
    templateName: string;
    size: number | null;
    mode: SockLayoutMode;
    matchedRealTemplate: boolean;
}

function resolveTemplateForCombo(combo: string[], input: BuildSockLayoutExecutionPlanInput): ResolvedTemplate {
    const override = String(input.templateName || '').trim();
    if (override) {
        // override 命中真实模板文件时回填真实文件名（含扩展名）：
        // 执行层要按真实文件名从模板目录打开文档，约定名「4双自选备注」是打不开文件的。
        const availableTemplates = Array.isArray(input.availableTemplates) ? input.availableTemplates : [];
        const realOverride = availableTemplates.find((name) => name === override)
            || availableTemplates.find((name) => stripExtension(name) === stripExtension(override))
            || null;
        const templateFileName = realOverride || override;
        return {
            templateFileName,
            templateName: stripExtension(templateFileName),
            size: extractSockSize(override),
            mode: classifyTemplateMode(override),
            matchedRealTemplate: Boolean(realOverride)
        };
    }

    const count = combo.length;
    const real = findRealTemplateByCount(input.availableTemplates, count, false);
    const templateFileName = real || `${count}双装`;
    return {
        templateFileName,
        templateName: stripExtension(templateFileName),
        size: count,
        mode: 'combo',
        matchedRealTemplate: Boolean(real)
    };
}

interface ResolvedLayoutItem {
    rowNumber: number;
    templateFileName: string;
    templateName: string;
    size: number | null;
    mode: SockLayoutMode;
    slotRegions: number[][];
    regions: string[][];
    colorNames: string[];
}

/**
 * 共享的执行条目收口：按模板分配文件序号、套用命名模板、推断输出全路径。
 * CSV 路径与组合优先路径都经过这里，保证输出命名规则唯一。
 */
function finalizeSockLayoutItems(
    resolvedItems: ResolvedLayoutItem[],
    paths: SockLayoutProjectPaths,
    outputPattern: string
): SockLayoutPlanItem[] {
    const fileSequenceByTemplate = new Map<string, number>();
    const items: SockLayoutPlanItem[] = [];

    for (const resolved of resolvedItems) {
        if (resolved.colorNames.length === 0) continue;

        const currentSequence = (fileSequenceByTemplate.get(resolved.templateName) || 0) + 1;
        fileSequenceByTemplate.set(resolved.templateName, currentSequence);

        const materialName = resolved.colorNames.join('+');
        const outputBase = formatSockLayoutOutputPath(outputPattern, {
            模板: resolved.templateName,
            素材: materialName,
            素材目录: paths.skuSourcePath ? getPathBaseName(getPathDirName(paths.skuSourcePath)) : '',
            模板目录: paths.templateDir ? getPathBaseName(paths.templateDir) : '',
            模板ID: resolved.rowNumber,
            文件序号: currentSequence
        });

        const outputRelativePath = `${outputBase}.jpg`;
        const outputFullPath = paths.outputDir ? joinPath(paths.outputDir, outputRelativePath) : undefined;

        items.push({
            id: `sock-layout-row-${resolved.rowNumber}`,
            rowNumber: resolved.rowNumber,
            templateFileName: resolved.templateFileName,
            templateName: resolved.templateName,
            size: resolved.size,
            mode: resolved.mode,
            slotRegions: resolved.slotRegions.map((region) => [...region]),
            regions: resolved.regions.map((region) => [...region]),
            colorNames: resolved.colorNames,
            outputRelativePath,
            outputFullPath
        });
    }

    return items;
}

function buildTemplateGroups(
    items: SockLayoutPlanItem[],
    isMatchedTemplate?: (templateFileName: string) => boolean
): SockLayoutTemplateGroup[] {
    const groups = new Map<string, SockLayoutTemplateGroup>();

    for (const item of items) {
        const key = `${item.mode}::${item.templateName}`;
        const existing = groups.get(key);
        if (existing) {
            existing.combos.push([...item.colorNames]);
            existing.items.push(item);
            continue;
        }
        groups.set(key, {
            templateFileName: item.templateFileName,
            templateName: item.templateName,
            mode: item.mode,
            size: item.size,
            matchedRealTemplate: isMatchedTemplate ? isMatchedTemplate(item.templateFileName) : true,
            combos: [[...item.colorNames]],
            items: [item]
        });
    }

    return Array.from(groups.values());
}

function deriveColorRowsFromCombos(combos: string[][]): SockColorConfigRow[] {
    const rows: SockColorConfigRow[] = [];
    const seen = new Set<string>();
    for (const combo of combos) {
        for (const name of combo) {
            const trimmed = String(name || '').trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            rows.push({
                rowNumber: rows.length + 1,
                slot: rows.length + 1,
                name: trimmed
            });
        }
    }
    return rows;
}

export function formatSockLayoutOutputPath(pattern: string, values: Record<string, string | number>): string {
    let output = String(pattern || DEFAULT_OUTPUT_PATTERN);
    for (const [key, value] of Object.entries(values)) {
        output = output.replace(new RegExp(`%${key}%`, 'g'), String(value));
    }
    return normalizeOutputRelativePath(output);
}

/**
 * 统一入口：
 * - 传入 comboText / combos → 组合优先路径（"只填颜色组合"，颜色数自动匹配模板）
 * - 否则回退到 6.0 双 CSV（排版 CSV + 颜色 CSV）兼容路径
 */
export function buildSockLayoutExecutionPlan(input: BuildSockLayoutExecutionPlanInput): SockLayoutExecutionPlan {
    const useCombos = input.comboText !== undefined || Array.isArray(input.combos);
    return useCombos ? buildSockLayoutPlanFromCombos(input) : buildSockLayoutPlanFromCsv(input);
}

function buildSockLayoutPlanFromCsv(input: BuildSockLayoutExecutionPlanInput): SockLayoutExecutionPlan {
    const paths = inferSockLayoutProjectPaths(input.projectRoot, input.paths || {});
    const outputPattern = String(input.outputPattern || DEFAULT_OUTPUT_PATTERN).trim() || DEFAULT_OUTPUT_PATTERN;
    const quality = getQualityConfig(input);
    const colorRows = parseSockColorCsv(input.colorCsvText || '');
    const layoutRows = parseSockLayoutCsv(input.layoutCsvText || '');
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!input.layoutCsvText || layoutRows.length === 0) {
        blockers.push('未读取到有效排版配置：CSV 必须包含「模板」和「配色」列。');
    }
    if (!input.colorCsvText || colorRows.length === 0) {
        blockers.push('未读取到有效颜色配置：CSV 至少需要颜色名称，建议包含「颜色,exValue,编号」列。');
    }
    if (quality.autoAdjustQuality && !quality.targetSizeMb) {
        blockers.push('已启用自动调整质量，但目标大小 targetSizeMb 不是大于 0 的数字。');
    }

    const colorsBySlot = new Map<number, SockColorConfigRow>();
    for (const color of colorRows) {
        if (colorsBySlot.has(color.slot)) {
            warnings.push(`颜色槽位 ${color.slot} 重复，已使用后出现的「${color.name}」。`);
        }
        colorsBySlot.set(color.slot, color);
    }

    const resolvedItems: ResolvedLayoutItem[] = [];
    for (const row of layoutRows) {
        const mappedRegions: string[][] = [];
        for (const region of row.regions) {
            const mappedRegion: string[] = [];
            for (const slot of region) {
                const color = colorsBySlot.get(slot);
                if (!color) {
                    blockers.push(`第 ${row.rowNumber} 行「${row.templateFileName}」引用了不存在的颜色槽位 ${slot}。`);
                    continue;
                }
                mappedRegion.push(color.name);
            }
            if (mappedRegion.length > 0) {
                mappedRegions.push(mappedRegion);
            }
        }

        const colorNames = flattenRegions(mappedRegions);
        if (colorNames.length === 0) continue;

        resolvedItems.push({
            rowNumber: row.rowNumber,
            templateFileName: row.templateFileName,
            templateName: row.templateName,
            size: row.size,
            mode: row.mode,
            slotRegions: row.regions,
            regions: mappedRegions,
            colorNames
        });
    }

    const items = finalizeSockLayoutItems(resolvedItems, paths, outputPattern);

    return {
        schema: 'sock-layout-execution-plan/v0',
        status: blockers.length > 0 ? 'blocked' : 'ready',
        inputMode: 'csv',
        paths,
        outputPattern,
        quality,
        colorRows,
        layoutRows,
        items,
        templateGroups: buildTemplateGroups(items),
        blockers,
        warnings,
        boundaries: READY_BOUNDARIES
    };
}

function buildSockLayoutPlanFromCombos(input: BuildSockLayoutExecutionPlanInput): SockLayoutExecutionPlan {
    const paths = inferSockLayoutProjectPaths(input.projectRoot, input.paths || {});
    const outputPattern = String(input.outputPattern || DEFAULT_OUTPUT_PATTERN).trim() || DEFAULT_OUTPUT_PATTERN;
    const quality = getQualityConfig(input);

    const combos = Array.isArray(input.combos) && input.combos.length > 0
        ? input.combos
            .map((combo) => (Array.isArray(combo) ? combo.map((name) => String(name || '').trim()).filter(Boolean) : []))
            .filter((combo) => combo.length > 0)
        : parseSockColorCombos(input.comboText || '');

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (combos.length === 0) {
        blockers.push('未填写颜色组合：请每行填写一组颜色，用 + 分隔，例如「白色+奶白+蓝色」。');
    }
    // 单组合颜色数上限与 parseSockColorCombosValidated 同一条线：超限几乎必是
    // 整段规格文本塌成一个组合的错乱，buildPlan 必须给 blocker 而不是静默产出垃圾计划。
    const oversizedCombo = combos.find((combo) => combo.length > MAX_COLORS_PER_COMBO);
    if (oversizedCombo) {
        blockers.push(`某个组合含 ${oversizedCombo.length} 个颜色，超过单组合上限 ${MAX_COLORS_PER_COMBO}——通常是整段规格文本被误当成一个组合。请每行（或用「/」分隔）填写一个组合，颜色名用「+」连接。`);
    }

    // 重复组合提醒：相同组合输出文件同名，执行链只会保留一份（执行层去重），提前告知而不是静默。
    const comboKeyCounts = new Map<string, number>();
    for (const combo of combos) {
        const key = combo.join('+');
        comboKeyCounts.set(key, (comboKeyCounts.get(key) || 0) + 1);
    }
    for (const [key, count] of comboKeyCounts) {
        if (count > 1) {
            warnings.push(`组合「${key}」重复填写 ${count} 次：输出文件同名，执行时会自动去重，只导出一份。`);
        }
    }
    if (quality.autoAdjustQuality && !quality.targetSizeMb) {
        blockers.push('已启用自动调整质量，但目标大小 targetSizeMb 不是大于 0 的数字。');
    }

    const resolved = combos.map((combo, index) => ({
        combo,
        index,
        template: resolveTemplateForCombo(combo, input)
    }));

    const resolvedItems: ResolvedLayoutItem[] = resolved.map(({ combo, index, template }) => ({
        rowNumber: index + 1,
        templateFileName: template.templateFileName,
        templateName: template.templateName,
        size: template.size,
        mode: template.mode,
        slotRegions: [],
        regions: [[...combo]],
        colorNames: [...combo]
    }));

    const hasTemplateList = Array.isArray(input.availableTemplates) && input.availableTemplates.length > 0;
    const matchedTemplateFiles = new Set<string>();
    if (hasTemplateList) {
        const missing = new Set<string>();
        for (const { template } of resolved) {
            if (template.matchedRealTemplate) {
                matchedTemplateFiles.add(template.templateFileName);
            } else {
                missing.add(template.templateFileName);
            }
        }
        for (const name of missing) {
            warnings.push(`未在模板目录找到「${name}」，将按约定名占位；请确认模板文件是否存在。`);
        }
    }

    const items = finalizeSockLayoutItems(resolvedItems, paths, outputPattern);
    const layoutRows: SockLayoutCsvRow[] = resolvedItems.map((item) => ({
        rowNumber: item.rowNumber,
        templateFileName: item.templateFileName,
        templateName: item.templateName,
        size: item.size,
        mode: item.mode,
        rawColorExpression: item.colorNames.join('+'),
        regions: []
    }));

    return {
        schema: 'sock-layout-execution-plan/v0',
        status: blockers.length > 0 ? 'blocked' : 'ready',
        inputMode: 'combos',
        paths,
        outputPattern,
        quality,
        colorRows: deriveColorRowsFromCombos(combos),
        layoutRows,
        items,
        templateGroups: buildTemplateGroups(items, hasTemplateList ? (name) => matchedTemplateFiles.has(name) : undefined),
        blockers,
        warnings,
        boundaries: READY_BOUNDARIES
    };
}
