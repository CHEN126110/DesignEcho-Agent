import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { BusinessSkillReadinessInputKey } from './business-skill-readiness-contract';
import type { EcommerceSocksDeliverable } from './ecommerce-socks-design';
import type {
  EcommerceSocksStrategyCheckpoint,
  EcommerceSocksStrategyCheckpointChild
} from './ecommerce-socks-strategy-checkpoint';

export type EcommerceSocksChildStrategyPacketSetStatus =
  | 'blocked_by_strategy_checkpoint'
  | 'ready_for_user_strategy_review';

export type EcommerceSocksChildStrategyDecision =
  | 'hero_subject_selection'
  | 'image_placement_and_smart_scaling'
  | 'main_image_export_acceptance'
  | 'screen_storyline_planning'
  | 'asset_allocation_by_screen'
  | 'detail_page_visual_qa'
  | 'sku_combination_policy'
  | 'color_and_spec_mapping'
  | 'sku_export_naming_acceptance';

export interface EcommerceSocksChildStrategyPacket {
  version: 'ecommerce-socks-child-strategy-packet/v0';
  deliverable: EcommerceSocksDeliverable;
  skillId: BusinessDesignSkillId;
  status: 'blocked' | 'ready_for_user_review';
  requiredSections: BusinessSkillReadinessInputKey[];
  missingSections: BusinessSkillReadinessInputKey[];
  requiredDecisions: EcommerceSocksChildStrategyDecision[];
  reviewQuestions: string[];
  canImplementChildStrategyChanges: false;
  canClaimOutputQuality: false;
  noPhotoshopWrites: true;
}

export interface EcommerceSocksChildStrategyPacketSet {
  version: 'ecommerce-socks-child-strategy-packet-set/v0';
  parentSkillId: 'ecommerce-socks-design';
  scene: 'ecommerce-socks';
  status: EcommerceSocksChildStrategyPacketSetStatus;
  canStartUserStrategyReview: boolean;
  canImplementChildStrategyChanges: false;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  packets: EcommerceSocksChildStrategyPacket[];
  blockedChildren: Array<{
    deliverable: EcommerceSocksDeliverable;
    skillId: BusinessDesignSkillId;
    missingSections: BusinessSkillReadinessInputKey[];
  }>;
  boundaries: string[];
}

export interface BuildEcommerceSocksChildStrategyPacketSetInput {
  strategyCheckpoint: EcommerceSocksStrategyCheckpoint;
}

const PACKET_BOUNDARIES = [
  'These packets prepare user strategy review only.',
  'These packets do not implement child skill strategy changes.',
  'These packets do not execute child skills or write Photoshop.',
  'These packets do not prove ecommerce socks design quality.'
];

export function buildEcommerceSocksChildStrategyPacketSet(
  input: BuildEcommerceSocksChildStrategyPacketSetInput
): EcommerceSocksChildStrategyPacketSet {
  const packets = input.strategyCheckpoint.childReadiness.map((child) => buildPacket(child));
  const blockedChildren = packets
    .filter((packet) => packet.status === 'blocked')
    .map((packet) => ({
      deliverable: packet.deliverable,
      skillId: packet.skillId,
      missingSections: packet.missingSections
    }));
  const canStartUserStrategyReview = input.strategyCheckpoint.canStartChildStrategyDesign
    && blockedChildren.length === 0;

  return {
    version: 'ecommerce-socks-child-strategy-packet-set/v0',
    parentSkillId: 'ecommerce-socks-design',
    scene: 'ecommerce-socks',
    status: canStartUserStrategyReview
      ? 'ready_for_user_strategy_review'
      : 'blocked_by_strategy_checkpoint',
    canStartUserStrategyReview,
    canImplementChildStrategyChanges: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    packets,
    blockedChildren,
    boundaries: [...PACKET_BOUNDARIES]
  };
}

function buildPacket(child: EcommerceSocksStrategyCheckpointChild): EcommerceSocksChildStrategyPacket {
  const requiredSections = child.contract.requiredInputs;
  const missingSections = child.contract.missingInputs;

  return {
    version: 'ecommerce-socks-child-strategy-packet/v0',
    deliverable: child.deliverable,
    skillId: child.skillId,
    status: child.contract.canModifyBusinessStrategy ? 'ready_for_user_review' : 'blocked',
    requiredSections,
    missingSections,
    requiredDecisions: buildRequiredDecisions(child.skillId),
    reviewQuestions: buildReviewQuestions(child.skillId),
    canImplementChildStrategyChanges: false,
    canClaimOutputQuality: false,
    noPhotoshopWrites: true
  };
}

function buildRequiredDecisions(skillId: BusinessDesignSkillId): EcommerceSocksChildStrategyDecision[] {
  switch (skillId) {
    case 'main-image-design':
      return [
        'hero_subject_selection',
        'image_placement_and_smart_scaling',
        'main_image_export_acceptance'
      ];
    case 'detail-page-design':
      return [
        'screen_storyline_planning',
        'asset_allocation_by_screen',
        'detail_page_visual_qa'
      ];
    case 'sku-batch':
      return [
        'sku_combination_policy',
        'color_and_spec_mapping',
        'sku_export_naming_acceptance'
      ];
    default:
      return [];
  }
}

function buildReviewQuestions(skillId: BusinessDesignSkillId): string[] {
  switch (skillId) {
    case 'main-image-design':
      return [
        '主图优先展示哪类素材：模特穿着、平铺、细节还是组合图？',
        '主体在画布中的安全区、占比和留白规则是什么？',
        '导出前用哪些截图检查或像素测量判断主体清晰、完整、不过度裁切？'
      ];
    case 'detail-page-design':
      return [
        '详情页从首屏到卖点屏的屏幕叙事顺序是什么？',
        '每一屏应该使用原始素材、细节素材还是已有成品切图？',
        '如何判断文字、图片、间距和重心达到可验收状态？'
      ];
    case 'sku-batch':
      return [
        'SKU 是否复用已有成品图、更新已有模板，还是重新生成？',
        '颜色、单双、组合数量和备注规则如何映射？',
        '导出命名、数量和失败重试如何验收？'
      ];
    default:
      return [];
  }
}
