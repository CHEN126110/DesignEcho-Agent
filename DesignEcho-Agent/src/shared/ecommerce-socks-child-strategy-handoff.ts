import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { EcommerceSocksChildStrategyPacket } from './ecommerce-socks-child-strategy-packets';
import type { EcommerceSocksChildStrategyPacketSet } from './ecommerce-socks-child-strategy-packets';
import type { EcommerceSocksChildStrategyReviewGate } from './ecommerce-socks-child-strategy-review-gate';
import type { EcommerceSocksDeliverable } from './ecommerce-socks-design';

export type EcommerceSocksChildStrategyHandoffStatus =
  | 'blocked_by_review_gate'
  | 'ready_for_child_strategy_input';

export type EcommerceSocksChildStrategyHandoffPacketStatus = 'blocked' | 'ready';

export interface EcommerceSocksStrategyContextSummary {
  version?: string;
  status?: string;
  summary?: string;
  candidateCount?: number;
  hasContext: boolean;
}

export interface EcommerceSocksChildStrategyHandoffPacket {
  version: 'ecommerce-socks-child-strategy-handoff-packet/v0';
  deliverable: EcommerceSocksDeliverable;
  skillId: BusinessDesignSkillId;
  status: EcommerceSocksChildStrategyHandoffPacketStatus;
  sourcePacketStatus: EcommerceSocksChildStrategyPacket['status'];
  strategyInputPatch: Record<string, unknown>;
  requiredDecisions: EcommerceSocksChildStrategyPacket['requiredDecisions'];
  reviewRequirements: string[];
  boundaryChecklist: string[];
  canUseAsChildStrategyInput: boolean;
  canExecuteChildSkill: false;
  canApplyPatchToChildSkillAutomatically: false;
  canClaimOutputQuality: false;
  noPhotoshopWrites: true;
}

export interface EcommerceSocksChildStrategyHandoff {
  version: 'ecommerce-socks-child-strategy-handoff/v0';
  parentSkillId: 'ecommerce-socks-design';
  scene: 'ecommerce-socks';
  status: EcommerceSocksChildStrategyHandoffStatus;
  packetSetStatus: EcommerceSocksChildStrategyPacketSet['status'];
  reviewGateStatus: EcommerceSocksChildStrategyReviewGate['status'];
  canUseAsChildStrategyInput: boolean;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustNotExecuteChildSkills: true;
  mustNotWriteChildStrategyFiles: true;
  handoffs: EcommerceSocksChildStrategyHandoffPacket[];
  blockers: string[];
  warnings: string[];
  boundaries: string[];
}

export interface BuildEcommerceSocksChildStrategyHandoffInput {
  packetSet: EcommerceSocksChildStrategyPacketSet;
  reviewGate: EcommerceSocksChildStrategyReviewGate;
  userIntent?: string;
  projectPath?: string;
  memoryStrategy?: unknown;
  placementIntelligenceBySkill?: Partial<Record<BusinessDesignSkillId, unknown>>;
}

const HANDOFF_BOUNDARIES = [
  'This handoff only converts approved parent strategy packets into child strategy input patches.',
  'This handoff does not call or execute child skills.',
  'This handoff does not write Photoshop or project files.',
  'This handoff does not prove main-image, detail-page, SKU, or full ecommerce design quality.'
];

const BLOCKED_HANDOFF_REVIEW_REQUIREMENTS = [
  'User strategy packet review must be approved before child strategy input patches can be consumed.',
  'Boundary acknowledgement and per-child approvals are required before this handoff becomes ready.'
];

