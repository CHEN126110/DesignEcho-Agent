/**
 * 活动库握手（P0 安全与契约）。
 *
 * DesignEcho 当前有两条 Eagle 通道：
 *  - 静态磁盘：用户选中的 `.library` 目录（`eagle-library-service`），`requiresEagleProcess:false`；
 *  - 实时 MCP：运行中的 Eagle（41596，只读知识检索）。
 *
 * 「活动库」此前没有单一真相：静态磁盘只知道「用户上次选了哪个 .library」，实时 MCP
 * 不告诉我们它当前打开的是哪个库。本模块把二者对账为一个诚实的握手结果：
 *  - 若实时 Eagle 可用且报告了当前库，则以实时信号为准（source=live_eagle）；
 *  - 否则回退到用户在磁盘上打开/持久化的 .library（source=disk_selection）；
 *  - 都没有则 source=none。
 *
 * reconciler 是纯函数、环境无关（不依赖 Node crypto / fetch），可离线单测。
 * libraryId 由主进程按 canonical path 哈希算出后传入，这里不重算，避免渲染进程缺少 crypto。
 * libraryPath 仅供 renderer/main 打开库使用，绝不作为模型提示词行输出。
 */
export const EAGLE_ACTIVE_LIBRARY_VERSION = 'eagle-active-library/v0' as const;

export type EagleActiveLibrarySource = 'live_eagle' | 'disk_selection' | 'none';

export interface EagleActiveLibraryHandshake {
    schemaVersion: typeof EAGLE_ACTIVE_LIBRARY_VERSION;
    source: EagleActiveLibrarySource;
    /** 实时 Eagle（MCP）在本次握手时是否可达。 */
    eagleAvailable: boolean;
    libraryId?: string;
    libraryName?: string;
    /** 仅 renderer/main 打开库用；不进入模型提示词。 */
    libraryPath?: string;
    eagleAppVersion?: string;
    /** 当实时库与磁盘选择都存在时，二者是否指向同一个库（按规范化路径比较）。 */
    matchesDiskSelection?: boolean;
    reconciledAt: string;
    notes: string[];
}

export interface EagleActiveLibraryLiveSignal {
    available: boolean;
    appVersion?: string;
    libraryName?: string;
    libraryPath?: string;
    error?: string;
}

export interface EagleActiveLibraryDiskSelection {
    libraryId?: string;
    libraryName?: string;
    libraryPath?: string;
}

export interface EagleActiveLibraryReconcileInput {
    live?: EagleActiveLibraryLiveSignal;
    disk?: EagleActiveLibraryDiskSelection;
    /** 实时库 path → libraryId 的主进程侧哈希（渲染进程无 crypto 时可省略）。 */
    resolveLibraryId?: (libraryPath: string) => string | undefined;
    now?: string;
}

