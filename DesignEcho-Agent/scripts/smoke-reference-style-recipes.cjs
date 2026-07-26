#!/usr/bin/env node

const {
  analyzeReferenceStyleRecipes,
  buildReferenceShadowRecipeExecutionPlan,
  buildReferenceStrokeRecipeExecutionPlan,
  formatReferenceStyleRecipeAnalysisForQa
} = require('../dist/main/shared/reference-replication-style-recipes.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const representation = {
    elements: [
      {
        id: 'headline_1',
        name: '主标题',
        style: {
          textColor: '#111111',
          fontSizeRatio: 0.08,
          effects: ['shadow']
        }
      },
      {
        id: 'card_1',
        name: '卖点卡片',
        style: {
          fillColor: '#FFFFFF',
          strokeColor: '#D4AF37',
          cornerRadius: 18,
          opacity: 0.84,
          effects: ['gradient', 'stroke', 'custom-hologram']
        }
      }
    ]
  };

  const analysis = analyzeReferenceStyleRecipes(representation);
  const qaLines = formatReferenceStyleRecipeAnalysisForQa(analysis);
  const shadowPlan = buildReferenceShadowRecipeExecutionPlan(representation.elements[0].style, { width: 260, height: 80 });
  const strokePlan = buildReferenceStrokeRecipeExecutionPlan(representation.elements[1].style, { width: 320, height: 140 });
  const conflictedShadowPlan = buildReferenceShadowRecipeExecutionPlan(
    { strokeColor: '#FFFFFF', effects: ['shadow', 'stroke'] },
    { width: 320, height: 140 }
  );

  assert(analysis.styledElementCount === 2, 'Expected 2 styled elements.');
  assert(analysis.executableHitCount === 7, `Expected 7 executable hits, got ${analysis.executableHitCount}.`);
  assert(analysis.plannedHitCount === 1, `Expected 1 planned hit, got ${analysis.plannedHitCount}.`);
  assert(analysis.unsupportedHitCount === 1, `Expected 1 unsupported hit, got ${analysis.unsupportedHitCount}.`);
  assert(shadowPlan?.executable === true, 'Expected shadow recipe to be executable when shadow is the only layer effect.');
  assert(shadowPlan?.params?.opacity === 28, `Expected controlled soft shadow opacity, got ${shadowPlan?.params?.opacity}.`);
  assert(shadowPlan?.params?.angle === 120, `Expected controlled soft shadow angle, got ${shadowPlan?.params?.angle}.`);
  assert(conflictedShadowPlan?.executable === false, 'Expected shadow recipe to skip stroke+shadow until layer-effect merge is verified.');
  assert(strokePlan?.executable === true, 'Expected stroke recipe to be executable when strokeColor is present.');
  assert(strokePlan?.params?.position === 'inside', 'Expected stroke recipe to use inside stroke by default.');
  assert(strokePlan?.params?.color?.r === 212 && strokePlan.params.color.g === 175 && strokePlan.params.color.b === 55, 'Expected stroke color to be parsed from hex.');
  assert(qaLines.some((line) => line.includes('可执行/基础落地 7 项')), 'Expected QA summary to mention executable hits.');
  assert(qaLines.some((line) => line.includes('待补 recipe')), 'Expected QA summary to mention planned recipes.');
  assert(qaLines.some((line) => line.includes('未知效果')), 'Expected QA summary to mention unsupported effects.');

  return {
    success: true,
    analysis: {
      styledElementCount: analysis.styledElementCount,
      executableHitCount: analysis.executableHitCount,
      plannedHitCount: analysis.plannedHitCount,
      unsupportedHitCount: analysis.unsupportedHitCount,
      plannedRecipes: analysis.plannedRecipes.map((recipe) => recipe.id),
      unsupportedEffects: analysis.unsupportedEffects,
      shadowPlan,
      conflictedShadowPlan,
      strokePlan
    },
    qaLines
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