function cleanText(value: unknown): string | undefined {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  if (/(data:image\/|base64|raw-image-payload|base64-image-payload|<tool_call|<\/tool_call>|needs_model_design_decision|direct_response|clarification_needed)/i.test(text)) {
    return undefined;
  }
  return text;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function summarizeContext(value: unknown): EcommerceSocksStrategyContextSummary {
  const objectValue = readObject(value);
  if (!objectValue) {
    return { hasContext: false };
  }
  const summaryObject = readObject(objectValue.summary);
  const candidateCount = Number(
    summaryObject?.candidateCount
    ?? objectValue.candidateCount
    ?? 0
  );
  return {
    version: cleanText(objectValue.version),
    status: cleanText(objectValue.status),
    summary: cleanText(objectValue.summary) || cleanText(summaryObject?.text),
    candidateCount: Number.isFinite(candidateCount) && candidateCount > 0 ? candidateCount : undefined,
    hasContext: true
  };
}

function buildCommonPatch(input: {
  packet: EcommerceSocksChildStrategyPacket;
  userIntent?: string;
  projectPath?: string;
  memoryStrategy?: unknown;
  placementIntelligence?: unknown;
}): Record<string, unknown> {
  return {
    parentSkillId: 'ecommerce-socks-design',
    source: 'approved_parent_child_strategy_handoff',
    userIntent: cleanText(input.userIntent),
    projectPath: cleanText(input.projectPath),
    requiredSections: [...input.packet.requiredSections],
    requiredDecisions: [...input.packet.requiredDecisions],
    memoryStrategy: summarizeContext(input.memoryStrategy),
    placementIntelligence: summarizeContext(input.placementIntelligence),
    qualityClaim: {
      canClaimOutputQuality: false,
      requiresChildSkillVerification: true
    },
    boundaries: {
      noPhotoshopWrites: true,
      mustNotExecuteChildSkillFromHandoff: true,
      requiresChildSkillOwnedAcceptance: true
    }
  };
}

function buildScenarioPatch(input: {
  packet: EcommerceSocksChildStrategyPacket;
  userIntent?: string;
  projectPath?: string;
  memoryStrategy?: unknown;
  placementIntelligence?: unknown;
}): Record<string, unknown> {
  const common = buildCommonPatch(input);
  switch (input.packet.skillId) {
    case 'main-image-design':
      return {
        ...common,
        scenario: 'main-image',
        heroSubject: {
          required: true,
          decision: 'select_hero_product_photo_from_project_assets',
          rejectRules: ['avoid_unclear_subject', 'avoid_overcropped_product', 'avoid_unverified_external_assets']
        },
        placement: {
          requiresSmartScaling: true,
          requiresSafeArea: true,
          requiresActualBoundsReadback: true,
          requiredReview: ['subject_bounds_required', 'canvas_variant_safe_area_required', 'export_probe_required']
        },
        exportAcceptance: {
          requiredFormats: ['1:1', '3:4', '9:16'],
          requiresPsdSave: true,
          requiresReadback: true
        }
      };
    case 'detail-page-design':
      return {
        ...common,
        scenario: 'detail-page',
        screenStoryline: {
          required: true,
          requiredPlanning: ['first_screen_hook', 'selling_point_order', 'material_allocation_by_screen']
        },
        assetAllocation: {
          required: true,
          requiresProjectAssetUnderstanding: true,
          avoidDuplicatingWeakPhotosAcrossScreens: true
        },
        qaAcceptance: {
          requiresTextBoundsReview: true,
          requiresImageFitReview: true,
          requiresLongCanvasExportReadback: true
        }
      };
    case 'sku-batch':
      return {
        ...common,
        scenario: 'sku',
        combinationPolicy: {
          required: true,
          includeSelfSelectNotesByDefault: true,
          preferProjectCsvConfig: true,
          requireColorAndSpecMapping: true
        },
        sourcePolicy: {
          preferProjectSkuPsdOrPsb: true,
          mustNotUseUnrelatedOpenSkuDocument: true,
          requiresProjectTemplateCoverage: true
        },
        exportAcceptance: {
          requiresReadback: true,
          requiresComboAndNoteFileProbe: true,
          canClaimCompletionOnlyAfterChildReview: true
        }
      };
    default:
      return {
        ...common,
        scenario: input.packet.deliverable
      };
  }
}

function buildReviewRequirements(packet: EcommerceSocksChildStrategyPacket): string[] {
  switch (packet.skillId) {
    case 'main-image-design':
      return [
        '主图子 skill 必须复核主体边界、画布变体安全区和导出读回。',
        '父级 handoff 只能提供策略输入，不能替代主图截图或像素验收。'
      ];
    case 'detail-page-design':
      return [
        '详情页子 skill 必须复核屏幕叙事、素材分配、文字边界和长图导出。',
        '父级 handoff 只能传递屏幕规划要求，不能声明详情页质量通过。'
      ];
    case 'sku-batch':
      return [
        'SKU 子 skill 必须复核项目 SKU 源文件、模板、CSV 配置、自选备注和导出读回。',
        '父级 handoff 不能直接执行 SKU，也不能声明批量 SKU 已完成。'
      ];
    default:
      return [
        '子 skill 必须自行完成执行和验收。',
        '父级 handoff 不能声明输出质量通过。'
      ];
  }
}

function buildBoundaryChecklist(packet: EcommerceSocksChildStrategyPacket): string[] {
  return [
    'no_parent_photoshop_write',
    'no_child_skill_execution_from_handoff',
    'no_design_quality_claim',
    `child_skill_owns_${packet.skillId}_acceptance`
  ];
}

export function buildEcommerceSocksChildStrategyHandoff(
  input: BuildEcommerceSocksChildStrategyHandoffInput
): EcommerceSocksChildStrategyHandoff {
  const ready = input.packetSet.status === 'ready_for_user_strategy_review'
    && input.reviewGate.canStartChildStrategyDesign === true;
  const handoffs = input.packetSet.packets.map((packet): EcommerceSocksChildStrategyHandoffPacket => {
    const placementIntelligence = input.placementIntelligenceBySkill?.[packet.skillId];
    return {
      version: 'ecommerce-socks-child-strategy-handoff-packet/v0',
      deliverable: packet.deliverable,
      skillId: packet.skillId,
      status: ready && packet.status === 'ready_for_user_review' ? 'ready' : 'blocked',
      sourcePacketStatus: packet.status,
      strategyInputPatch: ready
        ? buildScenarioPatch({
          packet,
          userIntent: input.userIntent,
          projectPath: input.projectPath,
          memoryStrategy: input.memoryStrategy,
          placementIntelligence
        })
        : {},
      requiredDecisions: [...packet.requiredDecisions],
      reviewRequirements: ready ? buildReviewRequirements(packet) : [...BLOCKED_HANDOFF_REVIEW_REQUIREMENTS],
      boundaryChecklist: buildBoundaryChecklist(packet),
      canUseAsChildStrategyInput: ready && packet.status === 'ready_for_user_review',
      canExecuteChildSkill: false,
      canApplyPatchToChildSkillAutomatically: false,
      canClaimOutputQuality: false,
      noPhotoshopWrites: true
    };
  });

  return {
    version: 'ecommerce-socks-child-strategy-handoff/v0',
    parentSkillId: 'ecommerce-socks-design',
    scene: 'ecommerce-socks',
    status: ready ? 'ready_for_child_strategy_input' : 'blocked_by_review_gate',
    packetSetStatus: input.packetSet.status,
    reviewGateStatus: input.reviewGate.status,
    canUseAsChildStrategyInput: ready,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecuteChildSkills: true,
    mustNotWriteChildStrategyFiles: true,
    handoffs,
    blockers: ready ? [] : [
      ...input.reviewGate.blockers,
      ...(input.packetSet.status !== 'ready_for_user_strategy_review' ? ['packet_set_not_ready'] : [])
    ],
    warnings: ready ? [] : ['child_strategy_handoff_waiting_for_review_gate'],
    boundaries: [...HANDOFF_BOUNDARIES]
  };
}
