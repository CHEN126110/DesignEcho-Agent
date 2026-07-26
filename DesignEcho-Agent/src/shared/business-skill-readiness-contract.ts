import {
  buildBusinessSkillImplementationCheckpoint,
  type BusinessDesignSkillId,
  type BusinessSkillImplementationCheckpoint
} from './business-skill-implementation-checkpoint';

export type BusinessSkillReadinessInputKey =
  | 'designStandards'
  | 'knowledgeRecipeSource'
  | 'assetUnderstanding'
  | 'imagePlacementPlan'
  | 'photoshopToolPlan'
  | 'qaAcceptancePlan'
  | 'performanceBudget';

export type BusinessSkillReadinessContractStatus =
  | 'blocked_missing_user_checkpoint'
  | 'blocked_missing_strategy_inputs'
  | 'ready_for_strategy_design';

export interface BusinessSkillReadinessStrategyInputs {
  designStandards?: boolean;
  knowledgeRecipeSource?: boolean;
  assetUnderstanding?: boolean;
  imagePlacementPlan?: boolean;
  photoshopToolPlan?: boolean;
  qaAcceptancePlan?: boolean;
  performanceBudget?: boolean;
  [key: string]: unknown;
}

export interface BusinessSkillReadinessRiskFlags {
  fexBenchmarkOnly?: boolean;
  toolOnlyPanelFeature?: boolean;
  syntheticFixtureOnly?: boolean;
}

export interface BuildBusinessSkillReadinessContractInput {
  skillId: BusinessDesignSkillId;
  userCheckpointConfirmed?: boolean;
  strategyInputs?: BusinessSkillReadinessStrategyInputs;
  riskFlags?: BusinessSkillReadinessRiskFlags;
}

export interface BusinessSkillReadinessContract {
  version: 'business-skill-readiness-contract/v0';
  skillId: BusinessDesignSkillId;
  status: BusinessSkillReadinessContractStatus;
  userCheckpointConfirmed: boolean;
  canModifyBusinessStrategy: boolean;
  canClaimDesignQuality: false;
  requiredInputs: BusinessSkillReadinessInputKey[];
  missingInputs: BusinessSkillReadinessInputKey[];
  readyInputs: BusinessSkillReadinessInputKey[];
  requiredOutputs: string[];
  implementationCheckpoint: BusinessSkillImplementationCheckpoint;
  blockers: string[];
  warnings: string[];
  requiredNextChecks: string[];
  boundaries: string[];
}

export const BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS: BusinessSkillReadinessInputKey[] = [
  'designStandards',
  'knowledgeRecipeSource',
  'assetUnderstanding',
  'imagePlacementPlan',
  'photoshopToolPlan',
  'qaAcceptancePlan',
  'performanceBudget'
];

const BUSINESS_SKILL_READINESS_REQUIRED_OUTPUTS = [
  'DesignBrief',
  'AssetUnderstanding',
  'DesignDSL',
  'ExecutionPlan',
  'ExecutionTrace',
  'VerificationReport'
];

const BUSINESS_SKILL_READINESS_BOUNDARIES = [
  'This readiness contract does not change Photoshop write order.',
  'This readiness contract does not call a provider, vision model, or Photoshop tool.',
  'This readiness contract does not prove main-image, detail-page, or SKU design quality.',
  'FEX and synthetic fixtures are regression fixtures only; they do not establish business strategy readiness.'
];

