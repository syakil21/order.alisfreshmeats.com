// Runs every browser test, each against its own fresh local mock server (nothing real is charged, booked or printed).
//   node scripts/e2e/run.js            all tests
//   node scripts/e2e/run.js extras     one test
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.OUT || path.join(__dirname, '.out');
const TESTS = ['board', 'payments', 'sections', 'extras'].filter((t) => !process.argv[2] || process.argv[2] === t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const failed = [];
  for (const [i, t] of TESTS.entries()) {
    const port = 3100 + i; const prints = path.join(OUT, `prints-${t}`);
    fs.rmSync(prints, { recursive: true, force: true }); fs.mkdirSync(prints, { recursive: true });
    const env = { ...process.env, PORT: String(port), PRINT_DIR: prints, OUT, BASE: `http://localhost:${port}` };
    const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.js')], { env, stdio: ['ignore', fs.openSync(path.join(OUT, `server-${t}.log`), 'w'), 'inherit'] });
    for (let n = 0; n < 50; n++) { await sleep(200); if (await fetch(`${env.BASE}/api/catalog`).then((r) => r.ok).catch(() => false)) break; }
    console.log(`\n===== ${t} =====`);
    const code = await new Promise((done) => spawn(process.execPath, [path.join(__dirname, `${t}.js`)], { env, stdio: 'inherit' }).on('exit', done));
    server.kill();
    if (code) failed.push(t);
  }
  console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll ${TESTS.length} test file(s) passed`);
  process.exit(failed.length ? 1 : 0);
})();
