// 设计意图信号守护：行为足迹/模型声明驱动、不读用户文本关键词、partial 覆盖纯图无文案设计、
// 优先级正确、失败工具不计、设计技能结构信号、"含形容词措辞"在新源里结构上不会漏判。纯逻辑。

const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  resolveDesignIntentSignal,
  evaluateDesignToolFootprint
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-intent-signal.ts'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const ok = (name) => ({ name, result: { success: true } });

// 1) 完整足迹（建文档+置图+文案）→ 设计、tool_footprint、非 partial
{
  const s = resolveDesignIntentSignal({ toolCallLog: [ok('createDocument'), ok('placeImage'), ok('createTextLayer')] });
  check('complete footprint → isDesign', s.isDesign === true);
  check('complete footprint → source=tool_footprint', s.source === 'tool_footprint', s.source);
  check('complete footprint → not partial', s.partial === false);
}

// 2) 纯图无文案（建文档+置图，无文案）→ 设计、partial（评审#1硬伤修复：海报/封面不被 copyCount=0 误判）
{
  const s = resolveDesignIntentSignal({ toolCallLog: [ok('createDocument'), ok('placeImage')] });
  check('text-less design → isDesign (critique #1 fix)', s.isDesign === true);
  check('text-less design → partial=true', s.partial === true);
  check('text-less design → source=tool_footprint', s.source === 'tool_footprint');
}

// 3) 仅 createDocument（无任何视觉元素）→ 不判设计（可能是建文档做工具验证，不预判）
{
  const s = resolveDesignIntentSignal({ toolCallLog: [ok('createDocument')] });
  check('createDocument only → not design', s.isDesign === false, s.source);
}

// 4) 仅模型声明（无任何工具调用）→ 设计、model_declaration、带 taskTypeId（动手前早激活）
{
  const s = resolveDesignIntentSignal({ declaredTaskType: 'design.poster.v1' });
  check('declaration only → isDesign', s.isDesign === true);
  check('declaration only → source=model_declaration', s.source === 'model_declaration', s.source);
  check('declaration only → taskTypeId carried', s.taskTypeId === 'design.poster.v1');
}

// 5) 声明 + 纯图足迹 → 声明优先，但 partial 标志透传
{
  const s = resolveDesignIntentSignal({ declaredTaskType: 'design.poster.v1', toolCallLog: [ok('createDocument'), ok('placeImage')] });
  check('declaration+partial → source=model_declaration', s.source === 'model_declaration');
  check('declaration+partial → partial透传', s.partial === true);
  check('declaration+partial → taskTypeId', s.taskTypeId === 'design.poster.v1');
}

// 6) 完整足迹 + 声明 → 足迹(complete)定 source，taskTypeId 仍由声明给出
{
  const s = resolveDesignIntentSignal({ declaredTaskType: 'ecommerce.main_image.v1', toolCallLog: [ok('createDocument'), ok('renderLayout'), ok('createTextLayer')] });
  check('complete+declaration → source=tool_footprint', s.source === 'tool_footprint');
  check('complete+declaration → taskTypeId from declaration', s.taskTypeId === 'ecommerce.main_image.v1');
  check('complete+declaration → not partial', s.partial === false);
}

// 7) 仅设计技能 id（结构信号）→ 设计、skill_id
{
  const s = resolveDesignIntentSignal({ skillId: 'main-image-design' });
  check('design skill id → isDesign', s.isDesign === true);
  check('design skill id → source=skill_id', s.source === 'skill_id', s.source);
}

// 8) autonomous-agent 通用入口本身不作为设计信号
{
  const s = resolveDesignIntentSignal({ skillId: 'autonomous-agent' });
  check('autonomous-agent alone → not design', s.isDesign === false);
}

// 9) 什么都没有 → 非设计、none
{
  const s = resolveDesignIntentSignal({});
  check('empty → not design', s.isDesign === false && s.source === 'none');
}

// 10) 失败工具不计入足迹
{
  const s = resolveDesignIntentSignal({ toolCallLog: [
    { name: 'createDocument', result: { success: false } },
    { name: 'placeImage', result: { success: true } },
    { name: 'createTextLayer', result: { success: true } }
  ] });
  check('failed createDocument not counted → not complete', s.footprint.hasCreateDocument === false && s.isDesign === false);
}

// 11) 核心演示：含形容词的"设计一张促销主图"在新源里**结构上不可能漏判**——因为新源根本不读用户文本。
//     旧关键词总闸(EXPLICIT_CREATIVE_DESIGN_PATTERNS)对"促销"夹在动词名词间会漏判；新源只看行为/声明：
{
  // 模型对该请求声明了 main-image → 立即激活，与措辞无关
  const byDeclare = resolveDesignIntentSignal({ declaredTaskType: 'ecommerce.main_image.v1' });
  check('促销主图 via declaration → isDesign (不受措辞影响)', byDeclare.isDesign === true);
  // 或模型直接动手 → 激活，与措辞无关
  const byAct = resolveDesignIntentSignal({ toolCallLog: [ok('createDocument'), ok('placeImage'), ok('setTextContent')] });
  check('促销主图 via behavior → isDesign (不受措辞影响)', byAct.isDesign === true);
  // 新源不接收、不依赖任何 taskText 字段，结构上无法因措辞漏判
  check('signal input 不含 taskText 字段（无关键词通路）', !('taskText' in resolveDesignIntentSignal({})));
}

// 12) evaluateDesignToolFootprint 直接可用（供 Step2 收敛复用）
{
  const f = evaluateDesignToolFootprint([ok('createDocument'), ok('createRectangle')]);
  check('footprint helper: shape 计入 visual', f.hasVisual === true && f.partial === true);
}

if (failures > 0) {
  console.error(`[smoke-design-intent-signal] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-intent-signal] passed');
