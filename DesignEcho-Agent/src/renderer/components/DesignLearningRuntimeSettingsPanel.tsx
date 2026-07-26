import React, { useRef, useState } from 'react';
import { useAppStore } from '../stores/app.store';
import {
    createDesignLearningRuntimeEntryController,
    type DesignLearningRuntimeEntryResult
} from '../services/design-learning-runtime-entry.service';

interface DesignLearningRuntimeSettingsPanelProps {
    onMemoryChanged?: () => void;
}

export const DesignLearningRuntimeSettingsPanel: React.FC<DesignLearningRuntimeSettingsPanelProps> = ({ onMemoryChanged }) => {
    const { currentProject, ecommerceStructure } = useAppStore();
    const controller = useRef(createDesignLearningRuntimeEntryController());
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<DesignLearningRuntimeEntryResult | null>(null);
    const [error, setError] = useState('');

    const handleRunManualLearning = async () => {
        if (running) return;
        setRunning(true);
        setError('');
        try {
            const nextResult = await controller.current.runManual({
                currentProject,
                ecommerceStructure,
                now: new Date().toISOString(),
                cadence: 'daily'
            });
            setResult(nextResult);
            if (nextResult.reviewQueue.queuedCount > 0) {
                onMemoryChanged?.();
            }
        } catch (caught: any) {
            setError(caught?.message || '手动学习运行失败，请重试。');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="integration-card" style={{ marginBottom: '16px' }} data-testid="design-learning-runtime-panel">
            <div className="integration-card-header">
                <div>
                    <div className="integration-card-title">手动学习</div>
                    <div className="integration-card-subtitle">
                        主动收集当前项目和素材相关的设计参考，结果会先进入下方复核队列。
                    </div>
                </div>
                <button
                    className="btn btn-primary"
                    type="button"
                    onClick={handleRunManualLearning}
                    disabled={running}
                >
                    {running ? '学习中...' : '开始学习'}
                </button>
            </div>

            <div role="status" aria-live="polite">
                {error
                    ? <div className="dl-outcome is-blocked">{error}</div>
                    : <RuntimeOutcome running={running} result={result} />}
            </div>

            {result?.warnings.length ? (
                <div className="dl-footnote">
                    {result.warnings.slice(0, 3).map((warning) => (
                        <div key={warning}>{warning}</div>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

/** 把学习结果说成一句可读的话（内容），而不是三张大数字卡（数据）。 */
function RuntimeOutcome({ running, result }: { running: boolean; result: DesignLearningRuntimeEntryResult | null }): React.ReactElement {
    if (running) {
        return <div className="dl-outcome">正在看当前项目的参考图，提炼可复用的设计判断…</div>;
    }
    if (!result) {
        return (
            <div className="dl-outcome">
                点「开始学习」，Agent 会看当前项目的参考图、并解析项目里的 PSD/PSB 设计源（字号/色板/版心/分屏），提炼出可复用的设计判断，先放到下方等你审阅。
            </div>
        );
    }
    if (result.status === 'blocked') {
        return (
            <div className="dl-outcome is-blocked">
                这次没能学起来：{result.blockers[0] || '当前条件不足，先打开一个带参考图或设计源（PSD/PSB）的项目再试。'}
            </div>
        );
    }
    const seen = result.projectImages.selectedCount;
    const psdParsed = result.psdSources?.parsedCount || 0;
    const queued = result.reviewQueue.queuedCount;
    const sourcesText = [
        seen > 0 ? `${seen} 张项目参考图` : '',
        psdParsed > 0 ? `${psdParsed} 份 PSD/PSB 设计源` : ''
    ].filter(Boolean).join('和') || '当前项目素材';
    if (result.status === 'manual_review_queued' && queued > 0) {
        return (
            <div className="dl-outcome">
                这次学习了 {sourcesText}，
                提炼出 <span className="dl-outcome-count">{queued}</span> 条设计经验。
                <div className="dl-outcome-pointer">↓ 在下方「设计学习复核」里查看内容，批准后 Agent 才会用作长期参考</div>
            </div>
        );
    }
    return (
        <div className="dl-outcome">
            这次学习了 {sourcesText}，没有提炼出够格的新经验。
            往项目里放参考图或设计师 PSD/PSB 源文件、或确认视觉模型能读图后再试。
        </div>
    );
}
