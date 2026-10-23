// GUI subsystem in every build: the development launcher runs the debug
// executable, and a console subsystem there opened a stray terminal window.
// Host diagnostics go to data/logs/desktop-host.log instead.
#![windows_subsystem = "windows"]

mod new_app;
mod screenshot;
mod desk_window;

use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use tauri::{menu::{ContextMenu, Menu, MenuItem}, AppHandle, Emitter, Manager, LogicalSize, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, Window};

struct HostProcess {
    child: Mutex<Option<ChildHandle>>,
}

#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow, title: Option<String>) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("FOLDER_PICKER_MAIN_WINDOW_ONLY".into());
    }
    let title = title.unwrap_or_else(|| "ScienceScope".into());
    if title.chars().count() > 200 {
        return Err("FOLDER_PICKER_INVALID_TITLE".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        window.dialog().file().set_parent(&window).set_title(title).blocking_pick_folder()
            .map(|value| value.into_path().map(|path| path.to_string_lossy().into_owned()).map_err(|error| error.to_string()))
            .transpose()
    }).await.map_err(|error| error.to_string())?
}

impl HostProcess {
    fn shutdown(&self) {
        let child = self.child.lock().ok().and_then(|mut slot| slot.take());
        if let Some(child) = child { child.shutdown(); }
    }
}

struct ShutdownTarget {
    host: String,
    port: u16,
    path: String,
    token: String,
}

struct WebviewDataDirectory(PathBuf);

// Per-launch authority, never persisted or derived from a navigated window URL.
struct HostAccess {
    url: url::Url,
    api_token: String,
}

fn api_initialization(app: &AppHandle) -> String {
    let Some(access) = app.try_state::<HostAccess>() else { return String::new() };
    let origin = serde_json::to_string(&access.url.origin().ascii_serialization()).expect("origin serializes");
    let token = serde_json::to_string(&access.api_token).expect("token serializes");
    format!("if (window.location.origin === {origin}) {{ Object.defineProperty(window, '__SCIENCESCOPE_API_TOKEN__', {{ value: {token}, enumerable: false, writable: false, configurable: false }}); }}")
}

struct AssistantState {
    mode: Mutex<AssistantMode>,
    dimensions_path: PathBuf,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum AssistantMode {
    Expanded,
    Orb,
}

impl Default for AssistantMode {
    fn default() -> Self { Self::Expanded }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
struct AssistantDimensions {
    width: u32,
    height: u32,
}

const ASSISTANT_LABEL: &str = "secondary-assistant";
const ASSISTANT_ORB_LABEL: &str = "secondary-assistant-orb";
const ASSISTANT_DEFAULT: AssistantDimensions = AssistantDimensions { width: 450, height: 800 };
const ASSISTANT_ORB: u32 = 64;

#[derive(Debug, Deserialize)]
struct SecondaryRequest {
    surface: String,
    project_id: Option<String>,
    #[serde(default)]
    toggle: bool,
    #[serde(default)]
    collapsed: bool,
    /// The editing desk's document: a path inside the project folder.
    #[serde(default)]
    path: Option<String>,
}

fn surface_name(surface: &str) -> Result<&'static str, String> {
    match surface {
        "assistant" | "map" | "browser" | "quick" | "desk" => Ok(match surface {
            "assistant" => "assistant",
            "map" => "map",
            "browser" => "browser",
            "desk" => "desk",
            _ => "quick",
        }),
        _ => Err("unsupported secondary surface".to_owned()),
    }
}

fn safe_project_id(project_id: Option<&str>) -> Result<Option<&str>, String> {
    let Some(value) = project_id else { return Ok(None) };
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
    }) {
        return Err("invalid project id".to_owned());
    }
    Ok(Some(value))
}

fn safe_document_path(path: Option<&str>) -> Result<Option<&str>, String> {
    let Some(value) = path else { return Ok(None) };
    if value.is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        return Err("invalid document path".to_owned());
    }
    Ok(Some(value))
}

