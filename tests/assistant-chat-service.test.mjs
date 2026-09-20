import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ChatStore } from "../scripts/chat-store.mjs";
import { createAssistantConversations } from "../scripts/assistant-conversations.mjs";
import { AssistantChatError, createAssistantChatService } from "../scripts/assistant-chat-service.mjs";

const model = { providerId: "fake", modelId: "assistant" };

class FakeHost {
  constructor() {
    this.sessions = new Map();
    this.starts = [];
    this.sends = [];
    this.interrupts = [];
    this.policies = [];
    this.models = [];
    this.failModel = false;
  }
  async startSession(input) {
    const sessionId = input.sessionId || `session-${this.starts.length + 1}`;
    this.sessions.set(sessionId, { ...input, sessionId });
    this.starts.push({ ...input, sessionId });
    return sessionId;
  }
  async getRuntimeConfig() { return {}; }
  async configurePolicy(input) { this.policies.push(input); }
  async configureReasoning() {}
  async configureModel(input) { if (this.failModel) throw new Error("invalid model"); this.models.push(input); }
  async releaseSession(sessionId) { this.sessions.delete(sessionId); }
  async send({ sessionId, text, onEvent }) {
    this.sends.push({ sessionId, text });
    const session = this.sessions.get(sessionId);
    if (session?.persona.includes("global") && text.includes("stop me")) {
      await new Promise((resolve) => { session.release = resolve; });
    }
    onEvent({ type: "text-delta", delta: `answer from ${sessionId}` });
  }
  async interrupt(sessionId) {
    this.interrupts.push(sessionId);
    this.sessions.get(sessionId)?.release?.();
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(path.resolve(".sciencescope-local/temp"), "assistant-service-"));
  const chatStore = await new ChatStore({ stateDir: root }).init();
  await chatStore.ensureChat({ chatId: "main-a", projectId: "project-a", title: "Main A" });
  await chatStore.ensureChat({ chatId: "main-b", projectId: "project-b", title: "Main B" });
  const conversations = createAssistantConversations({ chatStore });
  const host = new FakeHost();
  const service = createAssistantChatService({ host, conversations, chatStore, dataRoot: root });
  return { root, chatStore, conversations, host, service };
}

async function closeFixture(f) {
  f?.chatStore.close();
  if (f?.root) await rm(f.root, { recursive: true, force: true });
}

test("isolates global and per-main secretary sessions, workspaces, and messages", async () => {
  const f = await fixture();
  try {
    await Promise.all([
      f.service.send({ scope: "global", ownerId: "global", model, text: "global question", userMessageId: "global-u" }, { accept() {}, emit() {} }),
      f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "secretary A", userMessageId: "a-u" }, { accept() {}, emit() {} }),
      f.service.send({ scope: "secretary", ownerId: "main-b", model, text: "secretary B", userMessageId: "b-u" }, { accept() {}, emit() {} }),
    ]);
    assert.equal(f.host.starts.length, 3);
    assert.equal(new Set(f.host.starts.map((s) => s.sessionId)).size, 3);
    assert.ok(f.host.starts.every((s) => s.noTools !== true));
    assert.equal(new Set(f.host.starts.map((s) => s.workspace)).size, 3);
    assert.equal(f.chatStore.pageMessages("main-a").then ? (await f.chatStore.pageMessages("main-a")).total : -1, 0);
    assert.equal((await f.chatStore.pageMessages("main-b")).total, 0);
    for (const id of f.conversations.listPrivateChatIds()) assert.ok(id.startsWith("aux-"));
  } finally { await closeFixture(f); }
});

test("assistant ask and full modes apply distinct policies", async () => {
  const f=await fixture();
  try { await f.service.send({scope:"global",ownerId:"global",model,text:"ask",executionMode:"ask"},{accept(){},emit(){}}); await f.service.send({scope:"secretary",ownerId:"main-a",model,text:"full",executionMode:"full"},{accept(){},emit(){}}); assert.deepEqual(f.host.policies.map(p=>p.approvalPolicy),["ask","never"]); assert.deepEqual(f.host.policies.map(p=>p.sandboxMode),["workspace-write","danger-full-access"]); } finally { await closeFixture(f); }
});

test("assistant rejects auto execution mode", async () => { const f=await fixture(); try { await assert.rejects(f.service.send({scope:"global",ownerId:"global",model,text:"auto",executionMode:"auto"},{accept(){},emit(){}}),e=>e.code==="INVALID_EXECUTION_MODE"); assert.equal(f.host.starts.length,0); } finally { await closeFixture(f); } });

test("model switch preserves the existing session and history", async () => { const f=await fixture(); const next={providerId:"fake",modelId:"new"}; try { await f.service.send({scope:"global",ownerId:"global",model,text:"first",userMessageId:"first"},{accept(){},emit(){}}); const chat=f.conversations.get("global","global"); const old=f.host.starts[0].sessionId; await f.service.changeModel("global","global",next,"high"); assert.equal(f.host.starts.length,1); assert.equal(f.host.models[0].sessionId,old); assert.deepEqual(f.conversations.getSettings("global","global"),{model:next,reasoningEffort:"high",executionMode:"ask"}); assert.equal((await f.chatStore.pageMessages(chat.chatId)).total,2); } finally { await closeFixture(f); } });

