// 设计质量裁决单一口径守护：契约优先串联 scorecard、契约失败不被评分并行覆盖、
// incomplete_verification 不伪造失败、无 scorecard 时向后兼容契约二元判定。纯逻辑，无需运行环境。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignVerdict,
  isDesignVerdictDeliverable
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-quality-verdict-bundle.ts'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function scorecard(gate, overrides = {}) {
  return {
    version: 'design-quality-assertion/v0',
    overallScore: overrides.overallScore != null ? overrides.overallScore : (gate === 'passed' ? 88 : 52),
    passed: gate === 'passed',
    gate,
    coverage: overrides.coverage || {
      total: 14, evaluated: 10, uneval: 4, ratio: 10 / 14,
      deterministicEvaluated: 8, vlmEvaluated: 2
    },
    dimensionScores: [],
    blockers: overrides.blockers || [],
    failedAssertions: overrides.failedAssertions || (overrides.blockers || []),
    needsReview: overrides.needsReview || [],
    results: [],
    summary: overrides.summary || `gate=${gate}`
  };
}

const blockerAssertion = {
  id: 'subject-ratio', dimension: 'composition', status: 'fail', score: 0.2,
  confidence: 1, method: 'deterministic', severity: 'blocker', owner: 'executor',
  rationale: '主体占比过低', expectedFix: '放大主体到画面 40%-70%'
};

const majorAssertion = {
  id: 'contrast', dimension: 'color', status: 'fail', score: 0.35,
  confidence: 1, method: 'deterministic', severity: 'major', owner: 'executor',
  rationale: '主体与背景对比不足', expectedFix: '提高主体与背景明度对比'
};

const passContract = {
  kind: 'creative_design', status: 'completed',
  required: [
    { id: 'creative-visual', label: '主视觉', status: 'passed' },
    { id: 'creative-copy', label: '文案', status: 'passed' },
    { id: 'creative-delivery', label: '交付', status: 'passed' }
  ]
};

const failContract = {
  kind: 'creative_design', status: 'failed',
  required: [
    { id: 'creative-visual', label: '主视觉', status: 'failed', reason: '缺主视觉素材' },
    { id: 'creative-copy', label: '文案', status: 'passed' }
  ],
  blockers: ['缺主视觉素材'],
  summary: '设计产物未齐'
};

const needsReviewContract = {
  kind: 'creative_design', status: 'completed',
  required: [
    { id: 'creative-visual', label: '主视觉', status: 'passed' },
    { id: 'creative-copy', label: '文案', status: 'needs_review', reason: '文案待人工复核' }
  ]
};

const nonDesignContract = { kind: 'document_save', status: 'completed', required: [] };

// 1) 无 contract → not_applicable
check('no-contract → not_applicable',
  buildDesignVerdict({}).status === 'not_applicable');

// 2) 非设计 kind → not_applicable（即便给了通过的 scorecard 也不评分）
check('non-design-kind → not_applicable',
  buildDesignVerdict({ contract: nonDesignContract, scorecard: scorecard('passed') }).status === 'not_applicable');

// 3) 契约失败 → failed，source=contract，且不被通过的 scorecard 并行覆盖（核心反并行不变量）
{
  const v = buildDesignVerdict({ contract: failContract, scorecard: scorecard('passed') });
  check('contract-failed → failed', v.status === 'failed', `got ${v.status}`);
  check('contract-failed → source=contract', v.source === 'contract', `got ${v.source}`);
  check('contract-failed → not overridden by passing scorecard', v.scorecardGate === undefined, `scorecardGate=${v.scorecardGate}`);
  check('contract-failed → reports failed requirement ids', v.contractFailedRequirementIds.includes('creative-visual'));
  check('contract-failed → blockers carry reason', v.blockers.some((b) => b.includes('缺主视觉')));
}

// 4) 契约通过 + 无 scorecard → passed（向后兼容二元判定）
{
  const v = buildDesignVerdict({ contract: passContract });
  check('contract-passed + no-scorecard → passed', v.status === 'passed', `got ${v.status}`);
  check('contract-passed + no-scorecard → source=contract', v.source === 'contract');
}

