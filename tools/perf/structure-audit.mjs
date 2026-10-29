// Static relationships are review evidence, not executed coverage or API contracts.
import path from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const testPattern = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u;
const supportPattern =
  /(?:^|\/)(?:[^/]*-)?testing\.[cm]?[jt]sx?$|(?:^|\/)[^/]*-fixture\.[cm]?[jt]sx?$|(?:^|\/)fixtures\//u;
const scopes = ['services', 'core', 'server', 'shared'];
const slash = (value) => value.split(path.sep).join('/');
const physicalLines = (text) =>
  text ? text.split(/\r?\n/u).length - Number(text.endsWith('\n')) : 0;
const isFunction = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isConstructorDeclaration(node);
const testKind = (file) =>
  file.includes('.browser.test.')
    ? 'browser'
    : file.includes('.runtime.test.')
      ? 'runtime'
      : 'unit-or-integration';
const layerOf = (file) =>
  /^app\/([^/]+)\//u.exec(file)?.[1] ??
  (file.startsWith('app/') ? 'composition-root' : file.split('/')[0]);

/** Includes singleton self imports, which are cycles too. */
export function cyclicComponents(nodes, edges) {
  const known = new Set(nodes);
  const adjacency = new Map(nodes.map((node) => [node, new Set()]));
  for (const { from, to } of edges)
    if (known.has(from) && known.has(to)) adjacency.get(from).add(to);
  const indices = new Map(),
    low = new Map(),
    stack = [],
    active = new Set(),
    result = [];
  let index = 0;
  function visit(node) {
    indices.set(node, index);
    low.set(node, index++);
    stack.push(node);
    active.add(node);
    for (const next of adjacency.get(node)) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (active.has(next)) low.set(node, Math.min(low.get(node), indices.get(next)));
    }
    if (indices.get(node) !== low.get(node)) return;
    const component = [];
    let popped;
    do {
      popped = stack.pop();
      active.delete(popped);
      component.push(popped);
    } while (popped !== node);
    if (component.length > 1 || adjacency.get(node).has(node)) result.push(component.sort());
  }
  for (const node of [...nodes].sort()) if (!indices.has(node)) visit(node);
  return result.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function functionName(node, source) {
  if (node.name) return node.name.getText(source);
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isParameter(parent)
  )
    return parent.name.getText(source);
  if (ts.isBinaryExpression(parent) && parent.right === node) return parent.left.getText(source);
  if (ts.isCallExpression(parent))
    return `${parent.expression.getText(source).slice(0, 100)}[argument ${parent.arguments.indexOf(node) + 1}]`;
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `anonymous@${position.line + 1}:${position.character + 1}`;
}

