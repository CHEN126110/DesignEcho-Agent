/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const INPUT = path.join(TMP_DIR, 'photoshop-mcp-test-matrix.json');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-usage-guide.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-usage-guide.md');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function groupBy(array, selector) {
  return array.reduce((acc, item) => {
    const key = selector(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function laneDescription(lane) {
  switch (lane) {
    case 'safe-read-batch':
      return 'Can be batched unattended in small serial groups.';
    case 'conditional-read-batch':
      return 'Read-only, but verify preconditions before including in a batch.';
    case 'isolated-write':
      return 'Run alone; modifies the document or writes files.';
    case 'isolated-risky':
      return 'Run alone and interactively; may trigger modal state or availability alerts.';
    case 'blocked':
    default:
      return 'Keep out of unattended bulk execution.';
  }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Usage Guide');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Execution Lanes');
  lines.push('');
  for (const lane of report.lanes) {
    lines.push(`### ${lane.lane}`);
    lines.push('');
    lines.push(`- Description: ${lane.description}`);
    lines.push(`- Recommended batch size: ${lane.recommendedBatchSize}`);
    lines.push(`- Recommended delay: ${lane.recommendedDelayMs}ms`);
    lines.push(`- Tool count: ${lane.tools.length}`);
    lines.push('');
    lines.push('| Tool | Category | Preconditions | Validation Mode | Popup Risk |');
    lines.push('|---|---|---|---|---|');
    for (const tool of lane.tools) {
      lines.push(`| ${tool.toolName} | ${tool.category} | ${tool.preconditions.replace(/\|/g, '\\|')} | ${tool.manualValidationMode || 'n/a'} | ${tool.popupRisk} |`);
    }
    lines.push('');
  }

  lines.push('## Category Notes');
  lines.push('');
  for (const note of report.categoryNotes) {
    lines.push(`### ${note.category}`);
    lines.push('');
    lines.push(`- Guidance: ${note.guidance}`);
    lines.push(`- Tools: ${note.tools.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  ensureDir(TMP_DIR);
  const matrix = readJson(INPUT);
  const groupedByLane = groupBy(matrix.matrix, item => item.executionLane.lane);

  const lanes = Object.entries(groupedByLane)
    .map(([lane, tools]) => ({
      lane,
      description: laneDescription(lane),
      recommendedBatchSize: tools[0]?.executionLane?.recommendedBatchSize ?? 1,
      recommendedDelayMs: tools[0]?.executionLane?.recommendedDelayMs ?? 0,
      tools: tools.sort((a, b) => a.toolName.localeCompare(b.toolName))
    }))
    .sort((a, b) => a.lane.localeCompare(b.lane));

  const groupedByCategory = groupBy(matrix.matrix, item => item.category);
  const categoryNotes = Object.entries(groupedByCategory)
    .map(([category, tools]) => ({
      category,
      guidance:
        category === 'text' ? 'Prefer explicit layerId or an active text layer before calling these tools.' :
        category === 'layout' ? 'Separate document-scope layout readers from layer-targeted operations and screen-based tools.' :
        category === 'image' ? 'Separate heavy image readers from normal reads. getSubjectBounds requires explicit layerId and smart mode must fail explicitly when subject selection cannot be created. getMattingImage is layer-only and accepts jpeg or raw output only. getOptimizedImage returns requestedBounds and actualBounds, and may scale the returned region.' :
        category === 'layer' ? 'Most layer tools should be isolated if they mutate state; read-only inspections can batch if preconditions are met.' :
        category === 'canvas' ? 'Canvas/document readers are safest; snapshot/history operations stay out of unattended bulk runs.' :
        category === 'sku' ? 'Treat SKU tools as document-convention dependent and validate template structure first.' :
        category === 'morphing' ? 'Require explicit source/target context; do not batch with unrelated document mutations.' :
        'Verify arguments and runtime context before batching.',
      tools: tools.map(tool => tool.toolName).sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const report = {
    generatedAt: new Date().toISOString(),
    summary: matrix.summary,
    lanes,
    categoryNotes
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
}

main();