export function buildBusinessSkillReadinessContract(
  input: BuildBusinessSkillReadinessContractInput
): BusinessSkillReadinessContract {
  const userCheckpointConfirmed = input.userCheckpointConfirmed === true;
  const strategyInputs = input.strategyInputs || {};
  const riskFlags = input.riskFlags || {};
  const missingInputs = BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS.filter(
    (key) => strategyInputs[key] !== true
  );
  const readyInputs = BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS.filter(
    (key) => strategyInputs[key] === true
  );
  const implementationCheckpoint = buildBusinessSkillImplementationCheckpoint({
    skillId: input.skillId,
    intendedChange: 'business-strategy',
    userCheckpointConfirmed,
    inputs: {
      designStandards: strategyInputs.designStandards === true,
      knowledgeRecipeSource: strategyInputs.knowledgeRecipeSource === true,
      visualObservationPlan: strategyInputs.assetUnderstanding === true
        && strategyInputs.imagePlacementPlan === true,
      photoshopToolPlan: strategyInputs.photoshopToolPlan === true,
      qaAcceptancePlan: strategyInputs.qaAcceptancePlan === true,
      performanceBudget: strategyInputs.performanceBudget === true,
      fexBenchmarkOnly: riskFlags.fexBenchmarkOnly === true,
      toolOnlyPanelFeature: riskFlags.toolOnlyPanelFeature === true
    }
  });
  const blockers = buildBlockers(
    userCheckpointConfirmed,
    missingInputs,
    implementationCheckpoint
  );
  const status = buildStatus(userCheckpointConfirmed, missingInputs);
  const warnings = buildWarnings(riskFlags, implementationCheckpoint);

  return {
    version: 'business-skill-readiness-contract/v0',
    skillId: input.skillId,
    status,
    userCheckpointConfirmed,
    canModifyBusinessStrategy: status === 'ready_for_strategy_design'
      && implementationCheckpoint.canChangeBusinessStrategy,
    canClaimDesignQuality: false,
    requiredInputs: [...BUSINESS_SKILL_READINESS_CONTRACT_REQUIRED_INPUTS],
    missingInputs,
    readyInputs,
    requiredOutputs: [...BUSINESS_SKILL_READINESS_REQUIRED_OUTPUTS],
    implementationCheckpoint,
    blockers,
    warnings,
    requiredNextChecks: buildRequiredNextChecks(missingInputs),
    boundaries: [...BUSINESS_SKILL_READINESS_BOUNDARIES]
  };
}

function buildStatus(
  userCheckpointConfirmed: boolean,
  missingInputs: BusinessSkillReadinessInputKey[]
): BusinessSkillReadinessContractStatus {
  if (!userCheckpointConfirmed) {
    return 'blocked_missing_user_checkpoint';
  }

  if (missingInputs.length > 0) {
    return 'blocked_missing_strategy_inputs';
  }

  return 'ready_for_strategy_design';
}

function buildBlockers(
  userCheckpointConfirmed: boolean,
  missingInputs: BusinessSkillReadinessInputKey[],
  implementationCheckpoint: BusinessSkillImplementationCheckpoint
): string[] {
  const blockers: string[] = [];

  if (!userCheckpointConfirmed) {
    blockers.push('user_checkpoint_required');
  }

  if (missingInputs.length > 0) {
    blockers.push('business_skill_strategy_inputs_missing');
  }

  if (!implementationCheckpoint.canChangeBusinessStrategy) {
    blockers.push('implementation_checkpoint_not_ready');
  }

  return Array.from(new Set(blockers));
}

function buildWarnings(
  riskFlags: BusinessSkillReadinessRiskFlags,
  implementationCheckpoint: BusinessSkillImplementationCheckpoint
): string[] {
  const warnings = [...implementationCheckpoint.warnings];

  if (riskFlags.syntheticFixtureOnly === true) {
    warnings.push('synthetic_fixture_does_not_establish_business_strategy_readiness');
  }

  return Array.from(new Set(warnings));
}

function buildRequiredNextChecks(missingInputs: BusinessSkillReadinessInputKey[]): string[] {
  return missingInputs.map((key) => {
    switch (key) {
      case 'designStandards':
        return 'write_business_design_standards';
      case 'knowledgeRecipeSource':
        return 'provide_knowledge_or_recipe_source';
      case 'assetUnderstanding':
        return 'collect_project_asset_understanding';
      case 'imagePlacementPlan':
        return 'define_image_placement_and_smart_scaling_plan';
      case 'photoshopToolPlan':
        return 'define_photoshop_tool_execution_plan';
      case 'qaAcceptancePlan':
        return 'define_qa_acceptance_plan';
      case 'performanceBudget':
        return 'define_model_tool_and_photoshop_budget';
      default:
        return 'provide_missing_business_skill_strategy_input';
    }
  });
}
