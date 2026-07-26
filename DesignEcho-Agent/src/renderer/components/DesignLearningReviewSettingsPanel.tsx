import React, { useEffect, useState } from 'react';
import {
    getMemoryService,
    type GetDesignLearningMemoryReviewQueueOptions
} from '../services/memory.service';
import type {
    DesignLearningMemoryReviewQueueItemView,
    DesignLearningMemoryReviewQueueView
} from '../../shared/design-learning-memory-review-queue';
import type { DesignLearningMemoryReviewDecision } from '../../shared/design-learning-memory-review';
import { buildCompositionThirdsLines, subjectCoveragePercentFromRect } from '../../shared/design-learning-visual-case';
import type { DesignMemoryItem } from '../../shared/design-memory-knowledge';

interface DesignLearningReviewSettingsPanelProps {
    options?: GetDesignLearningMemoryReviewQueueOptions;
    onMemoryChanged?: () => void;
    refreshRevision?: number;
}

const REVIEWER = 'knowledge-library-learning-review';

export const DesignLearningReviewSettingsPanel: React.FC<DesignLearningReviewSettingsPanelProps> = ({
    options,
    onMemoryChanged,
    refreshRevision = 0
}) => {
    const [queue, setQueue] = useState<DesignLearningMemoryReviewQueueView>(() =>
        getMemoryService().getDesignLearningMemoryReviewQueueView({
            limit: 20,
            ...options
        })
    );
    const [activeItems, setActiveItems] = useState<DesignMemoryItem[]>(() =>
        getMemoryService().listPersistedDesignMemoryItems({
            status: 'active',
            scope: options?.scope,
            limit: 20
        })
    );
    const [message, setMessage] = useState('');

    useEffect(() => {
        setQueue(getMemoryService().getDesignLearningMemoryReviewQueueView({
            limit: 20,
            ...options
        }));
        setActiveItems(getMemoryService().listPersistedDesignMemoryItems({
            status: 'active',
            scope: options?.scope,
            limit: 20
        }));
    }, [refreshRevision, options?.scope?.type, options?.scope?.id, options?.limit]);

    const refreshMemoryViews = () => {
        setQueue(getMemoryService().getDesignLearningMemoryReviewQueueView({
            limit: 20,
            ...options
        }));
        setActiveItems(getMemoryService().listPersistedDesignMemoryItems({
            status: 'active',
            scope: options?.scope,
            limit: 20
        }));
    };

    const handleReview = (
        item: DesignLearningMemoryReviewQueueItemView,
        decision: DesignLearningMemoryReviewDecision
    ) => {
        try {
            const result = getMemoryService().reviewDesignLearningMemoryCandidateById({
                candidateId: item.candidateId,
                decision,
                reviewer: REVIEWER,
                notes: [buildReviewNote(item, decision)],
                reviewedAt: new Date().toISOString()
            });
            refreshMemoryViews();
            onMemoryChanged?.();
            setMessage(buildResultMessage(result.status, item.title));
        } catch (error: any) {
            setMessage(error?.message || '复核设计学习候选失败。');
        }
    };

    return (
        <div className="knowledge-learning-review" data-testid="design-learning-review-panel">
            <div className="config-section">
                <div className="dl-review-head">
                    <h3 className="section-title" style={{ margin: 0 }}>设计学习复核</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className={`dl-pending-pill ${queue.summary.pendingCount > 0 ? '' : 'is-empty'}`}>
                            {queue.summary.pendingCount > 0 ? `${queue.summary.pendingCount} 条待复核` : '暂无待复核'}
                        </span>
                        <button className="btn btn-secondary" type="button" onClick={refreshMemoryViews}>
                            刷新
                        </button>
                    </div>
                </div>
                <p className="dl-review-intro">
                    下面是 Agent 从项目参考里提炼的设计经验。看清内容后，批准的会成为长期设计知识、参与以后的设计；拒绝的不再出现。
                </p>

                {message && (
                    <div
                        className="test-message success"
                        style={{ marginBottom: '12px' }}
                        role="status"
                        aria-live="polite"
                    >
                        {message}
                    </div>
                )}

                {queue.items.length === 0 ? (
                    <div className="dl-empty">
                        <strong>还没有可复核的设计经验。</strong><br />
                        在上方点「开始学习」，Agent 提炼的设计判断会先出现在这里，批准后才会用于以后的设计。
                    </div>
                ) : (
                    <div className="dl-card-list">
                        {queue.items.map((item) => (
                            <div key={item.candidateId} className="dl-card">
                                <div className="dl-card-title-row">
                                    <span className="dl-card-title">{item.title}</span>
                                    <span className="dl-card-status">待复核</span>
                                </div>
                                <div className="dl-card-meta">
                                    <span>{formatScope(item.scope)}</span>
                                    {item.updatedAt && <span>{formatDate(item.updatedAt)}</span>}
                                    {item.tags.slice(0, 5).map((tag) => (
                                        <span key={tag} className="dl-tag">{tag}</span>
                                    ))}
                                </div>
                                {item.visualCase && <VisualCaseView visualCase={item.visualCase} />}
                                {item.summary && <p className="dl-card-summary">{item.summary}</p>}
                                {item.insights && <LearnedInsightsView insights={item.insights} />}
                                {item.sourceNotes.length > 0 && (
                                    <div className="dl-card-source-notes">
                                        <span className="dl-source-notes-label">来源说明</span>
                                        {item.sourceNotes.slice(0, 3).join(' · ')}
                                    </div>
                                )}
                                <div className="dl-card-actions">
                                    <button className="btn btn-primary" type="button" onClick={() => handleReview(item, 'approved')}>
                                        批准并采用
                                    </button>
                                    <button className="btn btn-secondary" type="button" onClick={() => handleReview(item, 'needs_review')}>
                                        稍后再看
                                    </button>
                                    <button className="btn btn-secondary" type="button" onClick={() => handleReview(item, 'rejected')}>
                                        拒绝
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <p className="dl-footnote">
                    复核只决定经验能否进入长期记忆，不会启动学习，也不会改动 Photoshop 或 Eagle。
                    {queue.warnings.length > 0 && queue.warnings.map((warning) => (
                        <span key={warning}><br />{warning}</span>
                    ))}
                </p>
            </div>

            <div className="config-section dl-active-section" data-testid="design-learning-active-memory-list">
                <div className="dl-review-head">
                    <div>
                        <h3 className="section-title" style={{ margin: 0 }}>已采用的长期设计记忆</h3>
                        <p className="dl-review-intro" style={{ marginTop: '6px', marginBottom: 0 }}>
                            这些内容已经通过复核，可作为后续设计参考；当前任务和项目事实仍然优先。
                        </p>
                    </div>
                    <span className={`dl-pending-pill ${activeItems.length > 0 ? 'is-active' : 'is-empty'}`}>
                        {activeItems.length} 条已采用
                    </span>
                </div>

                {activeItems.length === 0 ? (
                    <div className="dl-empty">
                        <strong>还没有已采用的长期设计记忆。</strong><br />
                        学习候选在上方批准后，会保留在这里供你随时查看。
                    </div>
                ) : (
                    <div className="dl-card-list">
                        {activeItems.map((item) => (
                            <div key={item.id} className="dl-card dl-card-active">
                                <div className="dl-card-title-row">
                                    <span className="dl-card-title">{item.title}</span>
                                    <span className="dl-card-status is-active">已采用</span>
                                </div>
                                <div className="dl-card-meta">
                                    <span>{formatScope(item.scope)}</span>
                                    {item.updatedAt && <span>{formatDate(item.updatedAt)}</span>}
                                    {(item.tags || []).slice(0, 5).map((tag) => (
                                        <span key={tag} className="dl-tag">{tag}</span>
                                    ))}
                                </div>
                                {item.visualCase && <VisualCaseView visualCase={item.visualCase} />}
                                {item.summary && <p className="dl-card-summary">{item.summary}</p>}
                                {item.learnedInsights && <LearnedInsightsView insights={item.learnedInsights} />}
                                {formatActiveMemorySourceNotes(item).length > 0 && (
                                    <div className="dl-card-source-notes">
                                        <span className="dl-source-notes-label">来源</span>
                                        {formatActiveMemorySourceNotes(item).join(' · ')}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

function formatActiveMemorySourceNotes(item: DesignMemoryItem): string[] {
    const labels = item.sourceNotes.flatMap((entry) => {
        if (entry.source === 'interactive-card-confirmation') return ['用户确认'];
        if (entry.source === 'knowledge-library-revision') {
            const revision = entry.summary.match(/(?:^|;)\s*revision=(\d+)/)?.[1];
            return [revision ? `知识库修订 · v${revision}` : '知识库修订'];
        }
        if (entry.source === 'knowledge-library-lifecycle' && /(?:^|;)\s*status=active(?:;|$)/.test(entry.summary)) {
            return ['用户恢复'];
        }
        if (entry.source.includes('learning') || entry.source.includes('review')) return ['人工复核'];
        if (entry.source.includes('benchmark')) return ['基准案例'];
        if (entry.source.includes('import')) return ['导入案例'];
        return [];
    });
    const uniqueLabels = Array.from(new Set(labels));
    if (uniqueLabels.length > 0) return uniqueLabels.slice(0, 3);
    if (item.source === 'accepted_output' || item.source === 'explicit_user_feedback') return ['用户确认'];
    if (item.source === 'benchmark') return ['基准案例'];
    if (item.source === 'imported_case') return ['导入案例'];
    return ['已复核'];
}

/**
 * 学习视觉案例：把经验钉在真实参考图上——展示真实图 + 三分构图线 + 真实分割出的主体框，
 * 让"主体占画面X%"这类判断有图为证，而不是纯文本。主体框来自抠图蒙版（真实分割，非弱模型猜）。
 */
export function VisualCaseView({ visualCase }: { visualCase: NonNullable<DesignLearningMemoryReviewQueueItemView['visualCase']> }): React.ReactElement {
    const thirds = buildCompositionThirdsLines();
    const rect = visualCase.subjectRect;
    const coverage = subjectCoveragePercentFromRect(rect);
    return (
        <div className="dl-visual-case">
            <div className="dl-visual-frame">
                <img className="dl-visual-img" src={visualCase.previewDataUrl} alt={visualCase.caption || '学习参考图'} />
                <svg className="dl-visual-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {visualCase.showCompositionGrid && (
                        <g className="dl-thirds">
                            {thirds.verticals.map((x) => (
                                <line key={`v${x}`} x1={x * 100} y1="0" x2={x * 100} y2="100" />
                            ))}
                            {thirds.horizontals.map((y) => (
                                <line key={`h${y}`} x1="0" y1={y * 100} x2="100" y2={y * 100} />
                            ))}
                            {thirds.powerPoints.map((p, i) => (
                                <circle key={`p${i}`} cx={p.x * 100} cy={p.y * 100} r="0.9" />
                            ))}
                        </g>
                    )}
                    {rect && (
                        <rect className="dl-subject-box" x={rect.x * 100} y={rect.y * 100} width={rect.w * 100} height={rect.h * 100} />
                    )}
                </svg>
            </div>
            <div className="dl-visual-caption">
                {visualCase.caption && <span>{visualCase.caption}</span>}
                {coverage !== undefined
                    ? <span className="dl-visual-metric">主体占画面 {coverage}%（分割实测）</span>
                    : <span className="dl-visual-metric dl-visual-metric-muted">未分割出主体框</span>}
            </div>
        </div>
    );
}

/**
 * 知识卡片的语义切面：把 Agent 学到的设计判断按 6 个角色展示，每类一种语义色——
 * 强项/原因/可复用规则/适用/警示/局限。让用户看清"学到了什么真实内容"，便于判断与调整。
 */
function LearnedInsightsView({ insights }: { insights: NonNullable<DesignLearningMemoryReviewQueueItemView['insights']> }): React.ReactElement {
    const facets: Array<{ label: string; items?: string[]; accent: string }> = [
        { label: '好在哪儿', items: insights.whatLooksGood, accent: '#34d399' },
        { label: '为什么成立', items: insights.whyItWorks, accent: '#60a5fa' },
        { label: '可复用手法', items: insights.reusableHeuristics, accent: '#a78bfa' },
        { label: '适合场景', items: insights.suitableScenarios, accent: '#93c5fd' },
        { label: '何时避免', items: insights.avoidWhen, accent: '#fbbf24' },
        { label: '局限', items: insights.limitations, accent: '#f87171' }
    ].filter((facet) => Array.isArray(facet.items) && facet.items.length > 0);

    if (facets.length === 0) return <></>;

    return (
        <div className="dl-facets">
            {facets.map((facet) => (
                <div key={facet.label} className="dl-facet">
                    <span className="dl-facet-label" style={{ color: facet.accent }}>{facet.label}</span>
                    <ul className="dl-facet-items">
                        {facet.items!.map((entry, index) => (
                            <li key={`${facet.label}-${index}`}>{entry}</li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

function buildReviewNote(
    item: DesignLearningMemoryReviewQueueItemView,
    decision: DesignLearningMemoryReviewDecision
): string {
    if (decision === 'approved') return `知识库批准：${item.title}`;
    if (decision === 'rejected') return `知识库拒绝：${item.title}`;
    return `知识库保留待复核：${item.title}`;
}

function buildResultMessage(status: string, title: string): string {
    if (status === 'promoted_active') return `已批准：${title}`;
    if (status === 'rejected_disabled') return `已拒绝：${title}`;
    return `已保留待复核：${title}`;
}

function formatScope(scope: DesignLearningMemoryReviewQueueItemView['scope']): string {
    if (scope.type === 'project') return scope.id ? `项目：${scope.id}` : '项目级';
    if (scope.type === 'brand') return scope.id ? `品牌：${scope.id}` : '品牌级';
    if (scope.type === 'session') return scope.id ? `会话：${scope.id}` : '会话级';
    return '用户级';
}

function formatDate(value: string | number): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
