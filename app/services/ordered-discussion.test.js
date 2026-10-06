import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { LOCAL_USER_ID } from '../core/defaults.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTurnRunner } from './turn-runner.js';
import { createTools } from './tools.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

async function withDiscussion(script, work) {
  return withCore('ordered-discussion', async (core) => {
    const runtime = createScriptedRuntime({ script });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const conductor = createConductor({ core, runner });
    const meeting = core.meetings.create({
      title: 'Expert consultation',
      members: [{ participantId: LOCAL_USER_ID }, { participantId: 'agent_main' }],
    });
    await core.participants.updateDefinition('agent_reviewer', { enabled: true });
    const post = (text) =>
      core.messages.post({ meetingId: meeting.id, authorId: LOCAL_USER_ID, text });
    const messages = () => core.messages.since(meeting.id, 0);
    conductor.start();
    try {
      await work({ core, runtime, conductor, runner, meeting, post, messages });
    } finally {
      conductor.stop();
      await conductor.interrupt(meeting.id);
      await conductor.idle();
      await runtime.close();
    }
  });
}

const roundPolicy = {
  mode: 'round',
  order: ['agent_methodologist', 'agent_statistician'],
  reviewer: 'agent_reviewer',
};

test(
  '@ invites enabled roster experts, excludes reviewers and joins the expert to the meeting',
  { timeout: 120000 },
  async () => {
    await withDiscussion(
      async function* ({ instructions }) {
        yield instructions.includes('方法学家') ? 'Methodologist answer' : 'Main answer';
      },
      async ({ core, meeting, conductor, post, messages }) => {
        post('@方法学家 请检查研究设计');
        await conductor.idle();
        assert.equal(messages().at(-1).authorId, 'agent_methodologist');
        assert.equal(
          core.meetings
            .get(meeting.id)
            .members.find((member) => member.participantId === 'agent_methodologist').roleNote,
          '研究设计',
        );
        post('@独立审核人 请回答');
        await conductor.idle();
        assert.equal(messages().at(-1).authorId, 'agent_main');
      },
    );
  },
);

test(
  'ordered experts start in parallel on the same cutoff, display in policy order, then review all terminal answers',
  { timeout: 120000 },
  async () => {
    const bothStarted = deferred();
    const release = deferred();
    const calls = [];
    await withDiscussion(
      async function* ({ instructions, input }) {
        calls.push({ instructions, input });
        if (!instructions.includes('你是本轮审核专家')) {
          if (calls.length === 2) bothStarted.resolve();
          await release.promise;
          if (instructions.includes('你是：方法学家')) {
            yield 'Methodologist independent finding';
            yield { stop: 'max_tokens' };
          } else yield 'Statistician independent finding';
        } else yield 'Reviewer judgement';
      },
      async ({ core, meeting, conductor, post, messages }) => {
        core.meetings.update(meeting.id, { policy: roundPolicy });
        const question = post('One shared question');
        await bothStarted.promise;
        const answers = messages().filter((message) => message.turnId);
        assert.deepEqual(
          answers.map((message) => message.authorId),
          roundPolicy.order,
        );
        assert.equal(calls.length, 2);
        assert.ok(calls.every((call) => call.input.includes('One shared question')));
        assert.ok(calls.every((call) => !call.input.includes('independent finding')));
        assert.ok(answers.every((message) => message.refs.discussion.cutoffSeq === question.seq));
        release.resolve();
        await conductor.idle();
        assert.equal(calls.length, 3);
        assert.match(
          calls[2].input,
          /Methodologist independent finding[\s\S]*Statistician independent finding/u,
        );
        assert.match(calls[2].input, /未完成：max_tokens/u);
        const review = messages().at(-1);
        assert.equal(review.authorId, 'agent_reviewer');
        assert.equal(review.adopted, false);
        assert.equal(review.refs.discussion.kind, 'review');
      },
    );
  },
);

test(
  'reviewer selected in the expert order answers only as reviewer and adopted reviews reach main context',
  { timeout: 120000 },
  async () => {
    await withDiscussion(
      async function* ({ instructions }) {
        yield instructions.includes('你是本轮审核专家')
          ? 'Review statement to adopt'
          : instructions.includes('你是：主专家')
            ? 'Main next step'
            : 'Expert statement';
      },
      async ({ core, runtime, meeting, conductor, post, messages }) => {
        core.meetings.update(meeting.id, {
          policy: { ...roundPolicy, order: [...roundPolicy.order, 'agent_reviewer'] },
        });
        post('Discuss this');
        await conductor.idle();
        assert.equal(
          messages().filter((message) => message.authorId === 'agent_reviewer').length,
          1,
        );
        const review = messages().at(-1);
        core.meetings.update(meeting.id, { policy: { mode: 'direct' } });
        post('Main first follows');
        await conductor.idle();
        const main = [...runtime.sessions.values()].find((session) =>
          session.instructions.includes('你是：主专家'),
        );
        assert.doesNotMatch(main.inputs[0], /Review statement to adopt/u);
        assert.match(main.inputs[0], /Expert statement/u);
        core.messages.update(review.id, { adopted: true });
        post('Main follows after adoption');
        await conductor.idle();
        assert.match(main.inputs[1], /Review statement to adopt/u);
        assert.throws(() => core.messages.update(review.id, { adopted: false }), { status: 409 });
      },
    );
  },
);

