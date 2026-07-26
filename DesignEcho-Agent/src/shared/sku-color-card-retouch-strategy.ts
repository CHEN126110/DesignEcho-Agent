export type SkuColorCardRetouchStrategyStatus = 'ready_for_strategy_review' | 'needs_current_context';

export interface SkuColorCardRetouchStrategy {
  version: 'sku-color-card-retouch-strategy/v0';
  status: SkuColorCardRetouchStrategyStatus;
  summary: {
    colorCount: number;
    comboSizes: number[];
    requestedByUser: boolean;
    sourceHintCount: number;
  };
  shapeStrategy: {
    unifiedPoseTargets: string[];
    allowedShapeAdjustments: string[];
    fidelityBoundaries: string[];
    reviewRequirements: string[];
  };
  lightStrategy: {
    goals: string[];
    methods: string[];
    textureProtection: string[];
    reviewRequirements: string[];
  };
  shadowStrategy: {
    goals: string[];
    methods: string[];
    whiteFieldPolicy: string[];
    reviewRequirements: string[];
  };
  retouchSequence: Array<{
    id: string;
    title: string;
    purpose: string;
    mustReview: boolean;
  }>;
  strategyInputPatch: {
    skuColorCardRetouchStrategy: {
      shapeStrategy: SkuColorCardRetouchStrategy['shapeStrategy'];
      lightStrategy: SkuColorCardRetouchStrategy['lightStrategy'];
      shadowStrategy: SkuColorCardRetouchStrategy['shadowStrategy'];
      retouchSequence: SkuColorCardRetouchStrategy['retouchSequence'];
      reviewRequirements: string[];
      boundary: string;
    };
  };
  reviewRequirements: string[];
  blockers: string[];
  warnings: string[];
  limitations: string[];
  canClaimOutputQuality: false;
  canClaimDesignComplete: false;
  noPhotoshopWrites: true;
  mustNotExecutePhotoshop: true;
  mustNotChangeExecutionParams: true;
}

export interface BuildSkuColorCardRetouchStrategyInput {
  userText?: string;
  colorCount?: number;
  comboSizes?: number[];
  sourceHints?: unknown[];
}

const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]'],
  [/data:image\//gi, '[redacted-image-payload]'],
  [/raw-image-payload|base64-image-payload/gi, '[redacted-image-payload]'],
  [/[A-Z]:[\\/][^\s"'`，。；;,)）\]}]+/g, '[local-path-redacted]']
];

function cleanText(value: unknown): string {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text.trim();
}

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function normalizePositiveInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function normalizeSizes(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .map((value) => normalizePositiveInteger(value, 0))
    .filter((value) => value > 0 && value <= 50)))
    .sort((a, b) => a - b);
}

function userRequestsRetouchStrategy(userText: string): boolean {
  return /色卡|精修|形态|光影|阴影|白场|正片叠底|罗口|袜口|统一|自然/.test(userText);
}

function buildShapeStrategy(): SkuColorCardRetouchStrategy['shapeStrategy'] {
  return {
    unifiedPoseTargets: [
      'aligned_cuff_top',
      'consistent_sock_body_axis',
      'consistent_heel_turn_position',
      'consistent_toe_angle',
      'consistent_bottom_baseline'
    ],
    allowedShapeAdjustments: [
      'translate_rotate_scale_to_reference_pose',
      'minor_warp_for_body_axis_only_after_texture_review',
      'mask_edge_cleanup_without_changing_product_identity'
    ],
    fidelityBoundaries: [
      'preserve_special_cuff_shape',
      'do_not_force_lace_or_flower_cuff_into_plain_cuff',
      'do_not_stretch_knit_texture_beyond_manual_review',
      'do_not_hide_real_style_differences_between_colors'
    ],
    reviewRequirements: [
      'shape_consistency_review_required',
      'cuff_shape_manual_review_required',
      'texture_distortion_review_required',
      'product_identity_preservation_required'
    ]
  };
}

function buildLightStrategy(): SkuColorCardRetouchStrategy['lightStrategy'] {
  return {
    goals: [
      'unified_white_balance_without_color_fact_changes',
      'consistent_volume_light_across_colors',
      'natural_highlight_shadow_transition',
      'dark_color_texture_visibility'
    ],
    methods: [
      'white_point_reference_review',
      'neutral_gray_dodge_burn_review',
      'per_color_tone_curve_review',
      'highlight_clipping_check',
      'dark_texture_detail_check'
    ],
    textureProtection: [
      'preserve_knit_texture_detail',
      'preserve_rib_structure',
      'avoid_flat_overexposure_on_white_socks',
      'avoid_crushed_shadow_on_black_socks'
    ],
    reviewRequirements: [
      'lighting_consistency_review_required',
      'white_point_manual_review_required',
      'knit_texture_detail_review_required',
      'dark_light_color_separate_review_required'
    ]
  };
}

