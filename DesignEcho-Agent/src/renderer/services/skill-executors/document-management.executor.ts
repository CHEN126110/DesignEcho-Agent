import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';

import {
    inferDesignDocumentRoleFromName,
    inferDesignDocumentRoleFromTaskText,
    normalizeCreateDocumentParamsForDesignRole,
    type DesignDocumentRole
} from '../../../shared/design-document-role';

import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

type DocumentRecord = {
    id?: number;
    name?: string;
    isActive?: boolean;
    path?: string;
};

type DocumentSize = {
    width: number;
    height: number;
};

const CREATE_DOCUMENT_PRESET_SPECS: Record<string, DocumentSize> = {
    'detail-page': { width: 790, height: 2000 },
    'detail-page-large': { width: 790, height: 5000 },
    'main-image': { width: 800, height: 800 },
    'main-image-hd': { width: 1500, height: 1500 },
    'poster-a4': { width: 2480, height: 3508 },
    'poster-square': { width: 1080, height: 1080 },
    'wechat-article': { width: 900, height: 500 },
    xiaohongshu: { width: 1242, height: 1660 },
    douyin: { width: 1080, height: 1920 },
    'banner-wide': { width: 1920, height: 600 },
    'banner-standard': { width: 750, height: 350 }
};

function pickActiveDocument(documents: DocumentRecord[]): DocumentRecord | undefined {
    return documents.find((doc) => doc?.isActive) || documents[0];
}

function readPositiveNumber(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
    return Math.round(numberValue);
}

function resolveExpectedCreateDocumentSize(params: Record<string, any>): DocumentSize | null {
    const explicitWidth = readPositiveNumber(params.width);
    const explicitHeight = readPositiveNumber(params.height);
    const preset = String(params.preset || '').trim();
    const presetSpec = preset ? CREATE_DOCUMENT_PRESET_SPECS[preset] : undefined;
    const width = explicitWidth || presetSpec?.width;
    const height = explicitHeight || presetSpec?.height;
    if (!width || !height) return null;
    return { width, height };
}

function readDocumentSizeFromInfoResult(infoResult: any): DocumentSize | null {
    const document = infoResult?.document && typeof infoResult.document === 'object'
        ? infoResult.document
        : infoResult;
    const width = readPositiveNumber(document?.width);
    const height = readPositiveNumber(document?.height);
    if (!width || !height) return null;
    return { width, height };
}

function verifyCreatedDocumentInfo(params: Record<string, any>, infoResult: any): {
    ok: boolean;
    expected?: DocumentSize;
    actual?: DocumentSize | null;
    error?: string;
} {
    const expected = resolveExpectedCreateDocumentSize(params);
    if (!expected) return { ok: true };

    const actual = readDocumentSizeFromInfoResult(infoResult);
    if (!actual) {
        return {
            ok: false,
            expected,
            actual,
            error: 'created_document_info_unavailable'
        };
    }

    if (actual.width !== expected.width || actual.height !== expected.height) {
        return {
            ok: false,
            expected,
            actual,
            error: 'created_document_dimension_mismatch'
        };
    }

    return { ok: true, expected, actual };
}

function countTruthy(values: boolean[]): number {
    return values.filter(Boolean).length;
}

