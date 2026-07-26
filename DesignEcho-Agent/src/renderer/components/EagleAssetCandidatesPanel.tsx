import React, { useEffect, useMemo, useState } from 'react';
import {
    buildEagleAssetCandidatesPanel,
    type EagleAssetCandidatesPanelViewModel
} from '../../shared/eagle-asset-candidates-panel';
import {
    buildEagleCandidateVisualHandoff,
    type EagleCandidateVisualHandoff
} from '../../shared/eagle-candidate-visual-handoff';
import {
    getEagleAssetCandidatesService,
    type EagleAssetCandidatesService
} from '../services/eagle-asset-candidates.service';

interface EagleAssetCandidatesPanelProps {
    query: string;
    service?: EagleAssetCandidatesService;
}

export const EagleAssetCandidatesPanel: React.FC<EagleAssetCandidatesPanelProps> = ({
    query,
    service
}) => {
    const normalizedQuery = query.trim() || 'Eagle readonly asset candidates';
    const serviceInstance = useMemo(
        () => service || getEagleAssetCandidatesService(),
        [service]
    );
    const [panel, setPanel] = useState<EagleAssetCandidatesPanelViewModel>(() =>
        buildEagleAssetCandidatesPanel({ query: normalizedQuery })
    );
    const [selectedCandidateId, setSelectedCandidateId] = useState('');
    const [handoff, setHandoff] = useState<EagleCandidateVisualHandoff>(() =>
        buildEagleCandidateVisualHandoff({
            panel: buildEagleAssetCandidatesPanel({ query: normalizedQuery }),
            requestedBy: 'renderer:eagle-asset-candidates-panel'
        })
    );
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        const nextPanel = buildEagleAssetCandidatesPanel({ query: normalizedQuery });
        setPanel(nextPanel);
        setSelectedCandidateId('');
        setHandoff(buildEagleCandidateVisualHandoff({
            panel: nextPanel,
            requestedBy: 'renderer:eagle-asset-candidates-panel'
        }));
        setIsSearching(false);
    }, [normalizedQuery]);

    const handleSearch = async () => {
        setIsSearching(true);
        setSelectedCandidateId('');
        try {
            const nextPanel = await serviceInstance.search({
                query: normalizedQuery,
                limit: 6,
                preferAiSearch: true
            });
            setPanel(nextPanel);
            setHandoff(buildEagleCandidateVisualHandoff({
                panel: nextPanel,
                requestedBy: 'renderer:eagle-asset-candidates-panel'
            }));
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectCandidate = (candidateId: string) => {
        setSelectedCandidateId(candidateId);
        setHandoff(buildEagleCandidateVisualHandoff({
            panel,
            selectedCandidateId: candidateId,
            requestedBy: 'renderer:eagle-asset-candidates-panel'
        }));
    };

    return (
        <section
            className="workbench-inspector-section eagle-asset-candidates-panel"
            data-testid="workbench-eagle-asset-candidates-panel"
        >
            <div className="workbench-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M4 4h16v5H4z" />
                    <path d="M4 15h6v5H4z" />
                    <path d="M14 15h6v5h-6z" />
                    <path d="M7 9v6" />
                    <path d="M17 9v6" />
                </svg>
                Eagle 候选
            </div>
            <div
                className={`eagle-asset-candidates-status ${panel.status}`}
                data-testid="workbench-eagle-asset-candidates-status"
            >
                <span>{isSearching ? '正在查找' : panel.statusLabel}</span>
                <strong>{panel.totals.candidateCount} 个候选</strong>
            </div>
            <p className="eagle-asset-candidates-summary">
                {panel.summary}
            </p>
            <div className="eagle-asset-candidates-metrics">
                <span>标签 {panel.totals.tagCount}</span>
                <span>文件夹 {panel.totals.folderCount}</span>
                <span>待分析 {panel.totals.needsVisualAnalysisCount}</span>
            </div>
            <div className="eagle-asset-candidates-actions">
                <button
                    type="button"
                    onClick={handleSearch}
                    disabled={isSearching}
                    data-testid="workbench-eagle-asset-candidates-search-button"
                >
                    {isSearching ? '查找中' : '查找候选'}
                </button>
            </div>
            {panel.candidates.length > 0 && (
                <ul className="eagle-asset-candidates-list">
                    {panel.candidates.slice(0, 3).map((candidate) => (
                        <li
                            key={candidate.candidateId}
                            className={`eagle-asset-candidate-item ${selectedCandidateId === candidate.candidateId ? 'selected' : ''}`}
                        >
                            <div className="eagle-asset-candidate-heading">
                                <span>{candidate.title}</span>
                                <strong>{candidate.readinessLabel}</strong>
                            </div>
                            <p>{candidate.dimensionsLabel}</p>
                            <div className="eagle-asset-candidate-tags">
                                {[...candidate.tagPreview, ...candidate.allowedUseLabels].slice(0, 4).map((tag, index) => (
                                    <span key={`${candidate.candidateId}:${index}:${tag}`}>{tag}</span>
                                ))}
                            </div>
                            <div className="eagle-asset-candidate-action">
                                <button
                                    type="button"
                                    aria-pressed={selectedCandidateId === candidate.candidateId}
                                    onClick={() => handleSelectCandidate(candidate.candidateId)}
                                    data-testid="workbench-eagle-asset-candidate-select-button"
                                >
                                    {selectedCandidateId === candidate.candidateId ? '已选择' : '选择'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <div
                className={`eagle-candidate-visual-handoff ${handoff.status}`}
                data-testid="workbench-eagle-candidate-visual-handoff"
            >
                <div className="eagle-candidate-visual-handoff-heading">
                    <span>{handoff.statusLabel}</span>
                    <strong>{handoff.visualAnalysisRequest.shouldRequestVisualAnalysis ? '待视觉分析' : '未交接'}</strong>
                </div>
                {handoff.selectedCandidate && (
                    <p>
                        {handoff.selectedCandidate.title} · {handoff.selectedCandidate.dimensionsLabel}
                    </p>
                )}
                <p>{handoff.visualAnalysisRequest.reason}</p>
                {handoff.requiredReview.length > 0 && (
                    <div className="eagle-candidate-visual-handoff-tags">
                        {handoff.requiredReview.slice(0, 3).map((item) => (
                            <span key={item}>{item}</span>
                        ))}
                    </div>
                )}
            </div>
            {(panel.warnings.length > 0 || panel.limitations.length > 0) && (
                <ul className="eagle-asset-candidates-message-list">
                    {[...panel.warnings, ...panel.limitations].slice(0, 4).map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
            )}
            <div
                className="eagle-asset-candidates-boundary"
                data-testid="workbench-eagle-asset-candidates-boundary"
            >
                {panel.boundary}
            </div>
        </section>
    );
};
