/**
 * CreativeStrategy — 所有者：R3 Creative Strategy
 * 定义「表达什么、以什么创意方向表达」；禁止 x/y/w/h、React 组件、PSD 图层名、tool_id、具体 Photoshop 实现。
 */

import type {
    ArtifactMeta,
    ArtifactRef,
    MissingInput,
    DetailPageModuleType,
    ModulePriority
} from './common';

export interface ContentModuleStrategy {
    moduleId: string;
    moduleType: DetailPageModuleType;
    priority: ModulePriority;
    intent: string;
    keyMessage: string;
    sourceRefs: string[];
}

export interface ReferenceTransferItem {
    referenceId: string;
    borrow: string[];
    avoid: string[];
    adaptationNotes: string[];
}

export interface StrategyVariant {
    variantId: string;
    label: string;
    intent: string;
    messageOverride?: string;
    visualOverride?: string[];
}

export interface CreativeStrategy {
    meta: ArtifactMeta;
    payload: {
        contextSnapshotRef: ArtifactRef;
        objective: {
            primaryGoal: string;
            secondaryGoals: string[];
            targetAudienceSummary: string;
        };
        messageArchitecture: {
            primaryMessage: string;
            supportingMessages: string[];
            supportingFacts: string[];
            objectionsToResolve: string[];
        };
        contentModules: ContentModuleStrategy[];
        copyDirection: {
            toneKeywords: string[];
            headlineOptions: string[];
            subtitleOptions: string[];
            tagOptions: string[];
            prohibitedClaims: string[];
        };
        visualDirection: {
            moodKeywords: string[];
            paletteIntent: string[];
            typographyIntent: string[];
            compositionIntent: string[];
            imageTreatment: string[];
            density: 'low' | 'medium' | 'high';
        };
        referenceTransfer: ReferenceTransferItem[];
        variants: StrategyVariant[];
        constraints: string[];
        missingInputs: MissingInput[];
    };
}
