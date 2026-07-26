export interface InpaintingMaskStats {
    pixelCount: number;
    editablePixelCount: number;
    opaquePixelCount: number;
}

export function analyzeInpaintingMask(mask: Uint8Array): InpaintingMaskStats {
    let editablePixelCount = 0;
    let opaquePixelCount = 0;

    for (const alpha of mask) {
        if (alpha > 0) {
            editablePixelCount += 1;
        }
        if (alpha === 255) {
            opaquePixelCount += 1;
        }
    }

    return {
        pixelCount: mask.length,
        editablePixelCount,
        opaquePixelCount
    };
}

export function assertInpaintingMaskHasEditablePixels(mask: Uint8Array): InpaintingMaskStats {
    const stats = analyzeInpaintingMask(mask);
    if (stats.editablePixelCount === 0) {
        throw new Error('局部重绘蒙版为空，请在 Photoshop 中重新创建有效选区');
    }
    return stats;
}

export function clampSoftenedMaskToSelection(
    sourceMask: Uint8Array,
    softenedMask: Uint8Array
): Uint8Array {
    if (sourceMask.length !== softenedMask.length) {
        throw new Error(`局部重绘蒙版尺寸不一致：原始蒙版 ${sourceMask.length} 字节，羽化蒙版 ${softenedMask.length} 字节`);
    }

    const protectedMask = new Uint8Array(sourceMask.length);
    for (let index = 0; index < sourceMask.length; index++) {
        protectedMask[index] = Math.min(sourceMask[index], softenedMask[index]);
    }
    return protectedMask;
}