function inferCreateDocumentRoleFromRequest(params: Record<string, any>): DesignDocumentRole {
    const nameRole = inferDesignDocumentRoleFromName(String(params.name || params.documentName || ''));
    if (nameRole !== 'unknown') return nameRole;

    const text = String(params.userIntent || '').trim();
    if (!text) return 'unknown';
    const createPrefix = '(?:帮我|请|需要|给我)?\\s*(?:新建|创建|建立|建一个|建个|创建一个|新建一个|建立一个)';
    if (new RegExp(`${createPrefix}.{0,24}(?:SKU|sku)\\s*(?:文档|文件|psd|psb)?`, 'i').test(text)) {
        return 'sku';
    }
    if (new RegExp(`${createPrefix}.{0,24}(?:详情页|商品详情|产品详情|详情长图|detail\\s*page|detail-page)\\s*(?:文档|文件|psd|psb)?`, 'i').test(text)) {
        return 'detailPage';
    }
    if (new RegExp(`${createPrefix}.{0,24}(?:主图|点击图|转化图|main\\s*image|main-image|hero\\s*image)\\s*(?:文档|文件|psd|psb)?`, 'i').test(text)) {
        return 'mainImage';
    }

    const hasDetailPage = /详情页|商品详情|产品详情|详情长图|detail\s*page|detail-page/i.test(text);
    const hasSku = /(^|[^a-z0-9])sku([^a-z0-9]|$)|色卡|组合图|规格图|自选备注|备注图/i.test(text);
    const hasMainImage = /主图|点击图|转化图|白底图|main\s*image|main-image|hero\s*image/i.test(text);
    if (countTruthy([hasDetailPage, hasSku, hasMainImage]) > 1) return 'unknown';

    return inferDesignDocumentRoleFromTaskText(text);
}

function hasExplicitCreateDimensionText(params: Record<string, any>): boolean {
    const text = String(params.userIntent || '').trim();
    if (!text) return false;
    return /\d{2,5}\s*[x×*]\s*\d{2,5}/i.test(text)
        || /(?:宽|宽度|高|高度)\s*[：:]?\s*\d{2,5}/i.test(text)
        || /\d{2,5}\s*(?:px|像素)/i.test(text);
}

function normalizeDocumentCreateParams(params: Record<string, any>): Record<string, any> {
    const role = inferCreateDocumentRoleFromRequest(params);
    if (role === 'unknown') return { ...params };

    const normalized = normalizeCreateDocumentParamsForDesignRole(role, params, {
        canonicalName: true,
        canonicalDimensions: false
    });

    if ((role === 'detailPage' || role === 'mainImage') && !hasExplicitCreateDimensionText(params)) {
        delete normalized.width;
        delete normalized.height;
    }

    return normalized;
}

function normalizeSaveFormat(value: any): string {
    const format = String(value || 'psd').trim().toLowerCase();
    if (format === 'tif') return 'tiff';
    if (['psd', 'psb', 'png', 'jpg', 'jpeg', 'tiff', 'pdf'].includes(format)) {
        return format;
    }
    return 'psd';
}

function formatSaveResultMessage(input: {
    format: string;
    projectSubdir?: string;
    savedPath?: string;
}): string {
    const formatLabel = input.format.toUpperCase();
    const destinationLabel = input.projectSubdir
        ? `项目 ${input.projectSubdir} 目录`
        : '当前文档位置';
    const summary = `已保存当前文档（${formatLabel}，${destinationLabel}）`;
    return input.savedPath ? `${summary}：${input.savedPath}` : `${summary}。`;
}

