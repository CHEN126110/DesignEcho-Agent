// 设计质量「视觉判官接线」守护（A1）：让"设计好不好"的真主观维度（主体突出/卖点视觉化/层次美感）
// 真被看图判定并入裁决，而非永远 uneval 空转——但只在能真看图时打分，否则诚实退回纯确定性裁决，绝不伪造。
//
// 这是结构化文本扫描（不解析 TS、不依赖运行环境）。核心逻辑（vlm 解析、乱响应→needs_review、确定性+vlm
// 合并打分覆盖率）由 smoke-design-quality-assertion 守护；本守护只锁 agent.ts 里的「诚实降级」与「单一口径」
// 不变量，防回归：①无截图/无视觉能力/调用失败 → 返回 null（不打分），而不是补默认分伪造"已评估"；
// ②仅创意设计任务才判；③结果经 buildRunResult await 后并入同一 buildExecutionSummary 的 scorecard。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const agentPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const src = fs.readFileSync(agentPath, 'utf8');

// 定位 evaluateDesignQualityVlmAssertions 方法体（切到下一个方法边界，避免固定长度截断）
const methodStart = src.indexOf('private async evaluateDesignQualityVlmAssertions');
check('存在 evaluateDesignQualityVlmAssertions 方法', methodStart >= 0);
const methodEnd = methodStart >= 0 ? src.indexOf('private buildExecutionSummary', methodStart) : -1;
const methodBody = methodStart >= 0 && methodEnd > methodStart ? src.slice(methodStart, methodEnd) : '';

// 1) 仅创意设计任务才判（非设计任务直接退出，不空跑模型）
check('仅 creative_design 才判定', /kind\s*!==\s*'creative_design'\s*\)\s*return null/.test(methodBody),
  "应有 if (taskCompletion?.kind !== 'creative_design') return null");

// 1a) 尊重取消/中止：已 abort 不发起视觉模型调用
check('abort 信号 → 返回 null（尊重取消）', /signal\?\.aborted\)\s*return null/.test(methodBody),
  '应有 if (this.config.signal?.aborted) return null');

// 1b) 仅可判定收尾态才判（昂贵视觉调用不在阻断/出错/取消/未成形态浪费）
check('仅可判定 stopReason 才判定', /JUDGEABLE_STOP_REASONS[\s\S]*includes\(stopReason\)\)\s*return null/.test(methodBody),
  '应有 stopReason 白名单：完成/到预算/超限/无进展才判，其余 return null');

// buildRunResult 方法体（切到下一个 private 方法边界，避免固定长度截断）
const brrStart = src.indexOf('private async buildRunResult');
const brrAfter = brrStart >= 0 ? src.indexOf('\n    private ', brrStart + 30) : -1;
const brrBody = brrStart >= 0 && brrAfter > brrStart ? src.slice(brrStart, brrAfter) : '';

// 1c) buildRunResult 对取消的运行跳过 vlm（不浪费模型调用）
check('buildRunResult 取消时跳过 vlm', /if\s*\(!input\.cancelled\)[\s\S]*evaluateDesignQualityVlmAssertions/.test(brrBody),
  'cancelled 时不调视觉判定');

// 2) 无截图或截图缺 Host 版本 → 不打分（接"真看过同一版本才打分"）
check('无可绑定截图 → 返回 null（不臆造视觉分）', /findLatestSnapshotImageForJudge\(\)[\s\S]*if\s*\(!snapshot\)\s*return null/.test(methodBody),
  '应取最近截图，无图则 return null');

