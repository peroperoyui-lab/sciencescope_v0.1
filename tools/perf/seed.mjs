// Offline fixture construction deliberately assembles no app/runtime or model
// consumers. Canonical records and parser projections use production services.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCore } from '../../app/core/index.js';
import { createResearch } from '../../app/services/research/index.js';
import { createProjectFiles } from '../../app/services/project-files.js';
import { createProjectIndex } from '../../app/services/knowledge/project-index.js';
import { createResearchInput } from '../../app/services/research-input/index.js';
import { createDesk } from '../../app/services/desk/index.js';
import { createVersions } from '../../app/services/versions/index.js';
import { documentBytes } from './seed-documents.mjs';
import { seedMeetings, seedVersions } from './seed-history.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestName = 'perf-seed-manifest.json';
const generatorVersion = 1;

async function existingJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveManifest(file, manifest) {
  const staged = `${file}.${process.pid}.tmp`;
  await writeFile(staged, JSON.stringify(manifest, null, 2));
  await rename(staged, file);
}

async function preserveFile(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (hash(await readFile(file)) !== hash(bytes))
      throw new Error(`Existing fixture file has different bytes; preserved: ${file}`);
  }
}

async function generateFiles(files, manifest, tiny, save) {
  const perFormat = tiny ? 2 : 100;
  let number = 0;
  for (const format of ['pdf', 'docx', 'md']) {
    for (let index = 0; index < perFormat; index++) {
      number++;
      const thesis = format === 'docx' && index === 0;
      const relative = thesis
        ? 'corpus/manuscript-城市韧性.docx'
        : `corpus/source-${String(number).padStart(3, '0')}.${format}`;
      const generated = await documentBytes({
        seed: manifest.seed,
        number,
        format,
        sections: tiny ? 3 : format === 'pdf' ? 16 : 17,
        thesis,
        chineseTarget: tiny ? 2500 : 50000,
      });
      await preserveFile(files.locate(manifest.projectId, relative), generated.bytes);
      manifest.files[number - 1] = {
        path: relative,
        format,
        bytes: generated.bytes.length,
        sha256: hash(generated.bytes),
        chineseCharacters: generated.chineseCharacters,
      };
      if (thesis)
        Object.assign(manifest, {
          docx: relative,
          thesisNumber: number,
          thesis: {
            chineseCharacters: generated.chineseCharacters,
            tableCount: 1,
            imageCount: 1,
            ommlCount: 1,
          },
        });
      if (number % 25 === 0) {
        await save();
        console.log(JSON.stringify({ phase: 'files', generated: number, total: perFormat * 3 }));
      }
    }
  }
  await save();
}

function indexedFiles(research, manifest) {
  const sources = research.store.listSources({ projectId: manifest.projectId, limit: 10000 });
  for (const file of manifest.files) {
    const source = sources.find((entry) => entry.folderPath === file.path);
    if (!source || !['parsed', 'partial'].includes(source.contentStatus))
      throw new Error(
        `Fixture did not parse: ${file.path}: ${source?.parseError ?? source?.contentStatus ?? 'missing'}`,
      );
    const chunks = research.store.chunks(source.id);
    Object.assign(file, {
      sourceId: source.id,
      chunks: chunks.length,
      contentStatus: source.contentStatus,
      parser: source.parser,
      pages: source.pages,
    });
  }
  return sources;
}

function actualCounts(core, manifest) {
  const count = (sql) => Number(core.db.prepare(sql).get(manifest.projectId).n);
  return {
    projectFiles: manifest.files.length,
    sources: count('SELECT count(*) n FROM rb_sources WHERE project_id=?'),
    chunks: count(
      'SELECT count(*) n FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id WHERE s.project_id=?',
    ),
    meetings: manifest.meetings.length,
    messages: count(
      'SELECT count(*) n FROM messages m JOIN meetings g ON g.id=m.meeting_id WHERE g.project_id=?',
    ),
    toolCalls: count(
      'SELECT count(*) n FROM tool_calls c JOIN turns t ON t.id=c.turn_id JOIN meetings g ON g.id=t.meeting_id WHERE g.project_id=?',
    ),
    imageAttachments: count(
      "SELECT count(*) n FROM message_research_input r JOIN messages m ON m.id=r.message_id JOIN meetings g ON g.id=m.meeting_id, json_each(r.input_json,'$.materials') j WHERE g.project_id=? AND json_extract(j.value,'$.type')='image'",
    ),
    sourceAttachments: count(
      "SELECT count(*) n FROM message_research_input r JOIN messages m ON m.id=r.message_id JOIN meetings g ON g.id=m.meeting_id, json_each(r.input_json,'$.materials') j WHERE g.project_id=? AND json_extract(j.value,'$.type')='source'",
    ),
  };
}

