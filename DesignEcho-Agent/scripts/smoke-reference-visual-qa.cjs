#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  buildReferenceReplicationVisualQaReport,
  compareReferenceVisualQaItem,
  normalizeReferenceVisualQaBox
} = require('../dist/main/shared/reference-replication-visual-qa.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const normalized = normalizeReferenceVisualQaBox({ x: 10, y: 20, width: 120, height: 80 });
  assert(normalized.left === 10 && normalized.right === 130, 'Expected x/y box to normalize into left/right.');

  const exact = compareReferenceVisualQaItem({
    id: 'exact',
    plannedBox: { left: 100, top: 120, width: 300, height: 180 },
    actualBox: { left: 100, top: 120, width: 300, height: 180 }
  });

  const watch = compareReferenceVisualQaItem({
    id: 'watch',
    plannedBox: { left: 100, top: 120, width: 300, height: 180 },
    actualBox: { left: 110, top: 132, width: 292, height: 178 }
  });

  const mismatch = compareReferenceVisualQaItem({
    id: 'mismatch',
    plannedBox: { left: 100, top: 120, width: 300, height: 180 },
    actualBox: { left: 260, top: 320, width: 220, height: 120 }
  });

  const textEnvelopeWatch = compareReferenceVisualQaItem({
    id: 'text-envelope-watch',
    kind: 'text',
    plannedBox: { left: 184, top: 38, width: 232, height: 48 },
    actualBox: { left: 184, top: 38, width: 200, height: 37 }
  });

  const unverified = compareReferenceVisualQaItem({
    id: 'unverified',
    plannedBox: { left: 10, top: 10, width: 100, height: 100 }
  });

  const report = buildReferenceReplicationVisualQaReport({
    comparisons: [exact, watch, mismatch, unverified],
    snapshotObservation: {
      source: 'bounds-only',
      snapshotCount: 0,
      overlayCount: 0
    }
  });

  assert(exact.status === 'ok', `Expected exact to pass, got ${exact.status}.`);
  assert(watch.status === 'watch', `Expected shifted box to need watch, got ${watch.status}.`);
  assert(mismatch.status === 'mismatch', `Expected far box to mismatch, got ${mismatch.status}.`);
  assert(textEnvelopeWatch.status === 'watch', `Expected contained text envelope drift to be watch, got ${textEnvelopeWatch.status}.`);
  assert(textEnvelopeWatch.notes.some((line) => line.includes('text actual bounds fit inside planned text envelope')), 'Expected text envelope watch note.');
  assert(unverified.status === 'unverified', `Expected missing actual box to be unverified, got ${unverified.status}.`);
  assert(report.status === 'mismatch', `Expected report mismatch, got ${report.status}.`);
  assert(report.counts.ok === 1 && report.counts.watch === 1 && report.counts.mismatch === 1 && report.counts.unverified === 1, 'Expected count distribution 1/1/1/1.');
  assert(report.limitations.some((line) => line.includes('bounds')), 'Expected limitations to mention bounds-only boundary.');
  assert(report.observations.some((line) => line.includes('bounds 不匹配明细') && line.includes('mismatch')), 'Expected mismatch observation to expose the first divergent item.');
  assert(report.verificationReport?.kind === 'reference-replication-visual-qa', 'Expected structured visual QA verification report.');
  assert(report.verificationReport.snapshot.rawImagesRedacted === true, 'Expected verification report to mark raw images redacted.');
  assert(report.verificationReport.snapshot.hasImageObservation === false, 'Bounds-only report must not claim an image observation.');
  assert(report.verificationReport.blockers.some((line) => line.includes('不匹配')), 'Expected mismatch blocker in verification report.');
  assert(report.verificationReport.blockers.some((line) => line.includes('首批差异') && line.includes('target')), 'Expected mismatch blocker to include concise diagnostic detail.');

  const overlayFailure = buildReferenceReplicationVisualQaReport({
    comparisons: [exact],
    snapshotObservation: {
      source: 'getScreenSnapshotsWithOverlay',
      snapshotCount: 0,
      overlayCount: 1
    }
  });
  assert(overlayFailure.verificationReport.snapshot.rawImagesRedacted === true, 'Overlay verification report must keep raw images redacted.');
  assert(overlayFailure.verificationReport.snapshot.hasImageObservation === false, 'Zero-snapshot overlay must not claim an image observation.');
  assert(overlayFailure.verificationReport.blockers.some((line) => line.includes('overlay 截图')), 'Expected zero-snapshot overlay blocker.');

  const overlaySuccess = buildReferenceReplicationVisualQaReport({
    comparisons: [exact],
    snapshotObservation: {
      source: 'getScreenSnapshotsWithOverlay',
      snapshotCount: 1,
      overlayCount: 1
    }
  });
  assert(overlaySuccess.verificationReport.snapshot.hasImageObservation === true, 'Overlay report with screenshots should include an image observation.');
  assert(overlaySuccess.verificationReport.blockers.length === 0, 'Clean overlay report should not add blockers.');

  const pixelProbeWatch = buildReferenceReplicationVisualQaReport({
    comparisons: [exact],
    snapshotObservation: {
      source: 'getCanvasSnapshot',
      snapshotCount: 1,
      overlayCount: 0,
      pixelProbe: {
        mode: 'pixel-probe',
        status: 'watch',
        mae: 13.4,
        rmse: 47.8,
        highDeltaRatio: 0.0885,
        darkJaccard: 0.44,
        boundary: 'Pixel probe only. It is not a high-fidelity design acceptance score.',
        rawImagesRedacted: true
      }
    }
  });
  assert(pixelProbeWatch.observations.some((line) => line.includes('截图像素探针')), 'Expected visual QA observations to include the pixel probe summary.');
  assert(pixelProbeWatch.verificationReport.snapshot.pixelProbe?.rawImagesRedacted === true, 'Pixel probe check must keep raw images redacted.');
  assert(pixelProbeWatch.verificationReport.snapshot.pixelProbe?.status === 'watch', 'Expected pixel probe status to be exposed in the verification report.');
  assert(pixelProbeWatch.verificationReport.warnings.some((line) => line.includes('截图像素探针')), 'Non-ok pixel probe should be a warning, not silent.');

  const executorSource = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/services/skill-executors/layout-replication.executor.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  assert(executorSource.includes('summarizeOverlaySnapshotResult'), 'Expected overlay snapshot results to be summarized before returning.');
  assert(executorSource.includes('base64Hidden: true'), 'Expected overlay base64 to be hidden in normal tool results.');
  assert(executorSource.includes('verificationReport: visualQa.verificationReport'), 'Expected overlay result to expose the structured verification report.');
  assert(executorSource.includes('snapshotCount > 0'), 'Expected overlay success to require at least one snapshot.');
  assert(!executorSource.includes("callbacks?.onToolComplete?.('getScreenSnapshotsWithOverlay', result);"), 'Overlay tool completion must not forward raw base64 result.');
  assert(!executorSource.includes("callbacks?.onToolComplete?.('analyzeReferenceLayout', { success: true });"), 'Reference layout analysis must not complete successfully before JSON parsing and element validation.');
  assert(executorSource.includes("success: false,\n                    error: 'Failed to parse layout analysis'"), 'Reference layout analysis parse failure should be reported as a failed tool completion.');

  const qaSource = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/services/skill-executors/layout-replication-qa.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  assert(qaSource.includes('screen.copyPlaceholders'), 'Expected visual QA item builder to include text/copy placeholders.');
  assert(qaSource.includes("kind: 'text'"), 'Expected text placeholders to be marked as text visual QA items.');
  assert(qaSource.includes('未获得真实视觉 QA 结果'), 'Placement QA without a visual QA result must be explicitly downgraded.');
  assert(qaSource.includes('observations.push(...visualQa.observations'), 'Layout QA should retain visual observations in a dedicated observations collection.');
  assert(!qaSource.includes('checks.push(...visualQa.observations'), 'Layout QA must not treat visual observations as completed checks.');
  assert(qaSource.includes('checks.push(`视觉 QA 结论：${visualQa.summary}`)'), 'Layout QA may expose only the explicit visual QA conclusion as a check.');

  const uxpSnapshotSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'DesignEcho-UXP/src/tools/canvas/screen-snapshot.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  assert(uxpSnapshotSource.includes('errors?: ScreenSnapshotError[]'), 'Expected UXP screen snapshot tools to expose per-screen errors.');
  assert(uxpSnapshotSource.includes('success: snapshots.length > 0'), 'Expected UXP screen snapshot tools to fail when no snapshots are generated.');

  return {
    success: true,
    cases: { exact, watch, mismatch, textEnvelopeWatch, unverified },
    report,
    sourceChecks: {
      overlayResultRedaction: true
    }
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
