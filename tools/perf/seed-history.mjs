// Public core/service calls construct historical links without a runtime or
// background secretary. Tool records contain an actual local search result.
import { chartImage, documentBytes, syntheticParagraph } from './seed-documents.mjs';

/**
 * @param {{core:any,research:any,inputs:any,manifest:any,save:()=>Promise<void>,tiny:boolean}} options
 * @returns {Promise<void>}
 */
export async function seedMeetings({ core, research, inputs, manifest, save, tiny }) {
  const counts = tiny ? [12, 12] : [180, ...Array(10).fill(75), 70];
  const firstSource = manifest.files.find((file) => file.sourceId);
  for (const [index, count] of counts.entries()) {
    const title = `合成研究讨论 ${index + 1} · ${manifest.seedTag}`;
    const meeting =
      core.meetings
        .list({ projectId: manifest.projectId })
        .find((entry) => entry.title === title) ??
      core.meetings.create({
        projectId: manifest.projectId,
        title,
        policy: { mode: 'direct' },
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
    let messages = core.messages.since(meeting.id, 0);
    if (messages.some((message) => message.refs.perfSeed !== manifest.seed))
      throw new Error('Synthetic meeting contains unowned messages; refusing to append');
    for (let number = messages.length; number < count; number++) {
      const previous = messages.at(-1);
      const isPerson = number % 2 === 0;
      let researchInput;
      if (number === 0) {
        inputs.change(meeting.id, {
          op: 'add',
          material: { type: 'source', id: firstSource.sourceId },
        });
        if (!inputs.draft(meeting.id).materials.some((entry) => entry.type === 'image'))
          await inputs.attach(meeting.id, {
            name: 'synthetic-service-coverage.png',
            base64: chartImage().toString('base64'),
            projectId: manifest.projectId,
          });
        researchInput = inputs.capture(inputs.draft(meeting.id));
      }
      let turn;
      if (!isPerson) {
        turn =
          core.turns
            .running()
            .find(
              (entry) => entry.meetingId === meeting.id && entry.triggerMessageId === previous.id,
            ) ??
          core.turns.start({
            meetingId: meeting.id,
            participantId: 'agent_main',
            triggerMessageId: previous.id,
          });
        if (number === 1) {
          const callId = `perf-search-${index}`;
          core.turns.startToolCall({
            turnId: turn.id,
            callId,
            name: 'research_search',
            args: { query: manifest.searchTerm, projectId: manifest.projectId, limit: 3 },
            preamble: '合成历史夹具：执行一次本地资料检索，不调用模型。',
          });
          const result = await research.search(manifest.searchTerm, {
            projectId: manifest.projectId,
            limit: 3,
          });
          core.turns.endToolCall(turn.id, callId, { result, isError: false });
        }
      }
      const text =
        `${isPerson ? '研究问题' : '合成讨论记录'} ${index + 1}-${number + 1}：` +
        syntheticParagraph(manifest.seed, index + 1, number + 1) +
        (number === count - 1 ? '本次合成讨论到这里结束，下一步核对阈值与证据。' : '');
      const message = core.messages.post({
        meetingId: meeting.id,
        authorId: isPerson ? 'person_user' : 'agent_main',
        text,
        turnId: turn?.id,
        replyTo: previous?.id,
        refs: { perfSeed: manifest.seed, synthetic: true },
        researchInput,
      });
      if (researchInput) inputs.change(meeting.id, { op: 'consume', input: researchInput });
      if (turn)
        core.turns.end(turn.id, { status: 'done', stopReason: 'synthetic-history', usage: null });
      messages.push(message);
    }
    if (messages[0]?.researchInput)
      inputs.change(meeting.id, { op: 'consume', input: messages[0].researchInput });
    manifest.meetings[index] = {
      id: meeting.id,
      title,
      messages: messages.length,
      firstMessageId: messages[0].id,
      lastMessageId: messages.at(-1).id,
    };
    if (index === 0)
      Object.assign(manifest, {
        longestMeetingId: meeting.id,
        lastMessageId: messages.at(-1).id,
        lastMessageText: messages.at(-1).text,
        earlyMessageId: messages[0].id,
      });
    await save();
  }
}

/**
 * @param {{desk:any,versions:any,manifest:any,save:()=>Promise<void>,tiny:boolean}} options
 * @returns {Promise<void>}
 */
export async function seedVersions({ desk, versions, manifest, save, tiny }) {
  const group = await desk.registerDocument({ projectId: manifest.projectId, path: manifest.docx });
  const listed = versions.list(manifest.projectId).find((entry) => entry.id === group.id);
  const first = listed.versions.find((entry) => entry.parentId === null);
  let second = listed.versions.find((entry) => entry.title === 'P4a 修订：阈值与表格');
  if (!second) {
    const fixture = await documentBytes({
      seed: manifest.seed,
      number: manifest.thesisNumber,
      format: 'docx',
      sections: 17,
      thesis: true,
      revision: true,
      chineseTarget: tiny ? 2500 : 50000,
    });
    second = await versions.createVersion(
      {
        groupId: group.id,
        parentId: first.id,
        name: manifest.docx.split('/').at(-1),
        bytes: fixture.bytes,
        origin: 'desk',
        title: 'P4a 修订：阈值与表格',
      },
      { actorId: 'person_user' },
    );
  }
  await versions.diffIdle();
  const compared = await versions.compare(second.id, first.id);
  if (compared.status !== 'ready') throw new Error('Synthetic manuscript revisions must differ');
  Object.assign(manifest, {
    versionGroupId: group.id,
    compareVersionIds: [first.id, second.id],
    comparison: {
      status: compared.status,
      changedParts: compared.changes.filter((part) => part.type !== 'unchanged').length,
    },
  });
  await save();
}
