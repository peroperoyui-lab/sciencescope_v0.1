#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use serde::{Deserialize, Serialize};
use tauri::{menu::{ContextMenu, Menu, MenuItem}, AppHandle, Emitter, Manager, LogicalSize, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, Window};

struct HostProcess {
    child: Mutex<Option<ChildHandle>>,
}

struct WebviewDataDirectory(PathBuf);

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
}

fn surface_name(surface: &str) -> Result<&'static str, String> {
    match surface {
        "assistant" | "map" | "browser" | "quick" => Ok(match surface {
            "assistant" => "assistant",
            "map" => "map",
            "browser" => "browser",
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
    if !matches!(surface, "map" | "quick") && project_id.is_some() {
        return Err("project id is only supported by map or quick surfaces".to_owned());
    }
    let label = if let Some(project_id) = project_id {
        format!("secondary-{surface}-{project_id}")
    } else {
        format!("secondary-{surface}")
    };

    if surface != "assistant" {
        if let Some(existing)=app.get_webview_window(&label) {let _=existing.show();let _=existing.set_focus();return Ok(label);}
    }
    let base_url = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .filter(|url| {
            matches!(url.scheme(), "http" | "https")
                && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        })
        .unwrap_or_else(|| url::Url::parse("tauri://localhost/index.html").expect("static app URL"));
    let mut url = base_url;
    url.set_path("/");
    url.query_pairs_mut().append_pair("surface", surface);
    if let Some(project_id) = project_id {
        url.query_pairs_mut().append_pair("projectId", project_id);
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
                .devtools(false)
                .title("ScienceScope · 全局助手")
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
        let next = if request.toggle && had_panel {
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
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .devtools(false)
        .title(match surface {
            "assistant" => "ScienceScope · 全局助手",
            "map" => "ScienceScope · 研究导图",
            "browser" => "ScienceScope · 浏览器",
            _ => "ScienceScope · 快速聊天",
        })
        .inner_size(if surface == "map" { 1260.0 } else { f64::from(initial_dimensions.width) }, if surface == "map" { 850.0 } else { f64::from(initial_dimensions.height) })
        .decorations(false)
        .transparent(assistant)
        .shadow(!assistant)
        .always_on_top(false)
        .resizable(true)
        .data_directory(app.state::<WebviewDataDirectory>().0.clone())
        .build()
        .map_err(|error| format!("could not open secondary window: {error}"))?;
    Ok(label)
}

struct ChildHandle {
    child: Child,
    #[cfg(windows)]
    job: windows_job::Job,
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

fn host_url() -> Result<Option<(String, ChildHandle)>, Box<dyn std::error::Error>> {
    let node = match std::env::var_os("SCIENCESCOPE_NODE") {
        Some(value) if !value.is_empty() => value,
        _ => return Ok(None),
    };
    let script = match std::env::var_os("SCIENCESCOPE_HOST_SCRIPT") {
        Some(value) if !value.is_empty() => value,
        _ => return Ok(None),
    };

    let mut child = Command::new(node)
        .arg(script)
        .arg("--desktop")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
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
    let url = parsed
        .get("url")
        .and_then(serde_json::Value::as_str)
        .ok_or("desktop host readiness JSON did not contain a url")?;
    let parsed_url = url::Url::parse(url)?;
    if parsed_url.scheme() != "http"
        || !matches!(parsed_url.host_str(), Some("127.0.0.1" | "localhost"))
        || parsed_url.port().is_none()
    {
        return Err("desktop host URL was not an http loopback address".into());
    }

    Ok(Some((url.to_owned(), owned)))
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_secondary_window, set_assistant_mode, get_assistant_mode, show_assistant_menu])
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
                    for (label, secondary) in window.app_handle().webview_windows() {
                        if label != "main" {
                            let _ = secondary.close();
                        }
                    }
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            let executable = std::env::current_exe()?;
            let root = executable
                .parent()
                .ok_or("Application directory is unavailable")?;
            let webview_data = root.join("data").join("webview");
            std::fs::create_dir_all(&webview_data)?;
            app.manage(WebviewDataDirectory(webview_data.clone()));
            let dimensions_path = root.join("data").join("assistant-window.json");
            app.manage(AssistantState {
                mode: Mutex::new(AssistantMode::Expanded),
                dimensions_path,
            });

            let hosted = host_url()?;
            let mut config = app.config().app.windows[0].clone();
            if let Some((url, child)) = hosted {
                config.url = tauri::WebviewUrl::External(url::Url::parse(&url)?);
                app.manage(HostProcess {
                    child: Mutex::new(Some(child)),
                });
            }
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(webview_data)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ScienceScope desktop failed to start");
}
