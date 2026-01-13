# macOS: "App is damaged and can't be opened"

If you see a message saying "Brows3.app is damaged and can't be opened" when trying to launch the downloaded application, don't worry! This is a standard macOS security behavior for Open Source apps that are not yet signed with a paid Apple Developer certificate.

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
To remove this message automatically, Apple requires developers to pay a **$99/year fee** for an "Application Notarization" service. Since Brows3 is a free, community-driven project, we prioritize building features over paying for certificates.

By running the command above, you are telling macOS that you trust this community-built app.

## 🛡️ Other Verification Options
If you are uncomfortable running the command above, you can also:
1. **Build from source**: Following the [Installation Guide](../README.md#manual-build) ensures the app is built and signed locally on your machine.
2. **Download via Homebrew** (Coming soon): Package managers often handle these trust issues for you.
