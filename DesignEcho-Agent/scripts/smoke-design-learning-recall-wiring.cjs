// 设计学习「反哺读取侧」接线守护：通用自主主循环（autonomous-agent.executor）在创意设计任务时，
// 必须把已复核采纳（active）的设计经验记忆注入系统提示——兑现"学过的能在通用循环用上"，
// 而不再只有 main-image/detail-page/sku 三个 executor 能读到 active 记忆（治理审计标记的"建好未接线"病灶）。
//
// 这是结构化文本扫描（不解析 TS、不依赖运行环境）：锁定单一读取路径 buildDesignMemoryPromptSection
// 被调用、其产物 designMemorySummary 进入 reviewed_memory Context 槽、且受 designDisciplineContext.active 门控。
// 数据正确性（active-only / needs_review 排除 / 有界 / 不照搬红线）由 smoke-design-memory-knowledge 与
// smoke-design-memory-prompt-section 守护，本守护只防"注入被整段删掉"导致反哺链再次断裂。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const executorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const src = fs.readFileSync(executorPath, 'utf8');

// 1) 单一读取路径被调用（复用 design-planner-context 的 buildDesignMemoryPromptSection，避免另起读取逻辑）
check('调用 buildDesignMemoryPromptSection（单一读取路径）', src.includes('buildDesignMemoryPromptSection('));

// 2) 注入受创意设计纪律门控（designDisciplineContext.active）——非设计对话不注入记忆，避免污染上下文
{
  const idx = src.indexOf('buildDesignMemoryPromptSection(');
  const before = idx >= 0 ? src.slice(Math.max(0, idx - 400), idx) : '';
  check('注入受 designDisciplineContext.active 门控', before.includes('designDisciplineContext.active'), '应在创意设计任务时才注入');
}

// 3) 记忆摘要进入结构化 reviewed_memory 槽（真正喂给模型，且不能混入 System Policy）
check('designMemorySummary 进入 reviewed_memory Context 槽', /id:\s*'memory\.reviewed-design-experience'[\s\S]*trust:\s*'reviewed_memory'[\s\S]*slot:\s*'reviewed_memory'[\s\S]*content:\s*designMemorySummary/.test(src),
  'designMemorySummary 必须进入 reviewed_memory trust/slot');
check('Context Compiler 消费记忆项', src.includes('compileRuntimeContext({ items: contextItems })'),
  '结构化 Context 必须由统一 compiler 生成模型上下文');
check('旧无类型 systemPromptSections 已退役', !src.includes('systemPromptSections'),
  '不得退回无类型字符串数组拼接');

// 4) 读取失败不阻断执行（try/catch + 不影响执行）——反哺是增益项，缺记忆不能让设计任务失败
{
  const idx = src.indexOf('buildDesignMemoryPromptSection(');
  const around = idx >= 0 ? src.slice(Math.max(0, idx - 200), idx + 400) : '';
  check('读取失败优雅降级（不阻断执行）', /catch[\s\S]*不影响执行|catch[\s\S]*designMemorySummary\s*=/.test(around) || around.includes('catch'),
    '应 try/catch 包裹，失败静默跳过');
}

if (failures > 0) {
  console.error(`[smoke-design-learning-recall-wiring] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-learning-recall-wiring] passed');
