/**
 * 设计参考搜索技能执行器
 *
 * search 模式聚合两路参考源：用户本地 Eagle 素材库（searchEagleReferences，R0 只读）
 * 与网络设计参考（searchDesigns）；任一路成功即返回可用结果，单路失败按警告透传。
 * fetchUrl 模式调用 fetchWebPageDesignContent。
 */

import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import { normalizeExternalDesignKnowledgeResults } from '../../../shared/design-knowledge-search';
import { selectDesignKnowledgeResultsForUse } from '../../../shared/design-knowledge-governance';

function buildSearchKnowledgeResults(query: string, results: any[], limit: number) {
    return normalizeExternalDesignKnowledgeResults(
        {
            query,
            intents: ['reference'],
            sourceTypes: ['design_crawler'],
            limit
        },
        results.map((item, index) => ({
            id: item.id ? `design-crawler:${item.id}` : undefined,
            title: item.title || `设计参考 ${index + 1}`,
            intent: 'reference',
            sourceType: 'design_crawler',
            summary: item.description || item.summary || item.title || '设计参考搜索结果。',
            sourceNotes: [
                `平台：${item.platform || 'unknown'}`,
                item.url ? `来源：${item.url}` : '来源：未提供 URL'
            ],
            tags: ['design-reference-search', item.platform || 'unknown'],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceLevel: 'external_snippet',
            sourceRank: Number.isFinite(Number(item.score)) ? Math.max(1, Math.min(100, Math.round(Number(item.score) * 100))) : Math.max(1, 62 - index),
            sourceUrl: item.url
        }))
    );
}

function buildFetchedPageKnowledgeResult(url: string, result: any) {
    return normalizeExternalDesignKnowledgeResults(
        {
            query: url,
            intents: ['reference'],
            sourceTypes: ['web_page'],
            limit: 1
        },
        [{
            id: result.id ? `web-page:${result.id}` : undefined,
            title: result.title || url,
            intent: 'reference',
            sourceType: 'web_page',
            summary: result.description || (result.textContent || '').slice(0, 300) || '网页设计内容摘要。',
            sourceNotes: [
                `URL：${url}`,
                `图片数：${Array.isArray(result.images) ? result.images.length : 0}`,
                `文本长度：${String(result.textContent || '').length}`
            ],
            tags: ['web-page-design-reference'],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceLevel: 'external_snippet',
            sourceRank: 58,
            sourceUrl: url
        }]
    );
}

