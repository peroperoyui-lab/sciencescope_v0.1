import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ChatStore } from "../scripts/chat-store.mjs";
import {
  AssistantConversationError,
  createAssistantConversations,
} from "../scripts/assistant-conversations.mjs";

const stateDir = path.resolve(".sciencescope-local/temp/assistant-conversations-test");
let chats;

test.beforeEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
  await mkdir(stateDir, { recursive: true });
  chats = await new ChatStore({ stateDir }).init();
});
test.afterEach(() => chats?.close());

test("creates one global and one secretary relationship without polluting main chats", async () => {
  await chats.ensureChat({ chatId: "main-1", projectId: "project-a", title: "Main" });
  const assistants = createAssistantConversations({ chatStore: chats });
  const model = { providerId: "local", modelId: "research" };
  const [global, secretary] = await Promise.all([
    assistants.ensure("global", "global", model),
    assistants.ensure("secretary", "main-1", model),
  ]);
  assert.equal(global.chat.projectId, null);
  assert.equal(secretary.chat.projectId, "project-a");
  assert.equal(assistants.listPrivateChatIds().length, 2);
  assert.equal(chats.listChats().filter((c) => c.id === "main-1").length, 1);
  assert.equal(assistants.isAssistant("main-1"), false);
});

test("same-process concurrent ensure is idempotent and persists drafts", async () => {
  await chats.ensureChat({ chatId: "main-2", projectId: "p2", title: "Main" });
  const assistants = createAssistantConversations({ chatStore: chats });
  const values = await Promise.all(Array.from({ length: 12 }, () => assistants.ensure("secretary", "main-2", { providerId: "p", modelId: "m" })));
  assert.equal(new Set(values.map((v) => v.chatId)).size, 1);
  await assistants.saveDraft("secretary", "main-2", "draft text");
  assert.equal(assistants.getDraft("secretary", "main-2"), "draft text");
  chats.close();
  chats = await new ChatStore({ stateDir }).init();
  const reopened = createAssistantConversations({ chatStore: chats });
  assert.equal(reopened.get("secretary", "main-2").chatId, values[0].chatId);
  assert.equal(reopened.getDraft("secretary", "main-2"), "draft text");
  assert.equal(chats.pageMessages(values[0].chatId).then ? (await chats.pageMessages(values[0].chatId)).total : -1, 0);
});

test("rejects model changes once messages or runtime binding exist", async () => {
  await chats.ensureChat({ chatId: "main-3", projectId: "p3", title: "Main" });
  const assistants = createAssistantConversations({ chatStore: chats });
  const conversation = await assistants.ensure("secretary", "main-3", { providerId: "p", modelId: "one" });
  await chats.appendMessage({ chatId: conversation.chatId, role: "user", text: "hello" });
  await assert.rejects(
    assistants.ensure("secretary", "main-3", { providerId: "p", modelId: "two" }),
    (error) => error instanceof AssistantConversationError && error.code === "ASSISTANT_MODEL_CHANGE_FORBIDDEN",
  );
});

test("main chats cannot be owners of assistant conversations", async () => {
  await chats.ensureChat({ chatId: "main-4", title: "Main" });
  const assistants = createAssistantConversations({ chatStore: chats });
  await assistants.ensure("global", "global");
  await assert.rejects(
    assistants.ensure("secretary", "aux-not-created"),
    (error) => error instanceof AssistantConversationError && error.code === "ASSISTANT_OWNER_NOT_FOUND",
  );
});
