import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import {
  BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS,
  buildBusinessSkillReadinessContract,
  type BusinessSkillReadinessContract,
  type BusinessSkillReadinessInputKey,
  type BusinessSkillReadinessRiskFlags,
  type BusinessSkillReadinessStrategyInputs
} from './business-skill-readiness-contract';
import type { EcommerceSocksDeliverable } from './ecommerce-socks-design';

export type EcommerceSocksStrategyCheckpointStatus =
  | 'blocked_missing_user_checkpoint'
  | 'blocked_missing_child_strategy_inputs'
  | 'ready_for_child_strategy_design';

export interface EcommerceSocksStrategyCheckpointChild {
  deliverable: EcommerceSocksDeliverable;
  skillId: BusinessDesignSkillId;
  contract: BusinessSkillReadinessContract;
}

export interface EcommerceSocksStrategyCheckpointBlockedChild {
  deliverable: EcommerceSocksDeliverable;
  skillId: BusinessDesignSkillId;
  status: BusinessSkillReadinessContract['status'];
  missingInputs: BusinessSkillReadinessInputKey[];
  blockers: string[];
}

export interface BuildEcommerceSocksStrategyCheckpointInput {
  deliverables: EcommerceSocksDeliverable[];
  userCheckpointConfirmed?: boolean;
  strategyInputsBySkill?: Partial<Record<BusinessDesignSkillId, BusinessSkillReadinessStrategyInputs>>;
  riskFlagsBySkill?: Partial<Record<BusinessDesignSkillId, BusinessSkillReadinessRiskFlags>>;
}

export interface EcommerceSocksStrategyCheckpoint {
  version: 'ecommerce-socks-strategy-checkpoint/v0';
  parentSkillId: 'ecommerce-socks-design';
  scene: 'ecommerce-socks';
  status: EcommerceSocksStrategyCheckpointStatus;
  userCheckpointConfirmed: boolean;
  canStartChildStrategyDesign: boolean;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustTellUserBeforeChildStrategyChange: true;
  requiredDiscussionTopics: BusinessSkillReadinessInputKey[];
  childReadiness: EcommerceSocksStrategyCheckpointChild[];
  blockedChildren: EcommerceSocksStrategyCheckpointBlockedChild[];
  blockers: string[];
  warnings: string[];
  boundaries: string[];
}

const SKILL_BY_DELIVERABLE: Record<EcommerceSocksDeliverable, BusinessDesignSkillId> = {
  'main-image': 'main-image-design',
  'detail-page': 'detail-page-design',
  sku: 'sku-batch'
};

const CHECKPOINT_BOUNDARIES = [
  'This checkpoint is a parent strategy-design gate only.',
  'This checkpoint does not execute child skills.',
  'This checkpoint does not call a provider, vision model, or Photoshop tool.',
  'This checkpoint does not prove ecommerce socks design quality.'
];

export function buildEcommerceSocksStrategyCheckpoint(
  input: BuildEcommerceSocksStrategyCheckpointInput
): EcommerceSocksStrategyCheckpoint {
  const userCheckpointConfirmed = input.userCheckpointConfirmed === true;
  const deliverables = Array.from(new Set(input.deliverables));
  const childReadiness = deliverables.map((deliverable) => {
    const skillId = SKILL_BY_DELIVERABLE[deliverable];
    return {
      deliverable,
      skillId,
      contract: buildBusinessSkillReadinessContract({
        skillId,
        userCheckpointConfirmed,
        strategyInputs: input.strategyInputsBySkill?.[skillId],
        riskFlags: input.riskFlagsBySkill?.[skillId]
      })
    };
  });
  const blockedChildren = childReadiness
    .filter((item) => !item.contract.canModifyBusinessStrategy)
    .map((item) => ({
      deliverable: item.deliverable,
      skillId: item.skillId,
      status: item.contract.status,
      missingInputs: item.contract.missingInputs,
      blockers: item.contract.blockers
    }));
  const status = buildStatus(userCheckpointConfirmed, blockedChildren);
  const warnings = childReadiness.flatMap((item) => item.contract.warnings);

  return {
    version: 'ecommerce-socks-strategy-checkpoint/v0',
    parentSkillId: 'ecommerce-socks-design',
    scene: 'ecommerce-socks',
    status,
    userCheckpointConfirmed,
    canStartChildStrategyDesign: status === 'ready_for_child_strategy_design',
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustTellUserBeforeChildStrategyChange: true,
    requiredDiscussionTopics: [...BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS],
    childReadiness,
    blockedChildren,
    blockers: buildBlockers(userCheckpointConfirmed, blockedChildren),
    warnings: Array.from(new Set(warnings)),
    boundaries: [...CHECKPOINT_BOUNDARIES]
  };
}

function buildStatus(
  userCheckpointConfirmed: boolean,
  blockedChildren: EcommerceSocksStrategyCheckpointBlockedChild[]
): EcommerceSocksStrategyCheckpointStatus {
  if (!userCheckpointConfirmed) {
    return 'blocked_missing_user_checkpoint';
  }

  if (blockedChildren.length > 0) {
    return 'blocked_missing_child_strategy_inputs';
  }

  return 'ready_for_child_strategy_design';
}

function buildBlockers(
  userCheckpointConfirmed: boolean,
  blockedChildren: EcommerceSocksStrategyCheckpointBlockedChild[]
): string[] {
  const blockers: string[] = [];

  if (!userCheckpointConfirmed) {
    blockers.push('user_checkpoint_required');
  }

  if (blockedChildren.length > 0) {
    blockers.push('child_strategy_inputs_missing');
  }

  return blockers;
}
