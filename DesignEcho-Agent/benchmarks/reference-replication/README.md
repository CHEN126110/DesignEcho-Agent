# Reference Replication Benchmarks

## 目的

本目录用于承载“参考图理解并复刻设计”的基准样例与评分记录。

目标：

1. 不再靠主观感觉判断改动是否有效
2. 为后续的 placement policy、recipe、QA 建立统一验证入口

## 当前规则

1. 没有真实参考图与结果截图时，不创建伪造案例
2. 没有手测结果时，不填写评分
3. 每个案例必须能追溯：
   - 输入参考图
   - 测试场景
   - 执行配置
   - 结果截图
   - 评分记录

## 来源边界

每个 benchmark case 必须在 `scenario.source.providedBy` 中记录来源。

允许作为真实质量候选的来源必须是明确真实来源，例如：

- `real-commercial-reference`
- `user-provided-commercial-reference`
- `user-supplied-real-reference`
- `brand-reference`
- `public-example-reference`

以下来源只能作为机制或临时验证，不能支持“设计质量达标”声明：

- `unknown`
- `user`
- `synthetic-fixture`
- `fixture`
- `fex`
- `temporary-fex`

新增 case 时应通过 `benchmark:reference-replication:create-case -- --source-kind <kind>` 结构化写入来源；真实商业参考图应先通过 `maintenance:reference-real-case-intake` 生成创建命令。

## 目录结构

- `cases.manifest.json`：案例清单
- `case-template.json`：新案例模板
- `scorecard-template.md`：评分模板
- `cases/`：具体案例目录

## CLI 脚手架

可以用下面的脚本从模板创建一个新 case。脚本默认会注册到 manifest；只有临时草稿才使用 `--no-register`。

```bash
node scripts/create-reference-replication-case.cjs --id rr-002 --name "双栏电商海报" --category poster-layout --source-kind synthetic-fixture
```

也可以通过 npm script 调用：

```bash
npm run benchmark:reference-replication:create-case -- --id rr-002 --name "双栏电商海报" --category poster-layout --source-kind real-commercial-reference --reference-image "C:\path\poster.jpg" --copy-reference-image
```

常用参数：

- `--id`：必填，case 文件名
- `--name`：case 显示名
- `--category`：必填口径的场景类别 slug，默认 `poster-layout`
- `--source-kind`：必填；参考图来源类别。真实质量候选必须使用明确真实来源，合成种子使用 `synthetic-fixture`，临时 FEX 使用 `temporary-fex`
- `--source-captured-at` / `--source-boundary`：来源采集时间和边界说明
- `--register`：把 case 追加到 `cases.manifest.json`，默认开启
- `--no-register`：只写入 case 文件；运行 benchmark validator 前必须手动登记
- `--reference-image`：参考图路径，写入 case JSON
- `--copy-reference-image`：把参考图复制到 `assets/`，并把 case 中的路径写成 benchmark 相对路径
- `--reference-asset-name`：复制参考图时使用的文件名；默认使用 `<case-id><原扩展名>`
- `--result-screenshot`：结果截图路径，写入 case JSON
- `--copy-result-screenshot`：把结果截图复制到 `results/`，并把 case 中的路径写成 benchmark 相对路径
- `--result-screenshot-name`：复制结果截图时使用的文件名；默认使用 `<case-id>-result<原扩展名>`
- `--manual-verified` / `--build-verified`：写入验证状态
- `--dry-run`：只打印将要写入的内容，不落盘

脚本默认以 UTF-8 读取和写入 JSON，避免中文字段在 Windows 控制台和文件中出现乱码。

## manifest 说明

`cases.manifest.json` 现在只保存最小清单信息：

- `suite`
- `version`
- `status`
- `template`
- `caseDirectory`
- `cases`

其中 `cases` 里的每一项至少包含：

- `id`
- `name`
- `status`
- `file`

## 验收契约

每个 case 必须包含 `acceptance` 段，明确该案例需要哪些证据，而不是只写主观描述。

当前支持的证据类型：

- `editable-text-layers`：结果必须保留可编辑文本或图层结构。
- `bounds-qa`：用 expectedElements 的 bounds 对齐结果图层或检测框。
- `screenshot-pixel-probe`：用截图级像素探针做诊断证据，不等同于高保真设计评分。
- `manual-review`：需要人工复核截图、PSD 或 Photoshop 文档。

`screenshot-pixel-probe` 必须声明 `targetSize`、`thresholds`、`boundary` 和 `rawImagesRedacted: true`，避免把像素诊断误说成完整视觉质量验收。

如果填写了 `outputs.resultScreenshot`，文件必须真实存在于 benchmark 目录内；推荐通过 `--copy-result-screenshot` 写入 `results/`，避免路径失效。

## 证据就绪度

可以用下面的命令查看每个 case 当前能证明什么：

```bash
npm run maintenance:reference-readiness
```

如果需要判断“现在是否允许对外声明参考图复刻设计质量达标”，必须运行质量声明 gate：

```bash
npm run maintenance:reference-quality-gate
```

该命令默认只报告，不失败退出。若在发布、验收或文档生成前要求必须具备真实质量证据，使用：

