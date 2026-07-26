import type { EagleLibraryAssetRole, EagleLibraryFileKind } from './eagle-library';

/**
 * EagleAssetRef —— 面向模型的「不透明素材引用」。
 *
 * 设计目标（P0 安全与契约）：Agent / 模型永远只看到 `libraryId:itemId` 这类不透明句柄
 * 与安全的展示元数据，绝不接收 Eagle 素材的本地文件系统路径。真实源文件路径只保留在
 * 主进程解析层（`eagle-library-service.resolveAssetSource`），供「素材置入」等能力按需解析，
 * 不进入任何模型提示词。
 *
 * 这是把此前散落在 `${libraryId}:${itemId}` 修订键（ChatPanel）中的隐式引用形式化为
 * 单一类型来源，避免各处各自拼接、并杜绝裸路径泄漏。
 */
export const EAGLE_ASSET_REF_VERSION = 'eagle-asset-ref/v0' as const;

export interface EagleAssetRef {
    schemaVersion: typeof EAGLE_ASSET_REF_VERSION;
    /** 稳定库标识（主进程按 canonical path 哈希得到，不可反推路径） */
    libraryId: string;
    libraryName: string;
    /** Eagle item id */
    itemId: string;
    name: string;
    ext: string;
    fileKind: EagleLibraryFileKind;
    role: EagleLibraryAssetRole;
    tags: string[];
    folderPaths: string[];
    width?: number;
    height?: number;
    selectedAt: string;
}

export interface EagleAssetRefInput {
    libraryId?: unknown;
    libraryName?: unknown;
    itemId?: unknown;
    name?: unknown;
    ext?: unknown;
    fileKind?: EagleLibraryFileKind;
    role?: EagleLibraryAssetRole;
    tags?: unknown;
    folderPaths?: unknown;
    width?: unknown;
    height?: unknown;
    selectedAt?: unknown;
}

const FILE_KINDS: EagleLibraryFileKind[] = [
    'image', 'design', 'video', 'font', 'document', 'archive', 'other'
];
const ASSET_ROLES: EagleLibraryAssetRole[] = [
    'reference', 'main_image_template', 'detail_page_template', 'sku_template', 'design_template', 'asset'
];

/**
 * 本地路径特征回归护栏（测试期使用，非运行时闸；真正的安全靠 buildEagleAssetRef 只读白名单字段）：
 * 盘符（X:\ 或 X:/）、UNC、file://，以及 Eagle 磁盘路径的强特征段 `.library/`、`.info/`。
 * 后两者能在 POSIX 上也识别 Eagle 源文件路径，且不会误伤 folderPaths（其分隔符是 " / "，不含 `.library`/`.info`）。
 */
const LOCAL_PATH_PATTERN = /(?:^|[^a-z0-9])[a-z]:[\\/]|\\\\[^\\/]+\\|file:\/\/|\.library[\\/]|\.info[\\/]/i;

/**
 * 从选择上下文之类的结构化输入派生一个「已剥离本地路径」的模型安全引用。
 * 任何 path 类字段都不会被读取，因此天然不含裸路径。
 */
export function buildEagleAssetRef(input: EagleAssetRefInput): EagleAssetRef {
    return {
        schemaVersion: EAGLE_ASSET_REF_VERSION,
        libraryId: cleanText(input.libraryId, 160),
        libraryName: cleanText(input.libraryName, 180) || 'Eagle 素材库',
        itemId: cleanText(input.itemId, 180),
        name: cleanText(input.name, 240),
        ext: cleanText(input.ext, 24).toLowerCase(),
        fileKind: FILE_KINDS.includes(input.fileKind as EagleLibraryFileKind)
            ? (input.fileKind as EagleLibraryFileKind)
            : 'other',
        role: ASSET_ROLES.includes(input.role as EagleLibraryAssetRole)
            ? (input.role as EagleLibraryAssetRole)
            : 'asset',
        tags: normalizeStringList(input.tags, 30),
        folderPaths: normalizeStringList(input.folderPaths, 20),
        ...(positiveNumber(input.width) ? { width: positiveNumber(input.width) } : {}),
        ...(positiveNumber(input.height) ? { height: positiveNumber(input.height) } : {}),
        selectedAt: normalizeIsoTime(input.selectedAt)
    };
}

/** 不透明句柄 `libraryId:itemId`，模型唯一可用来指代 Eagle 素材的字符串。 */
export function formatEagleAssetRefToken(ref: Pick<EagleAssetRef, 'libraryId' | 'itemId'>): string {
    return `${cleanText(ref.libraryId, 160)}:${cleanText(ref.itemId, 180)}`;
}

