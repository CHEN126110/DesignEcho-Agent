# Case Definition Checklist

录入每个真实 benchmark case 前，先确认以下项：

- 有真实参考图
- 有场景说明
- 有执行模型记录
- 有结果截图或结果文档
- 有 `acceptance.requiredEvidence`
- 有 bounds QA 阈值
- 如果需要截图级诊断，有 pixel-probe 的 targetSize、thresholds、boundary 和 rawImagesRedacted 标记
- 有人工复核人
- 有评分记录
- 已更新 manifest

如果以上任一项缺失，不应把该案例记为完成。
