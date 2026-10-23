use std::{ffi::OsStr, path::{Path, PathBuf}};

/// Installed programs use their adjacent resources and data, while development
/// retains the repository's ignored data root and optional launch overrides.
pub struct NewAppLaunch {
    pub script: PathBuf,
    pub data_root: PathBuf,
    pub node: PathBuf,
    pub uv: PathBuf,
}

impl NewAppLaunch {
    pub fn resolve(executable_root: &Path, data_override: Option<&OsStr>) -> std::io::Result<Self> {
        let app_root = if cfg!(debug_assertions) {
            Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("native source has a repository root")
        } else {
            executable_root
        };
        let data_root = match data_override.filter(|value| !value.is_empty()) {
            Some(value) => std::path::absolute(Path::new(value))?,
            None if cfg!(debug_assertions) => app_root.join(".sciencescope-local").join("data"),
            None => app_root.join("data"),
        };
        let node = if cfg!(debug_assertions) { PathBuf::from("node") }
            else { app_root.join("runtime").join("node.exe") };
        let uv = if cfg!(debug_assertions) { app_root.join(".sciencescope-local").join("runtimes").join("uv").join("uv.exe") }
            else { app_root.join("runtime").join("uv.exe") };
        Ok(Self { script: app_root.join("app").join("main.js"), data_root, node, uv })
    }

    pub fn configure(&self, command: &mut std::process::Command) {
        command.arg(&self.script).arg("--data").arg(&self.data_root)
            .current_dir(self.script.parent().and_then(Path::parent).expect("app script has a root"));
        if std::env::var_os("SCIENCESCOPE_UV").is_none() {
            command.env("SCIENCESCOPE_UV", &self.uv);
        }
        // Runtime tools must find the bundled Node, even with no developer PATH.
        if let Some(parent) = self.node.parent().filter(|parent| !parent.as_os_str().is_empty()) {
            let paths = std::iter::once(parent.to_path_buf()).chain(
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            ).collect::<Vec<_>>();
            if let Ok(paths) = std::env::join_paths(paths) { command.env("PATH", paths); }
        }
    }
}

pub fn readiness(parsed: &serde_json::Value) -> Result<(String, String), Box<dyn std::error::Error>> {
    let ui = parsed.get("ui").and_then(serde_json::Value::as_str)
        .ok_or("app readiness JSON did not contain ui")?;
    let token = parsed.get("token").and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= 256)
        .ok_or("app API capability was invalid")?;
    Ok((ui.to_owned(), token.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};

    #[test]
    fn launch_uses_app_main_with_its_data_root() {
        let launch = NewAppLaunch::resolve(Path::new("."), None).unwrap();
        let mut command = std::process::Command::new("node");
        launch.configure(&mut command);
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, [launch.script.as_os_str(), OsStr::new("--data"), launch.data_root.as_os_str()]);
        assert!(launch.script.ends_with(Path::new("app").join("main.js")));
        if cfg!(debug_assertions) {
            assert!(launch.data_root.ends_with(Path::new(".sciencescope-local").join("data")));
        } else {
            assert!(launch.data_root.ends_with("data"));
            assert!(launch.node.ends_with(Path::new("runtime").join("node.exe")));
        }
    }

    #[test]
    fn chinese_data_path_and_first_json_line_are_preserved() {
        let path = std::path::absolute(".sciencescope-local/temp/中文 数据").unwrap();
        let launch = NewAppLaunch::resolve(Path::new("."), Some(path.as_os_str())).unwrap();
        assert_eq!(launch.data_root, path);
        let mut reader = BufReader::new(concat!(
            "{\"url\":\"http://127.0.0.1:43123\",\"ui\":\"http://127.0.0.1:43123/?token=launch-token\",\"token\":\"launch-token\",\"dataRoot\":\"中文 数据\"}\r\n",
            "later diagnostics\n"
        ).as_bytes());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let parsed = serde_json::from_str(line.trim()).unwrap();
        let (ui, token) = readiness(&parsed).unwrap();
        assert_eq!(ui, "http://127.0.0.1:43123/?token=launch-token");
        assert_eq!(token, "launch-token");
    }
}
