import { BinaryMessageType } from './binary-protocol';

export interface BinaryMaskPayload {
    requestId: number;
    width: number;
    height: number;
    type: BinaryMessageType;
    data: Uint8Array;
    receivedAt: number;
}

interface StoredBinaryMask extends BinaryMaskPayload {
    expiryTimer: ReturnType<typeof setTimeout>;
}

interface PendingBinaryMask {
    resolve: (payload: BinaryMaskPayload) => void;
    reject: (error: Error) => void;
    timeoutTimer: ReturnType<typeof setTimeout>;
}

export interface BinaryMaskStoreStats {
    cachedCount: number;
    pendingCount: number;
    cachedBytes: number;
}

export class BinaryMaskStore {
    private readonly cachedMasks: Map<number, StoredBinaryMask> = new Map();
    private readonly pendingMasks: Map<number, PendingBinaryMask> = new Map();
    private readonly ttlMs: number;

    constructor(ttlMs: number = 30000) {
        this.ttlMs = Math.max(1, Math.round(ttlMs));
    }

    receive(
        requestId: number,
        width: number,
        height: number,
        data: Uint8Array,
        type: BinaryMessageType
    ): void {
        const payload: BinaryMaskPayload = {
            requestId,
            width: Math.max(0, Math.round(Number(width) || 0)),
            height: Math.max(0, Math.round(Number(height) || 0)),
            type,
            // WebSocket 的 ArrayBuffer 生命周期不属于工具；只在唯一 Store 中复制一次。
            data: new Uint8Array(data),
            receivedAt: Date.now()
        };

        const pending = this.takePending(requestId);
        if (pending) {
            pending.resolve(payload);
            return;
        }

        this.takeCached(requestId);
        const expiryTimer = setTimeout(() => {
            this.takeCached(requestId);
        }, this.ttlMs);
        this.cachedMasks.set(requestId, { ...payload, expiryTimer });
    }

    waitFor(requestId: number, timeoutMs: number = 60000): Promise<BinaryMaskPayload> {
        const cached = this.takeCached(requestId);
        if (cached) {
            return Promise.resolve(this.toPayload(cached));
        }

        if (this.pendingMasks.has(requestId)) {
            return Promise.reject(new Error(`二进制蒙版请求正在等待中，不能重复注册：${requestId}`));
        }

        return new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                const pending = this.takePending(requestId);
                pending?.reject(new Error(`等待二进制蒙版超时：requestId=${requestId}`));
            }, Math.max(1, Math.round(timeoutMs)));
            this.pendingMasks.set(requestId, { resolve, reject, timeoutTimer });
        });
    }

    clear(reason: string = '二进制蒙版缓存已清理'): void {
        Array.from(this.cachedMasks.keys()).forEach((requestId) => this.takeCached(requestId));
        Array.from(this.pendingMasks.keys()).forEach((requestId) => {
            const pending = this.takePending(requestId);
            pending?.reject(new Error(reason));
        });
    }

    getStats(): BinaryMaskStoreStats {
        let cachedBytes = 0;
        this.cachedMasks.forEach((entry) => {
            cachedBytes += entry.data.byteLength;
        });
        return {
            cachedCount: this.cachedMasks.size,
            pendingCount: this.pendingMasks.size,
            cachedBytes
        };
    }

    private takeCached(requestId: number): StoredBinaryMask | undefined {
        const cached = this.cachedMasks.get(requestId);
        if (!cached) return undefined;
        clearTimeout(cached.expiryTimer);
        this.cachedMasks.delete(requestId);
        return cached;
    }

    private takePending(requestId: number): PendingBinaryMask | undefined {
        const pending = this.pendingMasks.get(requestId);
        if (!pending) return undefined;
        clearTimeout(pending.timeoutTimer);
        this.pendingMasks.delete(requestId);
        return pending;
    }

    private toPayload(stored: StoredBinaryMask): BinaryMaskPayload {
        return {
            requestId: stored.requestId,
            width: stored.width,
            height: stored.height,
            type: stored.type,
            data: stored.data,
            receivedAt: stored.receivedAt
        };
    }
}
