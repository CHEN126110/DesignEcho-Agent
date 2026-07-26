import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
  EcommerceSocksChildStrategyHandoff,
  EcommerceSocksChildStrategyHandoffPacket
} from './ecommerce-socks-child-strategy-handoff';
import type { MainImageStrategyInputKey } from './main-image-strategy-contract';

export type EcommerceSocksChildStrategyScenario = 'main-image' | 'detail-page' | 'sku';

export type EcommerceSocksChildStrategyInputStatus =
  | 'missing_parent_handoff'
  | 'blocked_parent_handoff_not_ready'
  | 'blocked_child_packet_missing'
  | 'blocked_child_packet_not_ready'
  | 'ready_for_child_planner';

export interface EcommerceSocksChildStrategyInput {
  version: 'ecommerce-socks-child-strategy-input/v0';
  source: 'ecommerce-socks-parent-handoff';
  skillId: BusinessDesignSkillId;
  expectedScenario: EcommerceSocksChildStrategyScenario;
  status: EcommerceSocksChildStrategyInputStatus;
  parentHandoffStatus: EcommerceSocksChildStrategyHandoff['status'] | 'missing';
  packetStatus: EcommerceSocksChildStrategyHandoffPacket['status'] | 'missing';
  sourcePacketStatus?: EcommerceSocksChildStrategyHandoffPacket['sourcePacketStatus'];
  strategyInputPatch: Record<string, unknown>;
  strategyInputsPatch: Record<string, any>;
  strategyDirectives: string[];
  reviewRequirements: string[];
  boundaryChecklist: string[];
  blockers: string[];
  warnings: string[];
  boundaries: string[];
  canUseAsChildStrategyInput: boolean;
  canExecuteChildSkill: false;
  canWritePhotoshop: false;
  canClaimOutputQuality: false;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
}

export interface BuildEcommerceSocksChildStrategyInputOptions {
  handoff?: EcommerceSocksChildStrategyHandoff | null;
  skillId: BusinessDesignSkillId;
  expectedScenario: EcommerceSocksChildStrategyScenario;
}

const BOUNDARIES = [
  'This child strategy input is read-only planner context.',
  'This child strategy input does not execute child skills.',
  'This child strategy input does not write Photoshop or project files.',
  'This child strategy input does not prove output quality or design completion.'
];

const UNSAFE_KEY_PATTERN = /(base64|rawimage|rawimagepayload|imagebase64|buffer|bytes|pixels|rawpayload)/i;
const UNSAFE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]'],
  [/data:image\//gi, '[redacted-image-payload]'],
  [/raw-image-payload|base64-image-payload/gi, '[redacted-image-payload]'],
  [/<\/?tool_call[^>]*>/gi, '[internal-tool-call-redacted]'],
  [/\b(?:direct_response|clarification_needed|needs_model_design_decision)\b/gi, '[internal-route-redacted]'],
  [/[A-Z]:[\\/][^\s"'`，。；;,)）\]}]+/g, '[local-path-redacted]']
];

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanText(value: unknown): string {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of UNSAFE_TEXT_REPLACEMENTS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text.trim();
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined && item !== '');
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_KEY_PATTERN.test(key)) continue;
      const sanitized = sanitizeValue(item);
      if (sanitized === undefined || sanitized === '') continue;
      output[key] = sanitized;
    }
    return output;
  }
  return undefined;
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function readRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function buildMainImageStrategyInputsPatch(
  patch: Record<string, any>
): Partial<Record<MainImageStrategyInputKey, unknown>> {
  const heroSubject = readRecord(patch.heroSubject);
  const placement = readRecord(patch.placement);
  const exportAcceptance = readRecord(patch.exportAcceptance);
  const requiredFormats = readStringArray(exportAcceptance.requiredFormats);
  return {
    heroSubjectPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      required: heroSubject.required === true,
      decision: cleanText(heroSubject.decision) || 'select_hero_product_photo_from_project_assets',
      rejectRules: readStringArray(heroSubject.rejectRules)
    },
    assetSelectionPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      preferProjectAssets: true,
      rejectUnverifiedExternalAssets: true,
      rejectRules: readStringArray(heroSubject.rejectRules)
    },
    imagePlacementPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      requiresSmartScaling: placement.requiresSmartScaling === true,
      requiresSafeArea: placement.requiresSafeArea === true,
      requiresActualBoundsReadback: placement.requiresActualBoundsReadback === true,
      requiredReview: readStringArray(placement.requiredReview)
    },
    smartScalingPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      requiresSmartScaling: placement.requiresSmartScaling === true,
      requiresCanvasVariantSafeArea: placement.requiresSafeArea === true,
      requiresActualBoundsReadback: placement.requiresActualBoundsReadback === true
    },
    copyRolePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      role: 'main_image_short_conversion_copy',
      requiresModelCopywriting: true,
      mustUseProjectContextForCopy: true,
      mustUseSupportedSellingPoints: true
    },
    exportAcceptancePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      requiredFormats,
      requiresPsdSave: exportAcceptance.requiresPsdSave === true,
      requiresReadback: exportAcceptance.requiresReadback === true
    },
    performanceBudget: {
      source: 'ecommerce-socks-parent-handoff',
      planningMode: 'child_strategy_input_only',
      requiresChildExecutionBudget: true
    }
  };
}

