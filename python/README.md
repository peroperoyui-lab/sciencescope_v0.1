# Managed scientific Python

ScienceScope uses [uv](https://docs.astral.sh/uv/) rather than implementing an environment
or package manager. `builtin.in` is the requested 22-package input;
`builtin.lock` is the resolved Windows x64 / CPython 3.14.7 package set.
`builtin.json` records the tested interpreter and uv versions. Changes to these
files are explicit upgrades, not an automatic update policy.

The application stores environments, interpreters, cache and operation files in
`<dataRoot>/python/`. uv uses a shared hardlink cache, falling
back to copying when hardlinks are unavailable. Environment sizes count exclusive
files separately from the shared cache. Bytecode generated during imports is
environment-local and may increase exclusive space.

Development uses `.sciencescope-local/runtimes/uv/uv.exe`, or an explicitly set
process-local `SCIENCESCOPE_UV`. uv's license is MIT OR Apache-2.0. Python and
individual packages retain their upstream licenses. Windows packages include uv
and these manifests; environments are created in the application's data folder.

The host ignores global uv/pip configuration (`UV_NO_CONFIG=1`,
`PIP_CONFIG_FILE=os.devNull`) and never installs into system Python. Package
requirements accept names, extras and version constraints, not URLs, paths,
markers or command-line switches. Mirror selection comes from saved settings.
User requirements and the resolved version lock are stored separately; adding a
package reuses existing pins where compatible. Failed operations retain a log.

The settings page and project/chat menus are the user controls. The
`python_env_install` model tool uses the same service and current approval rules.
The context assembly supplies the selected environment's PATH prefix and
VIRTUAL_ENV to the runtime; the shell tool inherits that meeting environment.

Verification entry points:

- `node --test "app/services/python/*.test.js"` (fake uv; no real package downloads).
- `npm run check` (including Python service, runtime and browser integration tests).

R5 removed the prototype's verification commands. The last main revision with
that implementation is recorded in `docs/decisions/DECISIONS.md`.

Fixtures and evidence remain under `.sciencescope-local/temp`, never in Git.
See `docs/log/IMPLEMENTATION_LOG.md` for measured results and unverified items.
