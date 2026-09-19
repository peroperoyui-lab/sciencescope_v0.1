export const PROTOCOLS = [
  { id: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
];

const PROTOCOL_IDS = new Set(PROTOCOLS.map((p) => p.id));

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseModels(raw) {
  let parts = null;
  if (typeof raw === "string") {
    parts = raw.split(/\r?\n/);
  } else if (Array.isArray(raw)) {
    parts = raw.slice();
  } else {
    return { ok: false };
  }
  const seen = new Set();
  const models = [];
  for (const item of parts) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      models.push(t);
    }
  }
  if (models.length === 0) return { ok: false };
  return { ok: true, models };
}

function validateBaseUrl(raw) {
  if (typeof raw !== "string") return { ok: false, message: "请填写接口地址。" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "请填写接口地址。" };
  let u = null;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, message: "接口地址无效，仅支持 http/https。" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, message: "接口地址仅支持 http/https。" };
  }
  if (u.username || u.password) {
    return { ok: false, message: "接口地址不得包含用户名或密码。" };
  }
  if (u.search && u.search !== "") {
    return { ok: false, message: "接口地址不得包含查询参数。" };
  }
  if (u.hash && u.hash !== "") {
    return { ok: false, message: "接口地址不得包含片段标识。" };
  }
  return { ok: true, baseUrl: trimmed };
}

export function validateProviderDraft(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: { input: "输入无效，请提供服务商草稿对象。" } };
  }
  const errors = {};

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.name = "请填写服务商名称。";

  const base = validateBaseUrl(input.baseUrl);
  if (!base.ok) errors.baseUrl = base.message;

  const protocol = typeof input.protocol === "string" ? input.protocol.trim() : "";
  if (!PROTOCOL_IDS.has(protocol)) errors.protocol = "请选择协议类型。";

  const parsed = parseModels(input.models);
  if (!parsed.ok) errors.models = "请填写至少一个模型 ID。";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, baseUrl: base.baseUrl, protocol, models: parsed.models },
  };
}