function buildShadowStrategy(): SkuColorCardRetouchStrategy['shadowStrategy'] {
  return {
    goals: [
      'consistent_contact_shadow_direction',
      'natural_soft_shadow_under_each_sock',
      'separate_shadow_from_product_color',
      'consistent_shadow_strength_across_colors'
    ],
    methods: [
      'shadow_layer_isolation_review',
      'multiply_shadow_layer_review',
      'shadow_group_b_comparison_review',
      'edge_halo_cleanup_review'
    ],
    whiteFieldPolicy: [
      'separate_product_from_shadow_after_white_point',
      'keep_shadow_layer_reviewable_after_background_cleanup',
      'do_not_erase_contact_shadow_when_exporting_white_background',
      'do_not_bake_unreviewed_shadow_into_product_layer'
    ],
    reviewRequirements: [
      'shadow_consistency_review_required',
      'multiply_blend_shadow_review_required',
      'white_background_edge_review_required',
      'contact_shadow_position_review_required'
    ]
  };
}

function buildRetouchSequence(): SkuColorCardRetouchStrategy['retouchSequence'] {
  return [
    {
      id: 'source_selection',
      title: '选择项目内单色 SKU 源图',
      purpose: '优先使用当前项目 PSD/PSB 或单色导出源，避免误用已打开的其他项目文档。',
      mustReview: true
    },
    {
      id: 'shape_reference',
      title: '建立参考袜形',
      purpose: '以一个最稳定颜色作为姿态参考，统一袜身轴线、袜口顶部、后跟和脚尖角度。',
      mustReview: true
    },
    {
      id: 'shape_normalization',
      title: '形态统一与保真检查',
      purpose: '只做平移、旋转、缩放和轻微形态修正；花边、特殊罗口和真实款式差异必须保留。',
      mustReview: true
    },
    {
      id: 'light_retouch',
      title: '中性灰式光影统一',
      purpose: '统一体积光与明暗过渡，同时保留针织纹理和不同颜色的真实色阶。',
      mustReview: true
    },
    {
      id: 'shadow_isolation',
      title: '阴影分离与正片叠底复核',
      purpose: '白场后保留可独立复核的阴影层，按正片叠底方向检查接触阴影和边缘灰影。',
      mustReview: true
    },
    {
      id: 'layout_acceptance',
      title: '色卡排版验收',
      purpose: '检查编号、色名、间距、基线、导出尺寸和人工复核记录。',
      mustReview: true
    }
  ];
}

function buildReviewRequirements(): string[] {
  return [
    'shape_consistency_review_required',
    'cuff_shape_manual_review_required',
    'lighting_consistency_review_required',
    'shadow_consistency_review_required',
    'white_background_edge_review_required',
    'knit_texture_detail_review_required',
    'result_screenshot_or_manual_review_required',
    'export_readback_required'
  ];
}

export function buildSkuColorCardRetouchStrategy(
  input: BuildSkuColorCardRetouchStrategyInput = {}
): SkuColorCardRetouchStrategy {
  const userText = cleanText(input.userText);
  const colorCount = normalizePositiveInteger(input.colorCount, 0);
  const comboSizes = normalizeSizes(input.comboSizes);
  const sourceHints = unique(input.sourceHints || []);
  const requestedByUser = userRequestsRetouchStrategy(userText);
  const shapeStrategy = buildShapeStrategy();
  const lightStrategy = buildLightStrategy();
  const shadowStrategy = buildShadowStrategy();
  const retouchSequence = buildRetouchSequence();
  const reviewRequirements = buildReviewRequirements();
  const boundary = 'SKU 色卡精修策略只能进入设计规划、模型决策和人工复核；它不直接执行 Photoshop、不改变 skuLayout 参数、不声明输出质量完成。';
  const warnings = unique([
    sourceHints.length === 0 ? '未提供可复核的 SKU 源图提示，执行前仍需从项目文件确认单色源图。' : '',
    !requestedByUser ? '用户未明确要求色卡精修时，该策略只能作为默认质量边界，不应扩大执行范围。' : '',
    colorCount <= 0 ? '未获得颜色数量，色卡间距和统一性仍需执行前补充。' : ''
  ]);

  return {
    version: 'sku-color-card-retouch-strategy/v0',
    status: 'ready_for_strategy_review',
    summary: {
      colorCount,
      comboSizes,
      requestedByUser,
      sourceHintCount: sourceHints.length
    },
    shapeStrategy,
    lightStrategy,
    shadowStrategy,
    retouchSequence,
    strategyInputPatch: {
      skuColorCardRetouchStrategy: {
        shapeStrategy,
        lightStrategy,
        shadowStrategy,
        retouchSequence,
        reviewRequirements,
        boundary
      }
    },
    reviewRequirements,
    blockers: [],
    warnings,
    limitations: [
      '该策略不直接执行 Photoshop，也不生成或修改图层。',
      '该策略不改变 SKU 组合、自选备注、项目 CSV、模板选择或 skuLayout 参数。',
      '形态统一必须经过特殊罗口/花边罗口保真复核，不能为追求统一而造成失真。',
      '光影统一必须保留针织纹理和真实商品颜色，不能把白袜过曝或黑袜压暗。',
      '阴影层建议独立复核，白场处理后仍需人工确认接触阴影自然。'
    ],
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    mustNotChangeExecutionParams: true
  };
}
