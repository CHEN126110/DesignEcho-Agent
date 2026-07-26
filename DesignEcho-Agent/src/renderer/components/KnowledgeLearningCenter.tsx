import React, { useEffect, useState } from 'react';
import { BrainCircuit, ShieldCheck } from 'lucide-react';

import { getMemoryService } from '../services/memory.service';
import { DesignLearningReviewSettingsPanel } from './DesignLearningReviewSettingsPanel';
import { DesignLearningRuntimeSettingsPanel } from './DesignLearningRuntimeSettingsPanel';

export function KnowledgeLearningCenter(): React.ReactElement {
    const [memoryRevision, setMemoryRevision] = useState(0);

    useEffect(() => getMemoryService().subscribe(() => {
        setMemoryRevision((revision) => revision + 1);
    }), []);

    function handleMemoryChanged(): void {
        setMemoryRevision((revision) => revision + 1);
    }

    return (
        <section className="knowledge-panel" data-testid="knowledge-learning-center">
            <div className="knowledge-panel__heading">
                <div>
                    <span className="knowledge-eyebrow">Human in the loop</span>
                    <h2>学习与复核</h2>
                    <p>学习只生成候选；经过你复核后才成为长期知识。拒绝项会保留用于避免重复学习，但不会再进入 Agent。</p>
                </div>
                <span className="knowledge-boundary-badge"><ShieldCheck size={14} aria-hidden="true" />人工复核后生效</span>
            </div>
            <div className="knowledge-learning-callout">
                <BrainCircuit size={18} aria-hidden="true" />
                <div><strong>学习不是自动改能力</strong><span>页面打开不会启动学习；每次学习都需要你明确点击，结果先进入待复核队列。</span></div>
            </div>
            <DesignLearningRuntimeSettingsPanel onMemoryChanged={handleMemoryChanged} />
            <DesignLearningReviewSettingsPanel
                onMemoryChanged={handleMemoryChanged}
                refreshRevision={memoryRevision}
            />
        </section>
    );
}
