/**
 * 标注式快照渲染器（SoM 式空间观察）
 *
 * 把 UXP getAnnotatedSnapshot 返回的「截图 + 图层边界映射」合成为
 * 带编号边框标注的图像：视觉模型看到的编号与坐标表一一对应，
 * 空间判断（对齐/间距/移动）不再靠裸数字猜测。
 */

export interface AnnotatedLayerBounds {
    index: number;
    id: number;
    name: string;
    kind: string;
    bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number };
    visible?: boolean;
    depth?: number;
}

const ANNOTATION_COLORS = [
    '#FF3B30', '#34C759', '#007AFF', '#FF9500', '#AF52DE',
    '#00C7BE', '#FF2D55', '#FFCC00', '#5856D6', '#A2845E'
];

/** 在截图上绘制编号边框；返回标注后 JPEG base64。无 DOM 时返回原图和坐标表。 */
export async function renderAnnotatedSnapshot(input: {
    imageBase64: string;
    layers: AnnotatedLayerBounds[];
    /** UXP 截图相对文档的缩放（bounds 是文档坐标，绘制前要乘 scale） */
    scale: number;
    snapshotSize: { width: number; height: number };
}): Promise<{ annotatedBase64: string; rendered: boolean }> {
    const canRenderInDom = (
        typeof Image !== 'undefined'
        && typeof document !== 'undefined'
        && typeof document.createElement === 'function'
    );
    if (!canRenderInDom) {
        return { annotatedBase64: input.imageBase64, rendered: false };
    }

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('标注快照渲染失败：截图 base64 无法解码为图像。'));
        img.src = `data:image/jpeg;base64,${input.imageBase64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = input.snapshotSize.width;
    canvas.height = input.snapshotSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('标注快照渲染失败：无法创建 Canvas 2D 上下文。');
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const scale = input.scale > 0 ? input.scale : 1;
    const fontSize = Math.max(11, Math.round(canvas.width / 70));
    ctx.lineWidth = Math.max(1.5, Math.round(canvas.width / 600));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';

    for (const layer of input.layers) {
        const color = ANNOTATION_COLORS[(layer.index - 1) % ANNOTATION_COLORS.length];
        const x = layer.bounds.left * scale;
        const y = layer.bounds.top * scale;
        const w = layer.bounds.width * scale;
        const h = layer.bounds.height * scale;
        if (w < 2 || h < 2) continue;

        ctx.strokeStyle = color;
        ctx.strokeRect(x, y, w, h);

        // 编号标签：框内左上角，超出画布时贴边
        const label = String(layer.index);
        const padding = Math.round(fontSize * 0.3);
        const labelWidth = ctx.measureText(label).width + padding * 2;
        const labelHeight = fontSize + padding * 2;
        const labelX = Math.min(Math.max(0, x), canvas.width - labelWidth);
        const labelY = Math.min(Math.max(0, y), canvas.height - labelHeight);
        ctx.fillStyle = color;
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, labelX + padding, labelY + padding);
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { annotatedBase64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''), rendered: true };
}
