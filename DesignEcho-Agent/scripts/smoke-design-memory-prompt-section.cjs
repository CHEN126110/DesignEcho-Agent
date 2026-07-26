// 设计经验记忆提示片段守护：只取 active local_case、有界(limit)、摘要截断、含"不照搬"红线、空则空串。
// 纯函数（formatDesignMemoryPromptSection），不依赖 getMemoryService。

const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  formatDesignMemoryPromptSection
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));
const { governDesignKnowledgeResult } = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-knowledge-governance.ts'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function caseResult(i, summary, tags) {
  return governDesignKnowledgeResult({
    id: `case-${i}`, title: `经验${i}`, intent: 'layout', sourceType: 'local_case',
    summary: summary || `第${i}条经验摘要`, sourceNotes: [], tags: tags || [`标签${i}`],
    allowedUses: ['prompt_context'], sourceLevel: 'local_case', sourceRank: 80
  }, {
    provenance: 'local_reviewed', sourceRevision: `memory-prompt-smoke:${i}:v1`, retrievedAt: '2026-07-12T00:00:00.000Z'
  });
}

// 1) 空 → 空串
check('empty → ""', formatDesignMemoryPromptSection([]) === '');

// 2) 仅非 local_case → 空串（被过滤）
check('non-local_case filtered → ""',
  formatDesignMemoryPromptSection([{ id: 'x', title: 'web', sourceType: 'web_page', summary: 's', tags: [] }]) === '');

// 3) local_case → 含表头 + 红线 + 条目
{
  const out = formatDesignMemoryPromptSection([caseResult(1, '主体居中、留白充足', ['构图', '留白'])]);
  check('has header', out.includes('已沉淀的设计经验'));
  check('has no-copy red line', out.includes('不要照搬复刻'));
  check('memory rules remain non-executable sources', out.includes('才可成为质量/交付 Policy') && out.includes('不授予工具执行权限'));
  check('has title+summary', out.includes('经验1') && out.includes('主体居中、留白充足'));
  check('has tags', out.includes('构图') && out.includes('留白'));
}

// 4) limit 生效（5 条，limit 2 → 只 2 条）
{
  const many = [1, 2, 3, 4, 5].map((i) => caseResult(i));
  const out = formatDesignMemoryPromptSection(many, 2);
  check('limit respected: has 经验1/经验2', out.includes('经验1') && out.includes('经验2'));
  check('limit respected: no 经验3', !out.includes('经验3'));
}

// 5) 摘要截断到 140
{
  const long = 'x'.repeat(300);
  const out = formatDesignMemoryPromptSection([caseResult(1, long)]);
  check('summary truncated to 140', !out.includes('x'.repeat(141)) && out.includes('x'.repeat(140)));
}

// 6) 混合：local_case 与非 local_case 混合 → 只保留 local_case
{
  const out = formatDesignMemoryPromptSection([
    { id: 'w', title: 'web参考', sourceType: 'web_page', summary: 's', tags: [] },
    caseResult(7, '本地经验7')
  ]);
  check('mixed: keeps local_case', out.includes('本地经验7'));
  check('mixed: drops non-local_case', !out.includes('web参考'));
}

if (failures > 0) {
  console.error(`[smoke-design-memory-prompt-section] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-memory-prompt-section] passed');