export function reconcileEagleActiveLibrary(
    input: EagleActiveLibraryReconcileInput = {}
): EagleActiveLibraryHandshake {
    const reconciledAt = normalizeIsoTime(input.now);
    const notes: string[] = [];

    const live = input.live;
    const disk = normalizeDiskSelection(input.disk);
    const eagleAvailable = live?.available === true;

    if (live && live.available !== true && live.error) {
        notes.push(`live_eagle_unavailable:${cleanText(live.error, 200)}`);
    }

    const liveLibraryPath = cleanText(live?.libraryPath, 1024);
    const liveLibraryName = cleanText(live?.libraryName, 180);
    const hasLiveLibrary = eagleAvailable && Boolean(liveLibraryPath || liveLibraryName);

    if (hasLiveLibrary) {
        const liveLibraryId = liveLibraryPath && typeof input.resolveLibraryId === 'function'
            ? cleanText(input.resolveLibraryId(liveLibraryPath), 160)
            : '';
        // 判定实时库与磁盘选择是否同一个库：优先按路径；实时只报库名时按库名弱匹配。
        let matchesDiskSelection: boolean | undefined;
        if (disk.libraryPath && liveLibraryPath) {
            matchesDiskSelection = normalizePathKey(disk.libraryPath) === normalizePathKey(liveLibraryPath);
        } else if (!liveLibraryPath && liveLibraryName && disk.libraryName) {
            matchesDiskSelection = normalizeNameKey(liveLibraryName) === normalizeNameKey(disk.libraryName);
        }
        if (matchesDiskSelection === false) {
            notes.push('active_library_differs_from_disk_selection');
        }
        // 只有确证同库时，才用磁盘的 id/path 补全实时库缺失字段；
        // 否则绝不把「实时库名 + 磁盘 id/path」拼成互相矛盾的库身份，宁可留空并加 note。
        const sameLibrary = matchesDiskSelection === true;
        const resolvedLibraryId = liveLibraryId || (sameLibrary ? disk.libraryId : '');
        const resolvedLibraryPath = liveLibraryPath || (sameLibrary ? disk.libraryPath : '');
        if (!resolvedLibraryPath && !resolvedLibraryId) {
            notes.push('live_library_path_unavailable');
        }
        return finalize({
            source: 'live_eagle',
            eagleAvailable: true,
            libraryId: resolvedLibraryId,
            libraryName: liveLibraryName || disk.libraryName || 'Eagle 素材库',
            libraryPath: resolvedLibraryPath,
            eagleAppVersion: cleanText(live?.appVersion, 80) || undefined,
            matchesDiskSelection,
            reconciledAt,
            notes
        });
    }

    if (eagleAvailable) {
        notes.push('live_eagle_available_without_active_library');
    }

    if (disk.libraryId || disk.libraryPath || disk.libraryName) {
        return finalize({
            source: 'disk_selection',
            eagleAvailable,
            libraryId: disk.libraryId,
            libraryName: disk.libraryName || 'Eagle 素材库',
            libraryPath: disk.libraryPath,
            eagleAppVersion: cleanText(live?.appVersion, 80) || undefined,
            reconciledAt,
            notes
        });
    }

    return finalize({
        source: 'none',
        eagleAvailable,
        eagleAppVersion: cleanText(live?.appVersion, 80) || undefined,
        reconciledAt,
        notes
    });
}

/** 规范化库名用于弱匹配：去空白、小写。 */
function normalizeNameKey(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 规范化路径用于比较：统一分隔符、去尾分隔、小写（Windows 不区分大小写）。 */
export function normalizePathKey(value: unknown): string {
    return String(value ?? '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/, '')
        .trim()
        .toLowerCase();
}

function normalizeDiskSelection(
    value?: EagleActiveLibraryDiskSelection
): EagleActiveLibraryDiskSelection {
    return {
        libraryId: cleanText(value?.libraryId, 160),
        libraryName: cleanText(value?.libraryName, 180),
        libraryPath: cleanText(value?.libraryPath, 1024)
    };
}

function finalize(
    partial: Omit<EagleActiveLibraryHandshake, 'schemaVersion' | 'libraryId' | 'libraryName' | 'libraryPath'> & {
        libraryId?: string;
        libraryName?: string;
        libraryPath?: string;
    }
): EagleActiveLibraryHandshake {
    return {
        schemaVersion: EAGLE_ACTIVE_LIBRARY_VERSION,
        source: partial.source,
        eagleAvailable: partial.eagleAvailable,
        ...(partial.libraryId ? { libraryId: partial.libraryId } : {}),
        ...(partial.libraryName ? { libraryName: partial.libraryName } : {}),
        ...(partial.libraryPath ? { libraryPath: partial.libraryPath } : {}),
        ...(partial.eagleAppVersion ? { eagleAppVersion: partial.eagleAppVersion } : {}),
        ...(typeof partial.matchesDiskSelection === 'boolean'
            ? { matchesDiskSelection: partial.matchesDiskSelection }
            : {}),
        reconciledAt: partial.reconciledAt,
        notes: Array.from(new Set(partial.notes.filter(Boolean)))
    };
}

function cleanText(value: unknown, limit: number): string {
    return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeIsoTime(value: unknown): string {
    const parsed = Date.parse(String(value ?? ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