fn read_assistant_dimensions(path: &PathBuf) -> AssistantDimensions {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .filter(|dimensions: &AssistantDimensions| dimensions.width >= 240 && dimensions.height >= 320)
        .unwrap_or(ASSISTANT_DEFAULT)
}

fn save_assistant_dimensions(path: &PathBuf, dimensions: AssistantDimensions) {
    if dimensions.width < 240 || dimensions.height < 320 { return; }
    if let Ok(value) = serde_json::to_string(&dimensions) {
        let _ = fs::write(path, value);
    }
}

fn assistant_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(ASSISTANT_LABEL)
        .ok_or_else(|| "assistant window is not open".to_owned())
}

fn assistant_orb(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(ASSISTANT_ORB_LABEL)
        .ok_or_else(|| "assistant orb is not open".to_owned())
}

fn keep_within_work_area(window: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? else { return Ok(()) };
    let area = monitor.work_area();
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let max_x = area.position.x.saturating_add(area.size.width.saturating_sub(size.width) as i32);
    let max_y = area.position.y.saturating_add(area.size.height.saturating_sub(size.height) as i32);
    let bounded = PhysicalPosition::new(
        position.x.clamp(area.position.x, max_x),
        position.y.clamp(area.position.y, max_y),
    );
    if bounded != position {window.set_position(bounded).map_err(|e| e.to_string())?;}
    Ok(())
}

fn place_panel_from_orb(panel: &tauri::WebviewWindow, orb: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(monitor) = orb.current_monitor().map_err(|e| e.to_string())? else { return Ok(()) };
    let area = monitor.work_area();
    let orb_pos = orb.outer_position().map_err(|e| e.to_string())?;
    let orb_size = orb.outer_size().map_err(|e| e.to_string())?;
    let panel_size = panel.outer_size().map_err(|e| e.to_string())?;
    let gap = 12i32;
    let mut x = orb_pos.x - panel_size.width as i32 - gap;
    let mut y = orb_pos.y - panel_size.height as i32 - gap;
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    if x < area.position.x { x = orb_pos.x + orb_size.width as i32 + gap; }
    if y < area.position.y { y = orb_pos.y + orb_size.height as i32 + gap; }
    let max_x = (right - panel_size.width as i32).max(area.position.x);
    let max_y = (bottom - panel_size.height as i32).max(area.position.y);
    panel.set_position(PhysicalPosition::new(x.clamp(area.position.x, max_x), y.clamp(area.position.y, max_y))).map_err(|e| e.to_string())
}

