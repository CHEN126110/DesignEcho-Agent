/**
 * SKU project CSV configured execution plan.
 *
 * This module is intentionally pure/shared: it parses project configuration
 * text and returns an execution plan only. It never reads files, calls
 * Photoshop, writes Eagle, or claims design quality.
 */

export type SkuConfiguredFileInput = {
    fileName: string;
    text?: string;
    base64?: string;
    encoding?: string;
};

export type SkuConfiguredTemplateInput = {
    fileName: string;
    filePath?: string;
};

export type SkuConfiguredExecutionPlanInput = {
    csvConfigs: SkuConfiguredFileInput[];
    comboTemplates?: SkuConfiguredTemplateInput[];
    noteTemplates?: SkuConfiguredTemplateInput[];
    availableColorNames?: string[];
    requestedSizes?: number[];
    validateColorAvailability?: boolean;
};

export type SkuConfiguredExecutionRow = {
    rowNumber: number;
    templateFileName: string;
    size: number;
    kind: 'combo' | 'self_select_note';
    colorSlots: number[];
    colorNames: string[];
};

export type SkuConfiguredExecutionSize = {
    size: number;
    comboTemplateFile: string | null;
    noteTemplateFile: string | null;
    comboRows: SkuConfiguredExecutionRow[];
    noteRows: SkuConfiguredExecutionRow[];
    blockers: string[];
};

export type SkuConfiguredExecutionPlan = {
    schema: 'sku-configured-execution-plan/v0';
    status: 'ready_configured_execution_plan' | 'blocked_configured_execution_plan';
    configFileName: string | null;
    encoding: string | null;
    expectedColorCount: number | null;
    colorSlotCount: number;
    availableColorCount: number;
    availableColorNames: string[];
    sizes: SkuConfiguredExecutionSize[];
    comboExecutionCount: number;
    noteExecutionCount: number;
    blockers: string[];
    warnings: string[];
    boundaries: {
        readOnly: true;
        writesPhotoshop: false;
        writesProjectDocuments: false;
        writesProjectOutputDir: false;
        claimsSkuCompletion: false;
        claimsDesignQuality: false;
    };
};

export type BuildSkuConfiguredExecutionBlockerMessageInput = {
    plan: SkuConfiguredExecutionPlan;
    skuDocName?: string | null;
    userRequestedExplicitCombos?: boolean;
    maxBlockers?: number;
};

type ParsedSkuConfigRow = {
    rowNumber: number;
    templateFileName: string;
    size: number;
    kind: 'combo' | 'self_select_note';
    colorSlots: number[];
};

type ParsedSkuConfigPlan = {
    status: 'ready_full_configured_plan' | 'blocked_config_incomplete' | 'blocked_missing_csv_config';
    configFileName: string | null;
    encoding: string | null;
    expectedColorCount: number | null;
    colorSlotCount: number;
    sizes: number[];
    comboRowsBySize: Record<string, ParsedSkuConfigRow[]>;
    noteRowsBySize: Record<string, ParsedSkuConfigRow[]>;
    blockers: string[];
    warnings: string[];
};

type ParsedCsvRows = ReturnType<typeof parseCsvRows>;

type SkuCsvConfigSelection = {
    config: SkuConfiguredFileInput | null;
    decoded?: { encoding: string | null; text: string };
    parsed?: ParsedCsvRows;
    blockers: string[];
    warnings: string[];
};

const READY_BOUNDARIES: SkuConfiguredExecutionPlan['boundaries'] = {
    readOnly: true,
    writesPhotoshop: false,
    writesProjectDocuments: false,
    writesProjectOutputDir: false,
    claimsSkuCompletion: false,
    claimsDesignQuality: false
};