/** Parse executable import syntax; JSDoc import types are not runtime dependencies. */
export function analyzeSource(text, file) {
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/u.test(file)
      ? ts.ScriptKind.TS
      : file.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const imports = [],
    functions = [],
    dynamicImports = [],
    workerEntries = [];
  function dependency(specifier, node, kind, typeOnly = false) {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    imports.push({ specifier, kind, typeOnly, line: start.line + 1, column: start.character + 1 });
  }
  function walk(node, containers = [], parentFunctionId = null) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier))
      dependency(node.moduleSpecifier.text, node, 'import', node.importClause?.isTypeOnly === true);
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      dependency(node.moduleSpecifier.text, node, 're-export', node.isTypeOnly === true);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      dependency(
        node.moduleReference.expression.text,
        node,
        'import-equals',
        node.isTypeOnly === true,
      );
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const kind =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require';
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) dependency(argument.text, node, kind);
      else
        dynamicImports.push({
          kind,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          expression: node.getText(source).slice(0, 200),
        });
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      const argument = node.arguments?.[0];
      if (
        argument &&
        ts.isNewExpression(argument) &&
        ts.isIdentifier(argument.expression) &&
        argument.expression.text === 'URL' &&
        argument.arguments?.[0] &&
        ts.isStringLiteralLike(argument.arguments[0]) &&
        argument.arguments[1]?.getText(source) === 'import.meta.url'
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        workerEntries.push({
          specifier: argument.arguments[0].text,
          kind: 'worker-entry',
          typeOnly: false,
          line: position.line + 1,
          column: position.character + 1,
        });
      }
    }
    let nextContainers = containers,
      nextParent = parentFunctionId;
    if (isFunction(node) && node.body) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source));
      const end = source.getLineAndCharacterOfPosition(node.getEnd() - 1);
      const name = functionName(node, source);
      const id = `${file}:${start.line + 1}:${start.character + 1}`;
      functions.push({
        id,
        file,
        name,
        qualifiedName: [...containers, name].join(' > '),
        container: containers.join(' > ') || null,
        parentFunctionId,
        kind: ts.SyntaxKind[node.kind],
        startLine: start.line + 1,
        endLine: end.line + 1,
        physicalLines: end.line - start.line + 1,
      });
      nextContainers = [...containers, name];
      nextParent = id;
    } else if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name)
      nextContainers = [...containers, `class ${node.name.text}`];
    ts.forEachChild(node, (child) => walk(child, nextContainers, nextParent));
  }
  walk(source);
  for (const fn of functions) {
    const children = functions.filter((child) => child.parentFunctionId === fn.id);
    const nestedLines = new Set(
      children.flatMap((child) =>
        Array.from(
          { length: child.endLine - child.startLine + 1 },
          (_, index) => child.startLine + index,
        ),
      ),
    );
    fn.directNestedFunctions = children.length;
    fn.ownPhysicalLinesExcludingNested = fn.physicalLines - nestedLines.size;
  }
  return {
    file,
    physicalLines: physicalLines(text),
    bytes: Buffer.byteLength(text),
    imports,
    workerEntries,
    functions,
    dynamicImports,
    parseDiagnostics: source.parseDiagnostics.map((entry) => ({
      message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
      line: source.getLineAndCharacterOfPosition(entry.start ?? 0).line + 1,
    })),
  };
}

