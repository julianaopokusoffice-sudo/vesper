import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Update detection without the network: version ordering and the release
 * fallback are the parts that can be wrong in a way users notice.
 */
const temp = mkdtempSync(join(tmpdir(), 'vesper-update-'));
process.env.VESPER_HOME = temp;
process.env.VESPER_REPO = 'example/nonexistent';

const { compareVersions, checkForUpdate } = await import('../server/update/index.ts');

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

check('newer major is newer', compareVersions('2.0.0', '1.9.9') === 1);
check('newer minor is newer', compareVersions('1.4.0', '1.3.9') === 1);
check('newer patch is newer', compareVersions('1.3.10', '1.3.9') === 1);
check('equal versions match', compareVersions('1.2.3', '1.2.3') === 0);
check('a v prefix is ignored', compareVersions('v1.2.4', '1.2.3') === 1);
check('a pre-release suffix is ignored', compareVersions('1.2.3-beta.2', '1.2.3') === 0);
check('older is older', compareVersions('0.9.0', '1.0.0') === -1);

const info = await checkForUpdate('1.0.0', true);
check('a missing release is not an update', info.available === false);
check('a missing release explains itself', Boolean(info.error?.includes('No published release')), info.error);
check('the checked version is reported', info.currentVersion === '1.0.0');
check('assets default to an empty list', Array.isArray(info.assets));

rmSync(temp, { recursive: true, force: true });
console.log(`\nupdate: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
