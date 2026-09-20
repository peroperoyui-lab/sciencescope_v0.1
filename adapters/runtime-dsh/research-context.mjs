/**
 * Build an explicit DSH patch for research workspaces.
 *
 * Research workspaces often live below the ScienceScope checkout.  DSH's
 * normal instruction discovery walks to the first `.git` marker, which would
 * make the checkout's developer instructions and SDK coding persona part of
 * a research session.  This overlay makes the launch boundary structural:
 * instruction discovery is rooted at the workspace itself, the user-global
 * instruction home is isolated, and the SDK coding persona is replaced.
 *
 * The returned JSON is valid YAML and can be passed to the supported DSH
 * `--patch`/SDK `patches` overlay. Instruction isolation is configuration,
 * not an instruction asking the model to ignore an injected developer prompt.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

const DEFAULT_MAX_BYTES = 65536;
const RESEARCH_PERSONA = 'You are ScienceScope\'s Main research coordinator. Coordinate rigorous scientific reasoning, evidence, uncertainty, and next steps for the research project. Explain reasoning directly; do not act as a general coding agent or a teaching tutor.';

function requiredAbsolute(name, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  if (!isAbsolute(value)) throw new TypeError(`${name} must be absolute`);
  const resolved = resolve(value);
  return resolved;
}

/**
 * Return the supported Cordis patch object without touching the filesystem.
 * @param {{home: string, workspace: string, instructionHome?: string, maxBytes?: number}} options
 */
export function buildResearchContextPatch(options = {}) {
  const home = requiredAbsolute('home', options.home);
  const workspace = requiredAbsolute('workspace', options.workspace);
  const instructionHome = requiredAbsolute(
    'instructionHome',
    options.instructionHome ?? join(home, '.sciencescope-local', 'dsh', 'research-instruction-home'),
  );
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive integer');
  }

  return [
    {
      id: 'agent-instructions',
      config: {
        // An empty marker set makes the workspace itself the discovery root;
        // explicit AGENTS.md/CLAUDE.md files in that workspace still apply.
        projectRootMarkers: [],
        dshHome: instructionHome,
        maxBytes,
      },
    },
    {
      id: 'system-prompt',
      config: {
        // Replace the SDK coding-agent persona with an explicit research
        // identity; project instructions remain a separate source.
        personaPrefix: options.persona || RESEARCH_PERSONA,
        personaSuffix: '',
      },
    },
  ];
}

/**
 * Materialize a per-launch patch under the caller's local ScienceScope data.
 * @param {{home: string, workspace: string, instructionHome?: string, patchDirectory?: string, patchName?: string, maxBytes?: number}} options
 * @returns {Promise<{patchPath: string, instructionHome: string, workspace: string}>}
 */
export async function createResearchContextPatch(options = {}) {
  const home = requiredAbsolute('home', options.home);
  const workspace = requiredAbsolute('workspace', options.workspace);
  const instructionHome = requiredAbsolute(
    'instructionHome',
    options.instructionHome ?? join(home, '.sciencescope-local', 'dsh', 'research-instruction-home'),
  );
  const patchDirectory = requiredAbsolute(
    'patchDirectory',
    options.patchDirectory ?? join(home, '.sciencescope-local', 'temp', 'research-context'),
  );
  const patchName = options.patchName ?? `research-${randomUUID()}.json`;
  if (!/^[A-Za-z0-9._-]+\.json$/u.test(patchName)) throw new TypeError('patchName must be a simple .json filename');
  await mkdir(patchDirectory, { recursive: true });
  const patchPath = join(patchDirectory, patchName);
  await writeFile(patchPath, `${JSON.stringify(buildResearchContextPatch({ ...options, home, workspace, instructionHome }))}\n`, { flag: 'wx' });
  return { patchPath, instructionHome, workspace };
}

export default { buildResearchContextPatch, createResearchContextPatch };
