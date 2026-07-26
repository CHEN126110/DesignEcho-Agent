/**
 * Guard image payloads before handing them to Photoshop.
 *
 * Photoshop may show native parser dialogs for corrupted PNG/JPEG data. Those
 * dialogs cannot be caught reliably after the open/place command has started,
 * so image bytes must be rejected before they enter Photoshop.
 */

export type SupportedImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

export interface ImageSafetyResult {
    ok: boolean;
    format?: SupportedImageFormat;
    error?: string;
    details?: Record<string, unknown>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_TABLE = createCrcTable();

export function normalizeSupportedImageFormat(value: string | null | undefined): SupportedImageFormat | null {
    const normalized = String(value || '').replace(/^image\//, '').replace(/^\./, '').trim().toLowerCase();
    if (normalized === 'jpg' || normalized === 'jpeg') {
        return 'jpeg';
    }
    if (normalized === 'png' || normalized === 'gif' || normalized === 'webp') {
        return normalized;
    }
    return null;
}

export function resolveImageResultFormatHint(options: {
    declaredFormat?: string | null;
    filePath?: string | null;
    fallbackFormat?: string | null;
}): SupportedImageFormat | undefined {
    const pathValue = String(options.filePath || '').split(/[?#]/, 1)[0];
    const extensionIndex = pathValue.lastIndexOf('.');
    if (extensionIndex >= 0) {
        const pathFormat = normalizeSupportedImageFormat(pathValue.slice(extensionIndex + 1));
        if (pathFormat) {
            return pathFormat;
        }
    }

    const declaredFormat = normalizeSupportedImageFormat(options.declaredFormat);
    if (declaredFormat) {
        return declaredFormat;
    }

    return normalizeSupportedImageFormat(options.fallbackFormat) || undefined;
}

export function bytesFromBase64ImagePayload(input: string): { bytes: Uint8Array; mimeType: string } {
    const raw = String(input || '').trim();
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = dataUrlMatch ? dataUrlMatch[1] : 'image/png';
    const base64 = dataUrlMatch ? dataUrlMatch[2] : raw;

    if (!base64) {
        throw new Error('图片数据为空，已取消置入以避免 Photoshop 弹出解析错误。');
    }

    const cleanBase64 = base64.replace(/\s+/g, '');
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
        bytes[index] = binaryString.charCodeAt(index);
    }
    return { bytes, mimeType };
}

export function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function assertImageBytesSafeForPhotoshop(
    bytes: Uint8Array,
    options: { formatHint?: string; sourceLabel?: string } = {}
): ImageSafetyResult {
    const result = validateImageBytesForPhotoshop(bytes, options);
    if (!result.ok) {
        throw new Error(result.error || '图片文件未通过 Photoshop 置入前检查。');
    }
    return result;
}

export function validateImageBytesForPhotoshop(
    bytes: Uint8Array,
    options: { formatHint?: string; sourceLabel?: string } = {}
): ImageSafetyResult {
    const sourceLabel = options.sourceLabel || '图片';
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return fail(`${sourceLabel} 没有可读取的图像数据，已取消置入。`, { byteLength: 0 });
    }

    const format = detectImageFormat(bytes, options.formatHint);
    if (format === 'png') {
        return validatePng(bytes, sourceLabel);
    }
    if (format === 'jpeg') {
        return validateJpeg(bytes, sourceLabel);
    }
    if (format === 'gif') {
        return validateGif(bytes, sourceLabel);
    }
    if (format === 'webp') {
        return validateWebp(bytes, sourceLabel);
    }

    return fail(
        `${sourceLabel} 不是可安全预检的图片格式。支持 PNG、JPG、GIF、WEBP；已取消置入以避免 Photoshop 弹窗。`,
        { byteLength: bytes.length, formatHint: options.formatHint || '' }
    );
}

export async function readFileEntryBytes(fileEntry: any, storage: any): Promise<Uint8Array> {
    const data = await fileEntry.read({ format: storage.formats.binary });
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error('无法按二进制读取图片文件，已取消置入以避免 Photoshop 弹窗。');
}

function detectImageFormat(bytes: Uint8Array, formatHint?: string): ImageSafetyResult['format'] | null {
    if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (bytes.length >= 6 && ascii(bytes, 0, 6).startsWith('GIF')) return 'gif';
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
    return normalizeSupportedImageFormat(formatHint);
}

function validatePng(bytes: Uint8Array, sourceLabel: string): ImageSafetyResult {
    if (!startsWith(bytes, PNG_SIGNATURE)) {
        return fail(`${sourceLabel} 的 PNG 文件头无效，已取消置入。`, { byteLength: bytes.length });
    }

    let offset = PNG_SIGNATURE.length;
    let chunkIndex = 0;
    let hasIhdr = false;
    let hasIdat = false;
    let hasIend = false;

    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) {
            return fail(`${sourceLabel} 的 PNG chunk 不完整，文件可能被截断。`, { offset, byteLength: bytes.length });
        }

        const length = readUint32(bytes, offset);
        const typeOffset = offset + 4;
        const dataOffset = offset + 8;
        const crcOffset = dataOffset + length;
        const nextOffset = crcOffset + 4;
        const type = ascii(bytes, typeOffset, 4);

        if (nextOffset > bytes.length) {
            return fail(`${sourceLabel} 的 PNG ${type || 'chunk'} 长度越界，文件可能损坏。`, {
                chunkIndex,
                type,
                length,
                offset,
                byteLength: bytes.length
            });
        }

        const expectedCrc = readUint32(bytes, crcOffset);
        const actualCrc = crc32(bytes, typeOffset, 4 + length);
        if (actualCrc !== expectedCrc) {
            return fail(`${sourceLabel} 的 PNG ${type} 校验失败，已取消置入以避免 Photoshop 弹出 IDAT/解码错误。`, {
                chunkIndex,
                type,
                expectedCrc,
                actualCrc
            });
        }

        if (chunkIndex === 0 && type !== 'IHDR') {
            return fail(`${sourceLabel} 的 PNG 首个 chunk 不是 IHDR，文件结构无效。`, { firstChunk: type });
        }
        if (type === 'IHDR') hasIhdr = true;
        if (type === 'IDAT') hasIdat = true;
        if (type === 'IEND') {
            hasIend = true;
            if (length !== 0) {
                return fail(`${sourceLabel} 的 PNG IEND chunk 长度异常，文件结构无效。`, { length });
            }
            break;
        }

        offset = nextOffset;
        chunkIndex += 1;
    }

