import type {
    AgentToolCallLogEntry,
    TaskCompletionContext
} from '../agent-runtime/types';
import { buildTaskCompletionContract } from '../agent-runtime/task-completion-contract';

export interface AgentTaskPolicyDirective {
    directive: string;
    shortReason: string;
}

export function buildDesignTaskContractRemediationDirective(input: {
    task: string;
    context?: TaskCompletionContext;
    toolCallLog: AgentToolCallLogEntry[];
}): AgentTaskPolicyDirective | null {
    const contract = buildTaskCompletionContract({
        task: input.task,
        context: input.context,
        toolCallLog: input.toolCallLog
    });
    if (!contract || contract.kind !== 'creative_design' || contract.status !== 'failed') {
        return null;
    }

    const failedIds = new Set(
        contract.required.filter((item) => item.status === 'failed').map((item) => item.id)
    );
    const missingVisual = failedIds.has('creative-visual');
    const missingCopy = failedIds.has('creative-copy');
    const missingDelivery = failedIds.has('creative-delivery');
    if (!missingVisual && !missingCopy && !missingDelivery) {
        return null;
    }

    const steps: string[] = [];
    const isFreshDetailPageStageDraft = input.context?.intentMode === 'fresh-detail-page-design';
    if (isFreshDetailPageStageDraft && (missingVisual || missingCopy)) {
        steps.push('用 renderLayout 重新生成当前阶段草稿：包含 background、main-image、title、selling-point；main-image 放入已选项目图片路径，title 和 selling-point 写买家能看到的真实卖点文案。生成后再截图复核主视觉、文字可读性和层级。');
    } else {
        if (missingVisual) {
            steps.push('用 placeImage 把项目里最合适的产品/模特图置入画布作为主视觉，并调整到合适大小与位置。');
        }
        if (missingCopy) {
            steps.push('用 createTextLayer 在画面上创建真实文案：主标题写产品核心卖点，再加 1-2 条关键卖点短句。必须是真实文字，不要写「核心卖点」「点击查看」这类占位词。深色背景配浅色字，字号合理，确认文字不超出画布。');
        }
    }
    if (missingDelivery) {
        steps.push('用 saveDocument 将当前设计导出或保存到用户要求的项目子目录；如果用户指定了「详情页」「主图」或「SKU」目录，优先使用 projectSubdir 字段，不要只口头说明已完成。');
    }
    steps.push('补完后用 getAnnotatedSnapshot 或 getCanvasSnapshot 截图复核排版与可读性，再给出最终回复。');

    const missingLabel = [missingVisual ? '主视觉素材' : '', missingCopy ? '真实文案文字' : '', missingDelivery ? '导出交付文件' : '']
        .filter(Boolean)
        .join('、');
    return {
        directive: [
            `设计还没完成，不要在这里收尾。当前成品缺少：${missingLabel}。`,
            '请继续在当前文档上完成以下步骤（每步调用对应工具，不要只用文字描述）：',
            ...steps.map((step, index) => `${index + 1}. ${step}`),
            '只有画面同时具备主视觉和真实文案、并经过截图复核后，才算完成。'
        ].join('\n'),
        shortReason: [missingVisual ? '缺主视觉' : '', missingCopy ? '缺文案' : '', missingDelivery ? '缺导出' : '']
            .filter(Boolean)
            .join('+')
    };
}

export function buildObservedDesignDraftSummary(toolCallLog: AgentToolCallLogEntry[]): string {
    const successfulCreate = [...toolCallLog].reverse().find((entry) =>
        entry.name === 'createDocument' && entry.result?.success !== false);
    const successfulLayout = [...toolCallLog].reverse().find((entry) =>
        (entry.name === 'renderLayout'
            || entry.name === 'placeImage'
            || entry.name === 'createTextLayer'
            || entry.name === 'createRectangle'
            || entry.name === 'createShape')
        && entry.result?.success !== false);
    const successfulObservation = [...toolCallLog].reverse().find((entry) =>
        (entry.name === 'getCanvasSnapshot'
            || entry.name === 'getAnnotatedSnapshot'
            || entry.name === 'getScreenSnapshots'
            || entry.name === 'getScreenSnapshotsWithOverlay'
            || entry.name === 'getAcceptanceSnapshot')
        && entry.result?.success !== false);

    if (!successfulCreate || !successfulLayout || !successfulObservation) {
        return '';
    }

    const documentName = resolveCreatedDocumentName(successfulCreate) || '当前设计文档';
    const documentRole = resolveDocumentRoleLabel(documentName);
    const createdCount = resolveCreatedElementCount(successfulLayout.result);
    const createdSummary = createdCount > 0
        ? `本轮已在画面中写入 ${createdCount} 个可编辑元素。`
        : '本轮已在画面中写入可编辑设计元素。';
    const observationLabel = successfulObservation.name === 'getAcceptanceSnapshot'
        ? '验收快照'
        : '画面快照';

    return [
        `${documentRole}「${documentName}」已经生成当前阶段草稿。`,
        createdSummary,
        `我已经读取过${observationLabel}，这个结果可以进入画面复核；它还不是最终质量结论，后续应继续根据实际画面调整。`
    ].join('\n');
}

function resolveCreatedDocumentName(entry: AgentToolCallLogEntry): string {
    const directName = String(
        entry.arguments?.documentName
        || entry.arguments?.name
        || entry.result?.documentName
        || entry.result?.name
        || ''
    ).trim();
    if (directName) return directName;

    const message = String(entry.result?.message || entry.result?.summary || '').trim();
    const quoted = message.match(/["“「]([^"”」]+)["”」]/);
    return String(quoted?.[1] || '').trim();
}

function resolveCreatedElementCount(result: any): number {
    const candidates = [
        result?.created,
        result?.createdLayers,
        result?.layers,
        result?.createdCount,
        result?.layerCount
    ];
    for (const value of candidates) {
        if (Array.isArray(value)) return value.length;
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) return Math.round(count);
    }
    return 0;
}

function resolveDocumentRoleLabel(documentName: string): string {
    const name = String(documentName || '').trim();
    if (/详情页|商品详情|detail\s*page|detail-page|product\s*detail/i.test(name)) return '详情页文档';
    if (/(^|[^a-z0-9])sku([^a-z0-9]|$)|色卡|组合图|规格图|套装|自选/i.test(name)) return 'SKU 文档';
    if (/主图|点击图|转化图|main\s*image|main-image|hero\s*image/i.test(name)) return '主图文档';
    return '设计文档';
}
