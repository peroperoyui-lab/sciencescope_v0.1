import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const topics = [
  '研究目标是比较三个合成城市在不同阈值下的案例归类。',
  '样本范围确定为甲城、乙城和丙城，时间范围为2020年至2023年。',
  '样本数确定为12个观测值，每个城市每年一个观测值。',
  '一致性阈值的基准值确定为0.80。',
  '案例频数阈值确定为2，请与一致性阈值分开解释。',
  '敏感性分析采用0.75和0.85两个替代阈值。',
  '指标包括合成就业、合成服务和合成交通三个维度。',
  '各维度均使用等权重，不根据当前合成结果事后调整权重。',
  '缺失值先列出原因，再由研究者决定是否剔除，不自动填补。',
  '所有数据和名称均为合成，报告必须保留这一说明。',
  '输出表格需要同时列出阈值、案例数和覆盖度。',
  '结果表优先按城市再按年份排列，保持中文字段名。',
  '解释中区分统计结果与待验证的机制假设。',
  '如结论依赖某个阈值，需在局限部分明确说明。',
  '当前选择先完成指标口径核对，再写解释段落。',
  '引用格式统一采用作者和年份，暂不生成真实参考文献。',
  '下一步由研究者核对甲城2022年的合成编码。',
  '待决定问题是是否另外加入合成公共服务维度。',
  '本轮确认维持三维指标和12个观测值，不增加样本。',
  '请记住基准阈值0.80、频数2、敏感性0.75和0.85这套口径。',
];

