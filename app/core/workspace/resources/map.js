// Research map (导图): `{ nodes, edges }`, the same shape as the v0 workbench.
// Nodes form a tree through `parent`; edges are extra links between nodes.
import path from 'node:path';
import { AppError } from '../../errors.js';
import { newId } from '../../ids.js';

/** @typedef {{ id: string, parent: string | null, type?: string, text: string,
 *   x?: number, y?: number, floating?:boolean, attachments?: any[] }} MapNode */
/** @typedef {{ id: string, from: string, to: string, label?: string, directed?:boolean }} MapEdge */

/** @param {string | null} text */
function parse(text) {
  if (text == null) return { nodes: [], edges: [] };
  const value = JSON.parse(text);
  return { nodes: value.nodes ?? [], edges: value.edges ?? [] };
}

function format(map) {
  return `${JSON.stringify(map, null, 2)}\n`;
}

function requireNode(map, id) {
  const node = map.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new AppError('NODE_NOT_FOUND', '导图中找不到这个节点。', 404);
  return node;
}

/** Ids of a node and everything below it. */
function subtree(map, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of map.nodes) {
      if (node.parent && ids.has(node.parent) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * @param {string | null} text
 * @param {string} op
 * @param {any} args
 */
function apply(text, op, args) {
  if (op === 'delete') return null;
  if (op === 'write') return format(parse(JSON.stringify(args.map ?? {})));

  const map = parse(text);
  switch (op) {
    case 'addNode': {
      const node = { id: newId('node'), parent: null, text: '', ...args.node };
      if (node.parent) requireNode(map, node.parent);
      map.nodes.push(node);
      break;
    }
    case 'updateNode': {
      const node = requireNode(map, args.id);
      Object.assign(node, args.changes ?? {}, { id: node.id });
      break;
    }
    case 'removeNode': {
      requireNode(map, args.id);
      const removed = subtree(map, args.id);
      map.nodes = map.nodes.filter((node) => !removed.has(node.id));
      map.edges = map.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
      break;
    }
    case 'addEdge': {
      requireNode(map, args.edge?.from);
      requireNode(map, args.edge?.to);
      map.edges.push({ id: newId('edge'), ...args.edge });
      break;
    }
    case 'removeEdge':
      map.edges = map.edges.filter((edge) => edge.id !== args.id);
      break;
    default:
      throw new AppError('UNKNOWN_OP', `不支持的操作：${op}`);
  }
  return format(map);
}

export const map = {
  name: 'map',
  ops: ['write', 'addNode', 'updateNode', 'removeNode', 'addEdge', 'removeEdge', 'delete'],
  /** @param {import('../workspace.js').Locate} locate @param {string} key project id */
  file: (locate, key) => path.join(locate.projectDir(key), 'workbench', 'map.json'),
  apply,
  parse,
};
