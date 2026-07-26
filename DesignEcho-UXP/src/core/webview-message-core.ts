export function summarizeWebViewPayload(payload: any): string {
    if (payload == null) {
        return '';
    }
    if (typeof payload === 'string') {
        return `s:${payload.length}`;
    }
    if (typeof payload !== 'object') {
        return String(payload);
    }

    const parts: string[] = [];
    const keys = Object.keys(payload).sort();
    for (const key of keys) {
        const value = payload[key];
        if (value == null) {
            continue;
        }
        if (typeof value === 'string') {
            parts.push(`${key}:s${value.length}`);
            continue;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            parts.push(`${key}:${String(value)}`);
            continue;
        }
        if (Array.isArray(value)) {
            if (key === 'droppedFiles') {
                const preview = value.slice(0, 3).map((item: any) => {
                    const name = String(item?.name || '');
                    const ext = String(item?.extension || '');
                    const dataLen = typeof item?.dataUrl === 'string' ? item.dataUrl.length : 0;
                    const textLen = typeof item?.textContent === 'string' ? item.textContent.length : 0;
                    return `${name}.${ext}:${dataLen}:${textLen}`;
                }).join('|');
                parts.push(`${key}:a${value.length}[${preview}]`);
            } else if (key === 'filePaths') {
                const preview = value.slice(0, 3).map((item: any) => String(item || '')).join('|');
                parts.push(`${key}:a${value.length}[${preview}]`);
            } else {
                parts.push(`${key}:a${value.length}`);
            }
            continue;
        }

        try {
            parts.push(`${key}:o${Object.keys(value).length}`);
        } catch {
            parts.push(`${key}:o`);
        }
    }

    return parts.join(',');
}

export function buildWebViewMessageSignature(data: any): string {
    return `${data?.type || ''}|${data?.action || ''}|${summarizeWebViewPayload(data?.payload)}`;
}

export function createDuplicateWebViewMessageGuard(
    now: () => number = () => Date.now()
): (data: any) => boolean {
    let lastMessageSignature = '';
    let lastMessageAt = 0;

    return (data: any): boolean => {
        const signature = buildWebViewMessageSignature(data);
        const timestamp = now();
        if (signature === lastMessageSignature && (timestamp - lastMessageAt) < 300) {
            return true;
        }
        lastMessageSignature = signature;
        lastMessageAt = timestamp;
        return false;
    };
}