// 5) 契约通过但有 needs_review 项 + 无 scorecard → needs_review
{
  const v = buildDesignVerdict({ contract: needsReviewContract });
  check('contract-needsReview + no-scorecard → needs_review', v.status === 'needs_review', `got ${v.status}`);
}

// 6) 契约通过 + scorecard failed(blocker) → failed，source=contract+scorecard
{
  const v = buildDesignVerdict({ contract: passContract, scorecard: scorecard('failed', { blockers: [blockerAssertion] }) });
  check('contract-passed + scorecard-failed → failed', v.status === 'failed', `got ${v.status}`);
  check('contract-passed + scorecard-failed → source=contract+scorecard', v.source === 'contract+scorecard');
  check('contract-passed + scorecard-failed → blocker text from assertion', v.blockers.some((b) => b.includes('主体占比过低')));
  check('contract-passed + scorecard-failed → carries overallScore', typeof v.overallScore === 'number');
}

// 6b) 分级核心：契约通过 + gate=failed 但仅 major 梯度缺陷（无 blocker）→ needs_review（软），blocker 空，major 进 warnings
{
  const v = buildDesignVerdict({ contract: passContract, scorecard: scorecard('failed', { failedAssertions: [majorAssertion], blockers: [] }) });
  check('major-only failed → needs_review (not failed)', v.status === 'needs_review', `got ${v.status}`);
  check('major-only failed → no hard blockers', v.blockers.length === 0, `blockers=${JSON.stringify(v.blockers)}`);
  check('major-only failed → major surfaced in warnings', v.warnings.some((w) => w.includes('对比不足')));
}

// 7) 契约通过 + scorecard needs_review → needs_review
{
  const v = buildDesignVerdict({ contract: passContract, scorecard: scorecard('needs_review', { needsReview: [blockerAssertion] }) });
  check('contract-passed + scorecard-needsReview → needs_review', v.status === 'needs_review', `got ${v.status}`);
}

// 8) 契约通过 + scorecard incomplete_verification → passed_unverified（红线：不伪造失败）
{
  const v = buildDesignVerdict({ contract: passContract, scorecard: scorecard('incomplete_verification', { coverage: { total: 14, evaluated: 4, uneval: 10, ratio: 4 / 14, deterministicEvaluated: 4, vlmEvaluated: 0 } }) });
  check('contract-passed + incomplete_verification → passed_unverified (not failed)', v.status === 'passed_unverified', `got ${v.status}`);
  check('contract-passed + incomplete_verification → has unverified warning', v.warnings.some((w) => w.includes('覆盖率不足')));
  check('contract-passed + incomplete_verification → no blockers', v.blockers.length === 0);
}

// 9) 契约通过 + scorecard passed → passed
{
  const v = buildDesignVerdict({ contract: passContract, scorecard: scorecard('passed') });
  check('contract-passed + scorecard-passed → passed', v.status === 'passed', `got ${v.status}`);
}

// 10) isDesignVerdictDeliverable：分级口径下 deliverable ⇔ 无 blocker
check('deliverable: no blockers → true',
  isDesignVerdictDeliverable({ blockers: [] }) === true);
check('deliverable: has blockers → false',
  isDesignVerdictDeliverable({ blockers: ['质量红线'] }) === false);
check('deliverable: real passed verdict → true',
  isDesignVerdictDeliverable(buildDesignVerdict({ contract: passContract, scorecard: scorecard('passed') })) === true);
check('deliverable: real blocker verdict → false',
  isDesignVerdictDeliverable(buildDesignVerdict({ contract: passContract, scorecard: scorecard('failed', { blockers: [blockerAssertion] }) })) === false);
check('deliverable: major-only (soft) → true',
  isDesignVerdictDeliverable(buildDesignVerdict({ contract: passContract, scorecard: scorecard('failed', { failedAssertions: [majorAssertion], blockers: [] }) })) === true);

if (failures > 0) {
  console.error(`[smoke-design-quality-verdict-bundle] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-quality-verdict-bundle] passed');