function buildDetailPageStrategyInputsPatch(patch: Record<string, any>): Record<string, any> {
  const screenStoryline = readRecord(patch.screenStoryline);
  const assetAllocation = readRecord(patch.assetAllocation);
  const qaAcceptance = readRecord(patch.qaAcceptance);
  return {
    screenStorylinePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      required: screenStoryline.required === true,
      requiredPlanning: readStringArray(screenStoryline.requiredPlanning)
    },
    assetAllocationPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      required: assetAllocation.required === true,
      requiresProjectAssetUnderstanding: assetAllocation.requiresProjectAssetUnderstanding === true,
      avoidDuplicatingWeakPhotosAcrossScreens: assetAllocation.avoidDuplicatingWeakPhotosAcrossScreens === true
    },
    qaAcceptancePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      requiresTextBoundsReview: qaAcceptance.requiresTextBoundsReview === true,
      requiresImageFitReview: qaAcceptance.requiresImageFitReview === true,
      requiresLongCanvasExportReadback: qaAcceptance.requiresLongCanvasExportReadback === true
    },
    performanceBudget: {
      source: 'ecommerce-socks-parent-handoff',
      planningMode: 'child_strategy_input_only',
      requiresChildExecutionBudget: true
    }
  };
}

function buildSkuStrategyInputsPatch(patch: Record<string, any>): Record<string, any> {
  const combinationPolicy = readRecord(patch.combinationPolicy);
  const sourcePolicy = readRecord(patch.sourcePolicy);
  const exportAcceptance = readRecord(patch.exportAcceptance);
  return {
    combinationPolicy: {
      source: 'ecommerce-socks-parent-handoff',
      required: combinationPolicy.required === true,
      includeSelfSelectNotesByDefault: combinationPolicy.includeSelfSelectNotesByDefault === true,
      preferProjectCsvConfig: combinationPolicy.preferProjectCsvConfig === true,
      requireColorAndSpecMapping: combinationPolicy.requireColorAndSpecMapping === true
    },
    sourcePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      preferProjectSkuPsdOrPsb: sourcePolicy.preferProjectSkuPsdOrPsb === true,
      mustNotUseUnrelatedOpenSkuDocument: sourcePolicy.mustNotUseUnrelatedOpenSkuDocument === true,
      requiresProjectTemplateCoverage: sourcePolicy.requiresProjectTemplateCoverage === true
    },
    exportAcceptancePolicy: {
      source: 'ecommerce-socks-parent-handoff',
      requiresReadback: exportAcceptance.requiresReadback === true,
      requiresComboAndNoteFileProbe: exportAcceptance.requiresComboAndNoteFileProbe === true,
      canClaimCompletionOnlyAfterChildReview: exportAcceptance.canClaimCompletionOnlyAfterChildReview === true
    },
    performanceBudget: {
      source: 'ecommerce-socks-parent-handoff',
      planningMode: 'child_strategy_input_only',
      requiresChildExecutionBudget: true
    }
  };
}

function buildStrategyInputsPatch(
  expectedScenario: EcommerceSocksChildStrategyScenario,
  strategyInputPatch: Record<string, any>
): Record<string, any> {
  if (expectedScenario === 'main-image') return buildMainImageStrategyInputsPatch(strategyInputPatch);
  if (expectedScenario === 'detail-page') return buildDetailPageStrategyInputsPatch(strategyInputPatch);
  return buildSkuStrategyInputsPatch(strategyInputPatch);
}

