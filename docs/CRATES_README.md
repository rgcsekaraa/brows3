# Brows3

A desktop browser for Amazon S3 and S3-compatible object storage, built with Tauri.

## Install from source

After the first crates.io release:

```sh
cargo install brows3 --locked
brows3
```

After the matching prebuilt release is available, avoid compiling locally with:

```sh
cargo binstall brows3 --locked
```

Prebuilt targets are macOS ARM64 and Intel, Linux ARM64 and x86-64 (glibc), and
Windows x86-64 (MSVC). Linux binaries require GTK 3, WebKitGTK 4.1, and a graphical
desktop session. Windows requires WebView2. These are standalone executables,
not AppImages or installers; system runtime libraries are not bundled.

The crate includes the compiled web interface. Node.js and pnpm are not required
on the installing machine. Rust and the platform's native build dependencies
are required. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for the C++ toolchain, Linux WebKitGTK 4.1 development libraries, and Windows
WebView2 requirements. Building the AWS SDK can take substantial time and memory.

This installs an executable into Cargo's bin directory, not an application bundle,
desktop shortcut, or file association. Native in-app update endpoints are disabled
in this package. Use Cargo to install newer versions.
For the native desktop installation experience, use the
[official releases](https://github.com/rgcsekaraa/brows3/releases).

Source and issues: [github.com/rgcsekaraa/brows3](https://github.com/rgcsekaraa/brows3).
