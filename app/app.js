// Assembles the whole host: core, runtime, tools, conductor and the HTTP
// server. `main.js` starts it for real; tests start it with a fixture model.
import { createCore } from './core/index.js';
import { createDshRuntime } from './runtime/dsh/runtime.js';
import { createAppServer } from './server/server.js';
import { createConductor } from './services/conductor.js';
import { createMinutesService } from './services/secretary/minutes.js';
import { createSecretaryChat } from './services/secretary/chat.js';
import { createBackgroundRunner } from './services/secretary/background.js';
import { projectBrief } from './services/secretary/project-brief.js';
import { createMemoryService } from './services/memory/index.js';
import { credentialsFile, runtimeProviderConfig } from './services/providers.js';
import { createTools } from './services/tools.js';
import { createContextAssembly } from './services/context-assembly.js';
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
  const minutes = createMinutesService({
    core,
    runtime: activeRuntime,
    defaultModel: async () => (await settings()).models.default,
  });
  const secretary = createSecretaryChat({ core, minutes });
  const memoryRunner = createBackgroundRunner({
    core,
    runtime: activeRuntime,
    defaultModel: async () => (await settings()).models.default,
  });
  const memory = createMemoryService({ core, minutes, research, runner: memoryRunner });
  const contextAssembly = createContextAssembly({
    core,
    defaultModel: async () => (await settings()).models.default,
    minutesCoverage: async (meetingId, revisionId) => minutes.coverage(meetingId, revisionId),
    minutesCoveredMessageIds: (meetingId, revisionId) =>
      minutes.coveredMessageIds(meetingId, revisionId),
    followup: (meetingId, options) => secretary.catchUp(meetingId, options),
    projectBrief: async (projectId) => projectBrief(core, projectId, research.store).text,
  });
  const runner = createTurnRunner({
    core,
    runtime: activeRuntime,
    runtimeName,
    contextAssembly,
    tools: createTools(core, research, { secretary }),
  });
  const conductor = createConductor({ core, runner });
  conductor.start();
  minutes.start();
  memory.start();
  const server = createAppServer({
    core,
    token,
    conductor,
    onShutdown,
    research,
    semantic,
    minutes,
    secretary,
    memory,
  });

  return {
    core,
    research,
    semantic,
    minutes,
    secretary,
    memory,
    conductor,
    runtime: activeRuntime,
    listen: server.listen,
    async close() {
      conductor.stop();
      await memory.close();
      await memoryRunner.close();
      await minutes.close();
      await server.close();
      await conductor.idle();
      await activeRuntime.close();
      await semantic.close();
      core.close();
    },
  };
}
