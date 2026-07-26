import type { EcommerceSocksChildStrategyDecision } from './ecommerce-socks-child-strategy-packets';
import type { EcommerceSocksChildStrategyReviewGate } from './ecommerce-socks-child-strategy-review-gate';

export type MainImageStrategyContractStatus =
  | 'blocked_missing_parent_review_gate'
  | 'blocked_parent_review_not_approved'
  | 'blocked_missing_strategy_inputs'
  | 'ready_for_main_image_strategy_design';

export type MainImageStrategyInputKey =
  | 'heroSubjectPolicy'
  | 'assetSelectionPolicy'
  | 'imagePlacementPolicy'
  | 'smartScalingPolicy'
  | 'copyRolePolicy'
  | 'exportAcceptancePolicy'
  | 'performanceBudget';

export interface MainImageStrategyContract {
  version: 'main-image-strategy-contract/v0';
  skillId: 'main-image-design';
  scene: 'ecommerce-socks';
  status: MainImageStrategyContractStatus;
  parentGateStatus: EcommerceSocksChildStrategyReviewGate['status'] | 'missing';
  requiredInputs: MainImageStrategyInputKey[];
  missingInputs: MainImageStrategyInputKey[];
  requiredDecisions: EcommerceSocksChildStrategyDecision[];
  canModifyMainImageStrategy: boolean;
  canClaimOutputQuality: false;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustNotExecutePhotoshop: true;
  blockers: string[];
  boundaries: string[];
}

export interface BuildMainImageStrategyContractInput {
  userIntent: string;
  parentReviewGate?: EcommerceSocksChildStrategyReviewGate | null;
  strategyInputs?: Partial<Record<MainImageStrategyInputKey, unknown>>;
}

const REQUIRED_INPUTS: MainImageStrategyInputKey[] = [
  'heroSubjectPolicy',
  'assetSelectionPolicy',
  'imagePlacementPolicy',
  'smartScalingPolicy',
  'copyRolePolicy',
  'exportAcceptancePolicy',
  'performanceBudget'
];

const REQUIRED_DECISIONS: EcommerceSocksChildStrategyDecision[] = [
  'hero_subject_selection',
  'image_placement_and_smart_scaling',
  'main_image_export_acceptance'
];

const BOUNDARIES = [
  'This contract only allows main-image strategy design to start.',
  'This contract does not change Photoshop execution parameters.',
  'This contract does not execute Photoshop or child skills.',
  'This contract does not prove main-image output quality.'
];

export function buildMainImageStrategyContract(
  input: BuildMainImageStrategyContractInput
): MainImageStrategyContract {
  const parentGateStatus = input.parentReviewGate?.status || 'missing';
  const missingInputs = collectMissingInputs(input.strategyInputs);
  const blockers = buildBlockers(parentGateStatus, missingInputs);
  const status = resolveStatus(parentGateStatus, missingInputs);

  return {
    version: 'main-image-strategy-contract/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status,
    parentGateStatus,
    requiredInputs: [...REQUIRED_INPUTS],
    missingInputs,
    requiredDecisions: [...REQUIRED_DECISIONS],
    canModifyMainImageStrategy: status === 'ready_for_main_image_strategy_design',
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    blockers,
    boundaries: [
      ...BOUNDARIES,
      `userIntentPresent=${String(input.userIntent || '').trim().length > 0}`
    ]
  };
}

function collectMissingInputs(
  strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>> | undefined
): MainImageStrategyInputKey[] {
  return REQUIRED_INPUTS.filter((key) => !isProvidedStrategyInput(strategyInputs?.[key]));
}

function isProvidedStrategyInput(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return false;
    if (text.includes('raw-image-payload') || text.includes('base64-image-payload') || text.includes('data:image/')) {
      return false;
    }
    return true;
  }
  if (value && typeof value === 'object') return true;
  return false;
}

function buildBlockers(
  parentGateStatus: MainImageStrategyContract['parentGateStatus'],
  missingInputs: MainImageStrategyInputKey[]
): string[] {
  const blockers: string[] = [];
  if (parentGateStatus === 'missing') {
    blockers.push('parent_review_gate_missing');
  } else if (parentGateStatus !== 'approved_for_child_strategy_design') {
    blockers.push('parent_review_gate_not_approved');
  }
  if (missingInputs.length > 0) {
    blockers.push('main_image_strategy_inputs_missing');
  }
  return blockers;
}

function resolveStatus(
  parentGateStatus: MainImageStrategyContract['parentGateStatus'],
  missingInputs: MainImageStrategyInputKey[]
): MainImageStrategyContractStatus {
  if (parentGateStatus === 'missing') {
    return 'blocked_missing_parent_review_gate';
  }
  if (parentGateStatus !== 'approved_for_child_strategy_design') {
    return 'blocked_parent_review_not_approved';
  }
  if (missingInputs.length > 0) {
    return 'blocked_missing_strategy_inputs';
  }
  return 'ready_for_main_image_strategy_design';
}