// 2a) 取图委托给纯逻辑选择器：它统一约束最后修改后的时序、同文档与完整画布语义。
// 具体序列行为由 smoke-design-visual-judge-observation 守护；这里只锁生产接线。
{
  const judgeStart = src.indexOf('private findLatestSnapshotImageForJudge');
  const judgeEnd = judgeStart >= 0 ? src.indexOf('evaluateDesignQualityVlmAssertions', judgeStart) : -1;
  const judgeBody = judgeStart >= 0 && judgeEnd > judgeStart ? src.slice(judgeStart, judgeEnd) : '';
  check('取图使用统一视觉观察选择器',
    /selectLatestDesignVisualJudgeObservation\(this\.toolCallLog\)/.test(judgeBody),
    'findLatestSnapshotImageForJudge 应消费有序 Tool 日志的纯逻辑选择结果');
  check('只从已选操作结果提取真实图像',
    /extractImageFromToolResult\(selection\.entry\.result\)/.test(judgeBody),
    '选择器只管时序/目标/完整画布，图像编码仍应由统一 extractor 解析');
  check('截图必须携带 Photoshop Host 历史版本',
    /readPhotoshopHistoryStateRef\(selection\.entry\.result\)[\s\S]*!historyStateRef\)\s*return null/.test(judgeBody),
    '缺 historyStateRef 时必须 fail closed，不能用 Renderer 计数器猜版本');
  check('Judge Host 复核进入既有 Tool 日志且标记 Harness origin',
    /origin:\s*'harness_quality_verification'[\s\S]*qualityVerificationPhase:\s*phase/.test(judgeBody),
    '前后 getDocumentInfo 复核必须可审计，但不能冒充模型主动 Tool call');
}

