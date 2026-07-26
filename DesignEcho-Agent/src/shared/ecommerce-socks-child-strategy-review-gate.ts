import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
  EcommerceSocksChildStrategyPacket,
  EcommerceSocksChildStrategyPacketSet
} from './ecommerce-socks-child-strategy-packets';

export type EcommerceSocksChildStrategyReviewGateStatus =
  | 'blocked_packet_set_not_ready'
  | 'awaiting_user_strategy_review'
  | 'awaiting_boundary_acknowledgement'
  | 'awaiting_child_skill_approval'
  | 'rejected_by_user'
  | 'approved_for_child_strategy_design';

export type EcommerceSocksChildStrategyReviewGateBlocker =
  | 'packet_set_not_ready'
  | 'user_strategy_review_missing'
  | 'boundary_acknowledgement_missing'
  | 'child_skill_approval_missing'
  | 'user_rejected_child_strategy';

export interface EcommerceSocksChildStrategyReviewGate {
  version: 'ecommerce-socks-child-strategy-review-gate/v0';
  parentSkillId: 'ecommerce-socks-design';
  scene: 'ecommerce-socks';
  status: EcommerceSocksChildStrategyReviewGateStatus;
  packetSetStatus: EcommerceSocksChildStrategyPacketSet['status'];
  userReviewedStrategyPackets: boolean;
  acknowledgedStrategyBoundaries: boolean;
  approvedSkillIds: BusinessDesignSkillId[];
  deniedSkillIds: BusinessDesignSkillId[];
  missingSkillApprovals: BusinessDesignSkillId[];
  requiredDecisionCount: number;
  requiredDecisionChecklist: Array<{
    skillId: BusinessDesignSkillId;
    decisions: EcommerceSocksChildStrategyPacket['requiredDecisions'];
  }>;
  canStartChildStrategyDesign: boolean;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustNotExecuteChildSkills: true;
  blockers: EcommerceSocksChildStrategyReviewGateBlocker[];
  boundaries: string[];
}

export interface BuildEcommerceSocksChildStrategyReviewGateInput {
  packetSet: EcommerceSocksChildStrategyPacketSet;
  userReviewedStrategyPackets?: boolean;
  acknowledgedStrategyBoundaries?: boolean;
  approvedSkillIds?: BusinessDesignSkillId[];
  deniedSkillIds?: BusinessDesignSkillId[];
}

const REVIEW_GATE_BOUNDARIES = [
  'This gate approves entering child strategy design only.',
  'This gate does not modify main-image, detail-page or SKU strategy by itself.',
  'This gate does not execute child skills or write Photoshop.',
  'This gate does not prove ecommerce socks design quality.'
];

export function buildEcommerceSocksChildStrategyReviewGate(
  input: BuildEcommerceSocksChildStrategyReviewGateInput
): EcommerceSocksChildStrategyReviewGate {
  const approvedSkillIds = uniqueSkillIds(input.approvedSkillIds);
  const deniedSkillIds = uniqueSkillIds(input.deniedSkillIds);
  const packetSkillIds = input.packetSet.packets.map((packet) => packet.skillId);
  const missingSkillApprovals = packetSkillIds.filter((skillId) => !approvedSkillIds.includes(skillId));
  const userReviewedStrategyPackets = input.userReviewedStrategyPackets === true;
  const acknowledgedStrategyBoundaries = input.acknowledgedStrategyBoundaries === true;
  const blockers = buildBlockers({
    packetSet: input.packetSet,
    userReviewedStrategyPackets,
    acknowledgedStrategyBoundaries,
    missingSkillApprovals,
    deniedSkillIds
  });
  const status = resolveStatus(blockers);
  const canStartChildStrategyDesign = status === 'approved_for_child_strategy_design';

  return {
    version: 'ecommerce-socks-child-strategy-review-gate/v0',
    parentSkillId: 'ecommerce-socks-design',
    scene: 'ecommerce-socks',
    status,
    packetSetStatus: input.packetSet.status,
    userReviewedStrategyPackets,
    acknowledgedStrategyBoundaries,
    approvedSkillIds,
    deniedSkillIds,
    missingSkillApprovals,
    requiredDecisionCount: countRequiredDecisions(input.packetSet.packets),
    requiredDecisionChecklist: input.packetSet.packets.map((packet) => ({
      skillId: packet.skillId,
      decisions: [...packet.requiredDecisions]
    })),
    canStartChildStrategyDesign,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecuteChildSkills: true,
    blockers,
    boundaries: [...REVIEW_GATE_BOUNDARIES]
  };
}

function uniqueSkillIds(value: BusinessDesignSkillId[] | undefined): BusinessDesignSkillId[] {
  return Array.from(new Set(Array.isArray(value) ? value : []));
}

function countRequiredDecisions(packets: EcommerceSocksChildStrategyPacket[]): number {
  return packets.reduce((total, packet) => total + packet.requiredDecisions.length, 0);
}

function buildBlockers(input: {
  packetSet: EcommerceSocksChildStrategyPacketSet;
  userReviewedStrategyPackets: boolean;
  acknowledgedStrategyBoundaries: boolean;
  missingSkillApprovals: BusinessDesignSkillId[];
  deniedSkillIds: BusinessDesignSkillId[];
}): EcommerceSocksChildStrategyReviewGateBlocker[] {
  const blockers: EcommerceSocksChildStrategyReviewGateBlocker[] = [];
  if (input.packetSet.status !== 'ready_for_user_strategy_review') {
    blockers.push('packet_set_not_ready');
  }
  if (!input.userReviewedStrategyPackets) {
    blockers.push('user_strategy_review_missing');
  }
  if (!input.acknowledgedStrategyBoundaries) {
    blockers.push('boundary_acknowledgement_missing');
  }
  if (input.missingSkillApprovals.length > 0) {
    blockers.push('child_skill_approval_missing');
  }
  if (input.deniedSkillIds.length > 0) {
    blockers.push('user_rejected_child_strategy');
  }

  return blockers;
}

function resolveStatus(
  blockers: EcommerceSocksChildStrategyReviewGateBlocker[]
): EcommerceSocksChildStrategyReviewGateStatus {
  if (blockers.includes('packet_set_not_ready')) {
    return 'blocked_packet_set_not_ready';
  }
  if (blockers.includes('user_rejected_child_strategy')) {
    return 'rejected_by_user';
  }
  if (blockers.includes('user_strategy_review_missing')) {
    return 'awaiting_user_strategy_review';
  }
  if (blockers.includes('boundary_acknowledgement_missing')) {
    return 'awaiting_boundary_acknowledgement';
  }
  if (blockers.includes('child_skill_approval_missing')) {
    return 'awaiting_child_skill_approval';
  }

  return 'approved_for_child_strategy_design';
}
