import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileName, isWithin } from './paths.js';
import { records, mapMarkdown } from './records.js';

/** @param {any} context */
export async function planProjects({ db, writer, paths, projectFolders }) {
  const root = await realpath(paths.root);
  for (const project of records(db, 'SELECT * FROM projects ORDER BY created_at,id')) {
    writer.check();
    const name = `${fileName(project.name)}-${fileName(project.id)}`;
    projectFolders.set(project.id, name);
    const base = `项目/${name}`;
    const workspace = path.join(paths.projects, project.dir_name);
    const folder = path.resolve(project.folder || workspace);
    const actual = await realpath(folder).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const included = actual != null && isWithin(root, actual);
    writer.json(`${base}/项目.json`, {
      ...project,
      python_bindings: records(
        db,
        "SELECT * FROM python_bindings WHERE scope='project' AND target_id=?",
        project.id,
      ),
      export_project_folder: {
        path: folder,
        included,
        reason: included ? '数据目录内的项目文件夹' : '外部项目文件夹或路径已不可用，只保留路径',
      },
    });
    await writer.tree(path.join(workspace, 'workbench'), `${base}/工作站`);
    await writer.tree(path.join(workspace, 'minutes'), `${base}/纪要`);
    await writer.tree(path.join(workspace, 'notes'), `${base}/笔记`);
    const map = await readFile(path.join(workspace, 'workbench', 'map.json'), 'utf8').catch(
      (error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (map) writer.text(`${base}/工作站/导图.md`, mapMarkdown(JSON.parse(map)));
    const groups = records(db, 'SELECT * FROM version_groups WHERE project_id=?', project.id);
    const versions = records(
      db,
      `SELECT v.* FROM manuscript_versions v JOIN version_groups g ON g.id=v.group_id WHERE g.project_id=? ORDER BY v.group_id,v.number`,
      project.id,
    );
    const versionIndex = [];
    for (const version of versions) {
      const exported = await writer.copy(
        path.resolve(workspace, version.original_path),
        `${base}/编辑台/原文件/${fileName(version.id)}/${fileName(version.original_name, 255)}`,
      );
      versionIndex.push({ ...version, export_path: exported });
      await writer.copy(
        `${path.resolve(workspace, version.original_path)}.notes.md`,
        `${base}/编辑台/原文件/${fileName(version.id)}/版本说明.md`,
      );
    }
    writer.json(`${base}/编辑台/版本.json`, versionIndex);
    writer.json(`${base}/编辑台/索引.json`, {
      version_groups: groups,
      desk_sessions: records(
        db,
        'SELECT s.* FROM desk_sessions s JOIN version_groups g ON g.id=s.group_id WHERE g.project_id=?',
        project.id,
      ),
      desk_changes: records(
        db,
        'SELECT c.* FROM desk_changes c JOIN desk_sessions s ON s.id=c.session_id JOIN version_groups g ON g.id=s.group_id WHERE g.project_id=?',
        project.id,
      ),
    });
    writer.json(`${base}/编辑台/批注.json`, {
      manuscript_bindings: records(
        db,
        'SELECT b.* FROM manuscript_bindings b JOIN version_groups g ON g.id=b.group_id WHERE g.project_id=?',
        project.id,
      ),
      manuscript_comments: records(
        db,
        'SELECT c.* FROM manuscript_comments c JOIN version_groups g ON g.id=c.group_id WHERE g.project_id=?',
        project.id,
      ),
    });
    if (included) await writer.tree(actual, `${base}/项目文件夹`);
  }
  await writer.copy(paths.globalPlans, '全局/计划.md');
  await writer.tree(paths.globalMinutes, '全局/纪要');
}
