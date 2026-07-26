#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORTER = path.join(ROOT, 'scripts', 'report-agent-photoshop-tool-coverage.cjs');
const REPORT_JSON = path.join(ROOT, 'tmp', 'agent-photoshop-tool-coverage.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'agent-photoshop-tool-coverage.md');

function assert(condition, message, details = null) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(
    pkg.scripts?.['smoke:agent:photoshop-tool-coverage'] === 'node scripts/smoke-agent-photoshop-tool-coverage.cjs',
    'package script smoke:agent:photoshop-tool-coverage must point to this contract smoke.'
  );
  assert(fs.existsSync(REPORTER), 'Agent Photoshop coverage reporter is missing.', { REPORTER });

  const source = readText(REPORTER);
  assert(source.includes('getDefaultAgentTools'), 'coverage reporter must inspect the default Agent tool catalog.');
  assert(source.includes('getPhotoshopToolSkillSemantics'), 'coverage reporter must use Photoshop tool semantics.');
  assert(source.includes('AGENT_LIVE_RUNNERS'), 'coverage reporter must distinguish real Agent live runners.');
  assert(source.includes('SCRIPTED_LIVE_SMOKE_HINTS'), 'coverage reporter must keep scripted live smokes separate.');
  assert(source.includes('needs-agent-live'), 'coverage reporter must expose missing real-Agent coverage as backlog.');
  assert(source.includes('scripted-live-only'), 'coverage reporter must not count scripted live smokes as Agent live coverage.');
  assert(source.includes('agent-live means'), 'coverage reporter must document the coverage boundary.');

  const reportRun = spawnSync(process.execPath, [REPORTER], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  assert(reportRun.status === 0, 'coverage reporter must pass its required signal checks.', {
    status: reportRun.status,
    stdout: reportRun.stdout,
    stderr: reportRun.stderr
  });
  assert(fs.existsSync(REPORT_JSON), 'coverage reporter must write JSON output.', { REPORT_JSON });
  assert(fs.existsSync(REPORT_MD), 'coverage reporter must write Markdown output.', { REPORT_MD });

  const report = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  assert(report.success === true, 'coverage report must pass required live Agent signal gates.', report.summary);
  assert(report.summary?.defaultPhotoshopToolCount > 0, 'coverage report must include Photoshop tools from the Agent catalog.');
  assert(report.summary?.agentLiveCovered > 0, 'coverage report must include real Agent live coverage.');
  assert(
    report.summary?.agentLiveCovered === report.summary?.defaultPhotoshopToolCount,
    'every default Photoshop tool must be covered by a real Agent live runner.',
    report.summary
  );
  assert(report.summary?.scriptedLiveOnly === 0, 'scripted live-only coverage must be cleared by real Agent runners.', report.summary);
  assert(report.summary?.needsAgentLive === 0, 'uncovered Agent live backlog must be empty.', report.summary);
  assert(
    Number.isInteger(report.summary?.needsAgentLive) && report.summary.needsAgentLive >= 0,
    'coverage report must expose the uncovered Agent live backlog count, including zero when the required backlog is cleared.'
  );
  assert(Array.isArray(report.requiredAgentLiveSignalGaps), 'coverage report must expose required signal gaps.');
  assert(report.requiredAgentLiveSignalGaps.length === 0, 'required Agent live signal gaps must be empty.', {
    requiredAgentLiveSignalGaps: report.requiredAgentLiveSignalGaps
  });
  assert(Array.isArray(report.matrix), 'coverage report must include a tool matrix.');
  assert(
    report.matrix.some((row) => row.name === 'createRectangle' && row.coverageStatus === 'agent-live'),
    'createRectangle must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'setLayerOpacity' && row.coverageStatus === 'agent-live'),
    'setLayerOpacity must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'renameLayer' && row.coverageStatus === 'agent-live'),
    'renameLayer must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'moveLayerToGroup' && row.coverageStatus === 'agent-live'),
    'moveLayerToGroup must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'focusLayer' && row.coverageStatus === 'agent-live'),
    'focusLayer must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'addBrightnessContrastAdjustment' && row.coverageStatus === 'agent-live'),
    'addBrightnessContrastAdjustment must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'createClippingMask' && row.coverageStatus === 'agent-live'),
    'createClippingMask must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'getAllClippingMasks' && row.coverageStatus === 'agent-live'),
    'getAllClippingMasks must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'getDocumentSnapshot' && row.coverageStatus === 'agent-live'),
    'getDocumentSnapshot must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'diagnoseState' && row.coverageStatus === 'agent-live'),
    'diagnoseState must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'getAnnotatedSnapshot' && row.coverageStatus === 'agent-live'),
    'getAnnotatedSnapshot must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'getScreenSnapshotsWithOverlay' && row.coverageStatus === 'agent-live'),
    'getScreenSnapshotsWithOverlay must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'resolveFontName' && row.coverageStatus === 'agent-live'),
    'resolveFontName must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'renderLayout' && row.coverageStatus === 'agent-live'),
    'renderLayout must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'alignToReference' && row.coverageStatus === 'agent-live'),
    'alignToReference must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'batchRenameLayers' && row.coverageStatus === 'agent-live'),
    'batchRenameLayers must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'undo' && row.coverageStatus === 'agent-live'),
    'undo must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'redo' && row.coverageStatus === 'agent-live'),
    'redo must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'openProjectFile' && row.coverageStatus === 'agent-live'),
    'openProjectFile must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'parseDetailPageTemplate' && row.coverageStatus === 'agent-live'),
    'parseDetailPageTemplate must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'fillDetailPage' && row.coverageStatus === 'agent-live'),
    'fillDetailPage must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'auditDetailPagePlacement' && row.coverageStatus === 'agent-live'),
    'auditDetailPagePlacement must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'fixLayerIssues' && row.coverageStatus === 'agent-live'),
    'fixLayerIssues must be covered by a real Agent live runner.'
  );
  assert(
    report.matrix.some((row) => row.name === 'exportDetailPageSlices' && row.coverageStatus === 'agent-live'),
    'exportDetailPageSlices must be covered by a real Agent live runner.'
  );
  assert(
    !report.matrix.some((row) => row.coverageStatus === 'scripted-live-only'),
    'scripted live-only tools must not remain after the serial Agent runner is registered.'
  );
  if (report.summary.needsAgentLive > 0) {
    assert(
      report.matrix.some((row) => row.coverageStatus === 'needs-agent-live'),
      'uncovered tools must remain explicit instead of being silently treated as covered.'
    );
  }

  console.log(JSON.stringify({
    success: true,
    summary: report.summary,
    report: report.report
  }, null, 2));
}

main();