export const documentManagementExecutor: SkillExecutor = {
    skillId: 'document-management',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = String(params.action || '').trim().toLowerCase();
        const toolResults: Array<{ toolName: string; result: any }> = [];

        const callTool = (toolName: string, toolParams: Record<string, any>, detail?: string) => {
            return executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, detail);
        };

        if (!action) {
            return {
                success: false,
                message: '缺少文档操作类型。',
                error: 'action is required'
            };
        }

        if (action === 'list') {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '准备读取文档列表',
                detail: '只读取当前 Photoshop 文档状态，不修改文档。',
                status: 'running'
            });
            callbacks?.onStatus?.('正在读取当前打开的 Photoshop 文档。');
            const docsResult = await callTool('listDocuments', { includeDetails: true }, '读取当前打开文档及活动文档信息。');
            toolResults.push({ toolName: 'listDocuments', result: docsResult });

            if (!docsResult?.success) {
                return {
                    success: false,
                    message: `读取文档列表失败：${docsResult?.error || '未知错误'}`,
                    error: docsResult?.error || 'listDocuments failed',
                    toolResults
                };
            }

            const documents = Array.isArray(docsResult?.documents) ? docsResult.documents : [];
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '文档列表读取完成',
                detail: `检测到 ${documents.length} 个打开文档。`,
                status: 'success'
            });
            return {
                success: true,
                message: `当前打开 ${documents.length} 个文档。`,
                toolResults,
                data: { documents }
            };
        }

        if (action === 'switch') {
            const documentName = String(params.documentName || '').trim();
            if (!documentName) {
                return {
                    success: false,
                    message: '切换文档需要提供 documentName。',
                    error: 'documentName is required for switch'
                };
            }

            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '准备切换文档',
                detail: `目标文档：${documentName}`,
                status: 'running'
            });
            callbacks?.onStatus?.(`正在切换到文档：${documentName}`);
            const switchResult = await callTool('switchDocument', { documentName }, `切换到文档：${documentName}`);
            toolResults.push({ toolName: 'switchDocument', result: switchResult });

            if (!switchResult?.success) {
                return {
                    success: false,
                    message: `切换文档失败：${switchResult?.error || '未知错误'}`,
                    error: switchResult?.error || 'switchDocument failed',
                    toolResults
                };
            }

            return {
                success: true,
                message: `已切换到文档：${documentName}`,
                toolResults,
                data: { documentName }
            };
        }

        if (action === 'create') {
            const createParams = normalizeDocumentCreateParams(params);
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '准备创建文档',
                detail: createParams.name ? `文档名：${String(createParams.name)}` : '使用传入尺寸或预设创建文档。',
                status: 'running'
            });
            callbacks?.onStatus?.('正在创建新文档。');
            const createResult = await callTool('createDocument', {
                preset: createParams.preset,
                width: createParams.width,
                height: createParams.height,
                name: createParams.name
            }, '创建 Photoshop 文档。');
            toolResults.push({ toolName: 'createDocument', result: createResult });

            if (!createResult?.success) {
                return {
                    success: false,
                    message: `创建新文档失败：${createResult?.error || '未知错误'}`,
                    error: createResult?.error || 'createDocument failed',
                    toolResults
                };
            }

            const infoResult = await callTool('getDocumentInfo', {}, '读取新建文档信息。');
            toolResults.push({ toolName: 'getDocumentInfo', result: infoResult });
            const verification = verifyCreatedDocumentInfo(createParams, infoResult);
            if (!verification.ok) {
                return {
                    success: false,
                    message: verification.error === 'created_document_dimension_mismatch'
                        ? `已创建文档，但读回尺寸与预期不一致：预期 ${verification.expected?.width}×${verification.expected?.height}px，实际 ${verification.actual?.width || 0}×${verification.actual?.height || 0}px。`
                        : '已创建文档，但暂时无法读回文档尺寸，因此不能确认创建结果。',
                    error: verification.error || 'created_document_verification_failed',
                    toolResults,
                    data: {
                        expectedDocumentSize: verification.expected,
                        actualDocumentSize: verification.actual,
                        documentInfo: infoResult
                    }
                };
            }

            return {
                success: true,
                message: `已创建文档：${String(infoResult?.name || createParams.name || '未命名文档')}`,
                toolResults,
                data: {
                    createParams,
                    documentInfo: infoResult
                }
            };
        }

        if (action === 'save') {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '准备保存文档',
                detail: params.path ? '按指定路径保存。' : '按当前文档路径或默认格式保存。',
                status: 'running'
            });
            callbacks?.onStatus?.('正在保存当前 Photoshop 文档。');
            const format = normalizeSaveFormat(params.format);
            const saveParams: Record<string, any> = {
                format
            };
            const path = String(params.path || '').trim();
            if (path) {
                saveParams.path = path;
                saveParams.saveAs = true;
            } else if (params.saveAs === true) {
                saveParams.saveAs = true;
            }
            const projectSubdir = String(params.projectSubdir || '').trim();
            if (projectSubdir) {
                saveParams.projectSubdir = projectSubdir;
            }
            const quality = Number(params.quality);
            if (Number.isFinite(quality) && quality > 0) {
                saveParams.quality = quality;
            }

            const saveResult = await callTool('saveDocument', saveParams, `保存格式：${format}`);
            toolResults.push({ toolName: 'saveDocument', result: saveResult });

            if (!saveResult?.success) {
                return {
                    success: false,
                    message: `保存文档失败：${saveResult?.error || '未知错误'}`,
                    error: saveResult?.error || 'saveDocument failed',
                    toolResults,
                    data: {
                        format,
                        path: path || undefined
                    }
                };
            }

            const savedPath = saveResult?.savePath || saveResult?.savedPath || path || '';
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '保存结果已返回',
                detail: savedPath ? `保存路径：${savedPath}` : `保存格式：${format.toUpperCase()}`,
                status: 'success'
            });
            return {
                success: true,
                message: formatSaveResultMessage({
                    format,
                    projectSubdir: projectSubdir || undefined,
                    savedPath: savedPath || undefined
                }),
                toolResults,
                data: {
                    format,
                    projectSubdir: projectSubdir || undefined,
                    savedPath: savedPath || undefined,
                    redirectedFrom: saveResult?.redirectedFrom
                }
            };
        }

        if (action === 'close') {
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '准备关闭文档',
                detail: params.save === true ? '关闭前保存更改。' : '关闭且不保存更改。',
                status: 'running'
            });
            callbacks?.onStatus?.('正在确认要关闭的文档。');
            const docsResult = await callTool('listDocuments', { includeDetails: true }, '确认目标文档。');
            toolResults.push({ toolName: 'listDocuments', result: docsResult });

            if (!docsResult?.success) {
                return {
                    success: false,
                    message: `读取文档列表失败：${docsResult?.error || '未知错误'}`,
                    error: docsResult?.error || 'listDocuments failed',
                    toolResults
                };
            }

            const documents: DocumentRecord[] = Array.isArray(docsResult?.documents) ? docsResult.documents : [];
            const targetDocumentId = Number(params.documentId);
            const targetDocumentName = String(params.documentName || '').trim();
            const activeDocument = pickActiveDocument(documents);
            const targetDocument = Number.isFinite(targetDocumentId)
                ? documents.find((doc) => Number(doc?.id) === targetDocumentId)
                : targetDocumentName
                    ? documents.find((doc) => String(doc?.name || '').toLowerCase().includes(targetDocumentName.toLowerCase()))
                    : activeDocument;

            if (!targetDocument) {
                return {
                    success: false,
                    message: '没有找到要关闭的文档。',
                    error: 'target document not found',
                    toolResults
                };
            }

            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '已定位关闭目标',
                detail: `目标文档：${String(targetDocument.name || targetDocument.id)}`,
                status: 'success'
            });
            callbacks?.onStatus?.(`正在关闭文档：${String(targetDocument.name || targetDocument.id)}`);
            const closeResult = await callTool('closeDocument', {
                documentId: targetDocument.id,
                save: params.save === true
            }, params.save === true ? '关闭前保存文档。' : '关闭且不保存文档。');
            toolResults.push({ toolName: 'closeDocument', result: closeResult });

            if (!closeResult?.success) {
                return {
                    success: false,
                    message: `关闭文档失败：${closeResult?.error || '未知错误'}`,
                    error: closeResult?.error || 'closeDocument failed',
                    toolResults,
                    data: {
                        targetDocument
                    }
                };
            }

            return {
                success: true,
                message: `已关闭文档：${String(closeResult?.closedDocument || targetDocument.name || targetDocument.id)}${params.save === true ? '（已保存）' : '（未保存）'}`,
                toolResults,
                data: {
                    targetDocument,
                    save: params.save === true
                }
            };
        }

        return {
            success: false,
            message: `不支持的文档操作：${action}`,
            error: 'unsupported document action'
        };
    }
};
