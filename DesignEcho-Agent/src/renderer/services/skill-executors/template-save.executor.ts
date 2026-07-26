import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';
import type { TemplateType } from '../../../shared/types/template.types';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

function inferTemplateType(input: string, documentName: string): TemplateType {
    const merged = `${input || ''} ${documentName || ''}`.toLowerCase();
    if (/sku|双装|组合|备注/.test(merged)) return 'sku';
    if (/详情|detail/.test(merged)) return 'detail-page';
    if (/主图|main image|click|white-bg|white bg/.test(merged)) return 'main-image';
    if (/banner|海报|横幅/.test(merged)) return 'banner';
    return 'other';
}

function buildDefaultDescription(templateType: TemplateType, documentName: string): string {
    const baseName = String(documentName || '').replace(/\.[^.]+$/, '') || '当前文档';
    switch (templateType) {
        case 'sku':
            return `从 Photoshop 当前文档「${baseName}」保存的 SKU 模板，可用于组合排版与批量出图。`;
        case 'detail-page':
            return `从 Photoshop 当前文档「${baseName}」保存的详情页模板，可用于详情页结构复用。`;
        case 'main-image':
            return `从 Photoshop 当前文档「${baseName}」保存的主图模板，可用于主图快速复用。`;
        case 'banner':
            return `从 Photoshop 当前文档「${baseName}」保存的 Banner 模板，可用于横幅或活动图复用。`;
        default:
            return `从 Photoshop 当前文档「${baseName}」保存的设计模板，可用于后续复用。`;
    }
}

export const templateSaveExecutor: SkillExecutor = {
    skillId: 'save-current-template',

    async execute({ params, callbacks, context }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onProgress?.('读取当前 Photoshop 文档', 12);
        callbacks?.onMessage?.('正在读取当前 Photoshop 文档。');

        const docsResult = await executeObservedSkillTool(
            callbacks,
            'listDocuments',
            { includeDetails: true },
            executeToolCall,
            '读取打开文档列表，用于确定需要保存到模板库的活动文档。'
        );
        const docs = Array.isArray(docsResult?.documents) ? docsResult.documents : [];
        const activeDoc = docs.find((doc: any) => doc?.isActive) || docs[0];

        if (!activeDoc?.name) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '未找到可保存文档',
                detail: '当前没有打开的 Photoshop 文档，无法写入模板库。',
                status: 'error',
                issue: 'No active Photoshop document'
            });
            return {
                success: false,
                message: '当前没有可用的 Photoshop 文档，无法保存为模板。',
                error: 'No active Photoshop document'
            };
        }

        const currentProjectPath =
            context?.projectContext?.projectPath ||
            useAppStore.getState().currentProject?.path ||
            (await window.designEcho?.getProjectRoot?.()) ||
            undefined;

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '确定模板保存上下文',
            detail: `文档: ${activeDoc.name}；项目路径: ${currentProjectPath || '未解析'}；文档路径: ${activeDoc.path || '未解析'}`,
            status: 'running',
            percent: 36
        });

        if (!activeDoc.path && !currentProjectPath) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '模板保存路径不足',
                detail: '当前文档没有文件路径，且没有可用项目路径，无法确定模板库写入位置。',
                status: 'error',
                issue: 'Document path not available'
            });
            return {
                success: false,
                message: '当前文档还没有可解析的文件路径。请先保存文档，或先打开项目后再执行。',
                error: 'Document path not available'
            };
        }

        const templateType = inferTemplateType(
            String(params.templateIntent || context?.userInput || ''),
            String(activeDoc.name || '')
        );
        const description = String(params.description || '').trim() || buildDefaultDescription(templateType, activeDoc.name);
        const tags = Array.isArray(params.tags)
            ? params.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean)
            : undefined;

        callbacks?.onProgress?.('识别模板类型', 52);
        callbacks?.onMessage?.(`当前文档: ${activeDoc.name}`);
        callbacks?.onMessage?.(`模板类型已识别为: ${templateType}`);
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '识别模板类型',
            detail: `类型: ${templateType}；描述: ${description}；标签: ${tags?.join('、') || '未提供'}`,
            status: 'success',
            percent: 58
        });

        try {
            callbacks?.onProgress?.('写入模板库', 72);
            emitSkillStep(callbacks, {
                kind: 'tool_started',
                title: '写入模板库',
                detail: `将当前文档「${activeDoc.name}」写入可复用模板库。`,
                status: 'running',
                toolName: 'template-knowledge:addFromPhotoshop',
                percent: 72
            });
            const saved = await window.designEcho.invoke('template-knowledge:addFromPhotoshop', {
                documentName: activeDoc.name,
                documentPath: activeDoc.path,
                currentProjectPath,
                type: templateType,
                description,
                tags
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '模板已保存',
                detail: `名称: ${saved?.name || activeDoc.name}；类型: ${saved?.type || templateType}`,
                status: 'success',
                toolName: 'template-knowledge:addFromPhotoshop',
                percent: 100
            });

            return {
                success: true,
                message: `已将当前文档保存为模板\n\n名称: ${saved.name}\n类型: ${saved.type}\n来源文档: ${activeDoc.name}`,
                data: saved
            };
        } catch (error: any) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '模板保存失败',
                detail: error?.message || String(error),
                status: 'error',
                toolName: 'template-knowledge:addFromPhotoshop',
                issue: error?.message || String(error)
            });
            return {
                success: false,
                message: `当前文档保存为模板失败: ${error?.message || '未知错误'}`,
                error: error?.message || String(error)
            };
        }
    }
};
