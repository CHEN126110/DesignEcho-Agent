const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const routing = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'routing.ts'
));

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'detail-page-document-preflight-routing-smoke.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  return jsonPath;
}

function pass(condition, details) {
  return { status: condition ? 'pass' : 'fail', details };
}

function run() {
  const ambiguousText = '看看这个模板有没有问题';
  const noEvidenceRoute = routing.fastDeterministicRoute(ambiguousText);
  const obsoleteStructureHintRoute = routing.fastDeterministicRoute(ambiguousText, {
    detailPageTemplateDetected: true,
    detailPageTemplateScreenCount: 14,
    detailPageTemplateIssueCodes: ['detail_container_detected', 'screen_bounds_repaired']
  });
  const explicitDetailPageRoute = routing.fastDeterministicRoute('检查当前详情页模板结构');

  const engineSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
    'utf8'
  );
  const routingSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'),
    'utf8'
  );
  const detailPageExecutorSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'detail-page.executor.ts'),
    'utf8'
  );

  const cases = [
    {
      name: 'ambiguous-template-inspection-does-not-route-without-document-evidence',
      ...pass(noEvidenceRoute === null, { noEvidenceRoute })
    },
    {
      name: 'obsolete-document-structure-hint-cannot-select-a-business-skill',
      ...pass(
        obsoleteStructureHintRoute === null,
        { obsoleteStructureHintRoute }
      )
    },
    {
      name: 'explicit-detail-page-inspection-still-selects-the-detail-page-skill',
      ...pass(
        explicitDetailPageRoute?.skillId === 'detail-page-design'
          && explicitDetailPageRoute?.skillParams?.inspectOnly === true,
        { explicitDetailPageRoute }
      )
    },
    {
      name: 'generic-routing-does-not-parse-detail-page-structure-before-skill-selection',
      ...pass(
        !engineSource.includes('buildCurrentDocumentStructureRouteOptions')
          && !engineSource.includes('parseDetailPageTemplate')
          && !routingSource.includes('detailPageTemplateDetected')
          && !routingSource.includes('detailPageTemplateScreenCount'),
        { genericPreflightRemoved: true }
      )
    },
    {
      name: 'detail-page-skill-still-owns-template-parsing-after-selection',
      ...pass(
        detailPageExecutorSource.includes("callTool('parseDetailPageTemplate'"),
        { detailPageExecutorOwnsParser: detailPageExecutorSource.includes('parseDetailPageTemplate') }
      )
    }
  ];

  const success = cases.every((item) => item.status === 'pass');
  const report = writeReport({ success, cases });
  console.log(JSON.stringify({ success, cases, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run();