export const designReferenceSearchExecutor: SkillExecutor = {
    skillId: 'design-reference-search',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const mode = params.mode || 'search';

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备设计参考检索',
            detail: `模式: ${mode}`,
            status: 'running',
            percent: 8
        });

        if (mode === 'search') {
            const query = (params.query || '').trim();
            if (!query) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '设计参考检索未开始',
                    detail: '搜索模式缺少关键词。',
                    status: 'error',
                    issue: 'Query is required for search mode'
                });
                return { success: false, message: '请提供搜索关键词', error: 'Query is required for search mode' };
            }

            callbacks?.onProgress?.('搜索设计参考', 28);
            callbacks?.onMessage?.(`正在搜索设计参考: 「${query}」。`);

            const limit = params.limit || 10;
            const [knowledgeResult, eagleResult, webResult] = await Promise.all([
                // 小米 MiMo web_search 作主力联网搜索：实测稳定出活(约30-50秒)，替代失败的爬虫。
                executeObservedSkillTool(callbacks, 'searchDesignKnowledge', {
                    query,
                    limit
                }, executeToolCall, `联网检索设计资料：${query}；数量: ${limit}`).catch((error: any) => ({
                    success: false,
                    error: String(error?.message || error)
                })),
                executeObservedSkillTool(callbacks, 'searchEagleReferences', {
                    query,
                    limit
                }, executeToolCall, `Eagle 素材库检索：${query}；数量: ${limit}`).catch((error: any) => ({
                    success: false,
                    error: String(error?.message || error)
                })),
                executeObservedSkillTool(callbacks, 'searchDesigns', {
                    query,
                    platform: params.platform || 'all',
                    limit
                }, executeToolCall, `网络检索：${query}；平台: ${params.platform || 'all'}；数量: ${limit}`).catch((error: any) => ({
                    success: false,
                    error: String(error?.message || error)
                }))
            ]);

            // 小米联网检索结果（主力）
            const knowledgeSearchResults = (knowledgeResult?.success && Array.isArray(knowledgeResult.results))
                ? knowledgeResult.results
                : [];
            const knowledgeWarnings: string[] = Array.isArray(knowledgeResult?.warnings) ? knowledgeResult.warnings : [];
            if (!knowledgeResult?.success && (knowledgeResult?.error || knowledgeResult?.message)) {
                knowledgeWarnings.push(`联网检索不可用：${knowledgeResult.error || knowledgeResult.message}`);
            }

            const eagleKnowledgeResults = (eagleResult?.success && Array.isArray(eagleResult.results))
                ? eagleResult.results
                : [];
            const eagleWarnings: string[] = Array.isArray(eagleResult?.warnings) ? eagleResult.warnings : [];
            if (!eagleResult?.success && (eagleResult?.error || eagleResult?.message)) {
                eagleWarnings.push(`Eagle 素材库检索不可用：${eagleResult.error || eagleResult.message}`);
            }

            const webResults = (webResult?.success && Array.isArray(webResult.results)) ? webResult.results : [];
            const warnings = [...knowledgeWarnings, ...eagleWarnings];
            if (!webResult?.success && (webResult?.error || webResult?.message)) {
                warnings.push(`网络设计参考检索不可用：${webResult.error || webResult.message}`);
            }

            if (knowledgeSearchResults.length === 0 && eagleKnowledgeResults.length === 0 && webResults.length === 0
                && !knowledgeResult?.success && !eagleResult?.success && !webResult?.success) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '设计参考检索失败',
                    detail: warnings.join('；') || '三路参考源都没有返回结果。',
                    status: 'error',
                    issue: 'all_reference_sources_failed'
                });
                return {
                    success: false,
                    message: `设计参考检索失败：${warnings.join('；') || '联网检索、Eagle 素材库与网络检索都不可用。'}`,
                    error: 'all_reference_sources_failed'
                };
            }

            const total = (webResult?.total ?? webResults.length) + eagleKnowledgeResults.length + knowledgeSearchResults.length;
            const knowledgeResults = [
                ...knowledgeSearchResults,
                ...eagleKnowledgeResults,
                ...buildSearchKnowledgeResults(query, webResults, limit)
            ];
            const knowledgeUsageSnapshot = selectDesignKnowledgeResultsForUse(knowledgeResults, {
                query,
                purpose: 'planning'
            }).snapshot;

            // 小米联网检索结果分两类：综合要点(趋势分析正文) + 来源链接，分开展示
            const xiaomiInsight = knowledgeSearchResults.find((item: any) => String(item.id || '').includes('mimo-web-search:summary'));
            const xiaomiCitations = knowledgeSearchResults.filter((item: any) => String(item.id || '').includes('mimo-web-search:cite'));
            const knowledgeCiteList = (xiaomiCitations.length ? xiaomiCitations : knowledgeSearchResults)
                .slice(0, 6)
                .map((item: any, i: number) => `${i + 1}. ${item.sourceUrl ? `[${item.title || '未命名'}](${item.sourceUrl})` : (item.title || '未命名')}`)
                .join('\n');
            const eagleSummary = eagleKnowledgeResults.slice(0, 5).map((item: any, i: number) =>
                `${i + 1}. ${item.title || '未命名'}${Array.isArray(item.tags) && item.tags.length ? `（标签：${item.tags.slice(0, 4).join('/')}）` : ''}`
            ).join('\n');
            const webSummary = webResults.slice(0, 5).map((w: any, i: number) =>
                `${i + 1}. [${w.title || '未命名'}](${w.url || '#'})${w.platform ? ` - ${w.platform}` : ''}`
            ).join('\n');

            // 给用户看的回复：检索词透明 + 实质内容 + 来源可核实 + 各源状态可诊断
            const contentSections: string[] = [];
            contentSections.push(`**🔍 检索词**：${query}`);
            if (xiaomiInsight?.summary) {
                contentSections.push(`**联网检索到的设计要点**\n\n${String(xiaomiInsight.summary).slice(0, 900)}`);
            }
            if (knowledgeCiteList) {
                contentSections.push(`**参考来源**（小米联网实时检索 ${xiaomiCitations.length || knowledgeSearchResults.length} 个来源，点击可核实真实性）\n${knowledgeCiteList}`);
            }
            if (eagleSummary) {
                contentSections.push(`**Eagle 本地素材库**（${eagleKnowledgeResults.length} 条）\n${eagleSummary}`);
            }
            if (webSummary) {
                contentSections.push(`**网络参考**（${webResults.length} 条）\n${webSummary}`);
            }
            const hasContent = contentSections.length > 1; // 除检索词外有实际结果

            // 各源检索状态：用人话说清哪源成功/降级/失败，便于判断可靠性与定位问题（不堆运维日志，细节在执行记录里）
            const eagleDegraded = eagleWarnings.some((w) => /降级|关键词/.test(w));
            const statusParts: string[] = [];
            if (knowledgeSearchResults.length > 0) {
                statusParts.push(`✅ 小米联网检索 ${knowledgeSearchResults.length} 条`);
            } else if (knowledgeResult?.success) {
                statusParts.push('· 小米联网检索无匹配结果');
            } else {
                statusParts.push('❌ 小米联网检索未成功');
            }
            if (eagleKnowledgeResults.length > 0) {
                statusParts.push(eagleDegraded
                    ? `⚠️ Eagle 素材库 ${eagleKnowledgeResults.length} 条（语义检索冷启动超时，已降级为关键词匹配）`
                    : `✅ Eagle 素材库 ${eagleKnowledgeResults.length} 条`);
            } else if (!eagleResult?.success) {
                statusParts.push('❌ Eagle 素材库暂不可用');
            }
            statusParts.push(webResults.length > 0 ? `✅ 网络爬虫 ${webResults.length} 条` : '· 网络爬虫 0 条');
            const statusLine = `\n\n---\n_检索状态：${statusParts.join('；')}。完整诊断见执行记录。_`;

            const summary = contentSections.join('\n\n');

            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '设计参考检索完成',
                detail: `联网 ${knowledgeSearchResults.length} 条；Eagle 素材库 ${eagleKnowledgeResults.length} 条；网络 ${webResults.length} 条${warnings.length ? `；警告：${warnings.join('；')}` : ''}`,
                status: 'success',
                percent: 100
            });

            return {
                success: true,
                message: hasContent
                    ? `${summary}${statusLine}`
                    : `未检索到可用的设计参考。${statusLine}`,
                data: {
                    results: webResults,
                    eagleResults: eagleKnowledgeResults,
                    knowledgeSearchResults,
                    total,
                    knowledgeResults,
                    knowledgeUsageSnapshot,
                    referenceSummary: summary,
                    warnings,
                    hiddenCount: Math.max(0, webResults.length - 5)
                }
            };
        }

        if (mode === 'fetchUrl') {
            const url = (params.url || '').trim();
            if (!url) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '网页设计内容获取未开始',
                    detail: 'fetchUrl 模式缺少 URL。',
                    status: 'error',
                    issue: 'URL is required for fetchUrl mode'
                });
                return { success: false, message: '请提供要访问的网页 URL', error: 'URL is required for fetchUrl mode' };
            }

            callbacks?.onProgress?.('获取网页设计内容', 28);
            callbacks?.onMessage?.(`正在获取网页内容: ${url.substring(0, 50)}。`);

            const result = await executeObservedSkillTool(callbacks, 'fetchWebPageDesignContent', {
                url,
                extractImages: params.extractImages !== false,
                maxTextLength: params.maxTextLength
            }, executeToolCall, `URL: ${url}; extractImages: ${params.extractImages !== false}`);

            if (!result?.success) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '网页设计内容获取失败',
                    detail: result?.error || result?.message || '未知错误',
                    status: 'error',
                    toolName: 'fetchWebPageDesignContent',
                    issue: result?.error || result?.message || 'fetch_failed'
                });
                return {
                    success: false,
                    message: result?.message || `网页内容获取失败: ${result?.error || '未知错误'}`,
                    error: result?.error
                };
            }

            const textPreview = (result.textContent || '').slice(0, 500);
            const imgCount = (result.images || []).length;
            const knowledgeResults = buildFetchedPageKnowledgeResult(url, result);
            const knowledgeUsageSnapshot = selectDesignKnowledgeResultsForUse(knowledgeResults, {
                query: url,
                purpose: 'planning'
            }).snapshot;
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '网页设计内容已获取',
                detail: `标题: ${result.title || '无'}；图片数: ${imgCount}；文本长度: ${(result.textContent || '').length}`,
                status: 'success',
                toolName: 'fetchWebPageDesignContent',
                percent: 100
            });

            return {
                success: true,
                message: `### 网页内容\n\n**标题**: ${result.title || '无'}\n**描述**: ${result.description || '无'}\n**图片数**: ${imgCount}\n\n**内容摘要**:\n${textPreview}${(result.textContent || '').length > 500 ? '...' : ''}`,
                data: { ...result, knowledgeResults, knowledgeUsageSnapshot }
            };
        }

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '设计参考检索模式不支持',
            detail: `不支持的模式: ${mode}`,
            status: 'error',
            issue: `Unsupported mode: ${mode}`
        });
        return {
            success: false,
            message: `不支持的模式: ${mode}，请使用 search 或 fetchUrl`,
            error: `Unsupported mode: ${mode}`
        };
    }
};
