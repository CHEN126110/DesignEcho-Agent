/**
 * Skill executor registry.
 * Keeps each skill implementation isolated while exposing one execution entrypoint.
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import {
    executeSkillWithExecutor as executeSkillWithExecutorFromRegistry,
    getSkillExecutor as getSkillExecutorFromRegistry,
    registerSkillExecutor as registerSkillExecutorInRegistry
} from './registry';

import { matteProductExecutor } from './matte-product.executor';
import { smartLayoutExecutor } from './smart-layout.executor';
import { skuColorCardExecutor } from './sku-color-card.executor';
import { skuBatchExecutor } from './sku-batch.executor';
import { skuConfigExecutor } from './sku-config.executor';
import { layoutReplicationExecutor } from './layout-replication.executor';
import { ecommerceSocksDesignExecutor } from './ecommerce-socks-design.executor';
import { mainImageExecutor } from './main-image.executor';
import { visualAnalysisExecutor } from './visual-analysis.executor';
import { projectImageAnalysisExecutor } from './project-image-analysis.executor';
import { layerManagementExecutor } from './layer-management.executor';
import { designReferenceSearchExecutor } from './design-reference-search.executor';
import { findEditElementExecutor } from './find-edit-element.executor';
import { agentPanelBridgeExecutor } from './agent-panel-bridge.executor';
import { documentManagementExecutor } from './document-management.executor';
import { templateSaveExecutor } from './template-save.executor';
import { detailPageExecutor } from './detail-page.executor';
import { textFontReplaceExecutor } from './text-font-replace.executor';

const lazyAutonomousAgentExecutor: SkillExecutor = {
    skillId: 'autonomous-agent',
    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        const { autonomousAgentExecutor } = await import('./autonomous-agent.executor');
        return autonomousAgentExecutor.execute(executeParams);
    }
};

function registerBuiltinExecutors(): void {
    registerSkillExecutorInRegistry(matteProductExecutor);

    registerSkillExecutorInRegistry(smartLayoutExecutor);
    registerSkillExecutorInRegistry(layoutReplicationExecutor);
    registerSkillExecutorInRegistry(ecommerceSocksDesignExecutor);

    registerSkillExecutorInRegistry(mainImageExecutor);
    registerSkillExecutorInRegistry(detailPageExecutor);
    registerSkillExecutorInRegistry(skuConfigExecutor);
    registerSkillExecutorInRegistry(skuColorCardExecutor);
    registerSkillExecutorInRegistry(skuBatchExecutor);

    registerSkillExecutorInRegistry(visualAnalysisExecutor);
    registerSkillExecutorInRegistry(projectImageAnalysisExecutor);
    registerSkillExecutorInRegistry(layerManagementExecutor);
    registerSkillExecutorInRegistry(findEditElementExecutor);
    registerSkillExecutorInRegistry(agentPanelBridgeExecutor);
    registerSkillExecutorInRegistry(documentManagementExecutor);
    registerSkillExecutorInRegistry(templateSaveExecutor);
    registerSkillExecutorInRegistry(textFontReplaceExecutor);

    registerSkillExecutorInRegistry(designReferenceSearchExecutor);
    registerSkillExecutorInRegistry(lazyAutonomousAgentExecutor);
}

registerBuiltinExecutors();

export function getSkillExecutor(skillId: string): SkillExecutor | undefined {
    return getSkillExecutorFromRegistry(skillId);
}

export function registerSkillExecutor(executor: SkillExecutor): void {
    registerSkillExecutorInRegistry(executor);
}

export async function executeSkillWithExecutor(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<AgentResult> {
    return executeSkillWithExecutorFromRegistry(skillId, executeParams);
}

export type { SkillExecutor, SkillExecuteParams } from './types';
