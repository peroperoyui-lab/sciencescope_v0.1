# DeepSeek Harness runtime adapter

Import `./host.mjs` and call `createDshHost({ home, cwd })`. The host exposes
`startSession({ model: { providerId, modelId }, workspace? })`,
`send({ sessionId, text, onEvent })`, and `close()`.

The adapter targets the published `@deepseek-ai/dsh-sdk-client@0.1.6-alpha.1`
package. The package must be installed in the desktop host's Node module
environment; this adapter does not vendor or silently install it.
The SDK resolves its same-version `@deepseek-ai/dsh` executable when `dshBin`
is omitted; callers may provide `dshBin` to select an explicit executable.

The SDK's stdio protocol does not expose provider chunks directly. This adapter
adds a per-launch, loopback-only presentation bridge: an adapter-owned DSH
plugin subscribes to the public `agent/assistant-stream` Cordis event and sends
validated `text-delta` frames to an ephemeral host receiver authenticated by a
random per-session token. The host relays those frames before `completed` and
waits for an ordered run-idle delivery barrier (bounded timeout). Failed attempts
replace only their transient text; committed text is not appended a second time. Durable
`session.event` messages remain available as committed history; no final text
is split after the fact and no provider HTTP is used. `tokenStreaming` and
`committedTextStreaming` are true. The SDK has no provider save/discover
methods, so those capabilities remain false on the SDK host alone.

`web-host.mjs` and `provider-service.mjs` compose the public web-profile Remote
settings/credentials/discovery services without changing inference transport.

`research-context.mjs` applies supported instruction-discovery configuration:
the research working directory is its own instruction root, with a separate
instruction home and an explicit Main research persona. This prevents automatic
developer-repository prompt injection; it is **not a filesystem sandbox** or a
claim that tools cannot explicitly read other paths.

`node scripts/dsh-stream-smoke.mjs` runs the installed SDK against a delayed local
SSE fixture. It checks first text arrives before the second fixture chunk is sent,
no duplicate final text, two independent sessions, and the actual model input's
workspace/ancestor instruction boundary. No commercial provider is called.
