/**
 * 工作流产物内容哈希（GPT 定稿 2026-06-24，硬约束 3）。
 *
 * 三类哈希，职责严格区分：
 * - computeAuthoritativeContentHash：权威内容哈希。规范化 hashInput → SHA-256，
 *   格式 `sha256-jcs-v1:<64位小写hex>`。用于 Artifact contentHash / ApprovalRecord 绑定 /
 *   不可变性校验 / Repository 冲突检查。必须由 Repository（主进程）计算，调用方不得自行声明。
 * - computeArtifactRecordHash：Repository 记录完整性哈希。绑定 record 的 meta、payload descriptor、
 *   lineage 与 runtimeBinding；用于发现 record.json 的合法形状损坏，不改变 ArtifactRef 内容身份。
 * - computeFastFingerprint：非安全快速指纹（FNV-1a 32 位）。仅可用于 UI dirty-check /
 *   内存缓存快速比较，绝不可承担审批绑定或不可变校验。
 *
 * SHA-256 为纯 JS 同步实现（无第三方依赖，跨 main/smoke 可用），输出与
 * node:crypto.createHash('sha256') 完全一致（smoke 交叉验证）。
 */

/** 权威哈希的输入子集（GPT 定稿：排除 artifactId / createdAt / contentHash） */
export interface AuthoritativeHashInput {
    schemaVersion: string;
    artifactType: string;
    projectId: string;
    skillId: string;
    sourceRevision: number;
    sourceRefs: unknown;
    producer: unknown;
    payload: unknown;
}

/**
 * Repository 记录清单的完整性输入。
 *
 * contentHash 只标识可复用的业务内容；recordHash 另外绑定 Repository 写入的身份、
 * payload descriptor、版本关系与 Runtime scope，避免合法形状的 record.json 损坏被当成
 * 另一条权威记录。recordHash 自身必须排除在输入之外。
 */
export interface ArtifactRecordHashInput {
    version: string;
    meta: unknown;
    payload: unknown;
    lineage: unknown;
    runtimeBinding: unknown;
}

/**
 * 递归按 key 排序，产出确定性 JSON 字符串（RFC 8785 JCS 风格）。
 * 覆盖本项目 payload 取值范围：对象 / 数组 / 字符串 / 有限数字 / 布尔 / null。
 * 未实现 RFC 8785 的大整数与特殊浮点序列化边界（contract payload 不含此类值）。
 */
export function canonicalize(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        // 必须使用 null prototype：普通对象上的 `__proto__` 赋值会触发原型 setter，
        // 让一个合法 JSON own key 在规范化结果里静默消失并造成内容哈希碰撞。
        // null-prototype 同时保证 constructor / prototype 等键始终只按数据处理。
        const sorted = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(record).sort()) {
            sorted[key] = sortKeysDeep(record[key]);
        }
        return sorted;
    }
    return value;
}

/**
 * 权威哈希算法版本（GPT 要求冻结）：sha256=SHA-256；jcs=RFC 8785 风格确定性序列化；v1=第 1 版规范化实现。
 * 冻结版本前缀可避免日后规范化细节变动导致历史 Artifact 哈希全部失效；升级须改版本号而非原地改算法。
 */
export const AUTHORITATIVE_HASH_VERSION = 'sha256-jcs-v1';
export const ARTIFACT_RECORD_HASH_VERSION = 'sha256-jcs-record-v1';

/**
 * 计算权威内容哈希：对规范化 hashInput 取 SHA-256。
 * 返回 `sha256-jcs-v1:<64hex>`。
 */
export function computeAuthoritativeContentHash(hashInput: AuthoritativeHashInput): string {
    return `${AUTHORITATIVE_HASH_VERSION}:${sha256Hex(canonicalize(hashInput))}`;
}

/** 计算 Repository record.json 的完整性哈希，不改变 ArtifactRef 的内容身份。 */
export function computeArtifactRecordHash(hashInput: ArtifactRecordHashInput): string {
    return `${ARTIFACT_RECORD_HASH_VERSION}:${sha256Hex(canonicalize(hashInput))}`;
}

/**
 * 非安全快速指纹（FNV-1a 32 位）。返回 `fnv1a32:<8hex>`。
 * 仅用于 UI dirty-check / 内存缓存快速比较，不得用于审批或不可变校验。
 */
export function computeFastFingerprint(value: unknown): string {
    const canonical = canonicalize(value);
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (let index = 0; index < canonical.length; index += 1) {
        hash ^= canonical.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** SHA-256（纯 JS 同步实现）。输入按 UTF-8 编码，返回 64 位小写 hex。 */
export function sha256Hex(message: string): string {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const data = new TextEncoder().encode(message);
    const bitLen = data.length * 8;
    const paddedLen = (Math.floor((data.length + 8) / 64) + 1) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(data);
    buf[data.length] = 0x80;

    const view = new DataView(buf.buffer);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(paddedLen - 4, bitLen >>> 0);

    const w = new Uint32Array(64);
    for (let offset = 0; offset < paddedLen; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            w[i] = view.getUint32(offset + i * 4);
        }
        for (let i = 16; i < 64; i += 1) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let i = 0; i < 64; i += 1) {
            const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + sigma1 + ch + K[i] + w[i]) >>> 0;
            const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (sigma0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7].map(toHex8).join('');
}

function rotr(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

function toHex8(value: number): string {
    return (value >>> 0).toString(16).padStart(8, '0');
}