async function sourceFiles(root, folders) {
  const result = [];
  async function walk(folder) {
    let entries;
    try {
      entries = await readdir(path.join(root, folder), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = slash(path.join(folder, entry.name));
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        await walk(relative);
      else if (entry.isFile() && sourcePattern.test(entry.name)) result.push(relative);
    }
  }
  for (const folder of folders) await walk(folder);
  return result.sort();
}

function reachability(start, adjacency) {
  const seen = new Set(),
    queue = [start];
  while (queue.length)
    for (const next of adjacency.get(queue.pop()) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
}

/** AST-only inventory; reads source code and installed TypeScript metadata. */
export async function auditStructure({ root = process.cwd() } = {}) {
  root = path.resolve(root);
  const metadata = JSON.parse(await readFile(require.resolve('typescript/package.json'), 'utf8'));
  const files = await sourceFiles(root, ['app', 'tools']);
  const analyzed = await Promise.all(
    files.map(async (file) => analyzeSource(await readFile(path.join(root, file), 'utf8'), file)),
  );
  const byFile = new Map(analyzed.map((entry) => [entry.file, entry]));
  const tests = files.filter((file) => testPattern.test(file));
  const support = files.filter((file) => !testPattern.test(file) && supportPattern.test(file));
  const production = files.filter((file) => !testPattern.test(file) && !supportPattern.test(file));
  const scoped = production.filter(
    (file) => scopes.includes(layerOf(file)) && file.startsWith('app/'),
  );
  const scopedSet = new Set(scoped),
    productionSet = new Set(production);
  const options = {
    allowJs: true,
    resolveJsonModule: true,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
  };
  const cache = ts.createModuleResolutionCache(root, (file) => file, options);
  const edges = [],
    workerEdges = [],
    externals = [],
    unresolved = [];
  for (const entry of analyzed)
    for (const imported of [...entry.imports, ...entry.workerEntries]) {
      const from = entry.file;
      if (!imported.specifier.startsWith('.')) {
        externals.push({ from, ...imported });
        continue;
      }
      const resolution = ts.resolveModuleName(
        imported.specifier,
        path.join(root, from),
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (!resolution) {
        unresolved.push({ from, ...imported });
        continue;
      }
      (imported.kind === 'worker-entry' ? workerEdges : edges).push({
        from,
        to: slash(path.relative(root, resolution.resolvedFileName)),
        ...imported,
      });
    }
  const runtimeEdges = edges.filter((edge) => !edge.typeOnly);
  const scopedEdges = runtimeEdges.filter((edge) => scopedSet.has(edge.from));
  const boundaryEdges = scopedEdges.filter((edge) => !scopedSet.has(edge.to));
  const transitionCounts = new Map();
  for (const edge of scopedEdges) {
    const transition = `${layerOf(edge.from)} → ${layerOf(edge.to)}`;
    transitionCounts.set(transition, (transitionCounts.get(transition) ?? 0) + 1);
  }
  const directionRules = {
    core: new Set(['core', 'shared']),
    shared: new Set(['shared']),
    services: new Set(['services', 'core', 'shared']),
    server: new Set(['server', 'services', 'core', 'shared']),
  };
  const directionFindings = scopedEdges
    .filter((edge) => !directionRules[layerOf(edge.from)].has(layerOf(edge.to)))
    .map((edge) => ({
      ...edge,
      fromLayer: layerOf(edge.from),
      toLayer: layerOf(edge.to),
      classification:
        layerOf(edge.to) === 'runtime'
          ? 'runtime-boundary-review'
          : 'reverse-or-outside-layer-review',
    }));
  const adjacency = new Map(files.map((file) => [file, new Set()]));
  const associationEdges = [...runtimeEdges, ...workerEdges];
  for (const edge of associationEdges) adjacency.get(edge.from)?.add(edge.to);
  const reachedBy = new Map(scoped.map((file) => [file, []]));
  for (const test of tests)
    for (const target of reachability(test, adjacency))
      if (scopedSet.has(target)) reachedBy.get(target).push(test);
  const moduleCoverage = scoped.map((file) => {
    const directTests = runtimeEdges
      .filter((edge) => edge.to === file && testPattern.test(edge.from))
      .map((edge) => edge.from);
    const companion = file.replace(sourcePattern, '.test' + path.extname(file));
    const grouped = { browser: [], runtime: [], 'unit-or-integration': [] };
    for (const test of reachedBy.get(file)) grouped[testKind(test)].push(test);
    return {
      file,
      companionTests: tests.includes(companion) ? [companion] : [],
      directTests: [...new Set(directTests)].sort(),
      reachableTests: grouped,
      reachableTestCount: reachedBy.get(file).length,
    };
  });
  const allFunctions = scoped.flatMap((file) => byFile.get(file).functions);
  const fullApp = production.filter((file) => file.startsWith('app/'));
  const withEdges = (components) =>
    components.map((nodes) => ({
      nodes,
      edges: runtimeEdges.filter((edge) => nodes.includes(edge.from) && nodes.includes(edge.to)),
    }));
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    tool: {
      name: metadata.name,
      version: metadata.version,
      license: metadata.license,
      method:
        'Installed TypeScript compiler API: createSourceFile, resolveModuleName; no added dependency',
    },
    definitions: {
      scope: scopes.map((name) => `app/${name}/`),
      scannedRoots: ['app/', 'tools/'],
      sourcePattern: sourcePattern.source,
      excludedTests: testPattern.source,
      excludedTestSupport: supportPattern.source,
      lineCount:
        'Physical lines; trailing newline adds no empty line. Function span starts at AST getStart() and includes its closing token and nested functions.',
      ownLineCount:
        'Physical function span minus the union of direct nested function spans; a structural aid, not statement complexity.',
      imports:
        'ES imports/re-exports, literal dynamic imports, literal require/import-equals. Type-only imports excluded from runtime graphs; JSDoc type imports omitted. Nonliteral imports listed separately.',
      workers:
        'new Worker(new URL(literal, import.meta.url)) entries are recorded separately and traversed for test associations. Worker launch links are excluded from module-import SCCs because workers execute in separate module graphs.',
      directionPolicy:
        'core→core/shared; shared→shared; services→services/core/shared; server→server/services/core/shared. Other edges are review candidates; runtime-boundary edges require contract inspection, not automatic violation.',
      testAssociation:
        'Direct imports, exact same-name test companion, and transitive literal-import reachability. Reachability indicates potential execution only, not assertions, branch/line coverage, or an executed test result.',
    },
    counts: {
      scannedSourceFiles: files.length,
      productionScopeFiles: scoped.length,
      excludedScopeTests: tests.filter(
        (file) => scopes.includes(layerOf(file)) && file.startsWith('app/'),
      ).length,
      excludedScopeSupport: support.filter(
        (file) => scopes.includes(layerOf(file)) && file.startsWith('app/'),
      ).length,
      scopeFunctions: allFunctions.length,
      functionsOver80Lines: allFunctions.filter((fn) => fn.physicalLines > 80).length,
      literalImportEdges: scopedEdges.length,
      workerEntryEdges: workerEdges.filter((edge) => scopedSet.has(edge.from)).length,
      externalImports: externals.filter((entry) => scopedSet.has(entry.from)).length,
      testFiles: tests.length,
    },
    files: scoped.map((file) => ({
      file,
      layer: layerOf(file),
      physicalLines: byFile.get(file).physicalLines,
      bytes: byFile.get(file).bytes,
      functionCount: byFile.get(file).functions.length,
    })),
    largest15Files: scoped
      .map((file) => ({
        file,
        physicalLines: byFile.get(file).physicalLines,
        bytes: byFile.get(file).bytes,
      }))
      .sort((a, b) => b.physicalLines - a.physicalLines || a.file.localeCompare(b.file))
      .slice(0, 15),
    functions: allFunctions,
    functionsOver80Lines: allFunctions
      .filter((fn) => fn.physicalLines > 80)
      .sort(
        (a, b) =>
          b.physicalLines - a.physicalLines ||
          a.file.localeCompare(b.file) ||
          a.startLine - b.startLine,
      ),
    imports: scopedEdges,
    workerEntries: workerEdges,
    layerTransitions: [...transitionCounts]
      .map(([transition, importDeclarations]) => ({ transition, importDeclarations }))
      .sort((a, b) => a.transition.localeCompare(b.transition)),
    serverToCoreImports: scopedEdges.filter(
      (edge) => layerOf(edge.from) === 'server' && layerOf(edge.to) === 'core',
    ),
    externalImports: externals.filter((entry) => scopedSet.has(entry.from)),
    boundaryEdges,
    directionFindings,
    cycles: {
      withinScope: withEdges(cyclicComponents(scoped, runtimeEdges)),
      appProductionTouchingScope: withEdges(
        cyclicComponents(fullApp, runtimeEdges).filter((nodes) =>
          nodes.some((file) => scopedSet.has(file)),
        ),
      ),
    },
    unresolvedRelativeImports: unresolved,
    nonliteralImports: analyzed.flatMap((entry) =>
      entry.dynamicImports.map((imported) => ({ file: entry.file, ...imported })),
    ),
    parseDiagnostics: analyzed.flatMap((entry) =>
      entry.parseDiagnostics.map((diagnostic) => ({ file: entry.file, ...diagnostic })),
    ),
    excludedScopeSupport: support.filter(
      (file) => file.startsWith('app/') && scopes.includes(layerOf(file)),
    ),
    coverage: {
      modules: moduleCoverage,
      tests: tests.map((file) => ({
        file,
        kind: testKind(file),
        directScopeImports: [
          ...new Set(
            runtimeEdges
              .filter((edge) => edge.from === file && scopedSet.has(edge.to))
              .map((edge) => edge.to),
          ),
        ],
      })),
      allResolvedImports: associationEdges.filter(
        (edge) => byFile.has(edge.from) && (byFile.has(edge.to) || productionSet.has(edge.to)),
      ),
    },
  };
}

export function structureSummary(result) {
  const lines = [
    '# P4b static structure inventory',
    '',
    `Tool: ${result.tool.name} ${result.tool.version} (${result.tool.license}); installed compiler reused.`,
    '',
    '## Definitions',
    '',
    ...Object.entries(result.definitions).map(
      ([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`,
    ),
    '',
    '## Counts',
    '',
    ...Object.entries(result.counts).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Largest 15 files',
    '',
    '| File | Physical lines | Bytes |',
    '|---|---:|---:|',
    ...result.largest15Files.map((row) => `| ${row.file} | ${row.physicalLines} | ${row.bytes} |`),
    '',
    '## Every function above 80 physical lines',
    '',
    '| File:start–end | Function / lexical container | Span | Own lines excluding nested | Direct nested functions |',
    '|---|---|---:|---:|---:|',
    ...result.functionsOver80Lines.map(
      (row) =>
        `| ${row.file}:${row.startLine}–${row.endLine} | ${row.qualifiedName.replaceAll('|', '\\|')} | ${row.physicalLines} | ${row.ownPhysicalLinesExcludingNested} | ${row.directNestedFunctions} |`,
    ),
    '',
    '## Direction review candidates',
    '',
    ...result.layerTransitions.map(
      (row) => `- ${row.transition}: ${row.importDeclarations} import declarations`,
    ),
    '',
    `Direct server→core imports: ${result.serverToCoreImports.length}; inspect the retained edge list separately from reverse dependencies.`,
    '',
    '| From:line | To | Classification |',
    '|---|---|---|',
    ...result.directionFindings.map(
      (edge) => `| ${edge.from}:${edge.line} | ${edge.to} | ${edge.classification} |`,
    ),
    '',
    '## Cycles',
    '',
    `Within scope: ${result.cycles.withinScope.length}; full app production cycles touching scope: ${result.cycles.appProductionTouchingScope.length}.`,
    ...result.cycles.appProductionTouchingScope.map((cycle) => `- ${cycle.nodes.join(' → ')}`),
    '',
    '## Test association and parse limits',
    '',
    `Modules without direct test imports: ${result.coverage.modules.filter((row) => row.directTests.length === 0).length}; without any transitive test imports: ${result.coverage.modules.filter((row) => row.reachableTestCount === 0).length}. Associations are static paths; inspect assertions separately.`,
    `Parse diagnostics: ${result.parseDiagnostics.length}; unresolved relative imports: ${result.unresolvedRelativeImports.length}; nonliteral import calls: ${result.nonliteralImports.length}. These lists and complete module→test paths are retained in structure-inventory.json.`,
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
      out: { type: 'string', default: '.sciencescope-local/temp/p4b' },
    },
  });
  const output = path.resolve(values.root, values.out);
  if (!output.includes(`${path.sep}.sciencescope-local${path.sep}`))
    throw new Error('Inventory output belongs under .sciencescope-local');
  const result = await auditStructure({ root: values.root });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'structure-inventory.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(output, 'structure-summary.md'), structureSummary(result));
  console.log(
    JSON.stringify({
      tool: result.tool,
      counts: result.counts,
      cycles: result.cycles.withinScope.length,
      findings: result.directionFindings.length,
      parseDiagnostics: result.parseDiagnostics.length,
      unresolved: result.unresolvedRelativeImports.length,
    }),
  );
}
