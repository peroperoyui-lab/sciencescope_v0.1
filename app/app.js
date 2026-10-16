// Assembles the whole host: core, runtime, tools, conductor and the HTTP
// server. `main.js` starts it for real; tests start it with a fixture model.
import { createCore } from './core/index.js';
import { createPiRuntime } from './runtime/pi/runtime.js';
import { createModelCatalog } from './runtime/pi/catalog.js';
import { createAppServer } from './server/server.js';
import { createConductor } from './services/conductor.js';
import { createMinutesService } from './services/secretary/minutes.js';
import { createSecretaryChat } from './services/secretary/chat.js';
import { createBackgroundRunner } from './services/secretary/background.js';
import { projectBrief } from './services/secretary/project-brief.js';
import { createMemoryService } from './services/memory/index.js';
import { createProviderService } from './services/providers.js';
import { createTools } from './services/tools.js';
import { createAssistant } from './services/assistant/index.js';
import { createContextAssembly } from './services/context-assembly.js';
import { createTurnRunner } from './services/turn-runner.js';
import { createResearch } from './services/research/index.js';
import { createResearchInput } from './services/research-input/index.js';
import { createSemantic } from './services/research/semantic/index.js';
import { createPython } from './services/python/index.js';
import { createVersions } from './services/versions/index.js';
import { createVersionOrganizer } from './services/versions/organizer.js';

/**
 * @param {{ dataRoot: string, token: string,
 *   runtime?: import('./runtime/port.js').Runtime, runtimeName?: string,
 *   pythonOptions?:Parameters<typeof createPython>[1],
 *   startup?: {mark:(name:string)=>void,finish:(page?:any)=>Promise<void>}, onShutdown?: () => void }} options
 *   `runtime` supplies a scripted model in tests.
 */
export async function createApp({
  dataRoot,
  token,
  runtime,
  runtimeName = 'pi',
  pythonOptions,
  onShutdown,
  startup,
}) {
  startup?.mark('createCoreStart');
  const core = await createCore({ dataRoot });
  startup?.mark('createCoreEnd');
  const versions = createVersions(core);
  const semantic = createSemantic(core);
  const research = createResearch(core, { semantic });
  const researchInput = createResearchInput({ core, research });
  startup?.mark('pythonStart');
  const python = createPython(core, pythonOptions);
  startup?.mark('pythonEnd');
  startup?.mark('semanticStart');
  await semantic.start();
  startup?.mark('semanticEnd');
  const settings = async () =>
    (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
  const catalog = createModelCatalog({
    paths: core.paths,
    providers: async () => (await settings()).providers,
  });

  const activeRuntime =
    runtime ??
    createPiRuntime({
      home: core.paths.runtime,
      logs: core.paths.logs,
      catalog,
    });
  const providers = createProviderService({ core, catalog, runtime: activeRuntime });
  const minutes = createMinutesService({
    core,
    runtime: activeRuntime,
    defaultModel: async () => (await settings()).models.default,
    modelCatalog: catalog,
  });
  const secretary = createSecretaryChat({ core, minutes, modelCatalog: catalog });
  const tools = createTools(core, research, { secretary, python, versions });
  const versionNotes = createVersionOrganizer({
    core,
    versions,
    runtime: activeRuntime,
    tools,
    modelCatalog: catalog,
    defaultModel: async () => (await settings()).models.default,
  });
  const memoryRunner = createBackgroundRunner({
    core,
    runtime: activeRuntime,
    defaultModel: async () => (await settings()).models.default,
    modelCatalog: catalog,
  });
  const memory = createMemoryService({ core, minutes, research, runner: memoryRunner });
  const assistant = createAssistant({ core });
  const contextAssembly = createContextAssembly({
    core,
    python,
    defaultModel: async () => (await settings()).models.default,
    minutesCoverage: async (meetingId, revisionId) => minutes.coverage(meetingId, revisionId),
    minutesCoveredMessageIds: (meetingId, revisionId) =>
      minutes.coveredMessageIds(meetingId, revisionId),
    followup: (meetingId, options) => secretary.catchUp(meetingId, options),
    assistantOverview: (meetingId, rebuilding) => assistant.packet(meetingId, rebuilding),
    projectBrief: async (projectId) => projectBrief(core, projectId, research.store).text,
  });
  const runner = createTurnRunner({
    core,
    runtime: activeRuntime,
    runtimeName,
    contextAssembly,
    tools,
  });
  const conductor = createConductor({ core, runner });
  conductor.start();
  minutes.start();
  memory.start();
  versionNotes.start();
  const server = createAppServer({
    core,
    versions,
    versionNotes,
    python,
    token,
    conductor,
    onShutdown,
    research,
    researchInput,
    semantic,
    minutes,
    secretary,
    assistant,
    memory,
    startup,
    providers,
  });

  return {
    core,
    versions,
    versionNotes,
    python,
    research,
    researchInput,
    semantic,
    minutes,
    secretary,
    assistant,
    memory,
    conductor,
    runtime: activeRuntime,
    providers,
    catalog,
    listen: server.listen,
    async close() {
      conductor.stop();
      await versionNotes.close();
      await python.close();
      await memory.close();
      await memoryRunner.close();
      await minutes.close();
      await server.close();
      await conductor.idle();
      await activeRuntime.close();
      researchInput.close();
      await semantic.close();
      core.close();
    },
  };
}