async function verifyReused(core, files, research, versions, manifest) {
  for (const file of manifest.files)
    if (hash(await readFile(files.locate(manifest.projectId, file.path))) !== file.sha256)
      throw new Error(`Fixture changed since generation: ${file.path}`);
  indexedFiles(research, manifest);
  const counts = actualCounts(core, manifest);
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts))
    throw new Error('Fixture database counts changed since generation; existing data preserved');
  for (const id of manifest.compareVersionIds) versions.get(id);
}

/**
 * @param {{dataRoot:string,seed?:string,tiny?:boolean}} options
 * @returns {Promise<any>} A manifest containing actual parsed counts and measurement targets.
 */
export async function seedFixture({ dataRoot, seed = 'p4a-20261026', tiny = false }) {
  const started = performance.now();
  const root = path.resolve(dataRoot);
  await mkdir(root, { recursive: true });
  const manifestPath = path.join(root, manifestName);
  const previous = await existingJson(manifestPath);
  if (
    previous &&
    (previous.generatorVersion !== generatorVersion ||
      previous.seed !== seed ||
      previous.profile !== (tiny ? 'tiny' : 'full'))
  )
    throw new Error('Existing fixture marker belongs to another seed/profile; no data changed');
  const seedTag = hash(seed).slice(0, 8);
  const manifest = previous ?? {
    generatorVersion,
    seed,
    seedTag,
    profile: tiny ? 'tiny' : 'full',
    synthetic: true,
    phase: 'building',
    homeProjectName: `P4a 城市韧性合成研究 ${seedTag}`,
    searchTerm: '城市韧性',
    files: [],
    meetings: [],
    determinism:
      'Stable content and document bytes; service-created IDs and times are retained by this manifest',
  };
  await saveManifest(manifestPath, manifest);
  const core = await createCore({ dataRoot: root });
  const files = createProjectFiles(core);
  const research = createResearch(core);
  const versions = createVersions(core);
  const desk = createDesk(core, { versions, projectFiles: files });
  const inputs = createResearchInput({ core, research });
  let index;
  try {
    if (manifest.phase === 'complete') {
      await verifyReused(core, files, research, versions, manifest);
      console.log(
        JSON.stringify({ phase: 'reused', manifest: manifestPath, counts: manifest.counts }),
      );
      return manifest;
    }
    const project = manifest.projectId
      ? core.projects.get(manifest.projectId)
      : (core.projects.list().find((entry) => entry.name === manifest.homeProjectName) ??
        (await core.projects.create({
          name: manifest.homeProjectName,
          description: `Self-created performance fixture; seed ${seed}. No model requests were made during construction.`,
        })));
    manifest.projectId = project.id;
    manifest.projectFolder = files.rootOf(project.id);
    await saveManifest(manifestPath, manifest);
    const save = () => saveManifest(manifestPath, manifest);
    await generateFiles(files, manifest, tiny, save);
    index = createProjectIndex({ core, research, files });
    const timer = setInterval(
      () => console.log(JSON.stringify({ phase: 'index', ...index.status(project.id) })),
      5000,
    );
    timer.unref();
    try {
      manifest.indexResult = await index.scanAndWait(project.id);
    } finally {
      clearInterval(timer);
    }
    const sources = indexedFiles(research, manifest);
    // Six invented papers give the global knowledge map real catalog nodes;
    // other files stay files, avoiding an accidental 300-paper model workload.
    for (const source of sources
      .filter((entry) => entry.name.endsWith('.pdf'))
      .slice(0, tiny ? 1 : 6))
      if (source.kind !== 'paper')
        research.store.updateSource(source.id, { kind: 'paper' }, { actorId: 'person_user' });
    await save();
    await seedMeetings({ core, research, inputs, manifest, save, tiny });
    await seedVersions({ core, desk, versions, manifest, save, tiny });
    manifest.counts = actualCounts(core, manifest);
    if (
      manifest.counts.projectFiles !== (tiny ? 6 : 300) ||
      manifest.counts.messages !== (tiny ? 24 : 1000)
    )
      throw new Error('Unexpected synthetic fixture counts');
    manifest.phase = 'complete';
    manifest.milliseconds = Math.round(performance.now() - started);
    await save();
    console.log(
      JSON.stringify({
        phase: 'complete',
        manifest: manifestPath,
        counts: manifest.counts,
        milliseconds: manifest.milliseconds,
      }),
    );
    return manifest;
  } catch (error) {
    manifest.lastError = String(error.stack ?? error);
    await saveManifest(manifestPath, manifest);
    throw error;
  } finally {
    await index?.close();
    inputs.close();
    await desk.shutdown();
    await versions.close();
    core.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes('--data') || args.includes('--help')) {
    console.log(
      'Usage: node tools/perf/seed.mjs --data <isolated data directory> [--seed text] [--tiny]\nClose the test product before generating. Same seed/profile reuses its own manifest and preserves unknown files.',
    );
    process.exitCode = args.includes('--help') ? 0 : 1;
  } else {
    seedFixture({
      dataRoot: value('--data'),
      seed: args.includes('--seed') ? value('--seed') : undefined,
      tiny: args.includes('--tiny'),
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
