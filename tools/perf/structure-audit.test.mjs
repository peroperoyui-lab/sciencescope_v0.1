import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import {
  analyzeSource,
  auditStructure,
  cyclicComponents,
  structureSummary,
} from './structure-audit.mjs';

test('AST inventory identifies executable imports and retains nested long-function spans', () => {
  const text = [
    "// import fake from './comment.js';",
    'const example = "import \'./string.js\'";',
    "import type { Shape } from './shape.js';",
    "import './side-effect.js';",
    "export { value } from './value.js';",
    'export function createStore() {',
    '  const worker = async () => {',
    ...Array.from({ length: 82 }, (_, index) => `    // Physical line ${index + 1}`),
    "    await import('./lazy.js');",
    '    await import(example);',
    "    require('./common.cjs');",
    '  };',
    '  return { worker };',
    '}',
    "new Worker(new URL('./worker.js', import.meta.url));",
    '',
  ].join('\n');
  const result = analyzeSource(text, 'app/services/sample.ts');
  assert.deepEqual(
    result.imports.map((row) => row.specifier),
    ['./shape.js', './side-effect.js', './value.js', './lazy.js', './common.cjs'],
  );
  assert.equal(result.imports[0].typeOnly, true);
  assert.equal(result.dynamicImports.length, 1);
  assert.equal(result.workerEntries[0].specifier, './worker.js');
  assert.equal(result.parseDiagnostics.length, 0);
  const [factory, child] = result.functions;
  assert.equal(factory.startLine, 6);
  assert.equal(factory.endLine, 95);
  assert.equal(child.startLine, 7);
  assert.equal(child.endLine, 93);
  assert.equal(child.parentFunctionId, factory.id);
  assert.equal(child.qualifiedName, 'createStore > worker');
  assert.equal(factory.directNestedFunctions, 1);
  assert.equal(factory.ownPhysicalLinesExcludingNested, 3);
  assert.equal(result.physicalLines, 96);
  assert.equal(result.functions.filter((row) => row.physicalLines > 80).length, 2);
  assert.deepEqual(
    cyclicComponents(
      ['a', 'b', 'self', 'alone'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'self', to: 'self' },
      ],
    ),
    [['a', 'b'], ['self']],
  );
});

test('repository audit reports boundary cycles and distinguishes direct, transitive and browser test associations', async () => {
  const parent = path.resolve('.sciencescope-local/temp/p4b');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'structure-test-'));
  const source = {
    'app/core/a.js': "import './b.js'; export const a = 1;\n",
    'app/core/b.js': "import './a.js'; import '../services/s.js'; export const b = 2;\n",
    'app/core/self.js': "import './self.js';\n",
    'app/core/testing.js': "import './b.js';\n",
    'app/core/a.test.js': "import './a.js';\n",
    'app/services/s.js':
      "import '../runtime/port.js'; import './missing.js'; new Worker(new URL('./worker.js', import.meta.url)); export const work = () => 1;\n",
    'app/services/worker.js': "import './s.js'; export const worker = 1;\n",
    'app/services/s.test.js': "import './s.js';\n",
    'app/services/retrieval-fixture.js': "import '../core/a.js';\n",
    'app/shared/util.js': 'export const double = (value) => value * 2;\n',
    'app/server/router.js': "import '../services/s.js';\n",
    'app/runtime/port.js': "import '../core/a.js';\n",
    'app/testing.js': "import './services/s.js';\n",
    'app/ui/view.browser.test.js': "import '../testing.js';\n",
  };
  try {
    for (const [file, text] of Object.entries(source)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    const result = await auditStructure({ root });
    assert.equal(result.tool.name, 'typescript');
    assert.equal(result.tool.license, 'Apache-2.0');
    assert.equal(result.counts.productionScopeFiles, 7);
    assert.equal(result.counts.workerEntryEdges, 1);
    assert.equal(result.counts.excludedScopeSupport, 2);
    assert.equal(result.counts.excludedScopeTests, 2);
    assert.deepEqual(
      result.cycles.withinScope.map((row) => row.nodes),
      [['app/core/a.js', 'app/core/b.js'], ['app/core/self.js']],
    );
    assert.deepEqual(result.cycles.appProductionTouchingScope[0].nodes, [
      'app/core/a.js',
      'app/core/b.js',
      'app/runtime/port.js',
      'app/services/s.js',
    ]);
    assert.ok(
      result.directionFindings.some(
        (row) => row.from === 'app/core/b.js' && row.to === 'app/services/s.js',
      ),
    );
    assert.ok(
      result.directionFindings.some(
        (row) =>
          row.to === 'app/runtime/port.js' && row.classification === 'runtime-boundary-review',
      ),
    );
    assert.equal(result.unresolvedRelativeImports.length, 1);
    const service = result.coverage.modules.find((row) => row.file === 'app/services/s.js');
    assert.deepEqual(service.directTests, ['app/services/s.test.js']);
    assert.deepEqual(service.companionTests, ['app/services/s.test.js']);
    assert.deepEqual(service.reachableTests.browser, ['app/ui/view.browser.test.js']);
    assert.ok(service.reachableTests['unit-or-integration'].includes('app/core/a.test.js'));
    assert.ok(
      result.coverage.modules
        .find((row) => row.file === 'app/services/worker.js')
        .reachableTests.browser.includes('app/ui/view.browser.test.js'),
    );
    assert.equal(
      result.coverage.modules.find((row) => row.file === 'app/shared/util.js').reachableTestCount,
      0,
    );
    assert.match(structureSummary(result), /potential execution only/);
  } finally {
    assert.ok(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
