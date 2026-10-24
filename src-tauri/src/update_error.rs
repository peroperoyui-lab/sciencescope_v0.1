use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct UpdateError {
    pub code: &'static str,
    pub message: String,
}

impl UpdateError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn check_failed() -> UpdateError {
    UpdateError::new("UPDATE_CHECK_FAILED", "检查更新未完成，当前版本没有改动。请检查网络后重试。\nThe update check did not finish. Your current version is unchanged. Check your connection and try again.")
}

pub fn download_failed(error: tauri_plugin_updater::Error) -> UpdateError {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => UpdateError::new(
            "UPDATE_SIGNATURE_FAILED",
            "更新包签名校验未通过，当前版本没有改动。请重新检查并下载更新。\nUpdate signature verification failed. Your current version is unchanged. Check for updates and download again.",
        ),
        _ => UpdateError::new("UPDATE_DOWNLOAD_FAILED", "更新下载未完成，当前版本没有改动。请检查网络后重试。\nThe update download did not finish. Your current version is unchanged. Check your connection and try again."),
    }
}

pub fn stop_failed() -> UpdateError {
    UpdateError::new("UPDATE_HOST_STOP_FAILED", "本地服务未能安全关闭，已停止安装。请重新打开 ScienceScope 后重试。\nThe local service could not close safely, so installation was stopped. Reopen ScienceScope and try again.")
}

pub fn install_failed() -> UpdateError {
    UpdateError::new("UPDATE_INSTALL_FAILED", "更新安装程序未能启动。请重新打开 ScienceScope 后重试，或手动下载安装包。\nThe update installer could not start. Reopen ScienceScope and try again, or download the installer manually.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_explain_retry_without_raw_network_or_signature_details() {
        let disconnected = download_failed(tauri_plugin_updater::Error::Network(
            "private URL and raw diagnostics".into(),
        ));
        assert_eq!(disconnected.code, "UPDATE_DOWNLOAD_FAILED");
        assert!(disconnected.message.contains("当前版本没有改动"));
        assert!(disconnected.message.contains("try again"));
        assert!(!disconnected.message.contains("private URL"));
        let signature = download_failed(tauri_plugin_updater::Error::SignatureUtf8(
            "raw signature".into(),
        ));
        assert_eq!(signature.code, "UPDATE_SIGNATURE_FAILED");
        assert!(signature.message.contains("签名校验未通过"));
        assert!(check_failed().message.contains("当前版本没有改动"));
        assert!(install_failed().message.contains("重新打开"));
    }
}
