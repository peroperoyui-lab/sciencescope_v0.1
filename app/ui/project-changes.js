// Recent changes to a project's workbench (plans, log, map and the global
// plans), shared by the workbench and the project summary.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from './context.js';

export const RESOURCE_LABELS = { plans: '计划', log: '日志', map: '导图' };
export const OP_LABELS = {
  write: '改写',
  append: '追加',
  replace: '替换',
  delete: '删除',
  addNode: '添加了节点',
  updateNode: '修改节点',
  removeNode: '删除了节点',
  addEdge: '添加连线',
  removeEdge: '删除连线',
  undo: '撤销了修改',
  external: '程序外编辑',
};

/**
 * Newest first; reloads whenever the workspace changes.
 * @param {string} projectId @param {number} limit
 */
export function useProjectRevisions(projectId, limit) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [revisions, setRevisions] = useState([]);
  useEffect(() => {
    const queries = [
      { resource: 'plans', key: projectId },
      { resource: 'log', key: projectId },
      { resource: 'map', key: projectId },
      { resource: 'plans', key: 'global' },
    ];
    Promise.all(queries.map((query) => actions.history({ ...query, limit })))
      .then((lists) =>
        setRevisions(
          lists
            .flat()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit),
        ),
      )
      .catch((error) => actions.toast(error.message));
  }, [projectId, version]);
  return revisions;
}