fn apply_assistant_mode(
    window: &tauri::WebviewWindow,
    mode: AssistantMode,
    dimensions: AssistantDimensions,
) -> Result<(), String> {
    match mode {
        AssistantMode::Orb => {
            window.hide().map_err(|e| e.to_string())?;
        }
        AssistantMode::Expanded => {
            window.set_size(LogicalSize::new(f64::from(dimensions.width), f64::from(dimensions.height))).map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn set_assistant_mode(window: Window, mode: AssistantMode) -> Result<AssistantMode, String> {
    if !matches!(window.label(), "main" | ASSISTANT_LABEL | ASSISTANT_ORB_LABEL) {
        return Err("assistant mode can only be changed by the main or assistant window".to_owned());
    }
    let app = window.app_handle();
    let assistant = assistant_window(&app)?;
    let orb = assistant_orb(&app)?;
    let state = app.state::<AssistantState>();
    let dimensions = read_assistant_dimensions(&state.dimensions_path);
    *state.mode.lock().map_err(|_| "assistant state is unavailable".to_owned())? = mode;
    apply_assistant_mode(&assistant, mode, dimensions)?;
    orb.show().map_err(|e| e.to_string())?;
    if mode == AssistantMode::Expanded {
        place_panel_from_orb(&assistant, &orb)?;
        assistant.set_focus().map_err(|e| e.to_string())?;
    }
    let _ = app.emit("assistant-mode", mode);
    Ok(mode)
}

#[tauri::command]
async fn get_assistant_mode(window: Window) -> Result<AssistantMode, String> {
    if !matches!(window.label(), "main" | ASSISTANT_LABEL | ASSISTANT_ORB_LABEL) {
        return Err("assistant mode can only be queried by the main or assistant window".to_owned());
    }
    let state = window.app_handle().state::<AssistantState>();
    state.mode.lock().map(|mode| *mode).map_err(|_| "assistant state is unavailable".to_owned())
}

#[tauri::command]
async fn hide_assistant(window: Window) -> Result<(), String> {
    if !matches!(window.label(), "main" | ASSISTANT_LABEL | ASSISTANT_ORB_LABEL) { return Err("only assistant windows can hide the assistant".to_owned()); }
    for label in [ASSISTANT_LABEL, ASSISTANT_ORB_LABEL] {
        if let Some(view) = window.app_handle().get_webview_window(label) {
            view.hide().map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_assistant_menu(window: Window) -> Result<(), String> {
    if !matches!(window.label(), ASSISTANT_LABEL | ASSISTANT_ORB_LABEL) {
        return Err("assistant menu can only be opened by the assistant window".to_owned());
    }
    let app = window.app_handle();
    let toggle = MenuItem::with_id(app, "assistant-toggle", "展开/收起助手", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let close = MenuItem::with_id(app, "assistant-exit", "退出助手", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&toggle, &close]).map_err(|error| error.to_string())?;
    menu.popup(window).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_secondary_window(
    app: AppHandle,
    request: SecondaryRequest,
) -> Result<String, String> {
    let surface = surface_name(&request.surface)?;
    let project_id = safe_project_id(request.project_id.as_deref())?;
    if surface == "quick" && project_id.is_none() {
        return Err("project id is required by the quick surface".to_owned());
    }
    if !matches!(surface, "map" | "quick" | "desk") && project_id.is_some() {
        return Err("project id is only supported by map, quick or desk surfaces".to_owned());
    }
    let path = safe_document_path(request.path.as_deref())?;
    if path.is_some() && (surface != "desk" || project_id.is_none()) {
        return Err("a document path needs the desk surface and a project id".to_owned());
    }
    // One desk window for every project; it opens each document in a tab.
    let label = if surface == "desk" {
        "secondary-desk".to_owned()
    } else if let Some(project_id) = project_id {
        format!("secondary-{surface}-{project_id}")
    } else {
        format!("secondary-{surface}")
    };

    if surface != "assistant" {
        if let Some(existing)=app.get_webview_window(&label) {
            if surface == "desk" {
                desk_window::present(&existing)?;
                let _ = app.emit_to(&label, "desk-open", serde_json::json!({ "projectId": project_id, "path": path }));
            } else {
                let _=existing.show();let _=existing.set_focus();
            }
            return Ok(label);
        }
    }
    let base_url = app
        .try_state::<HostAccess>()
        .map(|access| access.url.clone())
        .unwrap_or_else(|| url::Url::parse("tauri://localhost/index.html").expect("static app URL"));
    let mut url = base_url;
    url.set_path("/");
    url.query_pairs_mut().append_pair("surface", surface);
    if let Some(project_id) = project_id {
        url.query_pairs_mut().append_pair("projectId", project_id);
    }
    if let Some(path) = path {
        url.query_pairs_mut().append_pair("path", path);
    }
    let assistant = surface == "assistant";
    if assistant {
        let had_panel = app.get_webview_window(ASSISTANT_LABEL).is_some();
        let state = app.state::<AssistantState>();
        let dimensions = read_assistant_dimensions(&state.dimensions_path);
        let panel = if let Some(existing) = app.get_webview_window(ASSISTANT_LABEL) {
            existing
        } else {
            WebviewWindowBuilder::new(&app, ASSISTANT_LABEL, WebviewUrl::External(url.clone()))
                .initialization_script(api_initialization(&app))
                .devtools(false)
                .title("ScienceScope · 全局助手")
                .visible(false)
                .inner_size(f64::from(dimensions.width), f64::from(dimensions.height))
                .decorations(false).transparent(true).shadow(false).always_on_top(false).resizable(true)
                .data_directory(app.state::<WebviewDataDirectory>().0.clone()).build()
                .map_err(|error| format!("could not open assistant panel: {error}"))?
        };
        let mut orb_url = url.clone();
        orb_url.query_pairs_mut().clear().append_pair("surface", "assistant-orb");
        let had_orb=app.get_webview_window(ASSISTANT_ORB_LABEL).is_some();
        let orb = if let Some(existing) = app.get_webview_window(ASSISTANT_ORB_LABEL) {
            existing
        } else {
            WebviewWindowBuilder::new(&app, ASSISTANT_ORB_LABEL, WebviewUrl::External(orb_url))
                .initialization_script(api_initialization(&app))
                .devtools(false)
                .title("ScienceScope · 助手")
                .inner_size(f64::from(ASSISTANT_ORB), f64::from(ASSISTANT_ORB))
                .min_inner_size(f64::from(ASSISTANT_ORB), f64::from(ASSISTANT_ORB))
                .max_inner_size(f64::from(ASSISTANT_ORB), f64::from(ASSISTANT_ORB))
                .decorations(false).transparent(true).shadow(false).always_on_top(true).resizable(false)
                .data_directory(app.state::<WebviewDataDirectory>().0.clone()).build()
                .map_err(|error| format!("could not open assistant orb: {error}"))?
        };
        orb.set_size(LogicalSize::new(f64::from(ASSISTANT_ORB),f64::from(ASSISTANT_ORB))).map_err(|e|e.to_string())?;
        if !had_orb {
            if let (Ok(Some(monitor)),Ok(size))=(orb.current_monitor(),orb.outer_size()) {
                let area=monitor.work_area();
                let _=orb.set_position(PhysicalPosition::new(area.position.x+area.size.width.saturating_sub(size.width+24) as i32,area.position.y+area.size.height.saturating_sub(size.height+24) as i32));
            }
        }
        orb.show().map_err(|e| e.to_string())?;
        keep_within_work_area(&orb)?;
        let current = *state.mode.lock().map_err(|_| "assistant state is unavailable".to_owned())?;
        let next = if request.collapsed { AssistantMode::Orb } else if request.toggle && had_panel {
            if current == AssistantMode::Expanded { AssistantMode::Orb } else { AssistantMode::Expanded }
        } else { AssistantMode::Expanded };
        *state.mode.lock().map_err(|_| "assistant state is unavailable".to_owned())? = next;
        apply_assistant_mode(&panel, next, dimensions)?;
        if next == AssistantMode::Expanded { place_panel_from_orb(&panel, &orb)?; panel.set_focus().map_err(|e| e.to_string())?; }
        let _ = app.emit("assistant-mode", next);
        return Ok(label);
    }
    let assistant_dimensions = app.state::<AssistantState>().dimensions_path.clone();
    let initial_dimensions = if assistant { read_assistant_dimensions(&assistant_dimensions) } else { AssistantDimensions { width: 800, height: 740 } };
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .initialization_script(api_initialization(&app))
        .devtools(false)
        .title(match surface {
            "assistant" => "ScienceScope · 全局助手",
            "map" => "ScienceScope · 研究导图",
            "browser" => "ScienceScope · 浏览器",
            "desk" => "ScienceScope · 编辑台",
            _ => "ScienceScope · 快速聊天",
        })
        .inner_size(match surface { "map" => 1260.0, "desk" => 1440.0, _ => f64::from(initial_dimensions.width) }, match surface { "map" => 850.0, "desk" => 900.0, _ => f64::from(initial_dimensions.height) })
        .decorations(false)
        .transparent(assistant)
        .shadow(!assistant)
        .always_on_top(false)
        .resizable(true)
        .data_directory(app.state::<WebviewDataDirectory>().0.clone());
    if surface == "desk" {
        builder = builder.visible(false);
    }
    let window = builder.build().map_err(|error| format!("could not open secondary window: {error}"))?;
    if surface == "desk" { desk_window::initialize(&window)?; }
    Ok(label)
}

struct ChildHandle {
    child: Child,
    shutdown: Option<ShutdownTarget>,
    #[cfg(windows)]
    job: windows_job::Job,
}

impl ChildHandle {
    fn request_shutdown(target: &ShutdownTarget) -> std::io::Result<()> {
        let mut stream = TcpStream::connect_timeout(
            &format!("{}:{}", target.host, target.port).parse().map_err(|_| std::io::ErrorKind::InvalidInput)?,
            Duration::from_millis(400),
        )?;
        stream.set_read_timeout(Some(Duration::from_millis(400)))?;
        stream.set_write_timeout(Some(Duration::from_millis(400)))?;
        let path = if target.path.starts_with('/') { target.path.as_str() } else { "/api/shutdown" };
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            target.host, target.port, target.token,
        );
        stream.write_all(request.as_bytes())?;
        let mut response = [0u8; 64];
        let _ = stream.read(&mut response);
        Ok(())
    }

    fn shutdown(mut self) {
        if let Some(target) = self.shutdown.as_ref() {
            let _ = Self::request_shutdown(target);
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
                _ => break,
            }
        }
        #[cfg(not(windows))]
        let _ = self.child.kill();
        #[cfg(windows)]
        self.job.kill();
        let _ = self.child.wait();
    }
}

impl Drop for ChildHandle {
    fn drop(&mut self) {
        #[cfg(not(windows))]
        let _ = self.child.kill();
        #[cfg(windows)]
        self.job.kill();
        let _ = self.child.wait();
    }
}

impl Drop for HostProcess {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.child.lock() {
            slot.take();
        }
    }
}

fn host_url(log_dir: &std::path::Path, launch: &new_app::NewAppLaunch, native_started: u128) -> Result<(String, String, ChildHandle), Box<dyn std::error::Error>> {
    let node = match std::env::var_os("SCIENCESCOPE_NODE") {
        Some(value) if !value.is_empty() => value,
        _ => launch.node.clone().into_os_string(),
    };
    std::fs::create_dir_all(log_dir)?;
    // One log per launch; stdout carries only the capability line read below.
    // The previous launch's log is kept, so a crash is still on disk after the
    // person reopens the app to report it.
    let log = log_dir.join("desktop-host.log");
    if log.exists() {
        let _ = fs::rename(&log, log_dir.join("desktop-host.previous.log"));
    }
    let host_log = fs::File::create(&log)?;
    let mut command = Command::new(node);
    launch.configure(&mut command);
    command.stdout(Stdio::piped()).stderr(Stdio::from(host_log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: the host gets a console without a window, and the
        // tool processes it starts inherit that console instead of opening theirs.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.env("SCIENCESCOPE_STARTUP_NATIVE_MS", native_started.to_string());
    command.env("SCIENCESCOPE_STARTUP_NODE_MS", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis().to_string());
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let job = match windows_job::Job::for_child(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.into());
        }
    };

    let mut owned = ChildHandle {
        child,
        shutdown: None,
        #[cfg(windows)]
        job,
    };
    let stdout = owned.child.stdout.take().ok_or("host stdout was not piped")?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });

    let line = receiver
        .recv_timeout(Duration::from_secs(45))
        .map_err(|_| "timed out waiting for desktop host")??;
    let parsed: serde_json::Value = serde_json::from_str(line.trim())?;
    let (url, api_token) = new_app::readiness(&parsed)?;
    let parsed_url = url::Url::parse(&url)?;
    if parsed_url.scheme() != "http"
        || !matches!(parsed_url.host_str(), Some("127.0.0.1" | "localhost"))
        || parsed_url.port().is_none()
    {
        return Err("desktop host URL was not an http loopback address".into());
    }

    if let (Some(shutdown_path), Some(shutdown_token)) = (
        parsed.get("shutdownPath").and_then(serde_json::Value::as_str),
        parsed.get("shutdownToken").and_then(serde_json::Value::as_str),
    ) {
        if !shutdown_path.starts_with('/') || shutdown_token.is_empty() || shutdown_token.len() > 256 {
            return Err("desktop host shutdown capability was invalid".into());
        }
        owned.shutdown = Some(ShutdownTarget {
            host: parsed_url.host_str().unwrap_or("127.0.0.1").to_owned(),
            port: parsed_url.port().ok_or("desktop host URL did not contain a port")?,
            path: shutdown_path.to_owned(),
            token: shutdown_token.to_owned(),
        });
    }
    Ok((url, api_token, owned))
}

#[cfg(windows)]
mod windows_job {
    use std::{io, mem::size_of, os::windows::io::AsRawHandle};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    pub struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn for_child(child: &std::process::Child) -> io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    ..std::mem::zeroed()
                };
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                {
                    CloseHandle(handle);
                    return Err(io::Error::last_os_error());
                }
                if AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
                    CloseHandle(handle);
                    return Err(io::Error::last_os_error());
                }
                Ok(Self(handle))
            }
        }

        pub fn kill(&self) {
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn main() {
    let native_started = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("system clock follows Unix epoch").as_millis();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_secondary_window, set_assistant_mode, get_assistant_mode, show_assistant_menu, hide_assistant, pick_folder, screenshot::capture_screenshot])
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "assistant-exit" {
                if let Some(window) = app.get_webview_window(ASSISTANT_LABEL) { let _ = window.destroy(); }
                if let Some(window) = app.get_webview_window(ASSISTANT_ORB_LABEL) { let _ = window.destroy(); }
            } else if id == "assistant-toggle" {
                if let (Some(window), Some(orb)) = (app.get_webview_window(ASSISTANT_LABEL), app.get_webview_window(ASSISTANT_ORB_LABEL)) {
                    let state = app.state::<AssistantState>();
                    let next = state.mode.lock().map(|mode| if *mode == AssistantMode::Expanded { AssistantMode::Orb } else { AssistantMode::Expanded }).unwrap_or(AssistantMode::Expanded);
                    let dimensions = read_assistant_dimensions(&state.dimensions_path);
                    if apply_assistant_mode(&window, next, dimensions).is_ok() {
                        if next == AssistantMode::Expanded { let _ = place_panel_from_orb(&window, &orb); let _ = window.set_focus(); }
                        if let Ok(mut mode) = state.mode.lock() { *mode = next; }
                        let _ = app.emit("assistant-mode", next);
                    }
                }
            }
        })
        .on_window_event(|window, event| {
            desk_window::on_event(window, event);
            if window.label() == ASSISTANT_LABEL {
                match event {
                    tauri::WindowEvent::Resized(size) => {
                        let state = window.app_handle().state::<AssistantState>();
                        if let Ok(mode) = state.mode.lock() {
                            if *mode == AssistantMode::Expanded {
                                let scale = window.scale_factor().unwrap_or(1.0);
                                save_assistant_dimensions(&state.dimensions_path, AssistantDimensions {
                                    width: (f64::from(size.width) / scale).round() as u32,
                                    height: (f64::from(size.height) / scale).round() as u32,
                                });
                            }
                        };
                    }
                    _ => {}
                }
            }
            if window.label() == ASSISTANT_ORB_LABEL {
                if let tauri::WindowEvent::Moved(_) = event {
                    if let Some(orb)=window.app_handle().get_webview_window(ASSISTANT_ORB_LABEL) {
                        let _ = keep_within_work_area(&orb);
                        let expanded=window.app_handle().state::<AssistantState>().mode.lock().map(|mode|*mode==AssistantMode::Expanded).unwrap_or(false);
                        if expanded {if let Some(panel)=window.app_handle().get_webview_window(ASSISTANT_LABEL) {let _=place_panel_from_orb(&panel,&orb);}}
                    }
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == ASSISTANT_ORB_LABEL {
                    if let Some(panel)=window.app_handle().get_webview_window(ASSISTANT_LABEL) {let _=panel.destroy();}
                }
                if window.label() == ASSISTANT_LABEL {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Ok(mut mode) = window.app_handle().state::<AssistantState>().mode.lock() { *mode = AssistantMode::Orb; }
                    let _ = window.app_handle().emit("assistant-mode", AssistantMode::Orb);
                    return;
                }
                if window.label() == "main" {
                    if let Some(desk) = window.app_handle().get_webview_window(desk_window::LABEL) {
                        desk_window::save(&desk.as_ref().window(), true);
                    }
                    for (label, secondary) in window.app_handle().webview_windows() {
                        if label != "main" {
                            let _ = secondary.close();
                        }
                    }
                    if let Some(host) = window.app_handle().try_state::<HostProcess>() {
                        host.shutdown();
                    }
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(move |app| {
            let executable = std::env::current_exe()?;
            let root = executable
                .parent()
                .ok_or("Application directory is unavailable")?;
            let launch = new_app::NewAppLaunch::resolve(root, std::env::var_os("SCIENCESCOPE_DATA").as_deref())?;
            let native_data = launch.data_root.clone();
            let webview_data = native_data.join("webview");
            std::fs::create_dir_all(&webview_data)?;
            app.manage(desk_window::DeskState::new(native_data.join("desk-window.json")));
            app.manage(WebviewDataDirectory(webview_data.clone()));
            let dimensions_path = native_data.join("assistant-window.json");
            app.manage(AssistantState {
                mode: Mutex::new(AssistantMode::Expanded),
                dimensions_path,
            });

            let (url, api_token, child) = host_url(&native_data.join("logs"), &launch, native_started)?;
            let mut config = app.config().app.windows[0].clone();
            let parsed_url = url::Url::parse(&url)?;
            let mut capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json"))?;
            capability["identifier"] = serde_json::json!("host-window-controls");
            capability["windows"] = serde_json::json!(["main", ASSISTANT_LABEL, ASSISTANT_ORB_LABEL, desk_window::LABEL]);
            capability["permissions"].as_array_mut().ok_or("window permissions must be an array")?
                .push(serde_json::json!({"identifier": "opener:allow-open-url", "allow": [{"url": "http://*"}, {"url": "https://*"}]}));
            capability["local"] = serde_json::json!(false);
            capability["remote"] = serde_json::json!({"urls": [format!("{}/*", parsed_url.origin().ascii_serialization())]});
            app.add_capability(serde_json::to_string(&capability)?)?;
            let mut folder_capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/folder-picker.json"))?;
            folder_capability["local"] = serde_json::json!(false);
            folder_capability["remote"] = serde_json::json!({"urls": [format!("{}/*", parsed_url.origin().ascii_serialization())]});
            app.add_capability(serde_json::to_string(&folder_capability)?)?;
            config.url = tauri::WebviewUrl::External(parsed_url.clone());
            app.manage(HostAccess { url: parsed_url, api_token });
            app.manage(HostProcess {
                child: Mutex::new(Some(child)),
            });
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(api_initialization(app.handle()))
                .data_directory(webview_data)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ScienceScope desktop failed to start");
}