test("failed model switch leaves saved model unchanged", async () => { const f=await fixture(); try { await f.service.send({scope:"global",ownerId:"global",model,text:"first",userMessageId:"first"},{accept(){},emit(){}}); f.host.failModel=true; await assert.rejects(f.service.changeModel("global","global",{providerId:"fake",modelId:"bad"},"low")); assert.deepEqual(f.conversations.getSettings("global","global").model,model); } finally { await closeFixture(f); } });

test("explicit model selection creates an empty assistant conversation without a runtime", async () => { const f=await fixture(); const selected={providerId:"fake",modelId:"selected"}; try { const settings=await f.service.changeModel("global","global",selected,"low"); assert.deepEqual(settings,{model:selected,reasoningEffort:"low",executionMode:"ask"}); assert.equal(f.host.starts.length,0); assert.equal((await f.chatStore.pageMessages(f.conversations.get("global","global").chatId)).total,0); } finally { await closeFixture(f); } });

test("only explicit main context is excerpted, excluding system/tool/private material", async () => {
  const f = await fixture();
  try {
    await f.chatStore.appendMessage({ chatId: "main-a", id: "main-user", role: "user", text: "main user material" });
    await f.chatStore.appendMessage({ chatId: "main-a", id: "main-assistant", role: "assistant", text: "main assistant material" });
    await f.chatStore.appendMessage({ chatId: "main-a", id: "main-system", role: "system", text: "do not include system material" });
    const privateChat = await f.conversations.ensure("global", "global", model);
    await f.chatStore.appendMessage({ chatId: privateChat.id, id: "private", role: "user", text: "private material" });
    await f.service.send({ scope: "secretary", ownerId: "main-a", contextChatId: "main-a", model, text: "summarize", userMessageId: "context-u" }, { accept() {}, emit() {} });
    const sent = f.host.sends.at(-1).text;
    assert.match(sent, /main user material/);
    assert.match(sent, /main assistant material/);
    assert.doesNotMatch(sent, /system material|private material|tool material/);
  } finally { await closeFixture(f); }
});

test("same owner is busy while global and another secretary can run", async () => {
  const f = await fixture();
  try {
    const first = f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "one", userMessageId: "busy-1" }, { accept() {}, emit() {} });
    await assert.rejects(
      f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "two", userMessageId: "busy-2" }, { accept() {}, emit() {} }),
      (e) => e instanceof AssistantChatError && e.code === "ASSISTANT_BUSY" && e.status === 409,
    );
    await Promise.all([first, f.service.send({ scope: "global", ownerId: "global", model, text: "global", userMessageId: "busy-g" }, { accept() {}, emit() {} })]);
  } finally { await closeFixture(f); }
});

test("binding and model survive reopen, while stopping global leaves secretary unaffected", async () => {
  const f = await fixture();
  try {
    const globalRun = f.service.send({ scope: "global", ownerId: "global", model, text: "stop me", userMessageId: "stop-u" }, { accept() {}, emit() {} });
    const secretaryRun = f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "continue", userMessageId: "continue-u" }, { accept() {}, emit() {} });
    while (!f.host.starts.some((s) => s.persona.includes("global"))) await new Promise((resolve) => setTimeout(resolve, 5));
    await f.service.stop("global", "global");
    await globalRun;
    await secretaryRun;
    assert.equal(f.host.interrupts.length, 1);
    const secretary = f.conversations.get("secretary", "main-a");
    const oldBinding = f.chatStore.getBinding(secretary.id);
    const oldModel = secretary.model;
    f.chatStore.close();
    f.chatStore = await new ChatStore({ stateDir: f.root }).init();
    f.conversations = createAssistantConversations({ chatStore: f.chatStore });
    f.service = createAssistantChatService({ host: f.host, conversations: f.conversations, chatStore: f.chatStore, dataRoot: f.root });
    const reopened = f.conversations.get("secretary", "main-a");
    assert.deepEqual(reopened.model, oldModel);
    assert.equal(f.chatStore.getBinding(reopened.id), oldBinding);
    assert.equal(reopened.projectId, "project-a");
  } finally { await closeFixture(f); }
});

test("duplicate user message id does not send to the model twice", async () => {
  const f = await fixture();
  try {
    await f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "once", userMessageId: "same-u" }, { accept() {}, emit() {} });
    await assert.rejects(
      f.service.send({ scope: "secretary", ownerId: "main-a", model, text: "again", userMessageId: "same-u" }, { accept() {}, emit() {} }),
      (e) => e instanceof AssistantChatError && e.code === "DUPLICATE_MESSAGE" && e.status === 409,
    );
    assert.equal(f.host.sends.length, 1);
  } finally { await closeFixture(f); }
});
