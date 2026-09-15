import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Validator } from '../src/index.js';

interface SuiteTest {
  description: string;
  data: unknown;
  valid: boolean;
}

interface SuiteGroup {
  description: string;
  schema: unknown;
  tests: SuiteTest[];
}

const suiteDir = dirname(createRequire(import.meta.url).resolve('json-schema-test-suite/package.json'));
const testDir = join(suiteDir, 'tests', 'draft2020-12');
const remoteDir = join(suiteDir, 'remotes');

const SKIP_MAP: Record<string, string> = {
  vocabulary: 'custom meta-schemas with $vocabulary are unsupported by design',
  'optional/dependencies-compatibility': 'pre-2020-12 keyword',
  'optional/format-assertion': 'requires a custom meta-schema vocabulary',
  'optional/cross-draft': 'requires other drafts',
  'optional/bignum': 'JS number precision',
  'optional/float-overflow': 'JS number precision',
};

// remotes/** also holds draft-07 / 2019-09 / v1 documents; only 2020-12-compatible ones are registered.
function isRegisteredRemote(path: string): boolean {
  const top = path.split('/')[0]!;
  return !/^(?:draft\d|draft2019-09|v1)$/.test(top);
}

function listFileList(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
}

const remoteMap: Record<string, unknown> = {};
for (const path of listFileList(remoteDir)) {
  if (isRegisteredRemote(path))
    remoteMap[`http://localhost:1234/${path}`] = JSON.parse(readFileSync(join(remoteDir, path), 'utf8'));
}

for (const path of listFileList(testDir).sort()) {
  const name = path.slice(0, -'.json'.length);
  const groupList = JSON.parse(readFileSync(join(testDir, path), 'utf8')) as SuiteGroup[];
  const assertFormat = name.startsWith('optional/format/') || name === 'optional/ecmascript-regex';
  describe(name, () => {
    const reason = SKIP_MAP[name];
    if (reason !== undefined) {
      it.skip(`skipped: ${reason}`, () => {});
      return;
    }
    for (const group of groupList) {
      describe(group.description, () => {
        for (const test of group.tests) {
          it(test.description, () => {
            const validator = new Validator(group.schema, { schemas: remoteMap, assertFormat });
            const result = validator.validate(test.data);
            expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(test.valid);
            expect(result.errors.length === 0).toBe(result.valid);
          });
        }
      });
    }
  });
}
