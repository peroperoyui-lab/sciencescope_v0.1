// The DSH implementation of the runtime port (../port.js).
// One DSH process per active session; our plugin inside it talks to the
// bridge. DSH persists each session under its home, so a released session can
// be resumed later with the same id.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { createBridge } from './bridge.js';

const PLUGIN_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugin.js'),
).href;
const READY_TIMEOUT_MS = 30_000;
// Keys stay in the credentials file; never hand them to session processes.
const SECRET_NAME = /api[_-]?key|token|secret|password|credential|authorization/i;

/** @param {Record<string, string | undefined>} env */
function withoutSecrets(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SECRET_NAME.test(key)));
}

/** POST JSON to a session's control port. */
function control(url, route, body) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const target = new URL(route, url);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
          if (res.statusCode !== 200) reject(new Error(value?.error ?? `HTTP ${res.statusCode}`));
          else resolve(value);
        });
      },
    );
    req.on('error', reject);
    req.end(text);
  });
}

/**
 * @param {{ home: string, credentialsPath: string,
 *   providerConfig: () => Promise<any>, extraEnv?: Record<string, string> }} options
 *   `extraEnv` is for local test fixtures only (e.g. a fixture model's dummy key).
 * @returns {import('../port.js').Runtime}
 */
export function createDshRuntime({ home, credentialsPath, providerConfig, extraEnv = {} }) {
  /** @type {Promise<Awaited<ReturnType<typeof createBridge>>> | null} */
  let bridgePromise = null;
  /** @type {Map<string, { harness: DeepSeekHarness, controlUrl: string, token: string,
   *   onEvent: (event: any) => void }>} */
  const sessions = new Map();

  const bridge = () => (bridgePromise ??= createBridge());

  async function writeLaunchFiles(sessionId, config) {
    const folder = path.join(home, 'sciencescope-sessions');
    await mkdir(folder, { recursive: true });
    const configFile = path.join(folder, `${sessionId}.config.json`);
    const patchFile = path.join(folder, `${sessionId}.patch.json`);
    await writeFile(configFile, JSON.stringify(config));
    await writeFile(
      patchFile,
      JSON.stringify([
        { id: 'credentials', config: { path: credentialsPath } },
        { id: 'llm-pi-ai', config: await providerConfig() },
        { insert: [{ id: 'sciencescope-bridge', name: PLUGIN_URL }] },
      ]),
    );
    return { configFile, patchFile };
  }

  return {
    async startSession({ sessionId, model, workFolder, instructions, tools, onToolCall }) {
      const id = sessionId ?? `session-${randomUUID().replaceAll('-', '')}`;
      const running = sessions.get(id);
      const link = await bridge();
      if (running) {
        link.update(id, { onToolCall });
        await control(running.controlUrl, '/instructions', {
          token: running.token,
          text: instructions,
        });
        return id;
      }

      /** @type {(controlUrl: string) => void} */
      let onReady = () => {};
      /** @type {(error: string) => void} */
      let onFailed = () => {};
      /** @type {Promise<string>} */
      const ready = new Promise((resolve, reject) => {
        onReady = resolve;
        onFailed = (error) => reject(new Error(error));
      });
      /** @type {{ harness: any, controlUrl: string, token: string, onEvent: (event: any) => void }} */
      const entry = { harness: null, controlUrl: '', token: '', onEvent: () => {} };
      entry.token = link.link(id, {
        onReady,
        onFailed,
        onEvent: (event) => entry.onEvent(event),
        onToolCall,
      });
      const { configFile, patchFile } = await writeLaunchFiles(id, { instructions, tools, model });
      const temp = path.join(home, 'temp');
      await mkdir(temp, { recursive: true });
      entry.harness = new DeepSeekHarness({
        profile: 'sdk',
        initializeTimeoutMs: READY_TIMEOUT_MS,
        patches: [patchFile],
        dshHome: home,
        processCwd: workFolder,
        cwd: workFolder,
        env: {
          ...withoutSecrets(process.env),
          ...extraEnv,
          TEMP: temp,
          TMP: temp,
          TMPDIR: temp,
          DSH_TELEMETRY_DISABLED: '1',
          SCIENCESCOPE_BRIDGE_URL: link.url,
          SCIENCESCOPE_BRIDGE_TOKEN: entry.token,
          SCIENCESCOPE_SESSION_ID: id,
          SCIENCESCOPE_SESSION_CONFIG: configFile,
        },
        provider: model.provider,
        model: model.model,
        ...(model.effort ? { reasoningEffort: ReasoningEffortId(model.effort) } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      });
      let timer;
      try {
        await entry.harness.start();
        entry.controlUrl = await Promise.race([
          ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('DSH session did not start')),
              READY_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (error) {
        link.unlink(id);
        await entry.harness.close().catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
      sessions.set(id, entry);
      return id;
    },

    async send(sessionId, input, onEvent) {
      const entry = sessions.get(sessionId);
      if (!entry) throw new Error(`DSH session is not running: ${sessionId}`);
      entry.onEvent = onEvent;
      try {
        return await control(entry.controlUrl, '/prompt', { token: entry.token, text: input });
      } catch (error) {
        return { stopReason: 'failed', error: String(error.message) };
      } finally {
        entry.onEvent = () => {};
      }
    },

    async interrupt(sessionId) {
      const entry = sessions.get(sessionId);
      if (entry) await control(entry.controlUrl, '/interrupt', { token: entry.token });
    },

    async setInstructions(sessionId, instructions) {
      const entry = sessions.get(sessionId);
      if (entry) {
        await control(entry.controlUrl, '/instructions', {
          token: entry.token,
          text: instructions,
        });
      }
    },

    async release(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return;
      sessions.delete(sessionId);
      (await bridge()).unlink(sessionId);
      await entry.harness.close();
    },

    async close() {
      await Promise.all([...sessions.keys()].map((id) => this.release(id)));
      if (bridgePromise) await (await bridgePromise).close();
    },
  };
}
