// Assembles the whole host: core, runtime, tools, conductor and the HTTP
// server. `main.js` starts it for real; tests start it with a fixture model.
import { createCore } from './core/index.js';
import { createDshRuntime } from './runtime/dsh/runtime.js';
import { createAppServer } from './server/server.js';
import { createConductor } from './services/conductor.js';
import { credentialsFile, runtimeProviderConfig } from './services/providers.js';
import { createTools } from './services/tools.js';
import { createTurnRunner } from './services/turn-runner.js';
import { createResearch } from './services/research/index.js';
import { createSemantic } from './services/research/semantic/index.js';

/**
 * @param {{ dataRoot: string, token: string,
 *   runtime?: import('./runtime/port.js').Runtime, runtimeName?: string,
 *   extraEnv?: Record<string, string>, onShutdown?: () => void }} options
 *   `runtime` replaces DSH (tests); `extraEnv` passes fixture-only variables to DSH.
 */
export async function createApp({
  dataRoot,
  token,
  runtime,
  runtimeName = 'dsh',
  extraEnv,
  onShutdown,
}) {
  const core = await createCore({ dataRoot });
  const semantic = createSemantic(core);
  const research = createResearch(core, { semantic });
  await semantic.start();
  const settings = async () =>
    (await core.workspace.read({ resource: 'settings', key: 'app' })).value;

  const activeRuntime =
    runtime ??
    createDshRuntime({
      home: core.paths.runtime,
      credentialsPath: credentialsFile(core.paths),
      providerConfig: async () => runtimeProviderConfig((await settings()).providers),
      extraEnv,
    });
  const runner = createTurnRunner({
    core,
    runtime: activeRuntime,
    runtimeName,
    tools: createTools(core, research),
    defaultModel: async () => (await settings()).models.default,
  });
  const conductor = createConductor({ core, runner });
  conductor.start();
  const server = createAppServer({ core, token, conductor, onShutdown, research, semantic });

  return {
    core,
    research,
    semantic,
    conductor,
    runtime: activeRuntime,
    listen: server.listen,
    async close() {
      conductor.stop();
      await server.close();
      await conductor.idle();
      await activeRuntime.close();
      await semantic.close();
      core.close();
    },
  };
}
