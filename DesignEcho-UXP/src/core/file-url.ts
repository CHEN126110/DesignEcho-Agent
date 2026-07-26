export function normalizeLocalFilePath(input: string): string {
    let value = String(input || '').trim();
    if (!value) {
        throw new Error('Missing file path');
    }

    if (/^file:\/\//i.test(value)) {
        value = value.replace(/^file:\/+/i, '');
        if (/^\/[a-zA-Z]:/.test(value)) {
            value = value.slice(1);
        }
    }

    if (/%[0-9A-Fa-f]{2}/.test(value)) {
        for (let i = 0; i < 3; i += 1) {
            try {
                const decoded = decodeURIComponent(value);
                if (decoded === value) break;
                value = decoded;
            } catch {
                break;
            }
        }
    }

    return value;
}

export function getUxpFileUrlCandidates(input: string): string[] {
    const normalized = normalizeLocalFilePath(input).replace(/\\/g, '/');
    const candidates = new Set<string>();

    if (/^[a-zA-Z]:\//.test(normalized)) {
        candidates.add(encodeURI(`file:/${normalized}`));
        candidates.add(encodeURI(`file:///${normalized}`));
        candidates.add(normalized);
        return Array.from(candidates);
    }

    if (normalized.startsWith('//')) {
        candidates.add(encodeURI(`file:${normalized}`));
        candidates.add(normalized);
        return Array.from(candidates);
    }

    if (normalized.startsWith('/')) {
        candidates.add(encodeURI(`file:${normalized}`));
        candidates.add(encodeURI(`file://${normalized}`));
        candidates.add(normalized);
        return Array.from(candidates);
    }

    candidates.add(encodeURI(`file:/${normalized}`));
    candidates.add(encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`));
    candidates.add(normalized);
    return Array.from(candidates);
}

export function toUxpFileUrl(input: string): string {
    return getUxpFileUrlCandidates(input)[0];
}

export async function getEntryFromPath(localFs: any, input: string): Promise<any> {
    const normalized = normalizeLocalFilePath(input);
    const attempts = [normalized, ...getUxpFileUrlCandidates(normalized)];
    let lastError: any = null;

    for (const attempt of attempts) {
        try {
            const entry = await localFs.getEntryWithUrl(attempt);
            if (entry) {
                return entry;
            }
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error(`Could not find an entry of '${attempts[0]}'`);
}
