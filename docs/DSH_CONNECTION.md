# DeepSeek Harness connection

ScienceScope's bounded DSH entry point is
`adapters/runtime-dsh/host.mjs` (`createDshHost`). It owns the SDK child
process and exposes session start, prompt send, and shutdown to the desktop
host. It does not make provider HTTP requests or store credentials.

## Supported surface

The adapter uses the published
`@deepseek-ai/dsh-sdk-client@0.1.6-alpha.1` package. Its supported protocol is
`initialize`, `session/prompt`, and `shutdown`, with durable `session.event`
and status notifications. Install the package in the desktop host's local
Node environment. The SDK resolves its same-version `@deepseek-ai/dsh`
executable when `dshBin` is omitted; callers may provide `dshBin` explicitly.
`home` is passed through the SDK's `dshHome` launch option.

`text-delta` adapter events are emitted once from the SDK's stable
`RunResult.finalResponse`. They represent committed assistant message text,
not live provider token streaming, and are marked `committed: true`. The
adapter does not heuristically parse `session.event` notifications (which may
include descendants), so the capability report sets `tokenStreaming: false`.

Provider save/discovery is unsupported by this SDK release. The SDK adapter
reports `providerSave: false` and `providerDiscover: false`; callers must
provide an exact `{ providerId, modelId }` route already understood by DSH.

## Actual local verification

Installed SDK import/create/close succeeded. With an explicitly created local
workspace, SDK child startup reached JSON-RPC initialization and rejected an
intentionally absent route with `JsonRpcResponseError: no adapter registered for
provider "sciencescope-unconfigured"`; close completed. No provider was called.
An earlier ENOENT was caused by a missing smoke workspace, not a missing Node
binary or a proven SDK defect. Actual model generation remains unverified.

## Full application connection seam

Provider setup belongs to the composed web profile rather than this narrow SDK:
`@deepseek-ai/dsh-api-settings-controller` exposes settings and credentials
namespaces; `@deepseek-ai/dsh-client-ui-settings-models` implements the upstream
provider/model editor; `@deepseek-ai/dsh-client-connection` owns the client/host
connection. Inspect these installed public surfaces for the next slice instead
of adding another provider store/HTTP transport. Live token output likewise
needs the upstream full-session follow service, not fake chunks of final text.

## Implemented full-web settings bridge

`web-host.mjs` now starts the installed full web profile on loopback, consumes its
official one-time launch-token/303 cookie bootstrap, and invokes the existing
Remote endpoints using named argument objects. The token/cookie stay in the host
process and are not printed by ScienceScope. `provider-service.mjs` uses:

- `settings.describe/mutate` for `llm-pi-ai.providers`;
- `credentials.describe/set/unset` for write-only key management;
- `llm.discoverModels` for optional draft endpoint discovery.

The application host composes these with the SDK session API. No provider HTTP,
model-list parser or parallel provider database was added. Provider rows managed
by this UI have generated `sciencescope-` identifiers. Configuration lives in DSH
home; credentials use DSH's file-backed store, not an OS encrypted keychain.

Actual offline smoke: save a loopback-only provider and non-secret fixture key,
read its model/key-configured state, then remove both. All steps succeeded via
the real DSH service, without a provider request. Discovery is wired but has not
been verified against a live provider in this increment.

One offline full-turn smoke also passed: a local OpenAI-compatible SSE fixture
received exactly one model request via the saved DSH route; the SDK returned
`SCIENCESCOPE_LOCAL_OK`. This verifies provider routing and the real DSH loop,
not a commercial provider or UI token streaming. Fixture server and owned hosts
were closed afterwards; all fixture files are under `.sciencescope-local`.

## Real-provider verification

OpenCode Go discovery returned 38 candidates, including the explicitly selected
`deepseek-v4.1-flash` on the Chat Completions route. Two initial application
attempts were rejected with `MissingSessionID`; the installed adapter did not
send Go's required session-affinity header. The project-local runtime client
configuration now names required session headers. The generic SDK adapter uses
DSH's public per-launch profile patch with the resolved configuration and a fresh
session ID, owning one SDK child per conversation. No custom provider transport
or shared fixed session ID was introduced.

After that correction, one application chat request through the actual desktop
API → DSH → OpenCode Go returned `SCIENCESCOPE_DESKTOP_OK` and completed. This is
real provider verification of message-level output, not token-by-token display.
The opt-in `scripts/real-provider-smoke.mjs` is not part of ordinary tests. Its
credential input and the DSH credential store are Git-ignored and project-local.
No credentials are included in this document or tracked source.

## Genuine live text verification

The SDK is retained for session execution; a supported local Cordis plugin now
relays `agent/assistant-stream` text chunks without changing provider transport.
The ordinary offline suite passes, as do the browser Markdown/draft/focus smoke
and the real SDK delayed-loopback SSE test (two sessions, two fixture requests,
first chunk before the fixture's second chunk, no duplicate final response).

One explicit OpenCode Go `deepseek-v4.1-flash` application chat request then
received 137 live text deltas: first text at 29,236ms and completion at 47,956ms.
The expected sentinel was received. This measures one application invocation,
not an independently measured upstream HTTP retry count. No settings or model
list were changed by `scripts/real-stream-smoke.mjs`. Browser rendering was
checked separately using the same UI with local deterministic chunks.
