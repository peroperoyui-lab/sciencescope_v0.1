use std::{fs::OpenOptions, io::Write, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

#[derive(Clone, Default)]
pub struct StartupObservation {
    file: Option<PathBuf>,
}

impl StartupObservation {
    pub fn from_environment() -> Self {
        Self { file: std::env::var_os("SCIENCESCOPE_PERF_STARTUP_NATIVE").map(PathBuf::from) }
    }

    pub fn mark(&self, stage: &'static str) {
        let Some(file) = &self.file else { return };
        let record = serde_json::json!({
            "schema": 1,
            "stage": stage,
            "window": "main",
            "epochMs": SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs_f64() * 1000.0).unwrap_or(0.0),
        });
        let write = || -> std::io::Result<()> {
            if let Some(parent) = file.parent() { std::fs::create_dir_all(parent)?; }
            writeln!(OpenOptions::new().create(true).append(true).open(file)?, "{record}")
        };
        if write().is_err() { eprintln!("Native startup observation could not be written."); }
    }

    pub fn initialization_script(&self) -> &'static str {
        if self.file.is_none() { return ""; }
        "Object.defineProperty(window, '__SCIENCESCOPE_STARTUP_OBSERVE__', { value: { schema: 1 }, enumerable: false }); performance.setResourceTimingBufferSize(3000); performance.mark('sciencescope.document-start');"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opt_in_observation_records_native_stages_and_enables_buffered_browser_marks() {
        assert_eq!(StartupObservation::default().initialization_script(), "");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join(".sciencescope-local/temp");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join(format!("native-startup-observation-{}-{}.jsonl", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let observation = StartupObservation { file: Some(file.clone()) };
        observation.mark("mainWebviewBuildStart");
        observation.mark("mainWebviewBuildEnd");
        let records = std::fs::read_to_string(&file).unwrap().lines().map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()).collect::<Vec<_>>();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["stage"], "mainWebviewBuildStart");
        assert_eq!(records[1]["stage"], "mainWebviewBuildEnd");
        assert_eq!(records[0]["window"], "main");
        assert!(records[1]["epochMs"].as_f64().unwrap() >= records[0]["epochMs"].as_f64().unwrap());
        assert!(observation.initialization_script().contains("sciencescope.document-start"));
        std::fs::remove_file(file).unwrap();
    }
}