test(
  'stop cancels active experts, session startup, pending reviewer and the queued next round',
  { timeout: 120000 },
  async () => {
    const started = deferred();
    const unblockStartup = deferred();
    const startupBlocked = deferred();
    let sends = 0;
    await withDiscussion(
      async function* ({ signal }) {
        sends++;
        yield 'Partial answer';
        started.resolve();
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      },
      async ({ core, runtime, meeting, conductor, post, messages }) => {
        const originalStart = runtime.startSession;
        let starts = 0;
        runtime.startSession = async (options) => {
          starts++;
          if (starts === 2) {
            startupBlocked.resolve();
            await unblockStartup.promise;
          }
          return originalStart(options);
        };
        core.meetings.update(meeting.id, { policy: roundPolicy });
        post('Active round');
        await started.promise;
        await startupBlocked.promise;
        post('Queued round');
        await conductor.interrupt(meeting.id);
        unblockStartup.resolve();
        await conductor.idle();
        assert.equal(sends, 1);
        assert.equal(starts, 2);
        assert.ok(
          messages()
            .filter((message) => message.turnId)
            .every((message) => message.status === 'cancelled'),
        );
        assert.ok(messages().every((message) => message.authorId !== 'agent_reviewer'));
        assert.equal(core.turns.running().length, 0);
      },
    );
  },
);

test(
  'retry and continuation target only the selected expert without re-running the round',
  { timeout: 120000 },
  async () => {
    await withDiscussion(
      async function* ({ instructions }) {
        yield instructions.includes('你是：方法学家')
          ? 'Methodology segment'
          : 'Statistics segment';
        yield { stop: 'max_tokens' };
      },
      async ({ core, meeting, conductor, post, messages }) => {
        core.meetings.update(meeting.id, { policy: { ...roundPolicy, reviewer: null } });
        post('Discuss');
        await conductor.idle();
        const target = messages().find((message) => message.authorId === 'agent_methodologist');
        await conductor.retry(target.id);
        await conductor.continue(messages().at(-1).id);
        const aiMessages = messages().filter((message) => message.turnId);
        assert.deepEqual(
          aiMessages.map((message) => message.authorId),
          [
            'agent_methodologist',
            'agent_statistician',
            'agent_methodologist',
            'agent_methodologist',
          ],
        );
        assert.equal(messages().filter((message) => message.authorId === LOCAL_USER_ID).length, 1);
      },
    );
  },
);

test(
  'future queued user messages stay out of earlier direct and expert snapshots and are delivered next',
  { timeout: 120000 },
  async () => {
    const firstStarted = deferred();
    const release = deferred();
    const inputs = [];
    await withDiscussion(
      async function* ({ input }) {
        inputs.push(input);
        if (inputs.length === 1) {
          firstStarted.resolve();
          await release.promise;
        }
        yield 'Finished answer';
      },
      async ({ conductor, post }) => {
        post('First user question');
        post('Queued user question');
        await firstStarted.promise;
        assert.doesNotMatch(inputs[0], /Queued user question/u);
        release.resolve();
        await conductor.idle();
        assert.equal(inputs.length, 2);
        assert.match(inputs[1], /Queued user question/u);
      },
    );
  },
);

test(
  'the next expert round receives completed peers from its previous round while new peers remain invisible',
  { timeout: 120000 },
  async () => {
    const calls = [];
    await withDiscussion(
      async function* ({ instructions, input }) {
        calls.push({ instructions, input });
        yield instructions.includes('你是：方法学家')
          ? 'Methodologist prior result'
          : 'Statistician prior result';
      },
      async ({ core, meeting, post, conductor }) => {
        core.meetings.update(meeting.id, { policy: { ...roundPolicy, reviewer: null } });
        post('Initial panel question');
        await conductor.idle();
        post('Next panel question');
        await conductor.idle();
        const methodology = calls.filter((call) => call.instructions.includes('你是：方法学家'));
        const statistics = calls.filter((call) => call.instructions.includes('你是：统计审稿人'));
        assert.match(methodology[1].input, /Statistician prior result/u);
        assert.doesNotMatch(methodology[1].input, /Methodologist prior result/u);
        assert.match(statistics[1].input, /Methodologist prior result/u);
        assert.doesNotMatch(statistics[1].input, /Statistician prior result/u);
      },
    );
  },
);