/** API is the authenticated installed host client; provider credentials never enter this script. */
export async function runLive(
  api,
  { out, idleMs = 630000, timeoutMs = 240000, drainTimeoutMs = 180000, pollMs = 1500 } = {},
) {
  if (!out) throw new Error('Choose an ignored output report for this run.');
  if (
    await access(out).then(
      () => true,
      () => false,
    )
  )
    throw new Error('This report already exists; do not repeat a paid run.');
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const report = {
    schema: 1,
    startMs: Date.now(),
    phase: 'setup',
    rounds: [],
    windows: [],
    requestsAreCountedByRuntimeLog: true,
  };
  const save = () => writeFile(out, JSON.stringify(report, null, 2) + '\n');
  await save();
  async function window(name, work) {
    const record = { name, startMs: Date.now() };
    report.windows.push(record);
    try {
      return await work();
    } finally {
      record.endMs = Date.now();
      await save();
    }
  }
  try {
    const settings = await api('GET', '/api/settings');
    report.defaults = {
      summary: settings.summary,
      memory: {
        enabled: settings.memory.enabled,
        idleMinutes: settings.memory.idleMinutes,
        tokenLimit: settings.memory.tokenLimit,
      },
      cardsEnabled: settings.knowledge.cards.enabled,
    };
    assert.equal(report.defaults.summary.everyMessages.enabled, true);
    assert.equal(report.defaults.summary.everyMessages.n, 20);
    assert.equal(report.defaults.summary.everyTokens.enabled, true);
    assert.equal(report.defaults.summary.everyTokens.n, 30000);
    assert.equal(report.defaults.memory.enabled, true);
    assert.equal(report.defaults.memory.idleMinutes, 10);
    assert.equal(report.defaults.cardsEnabled, true);
    const project = await api('POST', '/api/projects', {
      name: 'P4a 合成后台用量研究',
      description: '完全合成的研究口径验收，不对应真实资料。',
    });
    const preferences = await api('GET', `/api/version-preferences/${project.id}`);
    report.defaults.versionPreferences = preferences;
    assert.equal(preferences.autoOrganize, true);
    const meeting = await api('POST', '/api/meetings', {
      projectId: project.id,
      title: 'P4a 合成研究口径二十轮',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      policy: { mode: 'direct' },
    });
    report.projectId = project.id;
    report.meetingId = meeting.id;
    await api('POST', `/api/projects/${project.id}/focus`, { focused: true });
    await save();
    for (let index = 0; index < topics.length; index++) {
      report.phase = 'round';
      const round = { number: index + 1, attemptedAt: Date.now(), topicHash: hash(topics[index]) };
      report.rounds.push(round);
      await save();
      await window(`round-${index + 1}`, async () => {
        const submitted = await api('POST', `/api/meetings/${meeting.id}/messages`, {
          text: `这是完全合成的研究项目。第${index + 1}轮：${topics[index]} 请只用一句话确认并指出一项需要核对的口径，不调用工具，不修改文件或设置。`,
          refs: { p4aRound: index + 1 },
        });
        round.userMessageId = submitted.queued ? null : (submitted.message ?? submitted).id;
        await save();
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
          const page = await api('GET', `/api/meetings/${meeting.id}/messages?limit=60`);
          round.userMessageId ??= page.messages.find(
            (entry) => entry.authorId === 'person_user' && entry.refs?.p4aRound === index + 1,
          )?.id;
          const answer = page.messages.find(
            (entry) =>
              entry.authorId === 'agent_main' &&
              entry.replyTo === round.userMessageId &&
              entry.status !== 'streaming',
          );
          if (answer) {
            round.answerId = answer.id;
            round.turnId = answer.turnId;
            round.status = answer.status;
            round.finishedAt = Date.now();
            round.answerHash = hash(answer.text);
            await save();
            if (answer.status !== 'done')
              throw new Error('A paid answer did not complete; no automatic scenario retry.');
            return;
          }
          await sleep(1500);
        }
        throw new Error('A paid answer timed out; inspect its recorded attempt before continuing.');
      });
      if (index === 2) {
        await window('normal-material-and-version-imports', async () => {
          const paper =
            '# 合成城市阈值研究\n\n本文全部名称与观测均为合成，仅用于后台整理验收。\n\n研究问题是阈值变化如何影响合成案例归类。采用三城市2020年至2023年的12个合成观测值，基准一致性阈值为0.80，案例频数阈值为2。\n\n方法为比较0.75、0.80和0.85三种口径。合成结果仅说明较高阈值减少满足规则的案例，不构成真实经验发现。\n';
          const source = await api('POST', '/api/research/sources', {
            projectId: project.id,
            kind: 'paper',
            name: '合成阈值研究.md',
            title: '合成阈值研究：后台验收材料',
            base64: Buffer.from(paper).toString('base64'),
          });
          report.sourceId = source.id;
          const imported = await api('POST', '/api/versions/import', {
            projectId: project.id,
            groupName: '合成方法稿',
            files: [
              {
                name: '合成方法初稿.md',
                base64: Buffer.from(
                  '# 合成方法稿\n\n研究样本为12个合成观测值，基准阈值为0.75。\n',
                ).toString('base64'),
              },
              {
                name: '合成方法修订.md',
                base64: Buffer.from(
                  '# 合成方法稿\n\n研究样本为12个合成观测值，基准阈值改为0.80，补充0.75和0.85敏感性检验。\n',
                ).toString('base64'),
              },
            ],
          });
          report.groupId = imported.group.id;
          report.versionIds = imported.versions.map((version) => version.id);
        });
      }
    }
    report.phase = 'default-idle';
    report.idleStartMs = Date.now();
    report.memoryWait = { minimumIdleMs: idleMs, drainTimeoutMs, observations: [] };
    async function observeMemory() {
      const value = await api('GET', `/api/meetings/${meeting.id}/memory/status`);
      report.memory = {
        state: value.state,
        skipReason: value.skipReason,
        requiredTokens: value.requiredTokens,
        tokenLimit: value.tokenLimit,
        usage: value.usage,
        proposed: value.proposalIds?.length ?? 0,
      };
      const minutes = await api('GET', `/api/meetings/${meeting.id}/minutes`);
      report.memoryWait.observations.push({
        at: Date.now(),
        state: value.state,
        minutesUpdating: minutes.updating,
        minutesRevision: minutes.revision ?? null,
        minutesThroughSeq: minutes.throughSeq,
      });
      await save();
    }
    await save();
    await window('default-memory-idle', async () => {
      while (Date.now() - report.idleStartMs < idleMs) {
        await sleep(Math.min(30000, idleMs - (Date.now() - report.idleStartMs)));
        await observeMemory();
      }
    });
    report.phase = 'natural-drain';
    await window('natural-memory-drain', async () => {
      const deadline = Date.now() + drainTimeoutMs;
      await observeMemory();
      while (!['completed', 'failed', 'skipped'].includes(report.memory.state)) {
        if (Date.now() >= deadline) {
          report.memoryWait.timedOut = true;
          break;
        }
        await sleep(Math.min(pollMs, deadline - Date.now()));
        await observeMemory();
      }
      report.drainEndMs = Date.now();
    });
    report.minutes = await api('GET', `/api/meetings/${meeting.id}/minutes`).then((value) => ({
      throughSeq: value.throughSeq,
      latestSeq: value.latestSeq,
      newMessages: value.newMessages,
      updating: value.updating,
    }));
    report.versions = (await api('GET', `/api/versions?projectId=${project.id}`)).flatMap((group) =>
      group.versions.map((version) => ({ id: version.id, notesStatus: version.notesStatus })),
    );
    const jobs = await api('GET', '/api/knowledge/jobs');
    report.knowledge = { counts: jobs.counts, cards: { counts: jobs.cards?.counts } };
    report.completedFeatures = {
      answers:
        report.rounds.length === 20 && report.rounds.every((round) => round.status === 'done'),
      minutes:
        report.minutes.throughSeq > 0 &&
        report.minutes.newMessages === 0 &&
        !report.minutes.updating,
      memory: report.memory?.state === 'completed',
      versionnotes:
        report.versions.length === 2 &&
        report.versions.every((version) => version.notesStatus === 'completed'),
      knowledge: (jobs.cards?.counts?.done ?? jobs.cards?.done ?? 0) > 0,
    };
    report.ok = Object.values(report.completedFeatures).every(Boolean);
    report.phase = 'finished';
  } catch {
    report.ok = false;
    report.error =
      'Scenario stopped; retained attempts must be reviewed before any further paid run.';
    throw new Error(report.error);
  } finally {
    report.endMs = Date.now();
    await save();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => {
      if (index % 2 === 0) pairs.push([value.replace(/^--/u, ''), all[index + 1]]);
      return pairs;
    }, []),
  );
  if (!args.endpoint || !args['token-file'] || !args.out) {
    process.stderr.write(
      'Usage: node tools/perf/live.mjs --endpoint http://127.0.0.1:PORT --token-file <local-token-file> --out live.json\n',
    );
    process.exitCode = 1;
  } else {
    const endpoint = new URL(args.endpoint);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
      throw new Error('Choose the local test host.');
    const token = (await readFile(args['token-file'], 'utf8')).trim();
    const api = async (method, route, body) => {
      const response = await fetch(new URL(route, endpoint), {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`Local test API returned HTTP ${response.status}.`);
      return response.json();
    };
    await runLive(api, { out: args.out });
  }
}
