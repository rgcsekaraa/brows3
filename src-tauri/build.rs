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

    #[cfg(feature = "crate-distribution")]
    prepare_crate_build_directory();

    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

// Tauri writes editor schemas relative to its working directory. Published
// crate sources must remain immutable, so run its build helper in OUT_DIR.
// generate_context! still reads the original config and embedded frontend.
#[cfg(feature = "crate-distribution")]
fn prepare_crate_build_directory() {
    use std::{env, fs, path::Path};

    fn copy_directory(source: &Path, destination: &Path) {
        fs::create_dir_all(destination).expect("failed to create build input directory");
        for entry in fs::read_dir(source).expect("failed to read build inputs") {
            let entry = entry.expect("failed to read build input");
            let target = destination.join(entry.file_name());
            if entry
                .file_type()
                .expect("failed to inspect build input")
                .is_dir()
            {
                copy_directory(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).expect("failed to copy build input");
            }
        }
    }

    let source = env::current_dir().expect("failed to locate crate source");
    let destination = std::path::PathBuf::from(env::var_os("OUT_DIR").expect("missing OUT_DIR"))
        .join("tauri-inputs");
    fs::create_dir_all(&destination).expect("failed to create Tauri build directory");
    for name in ["Cargo.toml", "tauri.conf.json"] {
        println!("cargo:rerun-if-changed={}", source.join(name).display());
        fs::copy(source.join(name), destination.join(name)).expect("failed to copy Tauri input");
    }
    for name in ["capabilities", "icons"] {
        println!("cargo:rerun-if-changed={}", source.join(name).display());
        copy_directory(&source.join(name), &destination.join(name));
    }
    env::set_current_dir(destination).expect("failed to select Tauri build directory");
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
