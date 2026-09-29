fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "open_secondary_window",
                "set_assistant_mode",
                "get_assistant_mode",
                "show_assistant_menu",
                "hide_assistant",
                "pick_folder",
            ]),
        ),
    ).expect("desktop build metadata failed")
}
