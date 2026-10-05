// AI participant definition files: YAML front matter plus a Markdown body
// that is the participant's instructions (persona and way of working).
import YAML from 'yaml';

/**
 * `role` is a short duty label (统计审稿); `panel` puts the AI on the expert
 * roster for discussions (`expert`, or `reviewer` for the independent review)
 * and `position` orders the roster.
 * @typedef {{ name: string, model?: { provider?: string, model?: string, effort?: string } | null,
 *   skills?: string[], tools?: { prefer?: string[], avoid?: string[] }, role?: string,
 *   panel?: 'expert' | 'reviewer' | null, enabled?: boolean, position?: number,
 *   prompt: string }} AgentDefinition
 */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * @param {string} text
 * @returns {AgentDefinition}
 */
export function parseAgentFile(text) {
  const match = FRONT_MATTER.exec(text);
  const header = match ? (YAML.parse(match[1]) ?? {}) : {};
  const prompt = match ? text.slice(match[0].length) : text;
  return {
    name: String(header.name ?? ''),
    model: header.model ?? null,
    skills: Array.isArray(header.skills) ? header.skills.map(String) : [],
    tools: header.tools ?? {},
    role: String(header.role ?? ''),
    panel: header.panel === 'expert' || header.panel === 'reviewer' ? header.panel : null,
    enabled: header.enabled !== false,
    position: Number.isFinite(header.position) ? header.position : 0,
    prompt: prompt.trim(),
  };
}

/**
 * @param {AgentDefinition} definition
 * @returns {string}
 */
export function formatAgentFile(definition) {
  const header = { name: definition.name };
  if (definition.model) header.model = definition.model;
  if (definition.skills?.length) header.skills = definition.skills;
  if (definition.tools && Object.keys(definition.tools).length) header.tools = definition.tools;
  if (definition.role) header.role = definition.role;
  if (definition.panel) header.panel = definition.panel;
  if (definition.enabled === false) header.enabled = false;
  if (definition.position) header.position = definition.position;
  return `---\n${YAML.stringify(header).trimEnd()}\n---\n\n${definition.prompt.trim()}\n`;
}