function toByteArrayFromBase64(base64: string): Uint8Array {
    const text = String(base64 || '').trim();
    const maybeBuffer = (globalThis as any).Buffer;
    if (maybeBuffer?.from) {
        return new Uint8Array(maybeBuffer.from(text, 'base64'));
    }

    const atobFn = (globalThis as any).atob;
    if (typeof atobFn !== 'function') {
        return new Uint8Array();
    }
    const binary = atobFn(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function decodeSkuConfigInput(file: SkuConfiguredFileInput): { encoding: string | null; text: string } {
    if (typeof file.text === 'string') {
        return {
            encoding: file.encoding || 'provided-text',
            text: file.text
        };
    }

    if (!file.base64) {
        return { encoding: null, text: '' };
    }

    const bytes = toByteArrayFromBase64(file.base64);
    const candidates: Array<{ name: string; fatal: boolean }> = [
        { name: 'utf-8', fatal: true },
        { name: 'gb18030', fatal: false },
        { name: 'gbk', fatal: false }
    ];
    const decoded: Array<{ encoding: string; text: string }> = [];

    for (const candidate of candidates) {
        try {
            const decoder = new TextDecoder(candidate.name, { fatal: candidate.fatal });
            const text = decoder.decode(bytes);
            decoded.push({ encoding: candidate.name, text });
            if (!text.includes('\uFFFD')) {
                return { encoding: candidate.name, text };
            }
        } catch {
            // Try the next candidate; spreadsheet-exported CSV files can be GBK/GB18030.
        }
    }

    return decoded[0] || { encoding: 'unknown', text: '' };
}

export function parseSkuConfiguredCsvLine(line: string): string[] {
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

function parseCsvRows(text: string): { headers: string[]; rows: Array<{ rowNumber: number; row: Record<string, string> }> } {
    const lines = String(text || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = parseSkuConfiguredCsvLine(lines[0]).map((header) => header.trim());
    const rows = lines.slice(1).map((line, index) => {
        const cells = parseSkuConfiguredCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, cellIndex) => {
            row[header] = cells[cellIndex] || '';
        });
        return {
            rowNumber: index + 2,
            row
        };
    });

    return { headers, rows };
}

function normalizeFileNameKey(fileName: string): string {
    return String(fileName || '').trim().replace(/\s+/g, '').toLowerCase();
}

export function extractSkuSizeFromTemplateName(fileName: string): number | null {
    const match = String(fileName || '').match(/(\d{1,2})\s*双/);
    const size = match ? Number(match[1]) : NaN;
    return Number.isFinite(size) && size > 0 ? Math.round(size) : null;
}

export function extractSkuColorCountFromConfigName(fileName: string): number | null {
    const match = String(fileName || '').match(/(\d{1,2})\s*色/);
    const count = match ? Number(match[1]) : NaN;
    return Number.isFinite(count) && count > 0 ? Math.round(count) : null;
}

export function parseSkuColorSlots(value: string): number[] {
    const normalized = String(value || '')
        .trim()
        .replace(/｜/g, '|')
        .replace(/＋/g, '+')
        .replace(/[，、；;,]/g, '+')
        .replace(/\s+/g, '+');

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

function templateKindFromFileName(fileName: string): 'combo' | 'self_select_note' {
    return /自选备注/.test(String(fileName || '')) ? 'self_select_note' : 'combo';
}

function findTemplateForConfigRow(
    templateFileName: string,
    templates: SkuConfiguredTemplateInput[] | undefined
): SkuConfiguredTemplateInput | null {
    const list = Array.isArray(templates) ? templates : [];
    const wantedKey = normalizeFileNameKey(templateFileName);
    const exact = list.find((file) => normalizeFileNameKey(file.fileName) === wantedKey);
    if (exact) return exact;

    const wantedSize = extractSkuSizeFromTemplateName(templateFileName);
    if (!wantedSize) return null;
    const wantedNoteMode = templateKindFromFileName(templateFileName) === 'self_select_note';
    return list.find((file) => {
        const size = extractSkuSizeFromTemplateName(file.fileName);
        const noteMode = templateKindFromFileName(file.fileName) === 'self_select_note';
        return size === wantedSize && noteMode === wantedNoteMode;
    }) || null;
}

function groupRowsBySize(rows: ParsedSkuConfigRow[]): Record<string, ParsedSkuConfigRow[]> {
    const output: Record<string, ParsedSkuConfigRow[]> = {};
    for (const row of rows) {
        const key = String(row.size);
        if (!output[key]) output[key] = [];
        output[key].push(row);
    }
    return output;
}

function normalizeDisplayText(value: unknown): string {
    return String(value || '').trim();
}

function firstMeaningfulBlockers(values: unknown, maxItems: number): string[] {
    const limit = Math.max(1, Math.min(8, Math.floor(maxItems || 4)));
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        const text = normalizeDisplayText(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function hasRequiredSkuCsvHeaders(parsed: ParsedCsvRows): boolean {
    const headers = new Set(parsed.headers);
    return headers.has('模板') && headers.has('配色');
}

function countValidSkuConfigRows(parsed: ParsedCsvRows): { comboRows: number; noteRows: number; sizes: number[]; maxColorSlot: number } {
    let comboRows = 0;
    let noteRows = 0;
    let maxColorSlot = 0;
    const sizes = new Set<number>();

    for (const parsedRow of parsed.rows) {
        const templateFileName = String(parsedRow.row['模板'] || '').trim();
        const colorSlots = parseSkuColorSlots(parsedRow.row['配色']);
        const size = extractSkuSizeFromTemplateName(templateFileName);
        if (!templateFileName || !size || colorSlots.length === 0) continue;
        sizes.add(size);
        maxColorSlot = Math.max(maxColorSlot, ...colorSlots);
        if (templateKindFromFileName(templateFileName) === 'self_select_note') {
            noteRows += 1;
        } else {
            comboRows += 1;
        }
    }

    return {
        comboRows,
        noteRows,
        sizes: Array.from(sizes).sort((a, b) => a - b),
        maxColorSlot
    };
}

function scoreSkuCsvConfigCandidate(input: {
    fileName: string;
    parsed: ParsedCsvRows;
    requestedSizes: Set<number>;
}): number {
    const name = String(input.fileName || '');
    const rowStats = countValidSkuConfigRows(input.parsed);
    let score = 0;

    if (hasRequiredSkuCsvHeaders(input.parsed)) score += 100;
    if (rowStats.comboRows > 0) score += 40;
    if (rowStats.noteRows > 0) score += 20;
    if (extractSkuColorCountFromConfigName(name)) score += 15;
    if (/双/.test(name)) score += 15;
    if (/sku/i.test(name)) score += 5;
    if (/备份|副本|旧|old|backup|bak|copy/i.test(name)) score -= 60;

    score += Math.min(rowStats.comboRows, 20);
    score += Math.min(rowStats.noteRows, 8);

    if (input.requestedSizes.size > 0) {
        const matchedSizeCount = rowStats.sizes.filter((size) => input.requestedSizes.has(size)).length;
        score += matchedSizeCount * 10;
        if (matchedSizeCount === 0) score -= 40;
    }

    return score;
}

function selectCsvConfig(input: SkuConfiguredExecutionPlanInput): SkuCsvConfigSelection {
    const configs = (Array.isArray(input.csvConfigs) ? input.csvConfigs : [])
        .filter((file) => /\.csv$/i.test(String(file.fileName || '')));
    if (configs.length === 0) {
        return {
            config: null,
            blockers: ['项目配置文件夹中没有可用的 SKU CSV 配置文件。'],
            warnings: []
        };
    }

    const requestedSizes = new Set((input.requestedSizes || [])
        .map((size) => Number(size))
        .filter((size) => Number.isFinite(size) && size > 0)
        .map((size) => Math.round(size)));

    const candidates = configs.map((config) => {
        const decoded = decodeSkuConfigInput(config);
        const parsed = parseCsvRows(decoded.text);
        return {
            config,
            decoded,
            parsed,
            score: scoreSkuCsvConfigCandidate({
                fileName: config.fileName,
                parsed,
                requestedSizes
            })
        };
    }).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.config.fileName).localeCompare(String(b.config.fileName), 'zh-Hans-CN');
    });

    const best = candidates[0];
    const tiedBest = candidates.filter((candidate) => candidate.score === best.score);
    if (tiedBest.length > 1 && best.score >= 100) {
        return {
            config: null,
            blockers: [
                `多个 SKU CSV 配置匹配度相同，无法自动选择：${tiedBest.map((candidate) => candidate.config.fileName).join(' / ')}。`
            ],
            warnings: []
        };
    }

    return {
        config: best.config,
        decoded: best.decoded,
        parsed: best.parsed,
        blockers: [],
        warnings: configs.length > 1
            ? [`已选择 SKU CSV 配置 ${best.config.fileName}；已忽略另外 ${configs.length - 1} 个 CSV 文件。`]
            : []
    };
}

function buildParsedConfigPlan(input: SkuConfiguredExecutionPlanInput): ParsedSkuConfigPlan {
    const selection = selectCsvConfig(input);
    const config = selection.config;
    if (!config || !selection.decoded || !selection.parsed) {
        return {
            status: 'blocked_missing_csv_config',
            configFileName: null,
            encoding: null,
            expectedColorCount: null,
            colorSlotCount: 0,
            sizes: [],
            comboRowsBySize: {},
            noteRowsBySize: {},
            blockers: selection.blockers.length > 0 ? selection.blockers : ['项目配置文件夹中没有可用的 SKU CSV 配置文件。'],
            warnings: selection.warnings
        };
    }

    const blockers: string[] = [...selection.blockers];
    const warnings: string[] = [...selection.warnings];
    const decoded = selection.decoded;
    const parsed = selection.parsed;
    const headers = new Set(parsed.headers);

    if (!headers.has('模板') || !headers.has('配色')) {
        blockers.push(`CSV 配置 ${config.fileName} 必须包含“模板”和“配色”两列。`);
    }

    const comboRows: ParsedSkuConfigRow[] = [];
    const noteRows: ParsedSkuConfigRow[] = [];
    for (const parsedRow of parsed.rows) {
        const templateFileName = String(parsedRow.row['模板'] || '').trim();
        const colorSlots = parseSkuColorSlots(parsedRow.row['配色']);
        const size = extractSkuSizeFromTemplateName(templateFileName);
        const kind = templateKindFromFileName(templateFileName);
        if (!templateFileName || !size || colorSlots.length === 0) {
            blockers.push(`CSV 第 ${parsedRow.rowNumber} 行无效：缺少模板名称或配色槽位。`);
            continue;
        }
        const row: ParsedSkuConfigRow = {
            rowNumber: parsedRow.rowNumber,
            templateFileName,
            size,
            kind,
            colorSlots
        };
        if (kind === 'self_select_note') {
            noteRows.push(row);
        } else {
            comboRows.push(row);
        }
    }

    const sizes = Array.from(new Set([...comboRows, ...noteRows].map((row) => row.size))).sort((a, b) => a - b);
    const expectedColorCount = extractSkuColorCountFromConfigName(config.fileName);
    const colorSlotCount = Math.max(0, ...comboRows.flatMap((row) => row.colorSlots), ...noteRows.flatMap((row) => row.colorSlots));

    if (expectedColorCount && colorSlotCount > expectedColorCount) {
        blockers.push(`CSV 配置 ${config.fileName} 引用了第 ${colorSlotCount} 个颜色槽，超过文件名声明的 ${expectedColorCount} 色。`);
    }
    if (expectedColorCount && colorSlotCount < expectedColorCount) {
        warnings.push(`CSV 配置 ${config.fileName} 声明为 ${expectedColorCount} 色，但实际只引用到 ${colorSlotCount} 个颜色槽。`);
    }
    if (comboRows.length === 0) blockers.push(`CSV 配置 ${config.fileName} 没有组合图行。`);

    return {
        status: blockers.length === 0 ? 'ready_full_configured_plan' : 'blocked_config_incomplete',
        configFileName: config.fileName,
        encoding: decoded.encoding,
        expectedColorCount,
        colorSlotCount,
        sizes,
        comboRowsBySize: groupRowsBySize(comboRows),
        noteRowsBySize: groupRowsBySize(noteRows),
        blockers,
        warnings
    };
}

function mapConfigRowToExecution(
    row: ParsedSkuConfigRow,
    colorNames: string[],
    blockers: string[],
    options: { validateColorAvailability: boolean }
): SkuConfiguredExecutionRow {
    const mappedColorNames: string[] = [];
    for (const slot of row.colorSlots) {
        const colorName = colorNames[slot - 1];
        if (!colorName) {
            if (options.validateColorAvailability) {
                blockers.push(`CSV 第 ${row.rowNumber} 行引用了不存在的第 ${slot} 个颜色槽。`);
            }
            mappedColorNames.push(`color_slot_${slot}`);
        } else {
            mappedColorNames.push(colorName);
        }
    }

    return {
        rowNumber: row.rowNumber,
        templateFileName: row.templateFileName,
        size: row.size,
        kind: row.kind,
        colorSlots: [...row.colorSlots],
        colorNames: mappedColorNames
    };
}

export function buildSkuConfiguredExecutionPlan(input: SkuConfiguredExecutionPlanInput): SkuConfiguredExecutionPlan {
    const configPlan = buildParsedConfigPlan(input);
    const blockers: string[] = [...configPlan.blockers];
    const warnings: string[] = [...configPlan.warnings];
    const validateColorAvailability = input.validateColorAvailability !== false;
    const availableColorNames = (Array.isArray(input.availableColorNames) ? input.availableColorNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean);

    if (validateColorAvailability && availableColorNames.length < configPlan.colorSlotCount) {
        blockers.push(`SKU 素材只有 ${availableColorNames.length} 个可用颜色组，配置文件需要 ${configPlan.colorSlotCount} 个颜色槽。`);
    }

    const requestedSizes = new Set((input.requestedSizes || [])
        .map((size) => Number(size))
        .filter((size) => Number.isFinite(size) && size > 0)
        .map((size) => Math.round(size)));
    const targetSizes = configPlan.sizes
        .filter((size) => requestedSizes.size === 0 || requestedSizes.has(size));

    if (requestedSizes.size > 0 && targetSizes.length === 0) {
        blockers.push(`CSV 配置 ${configPlan.configFileName || ''} 没有用户请求的 SKU 规格：${Array.from(requestedSizes).join(' / ')}。`);
    }

    const sizes = targetSizes.map((size) => {
        const comboConfigRows = configPlan.comboRowsBySize[String(size)] || [];
        const noteConfigRows = configPlan.noteRowsBySize[String(size)] || [];
        const comboTemplate = findTemplateForConfigRow(comboConfigRows[0]?.templateFileName || `${size}双装`, input.comboTemplates);
        const noteTemplate = findTemplateForConfigRow(noteConfigRows[0]?.templateFileName || `${size}双自选备注`, input.noteTemplates);
        const sizeBlockers: string[] = [];

        if (comboConfigRows.length > 0 && !comboTemplate?.fileName) {
            sizeBlockers.push(`缺少 ${size}双组合图模板，无法按配置执行。`);
        }
        if (noteConfigRows.length === 0) {
            sizeBlockers.push(`CSV 配置没有 ${size}双自选备注行。`);
        }
        if (noteConfigRows.length > 0 && !noteTemplate?.fileName) {
            sizeBlockers.push(`缺少 ${size}双自选备注模板，无法按配置执行。`);
        }

        blockers.push(...sizeBlockers);
        const comboRows = comboConfigRows.map((row) => mapConfigRowToExecution(row, availableColorNames, blockers, {
            validateColorAvailability
        }));
        const noteRows = noteConfigRows.map((row) => mapConfigRowToExecution(row, availableColorNames, blockers, {
            validateColorAvailability
        }));

        return {
            size,
            comboTemplateFile: comboTemplate?.fileName || null,
            noteTemplateFile: noteTemplate?.fileName || null,
            comboRows,
            noteRows,
            blockers: sizeBlockers
        };
    });

    const comboExecutionCount = sizes.reduce((total, item) => total + item.comboRows.length, 0);
    const noteExecutionCount = sizes.reduce((total, item) => total + item.noteRows.length, 0);

    return {
        schema: 'sku-configured-execution-plan/v0',
        status: blockers.length === 0 ? 'ready_configured_execution_plan' : 'blocked_configured_execution_plan',
        configFileName: configPlan.configFileName,
        encoding: configPlan.encoding,
        expectedColorCount: configPlan.expectedColorCount,
        colorSlotCount: configPlan.colorSlotCount,
        availableColorCount: availableColorNames.length,
        availableColorNames,
        sizes,
        comboExecutionCount,
        noteExecutionCount,
        blockers,
        warnings,
        boundaries: READY_BOUNDARIES
    };
}

export function buildSkuConfiguredExecutionBlockerMessage(
    input: BuildSkuConfiguredExecutionBlockerMessageInput
): string {
    const plan = input.plan;
    const skuDocName = normalizeDisplayText(input.skuDocName) || '当前 SKU 素材';
    const configName = normalizeDisplayText(plan.configFileName) || '项目 SKU 配置';
    const blockers = firstMeaningfulBlockers(plan.blockers, input.maxBlockers || 5);
    const hiddenBlockerCount = Math.max(0, (Array.isArray(plan.blockers) ? plan.blockers.length : 0) - blockers.length);
    const colorMismatch = typeof plan.availableColorCount === 'number'
        && typeof plan.colorSlotCount === 'number'
        && plan.colorSlotCount > plan.availableColorCount;
    const lines = [
        `SKU 暂时没有开始生成：项目配置「${configName}」和素材「${skuDocName}」还没有对齐。`,
        '',
        '当前需要先处理：',
        ...(blockers.length > 0 ? blockers.map((blocker) => `- ${blocker}`) : ['- 项目 SKU 配置暂不能直接执行。'])
    ];

    if (hiddenBlockerCount > 0) {
        lines.push(`- 还有 ${hiddenBlockerCount} 个同类配置问题已收起。`);
    }

    const recovery: string[] = [];
    if (colorMismatch) {
        const nextSlot = plan.availableColorCount + 1;
        recovery.push(`补齐第 ${nextSlot} 个颜色组，或换成只引用现有 ${plan.availableColorCount} 色的 SKU CSV。`);
    }
    recovery.push('也可以改为显式指定颜色组合；明确组合后先校验，再进入受控执行。');

    lines.push('', '可处理方式：', ...recovery.map((item) => `- ${item}`));

    if (input.userRequestedExplicitCombos) {
        lines.push('', '已提供明确组合时，优先按明确组合校验；这里的阻断只针对默认项目配置。');
    }

    return lines.join('\n');
}
