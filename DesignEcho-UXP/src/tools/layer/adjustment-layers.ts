/**
 * 调色 / 调整图层工具（非破坏性）
 *
 * 全部以「调整图层」(adjustmentLayer) 形式创建，不改动像素，可随时回退或与
 * createClippingMask 组合实现「只调某个图层、不影响背景」。
 *
 * 描述符说明：调整图层属于图层类，make 使用 _target:[{_ref:'adjustmentLayer'}] + using
 * 是标准形式（与「创建文档」用 new: 不同——文档是文档类，图层是图层类）。
 * 所有写操作都带 dialogOptions:'dontDisplay'，避免命令不可用时 Photoshop 弹出原生模态框。
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

interface AdjustmentResult {
    success: boolean;
    entityType?: 'adjustmentLayer';
    documentId?: number;
    layerId?: number;
    name?: string;
    adjustmentType?: string;
    message?: string;
    error?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback = 0): number {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

interface RGBColorValue {
    r: number;
    g: number;
    b: number;
}

function hexToRgb(hex: string, fallback: RGBColorValue): RGBColorValue {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!result) return fallback;
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    };
}

/**
 * 创建一个调整图层并读回新图层 id。所有调色工具共用此执行路径，保证：
 * 文档守卫 + 弹窗抑制 + 同步执行 + 读回 + 统一错误归一化 行为一致。
 */
async function makeAdjustmentLayer(options: {
    toolName: string;
    adjustmentType: string;
    layerName: string;
    typeDescriptor: Record<string, unknown>;
    commandName: string;
    params: unknown;
}): Promise<AdjustmentResult> {
    const doc = app.activeDocument as any;
    if (!doc) {
        return createToolFailureResult({
            toolName: options.toolName,
            error: `没有打开的文档，无法创建${options.adjustmentType}调整图层。`,
            params: options.params
        });
    }

    try {
        let createdLayerId: number | undefined;

        await core.executeAsModal(async () => {
            await action.batchPlay([
                {
                    _obj: 'make',
                    _target: [{ _ref: 'adjustmentLayer' }],
                    using: {
                        _obj: 'adjustmentLayer',
                        type: options.typeDescriptor
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });

            const created = doc.activeLayers?.[0];
            createdLayerId = created?.id;
            if (created && options.layerName) {
                try {
                    created.name = options.layerName;
                } catch {
                    // 命名失败不影响调整本身，保留 Photoshop 默认名
                }
            }
        }, { commandName: options.commandName });

        return {
            success: true,
            entityType: 'adjustmentLayer',
            documentId: doc.id,
            layerId: createdLayerId,
            name: options.layerName,
            adjustmentType: options.adjustmentType,
            message: `已创建${options.adjustmentType}调整图层「${options.layerName}」。如需只作用于某个图层，可对其调用 createClippingMask 形成剪切。`
        };
    } catch (error) {
        return createToolFailureResult({ toolName: options.toolName, error, params: options.params });
    }
}

/** 亮度 / 对比度 */
export class AddBrightnessContrastAdjustmentTool implements Tool {
    name = 'addBrightnessContrastAdjustment';
    schema = {
        name: 'addBrightnessContrastAdjustment',
        description: '创建「亮度/对比度」调整图层（非破坏性）。用于整体提亮、压暗或增强对比，常用于电商图统一氛围。',
        parameters: {
            type: 'object' as const,
            properties: {
                brightness: { type: 'number', description: '亮度，范围 -150~150，默认 0。' },
                contrast: { type: 'number', description: '对比度，范围 -50~100，默认 0。' },
                name: { type: 'string', description: '调整图层名称，默认「亮度/对比度」。' }
            }
        }
    };

    async execute(params: { brightness?: number; contrast?: number; name?: string }): Promise<AdjustmentResult> {
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '亮度/对比度',
            layerName: String(params?.name || '亮度/对比度').trim() || '亮度/对比度',
            commandName: 'DesignEcho: 亮度对比度',
            params,
            typeDescriptor: {
                _obj: 'brightnessEvent',
                brightness: clampInt(params?.brightness, -150, 150),
                center: clampInt(params?.contrast, -50, 100),
                useLegacy: false
            }
        });
    }
}