// 2b) 结构化产物必须新鲜且与截图同 Host 版本，不可把 H1 像素与 H2 结构拼成一个裁决。
check('surfaceSnapshot 与截图绑定同一 Host 版本',
  /extractFreshDesignSurfaceSnapshotFromToolResults\(this\.toolCallLog,\s*\{[\s\S]*requiredHistoryStateRef:\s*snapshot\.historyStateRef/.test(methodBody),
  '应在发起 VLM 前按 snapshot.historyStateRef 过滤结构证据');

// 2c) Judge 前后都读取当前 Host 版本；不一致时丢弃而非发布 fresh_visual_evaluation。
{
  const preVerificationCalls = methodBody.match(
    /readCurrentPhotoshopHistoryStateRefForQualityVerification\(\s*'pre_judge'\s*\)/g
  ) || [];
  const postVerificationCalls = methodBody.match(
    /readCurrentPhotoshopHistoryStateRefForQualityVerification\(\s*'post_judge'\s*\)/g
  ) || [];
  check('Judge 前后各执行一次 Host 版本复核',
    preVerificationCalls.length === 1 && postVerificationCalls.length === 1,
    `expected one pre and one post verification read, got ${preVerificationCalls.length}/${postVerificationCalls.length}`);
  check('Judge 前版本不一致 → 停止调用',
    /samePhotoshopHistoryStateRef\(snapshot\.historyStateRef,\s*preJudgeHistoryStateRef\)[\s\S]*return null/.test(methodBody));
  check('Judge 后版本不一致 → 丢弃模型返回',
    /samePhotoshopHistoryStateRef\(snapshot\.historyStateRef,\s*postJudgeHistoryStateRef\)[\s\S]*return null/.test(methodBody));
  const modelCallIndex = methodBody.indexOf('this.callModelWithAccounting(');
  const postReadIndex = methodBody.indexOf('const postJudgeHistoryStateRef');
  const parseIndex = methodBody.indexOf('parseVlmJudgeResponse(');
  check('后置版本复核位于模型调用之后、解析采用之前',
    modelCallIndex >= 0 && postReadIndex > modelCallIndex && parseIndex > postReadIndex);
}

// 3) 无视觉能力（主模型不支持读图且无视觉槽模型）→ 不打分
check('无视觉能力 → 返回 null（诚实不打分）', /if\s*\(!judgeModelId\)\s*return null/.test(methodBody),
  '主模型 supportsVision 或视觉槽模型都没有时应 return null');

// 4) 调用失败 → catch 退回 null（不把"没判过"伪造成"判过"）
check('视觉判官调用失败 → catch 返回 null（不伪造）', /catch[\s\S]*design_quality_vlm_unavailable[\s\S]*return null/.test(methodBody),
  'try/catch 包裹模型调用，失败标 design_quality_vlm_unavailable 并 return null');

// 5) 用 parseVlmJudgeResponse 解析（复用统一解析：乱响应转 needs_review 不伪造裁决）
check('用 parseVlmJudgeResponse 解析判官响应', methodBody.includes('parseVlmJudgeResponse('));

// 5a) Judge 必须按本次 R1 Brief / R3 Strategy 判断目标适配性，不能只拿任务文本做通用好看评分。
check('Judge 消费已校验 R1 Brief 情境',
  /const brief = this\.runtimeDesignBriefDeclaration\?\.readiness\s*===\s*'ready'/.test(methodBody)
    && /buildVlmJudgeContextMessage\(\{[\s\S]*brief:\s*briefParts\.join/.test(methodBody),
  '应只从 ready 的 runtimeDesignBriefDeclaration 构造 Judge brief');
check('Judge Brief 保留输出要求与约束',
  /appendDesignJudgeContextPart\(briefParts,\s*'输出要求',\s*brief\?\.outputRequirements/.test(methodBody)
    && /appendDesignJudgeContextPart\(briefParts,\s*'约束',\s*brief\?\.constraints/.test(methodBody)
    && /brief:\s*briefParts\.join/.test(methodBody),
  '不能只传目标与受众而遗漏已校验的 outputRequirements / constraints');
check('Judge 消费已校验 R3 Strategy digest',
  /const strategyDeclaration = this\.runtimeDesignStrategyDeclaration\?\.readiness\s*===\s*'ready'/.test(methodBody)
    && /buildRuntimeDesignStrategyDigest\(strategyDeclaration\)/.test(methodBody)
    && /buildVlmJudgeContextMessage\(\{[\s\S]*strategy:\s*strategyParts\.join/.test(methodBody),
  '应把模型拥有且 Harness 已校验的 R3 digest 传给同一次 Judge 调用');
check('Judge Strategy 保留关键视觉与禁止约束',
  /strategy\?\.constraints[\s\S]*prohibitedClaims[\s\S]*paletteIntent[\s\S]*typographyIntent[\s\S]*imageTreatment[\s\S]*density/.test(methodBody)
    && /strategy:\s*strategyParts\.join/.test(methodBody),
  'Judge 必须知道策略约束、禁止宣称、配色、字体、图像处理与密度，避免提出反向修订');
check('Judge 消费 manifest-selected Evaluation 目标',
  /evaluationGoal:\s*evaluationProfile\?\.capabilityGoal/.test(methodBody),
  'Profile 存在时应把 capabilityGoal 作为评价情境，不按任务关键词选标准');
check('Judge 固定协议与动态资料按消息层级隔离',
  /const judgeSystemPrompt = buildVlmJudgeSystemPrompt\(pending\)[\s\S]*const judgeContextMessage = buildVlmJudgeContextMessage\([\s\S]*role:\s*'system',\s*content:\s*judgeSystemPrompt[\s\S]*role:\s*'user'[\s\S]*text:\s*judgeContextMessage/.test(methodBody),
  '固定 assertion / JSON 协议必须位于 system，任务、Brief、Strategy 与图片只能位于 user data envelope');
check('Judge 情境确实随同一视觉请求发送',
  /role:\s*'user',[\s\S]*content:\s*judgeContextMessage[\s\S]*contentBlocks:\s*\[[\s\S]*type:\s*'text',\s*text:\s*judgeContextMessage[\s\S]*type:\s*'image'/.test(methodBody),
  '不能只构造 Brief/Strategy 情境而没有把它和图片一同发送给 Judge');

// 6) buildRunResult await 视觉判官结果，并入 buildExecutionSummary（单一裁决口径，能驱动 reflexion）
{
  check('buildRunResult 为 async', brrStart >= 0, 'buildRunResult 必须 async 才能 await 视觉判定');
  check('buildRunResult await 视觉判官结果', /await this\.evaluateDesignQualityVlmAssertions\(/.test(brrBody));
  check('视觉判官结果传入 buildExecutionSummary', /buildExecutionSummary\([^)]*vlmAssertions/.test(brrBody),
    'vlm 结果须并入执行摘要的同一裁决');
  // buildRunResult 在 run() 多处以未 await 的 return 调用，必须保证自身永不 reject（异步异常不绕过迭代级 catch）
  check('buildRunResult 对 vlm 异步段 try/catch（永不 reject）', /try\s*\{[\s\S]*evaluateDesignQualityVlmAssertions[\s\S]*\}\s*catch\s*\{[\s\S]*vlmAssertions = null/.test(brrBody),
    'vlm await 须包 try/catch 兜底为 null，保证 buildRunResult 不 reject');
  check('没有完整 Judge 后置复核时执行 final_summary Host 闭合',
    /shouldCloseDesignQualityHistoryState\(input\.stopReason\)[\s\S]*readLatestClosedQualityHistoryStateRef\(\)[\s\S]*readCurrentPhotoshopHistoryStateRefForQualityVerification\('final_summary'\)/.test(brrBody),
    '无视觉模型、Judge 失败或未进入 Judge 时，质量摘要也必须读取当前 Host 版本');
}

// 7) buildExecutionSummary 先把 vlm 断言与确定性断言合并成一个 assertionResults，
// 再分别交给 manifest Evaluation Profile 主路径或旧任务兼容路径；两条路径不能各拼一套断言。
{
  const besStart = src.indexOf('private buildExecutionSummary');
  // 截到下一个 private 方法为止（此前用固定 5200 字符窗口，注释增长就会把被钉代码挤出窗口产生假失败）
  const besNext = besStart >= 0 ? src.indexOf('\n    private ', besStart + 1) : -1;
  const besBody = besStart >= 0 ? src.slice(besStart, besNext > besStart ? besNext : besStart + 12000) : '';
  check('确定性 + vlm 先合并进同一 assertionResults', /const assertionResults\s*=\s*\[[\s\S]*evaluateDeterministicAssertions\([\s\S]*\.\.\.\(vlmAssertions\s*\|\|\s*\[\]\)/.test(besBody),
    '应先构造统一 assertionResults，包含确定性断言和 vlmAssertions');
  check('Evaluation Profile 主路径消费统一 assertionResults', /evaluateDesignEvaluationProfile\(\{[\s\S]*assertionResults,[\s\S]*verificationRecords/.test(besBody),
    'manifest Evaluation Profile 必须消费统一 assertionResults');
  check('fresh_visual_evaluation 只来自完整可靠的批量 Judge 响应',
    /isReliableVlmJudgeBatchComplete\(vlmAssertions,\s*expectedVlmAssertions\)[\s\S]*key:\s*'fresh_visual_evaluation'/.test(besBody),
    '仅数组非空不够；漏 assertion、协议矛盾或低置信时不得生成 fresh_visual_evaluation');
  check('视觉影响局部写入缺少可靠 Judge 时动态降级',
    /buildRuntimeScopedVisualReviewVerificationRecords\(this\.toolCallLog,\s*\{\s*hasFreshVisualEvaluation\s*\}\)/.test(besBody),
    '局部文字、样式或几何修改不能只凭确定性覆盖率声明写后视觉质量通过');
  check('执行摘要优先采用最新 Harness Host 复核版本',
    /readLatestClosedQualityHistoryStateRef\(\)[\s\S]*verifiedCurrentHistoryStateRef[\s\S]*requiredHistoryStateRef:\s*verifiedCurrentHistoryStateRef/.test(besBody),
    '只有完整 post_judge/final_summary 复核才能闭合版本；若 Judge 失败或版本变化，确定性结构分不能回退使用旧截图版本');
  check('旧任务兼容路径消费统一 assertionResults', /scoreDesignAssertions\(assertionResults\)/.test(besBody),
    '旧 creative_design 兼容路径必须消费同一 assertionResults');
}

if (failures > 0) {
  console.error(`[smoke-design-quality-vlm-wiring] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-quality-vlm-wiring] passed');