```bash
npm run maintenance:reference-quality-gate -- --require-ready
```

当前没有非 synthetic / 非 FEX 的真实结果截图、构建验证、人工复核和完整评分时，`--require-ready` 必须失败。这个失败是预期行为，表示还不能把“机制跑通”写成“设计质量达标”。

该报告会区分：

- `reference_only`：只有参考图和结构期望，不能证明 Photoshop 输出。
- `output_without_build_verification`：有结果截图但缺少构建/执行验证。
- `needs_manual_review`：有执行结果但缺少人工评分或人工复核。
- `reviewed_real_quality_candidate`：非 synthetic、非 FEX、具备结果截图、构建验证、人工评分和完整证据，且 `overall >= 0.8`，才允许作为设计质量候选证据。

当前所有 synthetic fixture 和 FEX case 都不能作为设计质量完成证据。`screenshot-pixel-probe` 仍只是诊断证据，不等于审美验收。

## 记录执行结果

真实 Photoshop 复刻完成后，不要手改 case JSON。使用下面的命令把结果截图复制到 benchmark 内部，并记录构建验证、人工评分和复核信息：

新增真实商业参考图前，先运行只读 intake 计划，确认它不是 FEX / synthetic fixture，并生成后续 `create-case` 命令：

```bash
npm run maintenance:reference-real-case-intake -- \
  --id rr-100-real-poster \
  --name "真实海报参考图" \
  --category poster-layout \
  --reference-image "C:\path\reference.jpg" \
  --source-kind real-commercial-reference
```

该命令只做路径、分类、来源和质量声明边界检查；不会复制文件、不会写 case JSON、不会调用模型或 Photoshop。通过 intake 只能说明“适合进入 benchmark”，不等于设计质量证据。

查看所有 case 当前证据流水线状态：

```bash
npm run maintenance:reference-evidence-pipeline
```

如果只是想恢复当前 reference 复刻主线的整体状态和下一步命令，使用一站式状态报告：

```bash
npm run maintenance:reference-status
```

该报告汇总 readiness、evidence pipeline 和 quality gate，只读输出当前结论、阻断项和下一步命令；不会调用模型、不会运行 Photoshop、不会写截图或修改 case。

采集前先生成计划：

```bash
npm run maintenance:reference-capture-plan -- --id rr-002-neutral-quality-card-text-layout
```

计划会输出参考图是否存在、建议结果截图路径、质量声明边界，以及截图完成后的 `record-result` 命令。

如果要通过真实 ChatPanel + 真实模型 + 真实 Photoshop/UXP 采集 `rr-002` 结果截图，使用受控 live 命令。该命令默认安全跳过；只有同时显式打开 live、real Photoshop 和 takeover 开关时才会创建一次性文档并写出截图：

```bash
DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI=1 \
DESIGNECHO_LIVE_REFERENCE_REPLICATION_REAL_PHOTOSHOP=1 \
DESIGNECHO_LIVE_REFERENCE_REPLICATION_TAKEOVER=1 \
npm run benchmark:reference-replication:capture-live
```

该 live 命令会拒绝接管已经占用默认端口的桌面端，不会杀进程。截图采集成功只表示拿到了真实输出截图，不等于人工评分通过，也不等于高保真复刻完成。

截图生成后，先生成独立证据报告和人工评分模板；这个命令不会修改 case JSON：

```bash
npm run benchmark:reference-replication:evaluate-result -- \
  --result-screenshot "C:\path\result.png"
```

该评估会输出像素探针、评分表和下一步 `record-result` 命令。只有人工复核并填完五项 `0..1` 评分后，才可以进入结果录入。

如果需要在录入前校验证据报告本身没有越界声明，可以运行：

```bash
npm run benchmark:reference-replication:validate-evidence -- \
  --evidence-json "C:\path\result-evidence.json"
```

```bash
npm run benchmark:reference-replication:record-result -- \
  --id rr-002-neutral-quality-card-text-layout \
  --result-screenshot "C:\path\result.png" \
  --copy-result-screenshot \
  --build-verified \
  --manual-verified \
  --reviewer "reviewer-name" \
  --score-structure 0.9 \
  --score-placement 0.85 \
  --score-text-hierarchy 0.88 \
  --score-editability 0.92 \
  --score-overall 0.86
```

注意：

- 所有评分是 `0..1`，不是 `0..5`。
- `--manual-verified` 必须同时提供五项评分和真实结果截图。
- `--copy-result-screenshot` 会把截图复制到 `results/` 并写入 benchmark 相对路径。
- 即使录入结果，FEX 和 synthetic fixture 仍不会成为设计质量声明证据。

## 当前状态

当前公开仓库已有 4 个 `reference_captured` case：

- `rr-002-neutral-quality-card-text-layout`：中性文字排版替换种子。
- `rr-003-synthetic-poster-layout`：合成海报版式种子。
- `rr-004-synthetic-ecommerce-detail-hero`：合成详情页首屏种子。
- `rr-005-synthetic-main-image-layout`：合成主图版式种子。

这些 synthetic case 只用于补齐代表性输入覆盖，不代表真实商业设计质量，不属于工具、skill 或产品功能。所有 case 尚未完成真实 Photoshop 结果截图和人工评分。
