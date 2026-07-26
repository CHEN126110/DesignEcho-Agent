const fs = require('fs');
const path = require('path');

const stateStorePath = path.join(process.env.APPDATA || '', 'designecho-agent', 'app-state-store.json');

function readStore() {
  try {
    const raw = fs.readFileSync(stateStorePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { entries: {} };
    if (!parsed.entries || typeof parsed.entries !== 'object') parsed.entries = {};
    return parsed;
  } catch {
    return { entries: {} };
  }
}

function writeStore(data) {
  const dir = path.dirname(stateStorePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${stateStorePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, stateStorePath);
}

function main() {
  const mode = process.argv[2];
  if (!mode || (mode !== 'set' && mode !== 'verify')) {
    console.error('Usage: node scripts/test-persistence-restart.cjs <set|verify> [marker]');
    process.exit(2);
  }

  if (mode === 'set') {
    const marker = `marker-${Date.now()}`;
    const data = readStore();
    data.entries.__persistence_test__ = marker;
    data.updatedAt = Date.now();
    writeStore(data);
    console.log(`STATE_STORE:${stateStorePath}`);
    console.log(`MARKER_SET:${marker}`);
    process.exit(0);
  }

  const marker = String(process.argv[3] || '').trim();
  if (!marker) {
    console.error('verify mode requires marker');
    process.exit(2);
  }
  const data = readStore();
  const current = data.entries.__persistence_test__;
  console.log(`STATE_STORE:${stateStorePath}`);
  console.log(`MARKER_CURRENT:${current || ''}`);
  if (current !== marker) {
    console.error(`VERIFY_FAILED expected=${marker} actual=${current || ''}`);
    process.exit(1);
  }
  console.log('VERIFY_OK');
}

main();
