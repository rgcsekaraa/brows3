fn main() {
    let attributes = tauri_build::Attributes::new();

    #[cfg(windows)]
    let attributes = {
        // tauri-build's default resource compiler currently applies its app
        // manifest only to binaries. Embed the same manifest for every linked
        // artifact so Windows unit-test executables also activate Common
        // Controls v6 instead of failing before the test harness starts.
        embed_windows_manifest();
        attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    };

    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

#[cfg(windows)]
fn embed_windows_manifest() {
    const MANIFEST_FILE: &str = "windows-app-manifest.xml";
    let manifest = std::env::current_dir()
        .expect("failed to resolve the Tauri project directory")
        .join(MANIFEST_FILE);

    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    println!("cargo:rustc-link-arg=/WX");
}