function buildStrategyDirectives(
  expectedScenario: EcommerceSocksChildStrategyScenario,
  strategyInputsPatch: Record<string, any>
): string[] {
  if (expectedScenario === 'main-image') {
    return [
      'Use project-owned hero product photography and reject unverified external assets.',
      'Plan smart scaling, safe areas, actual bounds readback and export probes before output claims.',
      'Ground main-image copy in project context and business memory instead of free-form claims.'
    ];
  }
  if (expectedScenario === 'detail-page') {
    return [
      `Plan screen storyline before Photoshop writes: ${readStringArray(strategyInputsPatch.screenStorylinePolicy?.requiredPlanning).join(', ') || 'missing planning list'}.`,
      'Allocate project assets by screen and avoid repeating weak photos across long-canvas sections.',
      'Require text bounds, image fit and export readback review before quality claims.'
    ];
  }
  return [
    'Default SKU execution must include self-select note outputs unless the user explicitly excludes them.',
    'Prefer project SKU PSD/PSB and project CSV config over unrelated open Photoshop documents.',
    'Require combo and note export file probes before any completion or review claim.'
  ];
}

export function resolveEcommerceSocksChildStrategyHandoff(value: unknown): EcommerceSocksChildStrategyHandoff | null {
  if (!isRecord(value)) return null;
  if (value.version !== 'ecommerce-socks-child-strategy-handoff/v0') return null;
  if (!Array.isArray(value.handoffs)) return null;
  return value as EcommerceSocksChildStrategyHandoff;
}

export function buildEcommerceSocksChildStrategyInput(
  options: BuildEcommerceSocksChildStrategyInputOptions
): EcommerceSocksChildStrategyInput {
  const handoff = options.handoff || null;
  const parentHandoffStatus = handoff?.status || 'missing';
  const packet = handoff?.handoffs.find((item) => item.skillId === options.skillId) || null;
  const packetStatus = packet?.status || 'missing';

  let status: EcommerceSocksChildStrategyInputStatus = 'ready_for_child_planner';
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!handoff) {
    status = 'missing_parent_handoff';
    blockers.push('ecommerce_socks_parent_handoff_missing');
  } else if (handoff.status !== 'ready_for_child_strategy_input' || handoff.canUseAsChildStrategyInput !== true) {
    status = 'blocked_parent_handoff_not_ready';
    blockers.push('ecommerce_socks_parent_handoff_not_ready');
  } else if (!packet) {
    status = 'blocked_child_packet_missing';
    blockers.push(`ecommerce_socks_child_packet_missing:${options.skillId}`);
  } else if (packet.status !== 'ready' || packet.canUseAsChildStrategyInput !== true) {
    status = 'blocked_child_packet_not_ready';
    blockers.push(`ecommerce_socks_child_packet_not_ready:${options.skillId}`);
  }

  const canUseAsChildStrategyInput = status === 'ready_for_child_planner' && Boolean(packet);
  const strategyInputPatch = canUseAsChildStrategyInput
    ? sanitizeRecord(packet?.strategyInputPatch)
    : {};
  const strategyInputsPatch = canUseAsChildStrategyInput
    ? sanitizeRecord(buildStrategyInputsPatch(options.expectedScenario, readRecord(packet?.strategyInputPatch)))
    : {};

  if (canUseAsChildStrategyInput && strategyInputPatch.scenario !== options.expectedScenario) {
    warnings.push(`expected_scenario_${options.expectedScenario}_but_received_${String(strategyInputPatch.scenario || 'unknown')}`);
  }

  return {
    version: 'ecommerce-socks-child-strategy-input/v0',
    source: 'ecommerce-socks-parent-handoff',
    skillId: options.skillId,
    expectedScenario: options.expectedScenario,
    status,
    parentHandoffStatus,
    packetStatus,
    sourcePacketStatus: packet?.sourcePacketStatus,
    strategyInputPatch,
    strategyInputsPatch,
    strategyDirectives: canUseAsChildStrategyInput
      ? buildStrategyDirectives(options.expectedScenario, strategyInputsPatch)
      : [],
    reviewRequirements: canUseAsChildStrategyInput
      ? readStringArray(packet?.reviewRequirements)
      : [],
    boundaryChecklist: canUseAsChildStrategyInput
      ? readStringArray(packet?.boundaryChecklist)
      : [],
    blockers,
    warnings,
    boundaries: [...BOUNDARIES],
    canUseAsChildStrategyInput,
    canExecuteChildSkill: false,
    canWritePhotoshop: false,
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true
  };
}
