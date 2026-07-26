/**
 * 创建新文档工具
 */

import { Tool, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

const DOCUMENT_PRESETS: Record<string, { width: number; height: number; resolution: number; name: string }> = {
    'detail-page': { width: 790, height: 2000, resolution: 72, name: '详情页' },
    'detail-page-large': { width: 790, height: 5000, resolution: 72, name: '长详情页' },
    'main-image': { width: 800, height: 800, resolution: 72, name: '主图' },
    'main-image-hd': { width: 1500, height: 1500, resolution: 72, name: '主图（高清）' },
    'poster-a4': { width: 2480, height: 3508, resolution: 300, name: 'A4 海报' },
    'poster-square': { width: 1080, height: 1080, resolution: 72, name: '方形海报' },
    'wechat-article': { width: 900, height: 500, resolution: 72, name: '公众号封面' },
    'xiaohongshu': { width: 1242, height: 1660, resolution: 72, name: '小红书图片' },
    'douyin': { width: 1080, height: 1920, resolution: 72, name: '抖音竖版' },
    'banner-wide': { width: 1920, height: 600, resolution: 72, name: '宽幅 Banner' },
    'banner-standard': { width: 750, height: 350, resolution: 72, name: '标准 Banner' }
};

interface CreateDocumentParams {
    preset?: string;
    width?: number;
    height?: number;
    resolution?: number;
    name?: string;
    backgroundColor?: 'white' | 'black' | 'transparent';
    colorMode?: 'RGB' | 'CMYK' | 'Grayscale';
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readDocumentDimension(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function readOpenDocumentIds(): Set<number> {
    const ids = new Set<number>();
    const documents = Array.from(app.documents || []) as any[];
    for (const doc of documents) {
        if (typeof doc?.id === 'number') ids.add(doc.id);
    }
    return ids;
}

function readCreatedDocumentId(result: unknown): number | null {
    if (!Array.isArray(result)) return null;
    for (const entry of result) {
        const id = (entry as any)?.documentID;
        if (typeof id === 'number' && Number.isFinite(id)) return id;
    }
    return null;
}

function documentMatchesExpected(doc: any, expected: {
    name: string;
    width: number;
    height: number;
}): boolean {
    return !!doc
        && String(doc.name || '').trim() === expected.name
        && readDocumentDimension(doc.width) === expected.width
        && readDocumentDimension(doc.height) === expected.height;
}

function findCreatedDocument(beforeIds: Set<number>, expected: {
    name: string;
    width: number;
    height: number;
}, createdId?: number | null): any | null {
    const documents = Array.from(app.documents || []) as any[];

    // 优先用 make 返回的权威 documentID 定位，避免依赖 DOM 集合刷新时序。
    if (typeof createdId === 'number') {
        const byId = documents.find((doc) => doc?.id === createdId);
        if (byId && !beforeIds.has(createdId) && documentMatchesExpected(byId, expected)) return byId;
    }

    const added = documents.find((doc) => (
        typeof doc?.id === 'number'
        && !beforeIds.has(doc.id)
        && documentMatchesExpected(doc, expected)
    ));
    if (added) return added;

    const activeDoc = app.activeDocument;
    if (
        activeDoc
        && typeof activeDoc.id === 'number'
        && !beforeIds.has(activeDoc.id)
        && documentMatchesExpected(activeDoc, expected)
    ) {
        return activeDoc;
    }

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCreatedDocument(beforeIds: Set<number>, expected: {
    name: string;
    width: number;
    height: number;
}, createdId?: number | null): Promise<any | null> {
    for (let attempt = 0; attempt < 12; attempt++) {
        const doc = findCreatedDocument(beforeIds, expected, createdId);
        if (doc) return doc;
        await sleep(50);
    }
    return null;
}

export class CreateDocumentTool implements Tool {
    name = 'createDocument';

    schema: ToolSchema = {
        name: 'createDocument',
        description: '在 Photoshop 中创建新文档。支持使用预设尺寸，或传入 width/height/resolution 自定义创建。',
        parameters: {
            type: 'object',
            properties: {
                preset: {
                    type: 'string',
                    description: '预设名称，例如 detail-page、main-image、poster-a4。'
                },
                width: {
                    type: 'number',
                    description: '文档宽度（像素）。如果提供 preset，可用来覆盖预设宽度。'
                },
                height: {
                    type: 'number',
                    description: '文档高度（像素）。如果提供 preset，可用来覆盖预设高度。'
                },
                resolution: {
                    type: 'number',
                    description: '文档分辨率（DPI）。默认 72。'
                },
                name: {
                    type: 'string',
                    description: '文档名称。'
                },
                backgroundColor: {
                    type: 'string',
                    enum: ['white', 'black', 'transparent'],
                    description: '背景填充类型。默认 white。'
                },
                colorMode: {
                    type: 'string',
                    enum: ['RGB', 'CMYK', 'Grayscale'],
                    description: '颜色模式。默认 RGB。'
                }
            }
        }
    };

    async execute(params: CreateDocumentParams): Promise<{
        success: boolean;
        entityType?: 'document';
        documentId?: number;
        name?: string;
        width?: number;
        height?: number;
        resolution?: number;
        document?: {
            id: number;
            name: string;
            width: number;
            height: number;
            resolution: number;
        };
        message?: string;
        error?: string;
    }> {
        try {
            let width: number;
            let height: number;
            let resolution: number;
            let docName: string;

            if (params.preset && DOCUMENT_PRESETS[params.preset]) {
                const preset = DOCUMENT_PRESETS[params.preset];
                width = params.width ?? preset.width;
                height = params.height ?? preset.height;
                resolution = params.resolution ?? preset.resolution;
                docName = params.name?.trim() || preset.name;
            } else {
                width = params.width ?? 800;
                height = params.height ?? 800;
                resolution = params.resolution ?? 72;
                docName = params.name?.trim() || '新建文档';
            }

            if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
                return {
                    success: false,
                    error: 'createDocument failed: width and height must be greater than 0.'
                };
            }

            if (!isPositiveNumber(resolution)) {
                return {
                    success: false,
                    error: 'createDocument failed: resolution must be greater than 0.'
                };
            }

            const fillType = params.backgroundColor === 'transparent'
                ? 'transparent'
                : params.backgroundColor === 'black'
                    ? 'black'
                    : 'white';

            const mode = params.colorMode === 'CMYK'
                ? 'CMYKColorMode'
                : params.colorMode === 'Grayscale'
                    ? 'grayscaleMode'
                    : 'RGBColorMode';

            const beforeIds = readOpenDocumentIds();
            let newDoc: any = null;
            let createdId: number | null = null;

            await core.executeAsModal(async () => {
                // 创建文档必须用 make 的 new 描述符（新对象语义），这是 Photoshop 录制
                // “新建文档”输出的标准形式。旧实现误用图层类的 target+using make 形式，
                // 该形式只适用于图层类（layer/contentLayer/textLayer/layerSection），对
                // document 类在部分 Photoshop 版本下不会真正创建文档，导致读回失败。
                const result = await action.batchPlay([
                    {
                        _obj: 'make',
                        new: {
                            _obj: 'document',
                            name: docName,
                            artboard: false,
                            autoPromoteBackgroundLayer: false,
                            mode: {
                                _class: mode
                            },
                            width: {
                                _unit: 'pixelsUnit',
                                _value: width
                            },
                            height: {
                                _unit: 'pixelsUnit',
                                _value: height
                            },
                            resolution: {
                                _unit: 'densityUnit',
                                _value: resolution
                            },
                            fill: {
                                _enum: 'fill',
                                _value: fillType
                            },
                            depth: 8,
                            profile: 'sRGB IEC61966-2.1'
                        },
                        _options: {
                            dialogOptions: 'dontDisplay'
                        }
                    }
                ], { synchronousExecution: true });

                createdId = readCreatedDocumentId(result);
            }, { commandName: 'DesignEcho: 创建文档' });

            newDoc = await waitForCreatedDocument(beforeIds, {
                name: docName,
                width,
                height
            }, createdId);

            if (!newDoc || typeof newDoc.id !== 'number') {
                return {
                    success: false,
                    error: 'createDocument failed: no new Photoshop document was created or read back.'
                };
            }

            if (app.activeDocument?.id !== newDoc.id) {
                await core.executeAsModal(async () => {
                    app.activeDocument = newDoc;
                }, { commandName: 'DesignEcho: 激活新建文档' });
            }

            const actualName = String(newDoc.name || '').trim();
            const actualWidth = readDocumentDimension(newDoc.width);
            const actualHeight = readDocumentDimension(newDoc.height);
            if (actualName !== docName || actualWidth !== width || actualHeight !== height) {
                return {
                    success: false,
                    error: `createDocument failed: readback mismatch. expected ${docName} ${width}x${height}, got ${actualName || 'unnamed'} ${actualWidth}x${actualHeight}.`
                };
            }

            const resultDocument = {
                id: newDoc.id,
                name: actualName,
                width,
                height,
                resolution
            };

            return {
                success: true,
                entityType: 'document',
                documentId: resultDocument.id,
                name: resultDocument.name,
                width: resultDocument.width,
                height: resultDocument.height,
                resolution: resultDocument.resolution,
                document: resultDocument,
                message: `Created document "${resultDocument.name}" (${width}x${height}px @ ${resolution}dpi).`
            };
        } catch (error) {
            console.error('[CreateDocument] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'createDocument failed'
            };
        }
    }

    static getPresets(): Record<string, { width: number; height: number; resolution: number; name: string }> {
        return DOCUMENT_PRESETS;
    }
}
