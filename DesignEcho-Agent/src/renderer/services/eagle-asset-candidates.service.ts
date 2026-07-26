import {
    buildEagleReadonlyUnavailableResponse,
    type EagleReadonlyKnowledgeQuery,
    type EagleReadonlyKnowledgeResponse,
    type EagleReadonlySettings
} from '../../shared/eagle-readonly-knowledge';
import { buildEagleVisualCaseIndexFromReadonlyKnowledge } from '../../shared/eagle-visual-case-index';
import {
    buildEagleAssetCandidatesPanel,
    type EagleAssetCandidatesPanelViewModel
} from '../../shared/eagle-asset-candidates-panel';

const DEFAULT_EAGLE_CANDIDATE_LIMIT = 6;

export interface EagleAssetCandidatesRuntimeApi {
    searchEagleReadonlyKnowledge?: (
        query: EagleReadonlyKnowledgeQuery,
        settings?: Partial<EagleReadonlySettings>
    ) => Promise<EagleReadonlyKnowledgeResponse>;
}

export interface EagleAssetCandidatesSearchInput extends EagleReadonlyKnowledgeQuery {
    settings?: Partial<EagleReadonlySettings>;
    generatedAt?: string;
}

export function createEagleAssetCandidatesRuntimeApi(
    source?: Partial<EagleAssetCandidatesRuntimeApi> | null
): EagleAssetCandidatesRuntimeApi {
    if (source) return source;
    if (typeof window === 'undefined') return {};
    const searchEagleReadonlyKnowledge = window.designEcho?.searchEagleReadonlyKnowledge as
        | EagleAssetCandidatesRuntimeApi['searchEagleReadonlyKnowledge']
        | undefined;
    return {
        searchEagleReadonlyKnowledge
    };
}

export class EagleAssetCandidatesService {
    private readonly api: EagleAssetCandidatesRuntimeApi;

    constructor(api: EagleAssetCandidatesRuntimeApi = createEagleAssetCandidatesRuntimeApi()) {
        this.api = api;
    }

    async search(input: EagleAssetCandidatesSearchInput): Promise<EagleAssetCandidatesPanelViewModel> {
        const query = normalizeQuery(input.query);
        const limit = normalizeLimit(input.limit);
        const generatedAt = normalizeGeneratedAt(input.generatedAt);
        const readonlyQuery: EagleReadonlyKnowledgeQuery = {
            query,
            limit,
            preferAiSearch: input.preferAiSearch !== false,
            tags: normalizeTextList(input.tags),
            folders: normalizeTextList(input.folders),
            ext: normalizeOptionalText(input.ext),
            selectedOnly: input.selectedOnly === true
        };

        if (!this.api.searchEagleReadonlyKnowledge) {
            return this.buildUnavailablePanel(
                readonlyQuery,
                'Eagle 只读搜索不可用：renderer 未暴露 searchEagleReadonlyKnowledge。',
                generatedAt
            );
        }

        try {
            const readonlyKnowledge = await this.api.searchEagleReadonlyKnowledge(readonlyQuery, input.settings);
            const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
                requestedBy: 'renderer:eagle-asset-candidates',
                generatedAt
            });
            return buildEagleAssetCandidatesPanel({
                query,
                readonlyKnowledge,
                visualCaseIndex,
                generatedAt
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '未收到可诊断的错误信息。';
            return this.buildUnavailablePanel(
                readonlyQuery,
                `Eagle 只读搜索失败：${message}`,
                generatedAt
            );
        }
    }

    private buildUnavailablePanel(
        query: EagleReadonlyKnowledgeQuery,
        message: string,
        generatedAt: string
    ): EagleAssetCandidatesPanelViewModel {
        const readonlyKnowledge = buildEagleReadonlyUnavailableResponse(query, message, 'unavailable');
        return buildEagleAssetCandidatesPanel({
            query: query.query,
            readonlyKnowledge,
            generatedAt
        });
    }
}

let singleton: EagleAssetCandidatesService | null = null;

export function getEagleAssetCandidatesService(): EagleAssetCandidatesService {
    if (!singleton) {
        singleton = new EagleAssetCandidatesService();
    }
    return singleton;
}

function normalizeQuery(value: unknown): string {
    return String(value || '').trim() || 'Eagle readonly asset candidates';
}

function normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > DEFAULT_EAGLE_CANDIDATE_LIMIT) {
        return DEFAULT_EAGLE_CANDIDATE_LIMIT;
    }
    return Math.floor(parsed);
}

function normalizeOptionalText(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}

function normalizeTextList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const list = Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
    return list.length ? list : undefined;
}

function normalizeGeneratedAt(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return new Date().toISOString();
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