test(
  'failed experts still receive a final reviewer turn and incomplete reviews cannot be adopted',
  { timeout: 120000 },
  async () => {
    await withDiscussion(
      async function* ({ instructions }) {
        if (instructions.includes('你是本轮审核专家')) {
          yield 'Incomplete reviewer judgement';
          yield { stop: 'max_tokens' };
        } else yield { stop: 'failed', error: 'Expert unavailable' };
      },
      async ({ core, meeting, post, conductor, messages }) => {
        core.meetings.update(meeting.id, { policy: roundPolicy });
        post('Question with failures');
        await conductor.idle();
        const review = messages().at(-1);
        assert.equal(review.authorId, 'agent_reviewer');
        assert.equal(review.status, 'max_tokens');
        assert.throws(() => core.messages.update(review.id, { adopted: true }), { status: 409 });
      },
    );
  },
);

test(
  'continuing an unadopted reviewer after losing its session supplies the selected partial answer without publishing it to main',
  { timeout: 120000 },
  async () => {
    const inputs = [];
    await withDiscussion(
      async function* ({ instructions, input }) {
        inputs.push({ instructions, input });
        if (instructions.includes('你是本轮审核专家')) {
          yield 'Reviewer partial text';
          yield { stop: 'max_tokens' };
        } else yield 'Expert terminal answer';
      },
      async ({ core, meeting, conductor, post, messages }) => {
        core.meetings.update(meeting.id, { policy: roundPolicy });
        post('Evaluate the design');
        await conductor.idle();
        const review = messages().at(-1);
        core.turns.dropSession(meeting.id, 'agent_reviewer');
        await conductor.continue(review.id);
        const latest = inputs.at(-1);
        assert.match(latest.input, /请继续完成你上一条未完成的回答：[\s\S]*Reviewer partial text/u);
        assert.equal(messages().at(-1).adopted, false);
        assert.equal(messages().at(-1).refs.discussion.continuedFrom, review.id);
        assert.match(messages().at(-1).text, /Reviewer partial text[\s\S]*Reviewer partial text/u);
      },
    );
  },
);

test(
  'three early queued panel requests keep all user questions and deliver prior round answers',
  { timeout: 120000 },
  async () => {
    const inputs = [];
    await withDiscussion(
      async function* ({ instructions, input }) {
        inputs.push({ instructions, input });
        const expert = instructions.includes('你是：方法学家') ? 'Methodologist' : 'Statistician';
        const round = input.includes('Third queued question')
          ? 3
          : input.includes('Second queued question')
            ? 2
            : 1;
        yield `${expert} result for round ${round}`;
      },
      async ({ core, meeting, conductor, post }) => {
        core.meetings.update(meeting.id, { policy: { ...roundPolicy, reviewer: null } });
        post('First queued question');
        post('Second queued question');
        const third = post('Third queued question');
        await conductor.idle();
        const methodology = inputs.filter((entry) => entry.instructions.includes('你是：方法学家'));
        assert.equal(methodology.length, 3);
        assert.doesNotMatch(methodology[0].input, /Second queued question|Third queued question/u);
        assert.match(methodology[1].input, /Second queued question/u);
        assert.match(methodology[1].input, /Statistician result for round 1/u);
        assert.doesNotMatch(methodology[1].input, /Third queued question/u);
        assert.match(methodology[2].input, /Third queued question/u);
        assert.match(methodology[2].input, /Statistician result for round 2/u);
        assert.doesNotMatch(methodology[2].input, /Statistician result for round 1/u);
        assert.equal(core.turns.session(meeting.id, 'agent_methodologist').lastSeq, third.seq);
      },
    );
  },
);

test(
  'a completed reviewer continuation publishes its full accumulated answer only after adoption',
  { timeout: 120000 },
  async () => {
    let reviews = 0;
    const mainInputs = [];
    await withDiscussion(
      async function* ({ instructions, input }) {
        if (instructions.includes('你是本轮审核专家')) {
          reviews++;
          if (reviews === 1) {
            yield 'Distinct reviewer opening judgement';
            yield { stop: 'max_tokens' };
          } else yield 'Distinct reviewer final recommendation';
        } else if (instructions.includes('你是：主专家')) {
          mainInputs.push(input);
          yield 'Main follows';
        } else yield 'Expert answer';
      },
      async ({ core, meeting, post, conductor, messages }) => {
        core.meetings.update(meeting.id, { policy: roundPolicy });
        post('Panel question');
        await conductor.idle();
        const partial = messages().at(-1);
        await conductor.continue(partial.id);
        const completed = messages().at(-1);
        assert.equal(completed.status, 'done');
        assert.match(
          completed.text,
          /Distinct reviewer opening judgement[\s\S]*Distinct reviewer final recommendation/u,
        );
        core.meetings.update(meeting.id, { policy: { mode: 'direct' } });
        post('Continue without adoption');
        await conductor.idle();
        assert.doesNotMatch(mainInputs[0], /Distinct reviewer/u);
        core.messages.update(completed.id, { adopted: true });
        post('Continue after adoption');
        await conductor.idle();
        assert.equal(mainInputs[1].match(/Distinct reviewer opening judgement/gu).length, 1);
        assert.equal(mainInputs[1].match(/Distinct reviewer final recommendation/gu).length, 1);
      },
    );
  },
);