/** 色相 / 饱和度 / 明度 */
export class AddHueSaturationAdjustmentTool implements Tool {
    name = 'addHueSaturationAdjustment';
    schema = {
        name: 'addHueSaturationAdjustment',
        description: '创建「色相/饱和度」调整图层（非破坏性）。用于调整整体色相、提升或降低饱和度、改变明度，常用于商品色彩还原与风格化。',
        parameters: {
            type: 'object' as const,
            properties: {
                hue: { type: 'number', description: '色相，范围 -180~180，默认 0。' },
                saturation: { type: 'number', description: '饱和度，范围 -100~100，默认 0。' },
                lightness: { type: 'number', description: '明度，范围 -100~100，默认 0。' },
                name: { type: 'string', description: '调整图层名称，默认「色相/饱和度」。' }
            }
        }
    };

    async execute(params: { hue?: number; saturation?: number; lightness?: number; name?: string }): Promise<AdjustmentResult> {
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '色相/饱和度',
            layerName: String(params?.name || '色相/饱和度').trim() || '色相/饱和度',
            commandName: 'DesignEcho: 色相饱和度',
            params,
            typeDescriptor: {
                _obj: 'hueSaturation',
                colorize: false,
                adjustment: [{
                    _obj: 'hueSatAdjustmentV2',
                    hue: clampInt(params?.hue, -180, 180),
                    saturation: clampInt(params?.saturation, -100, 100),
                    lightness: clampInt(params?.lightness, -100, 100)
                }]
            }
        });
    }
}

/** 色阶（复合通道） */
export class AddLevelsAdjustmentTool implements Tool {
    name = 'addLevelsAdjustment';
    schema = {
        name: 'addLevelsAdjustment',
        description: '创建「色阶」调整图层（非破坏性，复合通道）。用于设定黑/白场、调整灰度系数（gamma）与输出范围，常用于提亮白底、修正灰蒙。',
        parameters: {
            type: 'object' as const,
            properties: {
                inputBlack: { type: 'number', description: '输入黑场，0~253，默认 0。' },
                inputWhite: { type: 'number', description: '输入白场，2~255，默认 255。' },
                gamma: { type: 'number', description: '灰度系数，0.1~9.99，默认 1.0。大于 1 提亮中间调，小于 1 压暗。' },
                outputBlack: { type: 'number', description: '输出黑场，0~255，默认 0。' },
                outputWhite: { type: 'number', description: '输出白场，0~255，默认 255。' },
                name: { type: 'string', description: '调整图层名称，默认「色阶」。' }
            }
        }
    };

    async execute(params: {
        inputBlack?: number;
        inputWhite?: number;
        gamma?: number;
        outputBlack?: number;
        outputWhite?: number;
        name?: string;
    }): Promise<AdjustmentResult> {
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '色阶',
            layerName: String(params?.name || '色阶').trim() || '色阶',
            commandName: 'DesignEcho: 色阶',
            params,
            typeDescriptor: {
                _obj: 'levels',
                presetKind: { _enum: 'presetKindType', _value: 'presetKindCustom' },
                adjustment: [{
                    _obj: 'levelsAdjustment',
                    channel: { _ref: 'channel', _enum: 'channel', _value: 'composite' },
                    input: [clampInt(params?.inputBlack, 0, 253, 0), clampInt(params?.inputWhite, 2, 255, 255)],
                    gamma: clampFloat(params?.gamma, 0.1, 9.99, 1.0),
                    output: [clampInt(params?.outputBlack, 0, 255, 0), clampInt(params?.outputWhite, 0, 255, 255)]
                }]
            }
        });
    }
}

/** 色彩平衡 */
export class AddColorBalanceAdjustmentTool implements Tool {
    name = 'addColorBalanceAdjustment';
    schema = {
        name: 'addColorBalanceAdjustment',
        description: '创建「色彩平衡」调整图层（非破坏性）。分别调整阴影/中间调/高光的青-红、洋红-绿、黄-蓝偏移，常用于统一画面色调（如暖调/冷调）。',
        parameters: {
            type: 'object' as const,
            properties: {
                shadows: { type: 'array', description: '阴影 [青红, 洋红绿, 黄蓝]，每项 -100~100，默认 [0,0,0]。', items: { type: 'number' } },
                midtones: { type: 'array', description: '中间调 [青红, 洋红绿, 黄蓝]，每项 -100~100，默认 [0,0,0]。', items: { type: 'number' } },
                highlights: { type: 'array', description: '高光 [青红, 洋红绿, 黄蓝]，每项 -100~100，默认 [0,0,0]。', items: { type: 'number' } },
                preserveLuminosity: { type: 'boolean', description: '是否保持明度，默认 true。' },
                name: { type: 'string', description: '调整图层名称，默认「色彩平衡」。' }
            }
        }
    };

