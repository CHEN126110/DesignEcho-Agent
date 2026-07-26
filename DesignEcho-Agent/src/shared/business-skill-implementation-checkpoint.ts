export const BUSINESS_DESIGN_SKILL_IDS = [
  'main-image-design',
  'detail-page-design',
  'sku-batch'
] as const;

export type BusinessDesignSkillId = typeof BUSINESS_DESIGN_SKILL_IDS[number];

export type BusinessSkillIntendedChange = 'infra-only' | 'business-strategy';

export type BusinessSkillImplementationCheckpointStatus =
  | 'blocked_needs_user_checkpoint'
  | 'ready_for_infra_only'
  | 'ready_for_business_strategy';

export type BusinessSkillImplementationRequirementKey =
  | 'designStandards'
  | 'knowledgeRecipeSource'
  | 'visualObservationPlan'
  | 'photoshopToolPlan'
  | 'qaAcceptancePlan'
  | 'performanceBudget';

export interface BusinessSkillImplementationInputs {
  designStandards?: boolean;
  knowledgeRecipeSource?: boolean;
  visualObservationPlan?: boolean;
  photoshopToolPlan?: boolean;
  qaAcceptancePlan?: boolean;
  performanceBudget?: boolean;
  fexBenchmarkOnly?: boolean;
  toolOnlyPanelFeature?: boolean;
  [key: string]: unknown;
}

export interface BuildBusinessSkillImplementationCheckpointInput {
  skillId: BusinessDesignSkillId;
  intendedChange?: BusinessSkillIntendedChange;
  userCheckpointConfirmed?: boolean;
  inputs?: BusinessSkillImplementationInputs;
}

export interface BusinessSkillImplementationCheckpoint {
  version: 'business-skill-implementation-checkpoint/v0';
  skillId: BusinessDesignSkillId;
  intendedChange: BusinessSkillIntendedChange;
  status: BusinessSkillImplementationCheckpointStatus;
  canChangeBusinessStrategy: boolean;
  userCheckpointConfirmed: boolean;
  requiredInputs: BusinessSkillImplementationRequirementKey[];
  missingInputs: BusinessSkillImplementationRequirementKey[];
  satisfiedInputs: string[];
  requiredCapabilities: string[];
  requiredQaChecks: string[];
  blockers: string[];
  warnings: string[];
  boundaries: string[];
}

export const BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS: BusinessSkillImplementationRequirementKey[] = [
  'designStandards',
  'knowledgeRecipeSource',
  'visualObservationPlan',
  'photoshopToolPlan',
  'qaAcceptancePlan',
  'performanceBudget'
];

const BUSINESS_SKILL_REQUIRED_CAPABILITIES = [
  'business_skill_design_governance',
  'visual_observation_before_design',
  'design_knowledge_or_recipe_source',
  'design_dsl_execution_plan',
  'photoshop_tool_capability_map',
  'verification_report',
  'performance_budget'
];

const BUSINESS_SKILL_REQUIRED_QA_CHECKS = [
  'photoshop_output_acceptance',
  'screenshot_or_snapshot_review',
  'manual_review_when_quality_claimed',
  'no_synthetic_or_fex_quality_claim'
];

const BUSINESS_SKILL_BOUNDARIES = [
  'This checkpoint does not change Photoshop write order.',
  'This checkpoint does not prove main-image, detail-page, or SKU design quality.',
  'FEX and synthetic benchmarks are regression fixtures, not business strategy readiness.',
  'UXP panel-only tools do not establish Agent business skill strategy readiness.'
];

export function buildBusinessSkillImplementationCheckpoint(
  input: BuildBusinessSkillImplementationCheckpointInput
): BusinessSkillImplementationCheckpoint {
  const intendedChange = input.intendedChange || 'business-strategy';
  const userCheckpointConfirmed = input.userCheckpointConfirmed === true;
  const inputs = input.inputs || {};
  const missingInputs = BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS.filter((key) => inputs[key] !== true);
  const satisfiedInputs = Object.keys(inputs)
    .filter((key) => inputs[key] === true)
    .sort();
  const blockers = buildBlockers(intendedChange, userCheckpointConfirmed, missingInputs);
  const warnings = buildWarnings(inputs);
  const status = buildStatus(intendedChange, blockers, missingInputs);

  return {
    version: 'business-skill-implementation-checkpoint/v0',
    skillId: input.skillId,
    intendedChange,
    status,
    canChangeBusinessStrategy: status === 'ready_for_business_strategy',
    userCheckpointConfirmed,
    requiredInputs: [...BUSINESS_SKILL_IMPLEMENTATION_REQUIRED_INPUTS],
    missingInputs,
    satisfiedInputs,
    requiredCapabilities: [...BUSINESS_SKILL_REQUIRED_CAPABILITIES],
    requiredQaChecks: [...BUSINESS_SKILL_REQUIRED_QA_CHECKS],
    blockers,
    warnings,
    boundaries: [...BUSINESS_SKILL_BOUNDARIES]
  };
}

function buildBlockers(
  intendedChange: BusinessSkillIntendedChange,
  userCheckpointConfirmed: boolean,
  missingInputs: BusinessSkillImplementationRequirementKey[]
): string[] {
  if (intendedChange === 'infra-only') {
    return [];
  }

  const blockers: string[] = [];
  if (!userCheckpointConfirmed) {
    blockers.push('user_checkpoint_required');
  }

  if (missingInputs.length > 0) {
    blockers.push('required_business_skill_inputs_missing');
  }

  return blockers;
}

function buildWarnings(inputs: BusinessSkillImplementationInputs): string[] {
  const warnings: string[] = [];

  if (inputs.fexBenchmarkOnly === true) {
    warnings.push('fex_benchmark_does_not_establish_business_strategy_readiness');
  }

  if (inputs.toolOnlyPanelFeature === true) {
    warnings.push('tool_only_panel_feature_does_not_establish_agent_skill_strategy_readiness');
  }

  return warnings;
}

function buildStatus(
  intendedChange: BusinessSkillIntendedChange,
  blockers: string[],
  missingInputs: BusinessSkillImplementationRequirementKey[]
): BusinessSkillImplementationCheckpointStatus {
  if (intendedChange === 'infra-only') {
    return 'ready_for_infra_only';
  }

  if (blockers.length === 0 && missingInputs.length === 0) {
    return 'ready_for_business_strategy';
  }

  return 'blocked_needs_user_checkpoint';
}
