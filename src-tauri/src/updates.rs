// Only our main-window commands can install. The plugin's raw IPC permissions
// stay ungranted, so every installation passes download verification and the
// host's graceful database close before the Windows updater starts.
use crate::{
    host_http,
    update_error::{self, UpdateError},
    HostAccess, HostProcess,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str =
    "https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/latest/download/latest.json";
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const AVAILABLE_EVENT: &str = "update:available";
const ERROR_EVENT: &str = "update:error";
const PROGRESS_EVENT: &str = "update:progress";

fn installation_directory_arg(executable: &Path) -> Result<OsString, UpdateError> {
    let directory = executable.parent().ok_or_else(update_error::check_failed)?;
    // NSIS requires /D last and unquoted, including when the path has spaces.
    // Pin the running copy rather than restoring a different registry location.
    let mut argument = OsString::from("/D=");
    argument.push(directory);
    Ok(argument)
}

pub fn wait_for_host_close(
    mut exited: impl FnMut() -> Result<Option<bool>, String>,
    wal: &Path,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        match exited()? {
            Some(false) => {
                return Err(
                    "The local host did not close successfully; the update was stopped.".into(),
                )
            }
            Some(true) if !wal.try_exists().map_err(|error| error.to_string())? => return Ok(()),
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err("The local host or SQLite WAL is still open; the update was stopped. Reopen ScienceScope and try again.".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub struct UpdateState {
    release: Mutex<Option<Update>>,
    installing: AtomicBool,
    automatic_started: AtomicBool,
    data_root: PathBuf,
}

impl UpdateState {
    pub fn new(data_root: PathBuf) -> Self {
        Self {
            release: Mutex::new(None),
            installing: AtomicBool::new(false),
            automatic_started: AtomicBool::new(false),
            data_root,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CheckResult {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn emit<R: tauri::Runtime>(app: &AppHandle<R>, event: &str, payload: impl Serialize + Clone) {
    let _ = app.emit_to("main", event, payload);
}

fn require_main(window: &WebviewWindow) -> Result<(), UpdateError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(UpdateError::new(
            "UPDATE_MAIN_WINDOW_ONLY",
            "Updates are available in the main window.",
        ))
    }
}

pub fn validate_endpoint(value: &str) -> Result<url::Url, UpdateError> {
    let url = url::Url::parse(value).map_err(|_| {
        UpdateError::new("UPDATE_INVALID_ENDPOINT", "The update address is invalid.")
    })?;
    if url.scheme() == "https" || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1")) {
        Ok(url)
    } else {
        Err(UpdateError::new(
            "UPDATE_INVALID_ENDPOINT",
            "Updates require HTTPS or http://127.0.0.1.",
        ))
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn automatic_due(settings: &Value, now: u64) -> bool {
    settings
        .pointer("/updates/autoCheck")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && settings
            .pointer("/updates/lastCheckedAt")
            .and_then(Value::as_u64)
            .map(|last| now.saturating_sub(last) >= DAY_MS)
            .unwrap_or(true)
}

async fn settings(app: &AppHandle, changes: Option<Value>) -> Result<Value, UpdateError> {
    let access = app.state::<HostAccess>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || host_http::settings(&access, changes))
        .await
        .map_err(|error| UpdateError::new("UPDATE_SETTINGS_FAILED", error.to_string()))?
        .map_err(|error| UpdateError::new("UPDATE_SETTINGS_FAILED", error))
}

async fn check(app: &AppHandle) -> Result<CheckResult, UpdateError> {
    let state = app.state::<UpdateState>();
    if state.installing.load(Ordering::Acquire) {
        return Err(UpdateError::new(
            "UPDATE_BUSY",
            "An update is already being installed.",
        ));
    }
    let endpoint =
        std::env::var("SCIENCESCOPE_UPDATE_ENDPOINT").unwrap_or_else(|_| ENDPOINT.into());
    let executable = std::env::current_exe().map_err(|_| update_error::check_failed())?;
    let updater = app
        .updater_builder()
        .installer_arg(installation_directory_arg(&executable)?)
        .endpoints(vec![validate_endpoint(&endpoint)?])
        .and_then(|builder| builder.timeout(Duration::from_secs(120)).build())
        .map_err(|_| update_error::check_failed())?;
    let release = updater
        .check()
        .await
        .map_err(|_| update_error::check_failed())?;
    if let Some(release) = &release {
        validate_endpoint(release.download_url.as_str())?;
    }
    let result = CheckResult {
        available: release.is_some(),
        version: release.as_ref().map(|release| release.version.clone()),
        notes: release.as_ref().and_then(|release| release.body.clone()),
        date: release.as_ref().and_then(|release| {
            release
                .raw_json
                .get("pub_date")
                .and_then(Value::as_str)
                .map(str::to_owned)
        }),
    };
    *state
        .release
        .lock()
        .map_err(|_| UpdateError::new("UPDATE_STATE_FAILED", "Update state is unavailable."))? =
        release;
    if result.available {
        emit(app, AVAILABLE_EVENT, result.clone());
    }
    Ok(result)
}

#[tauri::command]
pub async fn check_update(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<CheckResult, UpdateError> {
    require_main(&window)?;
    // Manual checks leave settings untouched and are never throttled.
    let result = check(&app).await;
    if let Err(error) = &result {
        emit(&app, ERROR_EVENT, error.clone());
    }
    result
}

pub fn start_automatic(app: &AppHandle) {
    if app
        .state::<UpdateState>()
        .automatic_started
        .swap(true, Ordering::AcqRel)
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let current = settings(&app, None).await?;
            let now = now_ms();
            if !automatic_due(&current, now) {
                return Ok(());
            }
            // Persist before requesting the endpoint, including failed attempts.
            settings(&app, Some(json!({"updates": {"lastCheckedAt": now}}))).await?;
            check(&app).await.map(|_| ())
        }
        .await;
        if let Err(error) = result {
            emit(&app, ERROR_EVENT, error);
        }
    });
}

#[tauri::command]
pub async fn install_update(window: WebviewWindow, app: AppHandle) -> Result<(), UpdateError> {
    require_main(&window)?;
    let state = app.state::<UpdateState>();
    if state
        .installing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(UpdateError::new(
            "UPDATE_BUSY",
            "An update is already being installed.",
        ));
    }
    let result = install(&app).await;
    state.installing.store(false, Ordering::Release);
    if let Err(error) = &result {
        emit(&app, ERROR_EVENT, error.clone());
    }
    result
}

async fn install(app: &AppHandle) -> Result<(), UpdateError> {
    let state = app.state::<UpdateState>();
    let mut release = state
        .release
        .lock()
        .map_err(|_| UpdateError::new("UPDATE_STATE_FAILED", "Update state is unavailable."))?
        .clone()
        .ok_or_else(|| {
            UpdateError::new(
                "UPDATE_NOT_CHECKED",
                "Check for an update before installing.",
            )
        })?;
    // A large installer may take longer than the small manifest request.
    release.timeout = Some(Duration::from_secs(30 * 60));
    let mut downloaded = 0;
    emit(
        app,
        PROGRESS_EVENT,
        Progress {
            phase: "downloading",
            downloaded,
            total: None,
        },
    );
    // download() returns only after its complete bytes pass minisign verification.
    let bytes = release
        .download(
            |length, total| {
                downloaded += length as u64;
                emit(
                    app,
                    PROGRESS_EVENT,
                    Progress {
                        phase: "downloading",
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(update_error::download_failed)?;
    let total = Some(bytes.len() as u64);
    emit(
        app,
        PROGRESS_EVENT,
        Progress {
            phase: "verified",
            downloaded,
            total,
        },
    );
    emit(
        app,
        PROGRESS_EVENT,
        Progress {
            phase: "stopping",
            downloaded,
            total,
        },
    );
    let app_for_stop = app.clone();
    let data_root = state.data_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app_for_stop
            .state::<HostProcess>()
            .shutdown_for_update(&data_root)
    })
    .await
    .map_err(|_| update_error::stop_failed())?
    .map_err(|_| update_error::stop_failed())?;
    emit(
        app,
        PROGRESS_EVENT,
        Progress {
            phase: "installing",
            downloaded,
            total,
        },
    );
    // On Windows this starts NSIS in configured passive mode with /R, then exits.
    release
        .install(bytes)
        .map_err(|_| update_error::install_failed())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;

    #[test]
    fn native_events_pass_tauri_validation_and_reach_only_the_main_window() {
        let app = tauri::test::mock_app();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let secondary = tauri::WebviewWindowBuilder::new(
            &app,
            "secondary-assistant",
            tauri::WebviewUrl::default(),
        )
        .build()
        .unwrap();
        let received = std::sync::Arc::new(Mutex::new(Vec::new()));
        for name in [AVAILABLE_EVENT, ERROR_EVENT, PROGRESS_EVENT] {
            let received_main = received.clone();
            main.listen(name, move |event| {
                received_main
                    .lock()
                    .unwrap()
                    .push(("main", event.payload().to_owned()))
            });
            let received_secondary = received.clone();
            secondary.listen(name, move |event| {
                received_secondary
                    .lock()
                    .unwrap()
                    .push(("secondary", event.payload().to_owned()))
            });
            emit(
                app.handle(),
                name,
                json!({"phase":"downloading","downloaded":10,"total":20}),
            );
        }
        let received = received.lock().unwrap();
        assert_eq!(received.len(), 3);
        assert!(received.iter().all(|(window, payload)| *window == "main"
            && serde_json::from_str::<Value>(payload).unwrap()["downloaded"] == 10));
    }

    #[test]
    #[cfg(windows)]
    fn installer_pins_the_running_chinese_and_space_directory_without_quotes() {
        let executable = Path::new(r"H:\中文 安装目录\ScienceScope.exe");
        assert_eq!(
            installation_directory_arg(executable).unwrap(),
            OsString::from(r"/D=H:\中文 安装目录"),
        );
    }

    #[test]
    fn endpoints_allow_production_and_loopback_rehearsal() {
        assert!(validate_endpoint(ENDPOINT).is_ok());
        assert!(validate_endpoint("http://127.0.0.1:43125/latest.json").is_ok());
        assert!(validate_endpoint("http://localhost:43125/latest.json").is_err());
        assert!(validate_endpoint("http://example.com/latest.json").is_err());
        assert!(validate_endpoint("file:///latest.json").is_err());
    }

    #[test]
    fn automatic_checks_follow_persisted_twenty_four_hour_interval() {
        assert!(automatic_due(&json!({}), DAY_MS));
        assert!(!automatic_due(
            &json!({"updates":{"autoCheck":false}}),
            DAY_MS
        ));
        let settings = json!({"updates":{"autoCheck":true,"lastCheckedAt":1000}});
        assert!(!automatic_due(&settings, DAY_MS));
        assert!(automatic_due(&settings, DAY_MS + 1000));
    }

    #[test]
    fn installation_waits_for_host_success_and_wal_removal() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".sciencescope-local/temp/r6b")
            .join(format!("native-close-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let wal = directory.join("test.sqlite-wal");
        std::fs::write(&wal, b"pending writes").unwrap();
        assert!(wait_for_host_close(|| Ok(Some(true)), &wal, Duration::ZERO).is_err());
        std::fs::remove_file(&wal).unwrap();
        assert!(wait_for_host_close(|| Ok(None), &wal, Duration::ZERO).is_err());
        assert!(wait_for_host_close(|| Ok(Some(false)), &wal, Duration::ZERO).is_err());
        assert!(wait_for_host_close(|| Ok(Some(true)), &wal, Duration::ZERO).is_ok());
        std::fs::remove_dir(&directory).unwrap();
    }
}