    async execute(params: {
        shadows?: number[];
        midtones?: number[];
        highlights?: number[];
        preserveLuminosity?: boolean;
        name?: string;
    }): Promise<AdjustmentResult> {
        const triplet = (value: unknown): number[] => {
            const arr = Array.isArray(value) ? value : [];
            return [0, 1, 2].map((i) => clampInt(arr[i], -100, 100, 0));
        };
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '色彩平衡',
            layerName: String(params?.name || '色彩平衡').trim() || '色彩平衡',
            commandName: 'DesignEcho: 色彩平衡',
            params,
            typeDescriptor: {
                _obj: 'colorBalance',
                shadowLevels: triplet(params?.shadows),
                midtoneLevels: triplet(params?.midtones),
                highlightLevels: triplet(params?.highlights),
                preserveLuminosity: params?.preserveLuminosity !== false
            }
        });
    }
}

/** 自然饱和度 */
export class AddVibranceAdjustmentTool implements Tool {
    name = 'addVibranceAdjustment';
    schema = {
        name: 'addVibranceAdjustment',
        description: '创建「自然饱和度」调整图层（非破坏性）。vibrance 智能提升低饱和区域、保护肤色，saturation 为整体饱和度，常用于让商品更鲜亮而不过曝。',
        parameters: {
            type: 'object' as const,
            properties: {
                vibrance: { type: 'number', description: '自然饱和度，范围 -100~100，默认 0。' },
                saturation: { type: 'number', description: '饱和度，范围 -100~100，默认 0。' },
                name: { type: 'string', description: '调整图层名称，默认「自然饱和度」。' }
            }
        }
    };

    async execute(params: { vibrance?: number; saturation?: number; name?: string }): Promise<AdjustmentResult> {
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '自然饱和度',
            layerName: String(params?.name || '自然饱和度').trim() || '自然饱和度',
            commandName: 'DesignEcho: 自然饱和度',
            params,
            typeDescriptor: {
                _obj: 'vibrance',
                vibrance: clampInt(params?.vibrance, -100, 100),
                saturation: clampInt(params?.saturation, -100, 100)
            }
        });
    }
}

/** 照片滤镜 */
export class AddPhotoFilterAdjustmentTool implements Tool {
    name = 'addPhotoFilterAdjustment';
    schema = {
        name: 'addPhotoFilterAdjustment',
        description: '创建「照片滤镜」调整图层（非破坏性）。以一种颜色为整体画面加暖/加冷或染色，常用于统一氛围（如暖橙、冷蓝）。',
        parameters: {
            type: 'object' as const,
            properties: {
                colorHex: { type: 'string', description: '滤镜颜色，十六进制，例如暖色 #EC8A00、冷色 #00B5FF，默认暖橙 #EC8A00。' },
                density: { type: 'number', description: '浓度，1~100，默认 25。' },
                preserveLuminosity: { type: 'boolean', description: '是否保持明度，默认 true。' },
                name: { type: 'string', description: '调整图层名称，默认「照片滤镜」。' }
            }
        }
    };

    async execute(params: { colorHex?: string; density?: number; preserveLuminosity?: boolean; name?: string }): Promise<AdjustmentResult> {
        const color = hexToRgb(params?.colorHex || '#EC8A00', { r: 236, g: 138, b: 0 });
        return makeAdjustmentLayer({
            toolName: this.name,
            adjustmentType: '照片滤镜',
            layerName: String(params?.name || '照片滤镜').trim() || '照片滤镜',
            commandName: 'DesignEcho: 照片滤镜',
            params,
            typeDescriptor: {
                _obj: 'photoFilter',
                color: { _obj: 'RGBColor', red: color.r, green: color.g, blue: color.b },
                density: clampInt(params?.density, 1, 100, 25),
                preserveLuminosity: params?.preserveLuminosity !== false
            }
        });
    }
}
