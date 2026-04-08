# macOS: "App is damaged and can't be opened"

If you see a message saying "Brows3.app is damaged and can't be opened" when trying to launch the downloaded application, Gatekeeper is blocking that build. The proper fix is a signed and notarized release. Until that is available for the build you downloaded, use the steps below.

## Recommended Install Flow

1. Open the downloaded `.dmg`.
2. Drag `Brows3.app` into `/Applications`.
3. Eject the mounted `Brows3` disk image.
4. Launch `Brows3.app` from `/Applications`, not from inside the mounted DMG.
5. After the app is copied, move the downloaded `.dmg` file to the Bin if you no longer need it.

## 🛠️ The Fix (One Command)

To fix this, you just need to remove the "quarantine" flag that macOS adds to files downloaded from the internet.

1. Open **Terminal** (Command + Space, type "Terminal").
2. Run the following command:

```bash
sudo xattr -rd com.apple.quarantine /Applications/Brows3.app
```

> [!NOTE]
> If you haven't moved the app to your `/Applications` folder yet, replace the path above with the actual location of the app.

---

## 🏗️ Why is this happening?
Apple expects downloaded macOS applications to be code signed and, for smooth first-run installation, notarized. Tauri also documents macOS code signing as the way to prevent the app from being reported as broken when downloaded from the browser.

By running the command above, you are telling macOS that you trust this community-built app.

## 🛡️ Other Verification Options
If you are uncomfortable running the command above, you can also:
1. **Build from source**: Following the [Installation Guide](../README.md#manual-build) ensures the app is built and signed locally on your machine.
2. **Wait for a notarized release**: CI now supports Apple signing and notarization when the required Apple credentials are configured.
3. **Download via Homebrew** (Coming soon): Package managers often handle these trust issues for you.