/** 解析不透明句柄回 `{ libraryId, itemId }`；仅主进程解析层使用。 */
export function parseEagleAssetRefToken(token: unknown): { libraryId: string; itemId: string } | null {
    const text = cleanText(token, 360);
    const separator = text.indexOf(':');
    if (separator <= 0 || separator >= text.length - 1) return null;
    const libraryId = text.slice(0, separator).trim();
    const itemId = text.slice(separator + 1).trim();
    if (!libraryId || !itemId) return null;
    return { libraryId, itemId };
}

/**
 * 素材引用是否可安全交给模型：不能携带任何本地路径特征。
 * 作为回归护栏，防止未来有人误把 sourceFilePath 塞进引用字段。
 */
export function isModelSafeEagleAssetRef(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if ('sourceFilePath' in record || 'libraryPath' in record || 'path' in record) return false;
    return !containsLocalPathSignal(JSON.stringify(record));
}

/** 多素材选择集上限：防止把整页素材灌进模型上下文。 */
export const EAGLE_ASSET_GROUP_LIMIT = 12;

const TEMPLATE_ROLES: ReadonlySet<string> = new Set([
    'main_image_template', 'detail_page_template', 'sku_template', 'design_template'
]);

/**
 * 构建模型提示词中的 Eagle 素材段（不含结尾的边界免责声明，由调用方补上）。
 * 唯一负责「素材引用如何呈现给模型」的地方——单点保证不打印本地路径。
 */
export function buildEagleAssetRefPromptLines(ref: EagleAssetRef): string[] {
    const token = formatEagleAssetRefToken(ref);
    const dimensions = ref.width && ref.height ? `；尺寸=${ref.width}×${ref.height}` : '';
    const lines = [
        `- 提交时选中 Eagle 素材: ${ref.name || '未命名'}；role=${ref.role}；fileKind=${ref.fileKind}；ext=${ref.ext || '未知'}${dimensions}`,
        `- Eagle 素材引用: assetRef=${token}（不透明引用；真实源文件由主进程按需解析，模型不接收本地文件路径）`,
        `- Eagle 素材所属库: ${ref.libraryName}；libraryId=${ref.libraryId}`,
        `- Eagle 素材文件夹: ${ref.folderPaths.join(' / ') || '未归类'}；标签=${ref.tags.join(', ') || '无标签'}`
    ];
    if (TEMPLATE_ROLES.has(ref.role)) {
        lines.push(
            '- 模板工作流：这是模板素材。要使用它时先 importEagleAssetToProject 复制出项目内工作副本（Eagle 原件保持不动），再用 openTemplate 打开该副本进入对应模板链路（SKU/主图/详情页）。'
        );
    }
    if (ref.fileKind === 'video') {
        lines.push(
            '- 视频素材：observeEagleAsset 观察的是封面帧（缩略图），不是逐帧内容；需要用于设计时先 importEagleAssetToProject 复制进项目。'
        );
    }
    return lines;
}

/**
 * 构建多素材选择集的提示词段：每项一行紧凑引用，超上限如实截断标注。
 */
export function buildEagleAssetGroupPromptLines(refs: EagleAssetRef[]): string[] {
    const total = refs.length;
    const visible = refs.slice(0, EAGLE_ASSET_GROUP_LIMIT);
    const lines = [
        `- 提交时选中 Eagle 素材集（${total} 项）：作为一组参考/素材候选，不指定唯一目标。`
    ];
    for (const ref of visible) {
        const dimensions = ref.width && ref.height ? `；${ref.width}×${ref.height}` : '';
        lines.push(
            `  - ${ref.name || '未命名'}（assetRef=${formatEagleAssetRefToken(ref)}；role=${ref.role}；${ref.ext || '未知'}${dimensions}）`
        );
    }
    if (total > visible.length) {
        lines.push(`  - （其余 ${total - visible.length} 项超出上限未列出；可请用户缩小选择）`);
    }
    return lines;
}

export function containsLocalPathSignal(value: unknown): boolean {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return LOCAL_PATH_PATTERN.test(text);
}

function normalizeStringList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanText(item, 240)).filter(Boolean))).slice(0, limit);
}

function cleanText(value: unknown, limit: number): string {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function positiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function normalizeIsoTime(value: unknown): string {
    const parsed = Date.parse(String(value ?? ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}
