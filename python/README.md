# Managed scientific Python

T11 uses [uv](https://docs.astral.sh/uv/) rather than implementing an environment
or package manager. `builtin.in` is the requested 22-package input;
`builtin.lock` is the resolved Windows x64 / CPython 3.14.7 package set.
`builtin.json` records the tested interpreter and uv versions. Changes to these
files are explicit upgrades, not an automatic update policy.

The application stores environments, interpreters, cache and operation files in
`<dataRoot>/.sciencescope-local/python/`. uv uses a shared hardlink cache, falling
back to copying when hardlinks are unavailable. Environment sizes count exclusive
files separately from the shared cache. Bytecode generated during imports is
environment-local and may increase exclusive space.

Development uses `.sciencescope-local/runtimes/uv/uv.exe`, or an explicitly set
process-local `SCIENCESCOPE_UV`. uv's license is MIT OR Apache-2.0. Python and
individual packages retain their upstream licenses. Preparing an installer with
these resources and notices remains release-stage work; a successful local test
is not an offline installer or signature claim.

The host ignores global uv/pip configuration (`UV_NO_CONFIG=1`,
`PIP_CONFIG_FILE=os.devNull`) and never installs into system Python. Package
requirements accept names, extras and version constraints, not URLs, paths,
markers or command-line switches. Mirror selection comes from saved settings.
User requirements and the resolved version lock are stored separately; adding a
package reuses existing pins where compatible. Failed operations retain a log.

The settings page and project/chat menus are the user controls. The
`python_env_install` model tool uses the same service with an approval card;
automatic approval in full-control mode is separately opt-in and defaults off.
Session environment variables are host-generated and affect only that DSH
process. Expert children share Main's process; assistants have their own sessions.

Verification entry points:

- `node --test tests/python-env.test.mjs tests/session-env.test.mjs`
- `node scripts/python-env-ui-smoke.mjs` (fake uv, production API/router)
- `node scripts/python-env-local-smoke.mjs --install` (real downloads, no models)
- `node scripts/python-goal-env-runtime-smoke.mjs --root <owned-local-smoke-root>`
  (real DSH and interpreters, local model fixture, no paid requests)
- `node scripts/evals/python-env-live.mjs --live --root <owned-local-smoke-root>`
  (paid opt-in, real application/DSH, bounded request count)
- `node scripts/python-env-mirror-smoke.mjs --root <owned-local-smoke-root>`
  (real saved mirror and tiny package download, no models)
- `node scripts/python-env-native-smoke.mjs` (owned Windows client and picker)
- `node scripts/evals/python-native-live.mjs --live`
  (native project picker, real Go file write and denied outside write)

Fixtures and evidence remain under `.sciencescope-local/temp`, never in Git.
See `docs/DESKTOP_IMPLEMENTATION.md` for measured results and unverified items.