    if (!hasIhdr || !hasIdat || !hasIend) {
        return fail(`${sourceLabel} 的 PNG 缺少必要数据块，文件不完整。`, { hasIhdr, hasIdat, hasIend });
    }

    return { ok: true, format: 'png', details: { byteLength: bytes.length } };
}

function validateJpeg(bytes: Uint8Array, sourceLabel: string): ImageSafetyResult {
    const hasStart = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
    const hasEnd = bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!hasStart || !hasEnd) {
        return fail(`${sourceLabel} 的 JPG 文件头或文件尾无效，文件可能被截断。`, {
            byteLength: bytes.length,
            hasStart,
            hasEnd
        });
    }
    return { ok: true, format: 'jpeg', details: { byteLength: bytes.length } };
}

function validateGif(bytes: Uint8Array, sourceLabel: string): ImageSafetyResult {
    const header = ascii(bytes, 0, 6);
    if (header !== 'GIF87a' && header !== 'GIF89a') {
        return fail(`${sourceLabel} 的 GIF 文件头无效，已取消置入。`, { header, byteLength: bytes.length });
    }
    return { ok: true, format: 'gif', details: { byteLength: bytes.length } };
}

function validateWebp(bytes: Uint8Array, sourceLabel: string): ImageSafetyResult {
    const riffSize = bytes.length >= 8 ? readUint32Le(bytes, 4) : 0;
    const looksValid = bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    if (!looksValid || riffSize + 8 > bytes.length) {
        return fail(`${sourceLabel} 的 WEBP 文件结构无效或文件被截断，已取消置入。`, {
            byteLength: bytes.length,
            riffSize
        });
    }
    return { ok: true, format: 'webp', details: { byteLength: bytes.length } };
}

function fail(error: string, details?: Record<string, unknown>): ImageSafetyResult {
    return { ok: false, error, details };
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    if (bytes.length < signature.length) return false;
    for (let index = 0; index < signature.length; index += 1) {
        if (bytes[index] !== signature[index]) return false;
    }
    return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    let text = '';
    const end = Math.min(bytes.length, offset + length);
    for (let index = offset; index < end; index += 1) {
        text += String.fromCharCode(bytes[index]);
    }
    return text;
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset] << 24) >>> 0)
        + ((bytes[offset + 1] << 16) >>> 0)
        + ((bytes[offset + 2] << 8) >>> 0)
        + (bytes[offset + 3] >>> 0)
    ) >>> 0;
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] >>> 0)
        + ((bytes[offset + 1] << 8) >>> 0)
        + ((bytes[offset + 2] << 16) >>> 0)
        + ((bytes[offset + 3] << 24) >>> 0)
    ) >>> 0;
}

function createCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }
    return table;
}

function crc32(bytes: Uint8Array, offset: number, length: number): number {
    let crc = 0xffffffff;
    const end = offset + length;
    for (let index = offset; index < end; index += 1) {
        crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
