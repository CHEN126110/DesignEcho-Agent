# Benchmark 录入工作流

## 目的

为参考图复刻能力建立真实案例录入流程，避免：

1. 伪造案例
2. 没有输入输出证据的评分
3. 后续无法追溯测试条件

## 录入条件

只有满足以下条件时，才应新增 benchmark case：

1. 有真实参考图
2. 有本次测试使用的模型信息
3. 有结果截图或结果文档信息
4. 至少完成一次人工复核

## 录入步骤

1. 使用 `npm run benchmark:reference-replication:create-case -- --id <id> --name "<名称>" --category <category> --reference-image "<参考图路径>" --copy-reference-image` 从模板创建、复制参考图并登记 case
2. 填写或复核案例 ID、名称、场景类别和场景说明
3. 填写参考图说明；如果未使用 `--copy-reference-image`，必须确认参考图路径仍可被 validator 访问
4. 填写执行配置
5. 保存结果截图路径；推荐使用 `--result-screenshot "<截图路径>" --copy-result-screenshot` 复制到 `results/`
6. 按 `scorecard-template.md` 评分
7. 运行 `npm run benchmark:reference-replication:validate`，确保 case 已登记、类别有效且证据契约完整

## 不允许的写法

1. 没有参考图路径，仍把案例写成已完成
2. 没有结果截图，仍写总体评分
3. 没有人工复核，仍写 `manualVerified: true`
4. 在 `cases/` 中放置未登记到 `cases.manifest.json` 的孤立 JSON
5. 填写 `outputs.resultScreenshot`，但文件不存在或路径不在 benchmark 目录内

## 当前状态

当前公开 benchmark 目录已有 4 个 reference-captured case，覆盖 `certificate-text-layout`、`poster-layout`、`ecommerce-detail`、`main-image` 四类代表性输入。海报、详情页和主图 case 是 synthetic seed，只用于结构覆盖，不代表真实商业设计质量。
