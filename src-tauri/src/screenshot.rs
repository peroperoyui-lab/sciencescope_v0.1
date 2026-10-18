// Reuse Windows Snipping Tool (an OS component), not a second selection overlay.
// No third-party source copied. Clipboard capture runs on an STA PowerShell thread.
use tauri::Manager;

#[tauri::command]
pub async fn capture_screenshot(window: tauri::WebviewWindow, hide_window: bool) -> Result<Option<String>, String> {
    let mut hidden: Vec<tauri::WebviewWindow> = Vec::new();
    if hide_window {
        for candidate in window.app_handle().webview_windows().values() {
            if candidate.is_visible().unwrap_or(false) {
                if let Err(error) = candidate.hide() {
                    for previous in hidden { let _ = previous.show(); }
                    return Err(error.to_string());
                }
                hidden.push(candidate.clone());
            }
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || capture()).await;
    // Restore on success, Escape, cancellation and errors alike.
    for candidate in hidden {
        let _ = candidate.show();
    }
    let _ = window.set_focus();
    result.map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn capture() -> Result<Option<String>, String> {
    use std::os::windows::process::CommandExt;
    std::thread::sleep(std::time::Duration::from_millis(200));
    let shell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or("C:\\Windows".into()))
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut child = std::process::Command::new(shell)
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", include_str!("screenshot.ps1")])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
        .spawn().map_err(|_| "无法启动系统截图，请使用系统截图后粘贴。".to_string())?;
    let _job = match crate::windows_job::Job::for_child(&child) {
        Ok(job) => job,
        Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error.to_string()); }
    };
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("截图未完成，请重试或使用系统截图后粘贴。".into());
    }
    let image = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    Ok(if image.trim().is_empty() { None } else { Some(image.trim().to_string()) })
}

#[cfg(not(windows))]
fn capture() -> Result<Option<String>, String> {
    Err("请使用系统截图后，在输入框中粘贴。".into())
}
