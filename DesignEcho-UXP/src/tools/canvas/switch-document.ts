/**
 * 切换文档工具
 * 
 * 让 AI 能够切换到指定的文档
 * 支持错别字容错匹配
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');

/**
 * 计算两个字符串的编辑距离（Levenshtein Distance）
 * 用于错别字容错匹配
 */
function levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    
    // 创建距离矩阵
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // 初始化边界
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    // 填充矩阵
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,     // 删除
                    dp[i][j - 1] + 1,     // 插入
                    dp[i - 1][j - 1] + 1  // 替换
                );
            }
        }
    }
    
    return dp[m][n];
}

/**
 * 计算相似度分数 (0-1，1表示完全相同)
 */
function similarityScore(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // 完全匹配
    if (s1 === s2) return 1;
    
    // 包含匹配（高分）
    if (s2.includes(s1) || s1.includes(s2)) {
        return 0.9;
    }
    
    // 编辑距离匹配
    const distance = levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    
    // 转换为相似度分数
    return 1 - (distance / maxLen);
}

/**
 * 在候选列表中找到最相似的匹配
 */
function findBestMatch(searchName: string, candidates: { name: string; doc: any }[]): { doc: any; score: number; matchedName: string } | null {
    let bestMatch: { doc: any; score: number; matchedName: string } | null = null;
    
    for (const candidate of candidates) {
        // 去掉扩展名进行匹配
        const nameWithoutExt = candidate.name.replace(/\.(psd|psb|jpg|jpeg|png|gif|tif|tiff)$/i, '');
        
        // 计算与完整名和无扩展名的相似度，取较高者
        const score1 = similarityScore(searchName, candidate.name);
        const score2 = similarityScore(searchName, nameWithoutExt);
        const score = Math.max(score1, score2);
        
        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { doc: candidate.doc, score, matchedName: candidate.name };
        }
    }
    
    return bestMatch;
}

export class SwitchDocumentTool implements Tool {
    name = 'switchDocument';

    schema: ToolSchema = {
        name: 'switchDocument',
        description: '切换到指定的文档。可以通过文档 ID 或文档名称切换。支持错别字容错匹配。',
        parameters: {
            type: 'object',
            properties: {
                documentId: {
                    type: 'number',
                    description: '要切换到的文档 ID'
                },
                documentName: {
                    type: 'string',
                    description: '要切换到的文档名称（支持模糊匹配和错别字容错）'
                }
            }
        }
    };

    async execute(params: {
        documentId?: number;
        documentName?: string;
    }): Promise<{
        success: boolean;
        document?: {
            id: number;
            name: string;
            width: number;
            height: number;
        };
        allDocuments?: { id: number; name: string }[];
        matchInfo?: string;
        error?: string;
    }> {
        try {
            console.log('[SwitchDocument] 执行切换, 参数:', JSON.stringify(params));

            const documents = app.documents;
            if (!documents || documents.length === 0) {
                return { success: false, error: '没有打开的文档' };
            }

            // 列出所有文档
            const allDocuments: { id: number; name: string }[] = [];
            const candidates: { name: string; doc: any }[] = [];
            
            for (const doc of documents) {
                allDocuments.push({ id: doc.id, name: doc.name });
                candidates.push({ name: doc.name, doc });
            }

            let targetDoc: any = null;
            let matchInfo: string | undefined;

            // 通过 ID 查找
            if (params.documentId) {
                for (const doc of documents) {
                    if (doc.id === params.documentId) {
                        targetDoc = doc;
                        break;
                    }
                }
                if (!targetDoc) {
                    return {
                        success: false,
                        error: `未找到 ID 为 ${params.documentId} 的文档`,
                        allDocuments
                    };
                }
            }
            // 通过名称查找（支持模糊匹配和错别字容错）
            else if (params.documentName) {
                const searchName = params.documentName;
                
                // 使用智能匹配找到最佳结果
                const bestMatch = findBestMatch(searchName, candidates);
                
                if (bestMatch) {
                    // 相似度阈值：0.5 以上认为是有效匹配
                    if (bestMatch.score >= 0.5) {
                        targetDoc = bestMatch.doc;
                        
                        // 如果不是完美匹配，添加提示信息
                        if (bestMatch.score < 1) {
                            matchInfo = `已智能匹配："${searchName}" → "${bestMatch.matchedName}" (相似度: ${Math.round(bestMatch.score * 100)}%)`;
                            console.log('[SwitchDocument]', matchInfo);
                        }
                    } else {
                        // 相似度太低，给出建议
                        const suggestions = candidates
                            .map(c => ({ name: c.name, score: similarityScore(searchName, c.name) }))
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 3)
                            .map(s => `"${s.name}" (${Math.round(s.score * 100)}%)`);
                        
                        return {
                            success: false,
                            error: `未找到足够相似的文档。您是否想找：\n${suggestions.join('\n')}`,
                            allDocuments
                        };
                    }
                }

                if (!targetDoc) {
                    return {
                        success: false,
                        error: `未找到名称包含 "${params.documentName}" 的文档`,
                        allDocuments
                    };
                }
            } else {
                return {
                    success: false,
                    error: '请提供 documentId 或 documentName',
                    allDocuments
                };
            }

            // 切换到目标文档（需要在 modal scope 中执行）
            await core.executeAsModal(async () => {
                app.activeDocument = targetDoc;
            }, { commandName: 'DesignEcho: 切换文档' });

            console.log('[SwitchDocument] 已切换到:', targetDoc.name);

            return {
                success: true,
                document: {
                    id: targetDoc.id,
                    name: targetDoc.name,
                    width: targetDoc.width,
                    height: targetDoc.height
                },
                matchInfo
            };

        } catch (error) {
            console.error('[SwitchDocument] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '切换文档失败'
            };
        }
    }
}
