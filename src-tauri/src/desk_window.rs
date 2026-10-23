// Tauri's monitor/window APIs are reused without a window-state plugin.
// Windows normal placement follows GetWindowPlacement (Microsoft Win32 docs),
// including workspace-to-screen coordinates. No third-party source is copied.
use std::{fs, path::PathBuf, sync::mpsc, thread, time::Duration};
use tauri::{Manager, PhysicalPosition, PhysicalSize, Window, WindowEvent};

mod geometry;
use geometry::{client_size, restore, Placement, Rect, Screen};

pub const LABEL: &str = "secondary-desk";

fn screen(monitor: &tauri::window::Monitor) -> Screen {
    let area = monitor.work_area();
    Screen {
        area: Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        x: monitor.position().x,
        y: monitor.position().y,
        scale: monitor.scale_factor(),
    }
}

enum Write {
    Update(Placement),
    Flush(mpsc::Sender<()>),
}

pub struct DeskState {
    path: PathBuf,
    writer: mpsc::Sender<Write>,
}

impl DeskState {
    pub fn new(path: PathBuf) -> Self {
        let (writer, receiver) = mpsc::channel();
        let target = path.clone();
        thread::spawn(move || {
            let mut pending = None;
            loop {
                let message = if pending.is_some() {
                    receiver.recv_timeout(Duration::from_millis(350))
                } else {
                    receiver
                        .recv()
                        .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
                };
                match message {
                    Ok(Write::Update(value)) => pending = Some(value),
                    Ok(Write::Flush(done)) => {
                        persist(&target, pending.take());
                        let _ = done.send(());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => persist(&target, pending.take()),
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        persist(&target, pending);
                        break;
                    }
                }
            }
        });
        Self { path, writer }
    }
}

fn persist(path: &PathBuf, value: Option<Placement>) {
    if let Some(value) = value {
        let result = serde_json::to_vec(&value)
            .map_err(std::io::Error::other)
            .and_then(|bytes| fs::write(path, bytes));
        if let Err(error) = result {
            eprintln!("Could not save desk window placement: {error}");
        }
    }
}

#[cfg(windows)]
fn normal_rect(window: &Window, monitor: Screen) -> Option<(Rect, bool)> {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct WinRect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct WindowPlacement {
        length: u32,
        flags: u32,
        show: u32,
        min: Point,
        max: Point,
        normal: WinRect,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowPlacement(hwnd: *mut c_void, placement: *mut WindowPlacement) -> i32;
    }
    let mut placement = WindowPlacement {
        length: std::mem::size_of::<WindowPlacement>() as u32,
        ..Default::default()
    };
    if unsafe { GetWindowPlacement(window.hwnd().ok()?.0 as *mut c_void, &mut placement) } == 0 {
        return None;
    }
    let rect = placement.normal;
    Some((
        Rect {
            x: rect.left + monitor.area.x - monitor.x,
            y: rect.top + monitor.area.y - monitor.y,
            width: (rect.right - rect.left).max(1) as u32,
            height: (rect.bottom - rect.top).max(1) as u32,
        },
        placement.show == 3 || (placement.show == 2 && placement.flags & 2 != 0),
    ))
}

#[cfg(not(windows))]
fn normal_rect(window: &Window, _monitor: Screen) -> Option<(Rect, bool)> {
    if window.is_maximized().ok()? || window.is_minimized().ok()? {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        false,
    ))
}

fn snapshot(window: &Window) -> Option<Placement> {
    let monitor = screen(&window.current_monitor().ok()??);
    let (normal, maximized) = normal_rect(window, monitor)?;
    Some(Placement {
        normal,
        scale: window.scale_factor().ok()?,
        monitor_x: monitor.x,
        monitor_y: monitor.y,
        maximized,
    })
}

pub fn save(window: &Window, flush: bool) {
    let Some(state) = window.app_handle().try_state::<DeskState>() else {
        return;
    };
    if let Some(value) = snapshot(window) {
        let _ = state.writer.send(Write::Update(value));
    }
    if flush {
        let (done, completed) = mpsc::channel();
        if state.writer.send(Write::Flush(done)).is_ok() {
            let _ = completed.recv();
        }
    }
}

pub fn on_event(window: &Window, event: &WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    match event {
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. } => save(window, false),
        WindowEvent::CloseRequested { .. } => save(window, true),
        _ => {}
    }
}

pub fn initialize(window: &tauri::WebviewWindow) -> Result<(), String> {
    let state = window.app_handle().state::<DeskState>();
    let saved = fs::read(&state.path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Placement>(&bytes).ok())
        .filter(|value| {
            value.scale.is_finite()
                && value.scale > 0.0
                && value.normal.width > 0
                && value.normal.height > 0
        });
    let primary = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .ok_or("No monitor is available")?;
    let primary = screen(&primary);
    let fallback = Placement {
        normal: Rect {
            x: i32::MIN / 2,
            y: i32::MIN / 2,
            width: 1440,
            height: 900,
        },
        scale: 1.0,
        monitor_x: 0,
        monitor_y: 0,
        maximized: false,
    };
    let saved = saved.as_ref().unwrap_or(&fallback);
    let screens: Vec<_> = window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(screen)
        .collect();
    let bounds = restore(saved, &screens, primary);
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    // Placement describes the outer frame; Tauri's set_size takes the client
    // area. Even a frameless Windows window retains resize borders.
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let size = client_size(bounds, outer, inner);
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(PhysicalSize::new(
            ((960.0 * scale) as u32).min(size.width),
            ((600.0 * scale) as u32).min(size.height),
        )))
        .map_err(|e| e.to_string())?;
    window.set_size(size).map_err(|e| e.to_string())?;
    if saved.maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }
    present(window)
}

pub fn present(window: &tauri::WebviewWindow) -> Result<(), String> {
    // The invocation comes from a click in our main/assistant window; Windows
    // permits that foreground process to activate another window it owns.
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
