export const DEFAULT_IMAGE_TO_IMAGE_MODEL = 'doubao-seedream-5-0-260128';
export const DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET = '2K';
export const JIMENG_IMAGE_TO_IMAGE_MODEL = 'jimeng-seedream-4-6';

const JIMENG_IMAGE_TO_IMAGE_CAPTURE_MAX_EDGE = 4096;

const IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES: Record<string, { defaultSize: string; supportedSizes: string[] }> = {
    'doubao-seedream-5-0-260128': {
        defaultSize: '3K',
        supportedSizes: ['2K', '3K']
    },
    // Pro（260628）：方舟仅接受 1K / 2K 分辨率档位；与 Agent/WebView 能力表保持一致。
    'doubao-seedream-5-0-pro-260628': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K']
    },
    'doubao-seedream-5-0-lite-260128': {
        defaultSize: '3K',
        supportedSizes: ['2K', '3K', '4K']
    },
    'doubao-seedream-4-5-251128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '4K']
    },
    'doubao-seedream-4-0-250828': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    [JIMENG_IMAGE_TO_IMAGE_MODEL]: {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    'gemini-3-pro-image-preview': {
        defaultSize: '2K',
        supportedSizes: ['2K']
    }
};

// Volcengine Seedream input hard limit: total pixels <= 6000 x 6000.
const SEEDREAM_MAX_TOTAL_PIXELS = 36_000_000;

export function normalizeImageToImageModel(model?: string): string {
    const normalized = String(model || '').trim();
    return normalized || DEFAULT_IMAGE_TO_IMAGE_MODEL;
}

export function resolveImageToImageSizePreset(model?: string, sizePreset?: string): string {
    const normalizedModel = normalizeImageToImageModel(model);
    const capabilities = IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES[normalizedModel]
        || IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES[DEFAULT_IMAGE_TO_IMAGE_MODEL];
    const normalizedSizePreset = String(sizePreset || '').trim().toUpperCase();
    if (capabilities.supportedSizes.includes(normalizedSizePreset)) {
        return normalizedSizePreset;
    }
    return capabilities.defaultSize;
}

export function resolveImageToImageSnapshotMaxEdge(model?: string, sizePreset?: string): number {
    const normalizedModel = normalizeImageToImageModel(model);
    if (normalizedModel === JIMENG_IMAGE_TO_IMAGE_MODEL) {
        return JIMENG_IMAGE_TO_IMAGE_CAPTURE_MAX_EDGE;
    }

    const resolvedSizePreset = resolveImageToImageSizePreset(normalizedModel, sizePreset);
    const baseEdge = (() => {
        switch (resolvedSizePreset) {
            case '1K': return 1024;
            case '2K': return 2304;
            case '3K': return 3456;
            case '4K': return 4096;
            default: return 3456;
        }
    })();
    const totalPixelCap = Math.floor(Math.sqrt(SEEDREAM_MAX_TOTAL_PIXELS));
    return Math.max(14, Math.min(baseEdge, totalPixelCap));
}

export function resolveInpaintingCaptureMaxSize(qualityPreset?: string, model?: string): number {
    const normalizedModel = String(model || '').trim();
    switch (String(qualityPreset || '').trim().toLowerCase()) {
        case 'ultra':
            return 2048;
        case 'high':
            return 1536;
        case 'standard':
            return 1024;
        default:
            return normalizedModel === 'jimeng-inpaint' || normalizedModel === 'google/gemini-3-pro-image-preview'
                ? 1536
                : 1024;
    }
}
