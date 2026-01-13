# macOS Code Signing & Notarization Guide

To prevent the "Brows3.app is damaged and can't be opened" error, the macOS build must be signed and notarized by Apple. This process is automated in our [Release Workflow](file:///Users/rgchandrasekaraa/chan-main-proj/.github/workflows/release.yml) but requires following secrets to be set in your GitHub repository.

## 1. Prerequisites
- An active [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year).
- A Mac for exporting the certificate.

## 2. Required GitHub Secrets

| Secret Name | Description |
| :--- | :--- |
| `APPLE_CERTIFICATE` | Base64 encoded `.p12` certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` file. |
| `APPLE_ID` | Your Apple ID email (e.g., `dev@example.com`). |
| `APPLE_PASSWORD` | An **App-Specific Password** (not your login password). |
| `APPLE_TEAM_ID` | Your 10-character Team ID (found in Developer Account). |

## 3. Step-by-Step Setup

### A. Create a Developer ID Application Certificate
1. Open **Keychain Access** on your Mac.
2. Go to **Certificate Assistant** > **Request a Certificate from a Certificate Authority**.
3. Save the request to disk.
4. Go to the [Apple Developer Portal Certificates](https://developer.apple.com/account/resources/certificates/list) page.
5. Click **+**, select **Developer ID Application**, and upload your request.
6. Download the generated `.cer` file and double-click it to install it in your Keychain.

### B. Export the .p12 Certificate
1. In **Keychain Access**, find the new **Developer ID Application** certificate.
2. Right-click it and select **Export**.
3. Choose `.p12` format and set a strong password (`APPLE_CERTIFICATE_PASSWORD`).
4. Convert this file to Base64 to save it as `APPLE_CERTIFICATE`:
   ```bash
   base64 -i YourCert.p12 | pbcopy
   ```

### C. Generate App-Specific Password
1. Sign in to [appleid.apple.com](https://appleid.apple.com).
2. Go to **App-Specific Passwords** and generate a new one called "Brows3 Release".
3. Save this as `APPLE_PASSWORD`.

## 4. Why is this necessary?
macOS Gatekeeper checks for a valid signature and notarization ticket on any app downloaded from the internet. Without these, it labels the app as "damaged" to protect the user. By adding these secrets, Tauri will automatically sign and submit the app to Apple for notarization during the GitHub Actions build.
