import { readFile, mkdir, readdir, rm, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { createTexEngines } from './tex-engines.js';
import { runTexProcess } from './tex-process.js';
import { selectTexRoot, selectTexEngine, texDiagnostics } from './tex-source.js';
import { prepareTexBuild, texBuildEnv, texCommand, bibliography } from './tex-command.js';

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Compiles saved project files independently of the desk mutation queue. Each
 * session owns one process tree and one retained successful PDF.
 * @param {import('../../core/index.js').Core} core
 * @param {{projectFiles:any,store:any,engines?:ReturnType<typeof createTexEngines>,
 * run?:typeof runTexProcess,env?:NodeJS.ProcessEnv,timeoutMs?:number}} dependencies
 */
export function createTexBuild(
  core,
  {
    projectFiles,
    store,
    engines = createTexEngines(),
    run = runTexProcess,
    env = process.env,
    timeoutMs = 120000,
  },
) {
  const base = path.join(core.paths.root, 'temp', 'desk-build');
  const active = new Map();
  let stopped = false;
  let startupError;
  const ready = cleanup().catch((error) => {
    startupError = error;
  });
  async function cleanup() {
    await mkdir(base, { recursive: true });
    const open = new Set(
      core.db
        .prepare("SELECT id FROM desk_sessions WHERE status='open'")
        .all()
        .map((row) => row.id),
    );
    for (const entry of await readdir(base, { withFileTypes: true }))
      if (entry.isDirectory() && !open.has(entry.name))
        await rm(path.join(base, entry.name), { recursive: true, force: true });
  }
  function session(id) {
    const value = store.get(id);
    if (value.status !== 'open')
      throw new AppError('DESK_SESSION_CLOSED', '这个编辑会话已关闭。', 409);
    const group = core.versionCatalog.group(value.groupId);
    if (group.format !== 'tex') throw new AppError('DESK_FORMAT', '只有 TeX 文稿可以编译。');
    if (!group.sourcePath)
      throw new AppError('DESK_SOURCE_REQUIRED', '请先关联项目里的 TeX 文件。');
    return group;
  }
  async function execute(id, input, controller) {
    await ready;
    if (startupError) throw startupError;
    const group = session(id);
    const tools = await engines.get();
    if (!tools.engines.length)
      throw new AppError(
        'DESK_TEX_MISSING',
        '未找到已安装的 MiKTeX 或 TeX Live，请安装后重新检测。',
      );
    const project = projectFiles.rootOf(group.projectId);
    const exclude = core.projects.get(group.projectId).folder
      ? []
      : ['workbench', 'notes', 'minutes', 'versions', 'desk'];
    const source = await selectTexRoot(project, group.sourcePath, input.root, exclude);
    const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
    const engine = selectTexEngine(tools.engines, source, settings.value.desk.tex.engine);
    const folder = path.join(base, id);
    const output = path.join(folder, 'work');
    const pdf = path.join(folder, 'last-success.pdf');
    const job = path.basename(source.root, path.extname(source.root));
    const unsaved = core.db
      .prepare(
        `SELECT DISTINCT g.source_path AS path FROM desk_sessions s
      JOIN version_groups g ON g.id=s.group_id WHERE g.project_id=? AND s.status='open'
      AND s.seq<>s.saved_seq AND g.source_path IS NOT NULL ORDER BY g.source_path`,
      )
      .all(group.projectId)
      .map((row) => row.path);
    const started = performance.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let log = '';
    let failed = false;
    // TeX resolves \input and \include from the main file's folder, as editors do.
    const folderOfRoot = path.join(project, path.dirname(source.root));
    const childEnv = texBuildEnv(env, folderOfRoot, output, [
      engine.path,
      tools.latexmk,
      tools.biber,
      tools.bibtex,
    ]);
    async function invoke(executable, args, cwd = folderOfRoot) {
      const result = await run(executable, args, { cwd, env: childEnv, signal: controller.signal });
      log += result.output + '\n';
      if (result.code !== 0 || result.aborted) failed = true;
      return !failed;
    }
    try {
      await rm(output, { recursive: true, force: true });
      await prepareTexBuild(project, folderOfRoot, output, exclude);
      const command = texCommand(engine, tools.latexmk, path.basename(source.root), output);
      if (await invoke(command.executable, command.args)) {
        if (!tools.latexmk) {
          const backend = await bibliography(output, job);
          if (backend) {
            if (!tools[backend]) {
              failed = true;
              log += `! 参考文献需要 ${backend}，请在 TeX 安装中补齐后重试。\n`;
            } else {
              // Bibliography tools write beside the auxiliary files, never in the project.
              await invoke(tools[backend], [job], output);
              for (let pass = 0; pass < 2 && !failed; pass++)
                await invoke(command.executable, command.args);
            }
          }
        }
      }
      // Prefer TeX's complete log over duplicate terminal diagnostics.
      const fileLog = await readFile(path.join(output, job + '.log'), 'utf8').catch(() => '');
      if (fileLog) log = fileLog + '\n' + (failed ? log : '');
      if (!failed && !controller.signal.aborted) {
        if (await exists(path.join(output, job + '.pdf')))
          await copyFile(path.join(output, job + '.pdf'), pdf);
        else {
          failed = true;
          log += '\n! 编译结束，但没有生成 PDF。\n';
        }
      }
    } catch (error) {
      failed = true;
      log += `\n! 无法完成编译：${error.message}\n`;
    } finally {
      clearTimeout(timer);
    }
    const status = timedOut ? 'timeout' : failed || controller.signal.aborted ? 'failed' : 'ok';
    const diagnostics = texDiagnostics(log.trimEnd(), project, source.root);
    if (status !== 'ok' && !diagnostics.errors.length)
      diagnostics.errors.push({
        file: source.root,
        line: null,
        message: timedOut
          ? '编译超过时限，已停止。'
          : controller.signal.aborted
            ? '编译已停止。'
            : '编译失败，请查看日志末尾。',
      });
    const result = {
      status,
      root: source.root,
      engine: engine.id,
      durationMs: Math.round(performance.now() - started),
      pdf: await exists(pdf),
      ...diagnostics,
      unsaved,
    };
    core.events.transient('desk.compiled', { sessionId: id, status });
    return result;
  }
  return {
    engines: (refresh = false) => engines.get(refresh),
    compile(id, input = {}) {
      session(id);
      if (stopped) throw new AppError('DESK_SESSION_CLOSED', '应用正在关闭。', 409);
      if (active.has(id))
        throw new AppError('DESK_TEX_BUSY', '这份文稿正在编译，请等待结果。', 409);
      const controller = new AbortController();
      const task = execute(id, input, controller).finally(() => active.delete(id));
      active.set(id, { controller, task });
      return task;
    },
    async pdf(id) {
      session(id);
      await ready;
      try {
        return await readFile(path.join(base, id, 'last-success.pdf'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        throw new AppError('DESK_TEX_PDF_MISSING', '还没有成功编译的 PDF。', 404);
      }
    },
    async remove(id) {
      const job = active.get(id);
      job?.controller.abort();
      await job?.task.catch(() => {});
      await ready;
      await rm(path.join(base, id), { recursive: true, force: true });
    },
    async shutdown() {
      stopped = true;
      for (const job of active.values()) job.controller.abort();
      await Promise.allSettled([...active.values()].map((job) => job.task));
      await ready;
    },
  };
}
