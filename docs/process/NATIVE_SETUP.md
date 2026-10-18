# Native Windows setup

The Tauri backend uses a project-scoped Rust installation. From PowerShell, run
`.\scripts\windows\setup-rust.ps1 -Install`; it stores rustup, Cargo, downloads,
temporary files, and build state under `.sciencescope-local`. The script does not
modify user/system PATH or environment variables. For a check in the same process:

```powershell
. .\scripts\windows\setup-rust.ps1
cargo check --manifest-path .\src-tauri\Cargo.toml
```

Visual Studio Build Tools 18, MSVC, Windows SDK 10.0.26100.0, and WebView2 Runtime
153.0.4234.32 are installed on the audited machine. Network access to the official
Rust distribution is required for the first toolchain install.

`run-desktop.ps1 -Check` prepares resources and runs Cargo check with the installed
MSVC environment. Omit `-Check` to run the native window after building. An optional
`-Proxy http://127.0.0.1:10808` applies only to that PowerShell process.

Current verification: the resumed download completed. Project-local rustc and
Cargo both report 1.98.1; the stable MSVC toolchain is installed and selected
inside this worktree. `run-desktop.ps1 -Check` passed after generating the Windows
icon from the approved Logo (the original PNG remains unchanged). Full executable
build also passed; `sciencescope-desktop.exe` started and Windows reported a
responding main window titled `ScienceScope — 设计预览 · 模型未接入`.
This proves native startup, not full UI interaction or model connectivity. Download,
cache and build files remain inside this worktree.

The launch script now starts the application Node/DSH host automatically via the
Tauri-owned process boundary. Actual startup/close/restart smoke passed: the
native window responded, and closing it removed its entire captured process
tree. This does not claim end-to-end live model verification. Use the launch
script rather than the bare executable until runtime resources are packaged.

The redundant OS caption is now disabled (`decorations: false`). The approved
application top bar retains native minimize/maximize/close, with empty-area
dragging and double-click maximization. The frameless executable rebuilt and
started successfully; this is not a separate visual redesign.
