# Winget Release Process

Brows3 already exists in the public Windows Package Manager catalog as `Brows3Team.Brows3`. Keep that identifier unchanged: using a different publisher prefix creates a second package and does not update existing installations.

## What The Release Workflow Does

After all platform builds pass, `.github/scripts/write-winget-manifests.js` reads the actual draft-release metadata and attaches manifests for the MSI and NSIS installers. It refuses assets without a GitHub-provided SHA256 digest. The GitHub release remains a draft until the workflow verifies every required platform artifact and updater signature.

Release attachments alone do not update the public Winget catalog. Microsoft publishes a version only after a manifest pull request to `microsoft/winget-pkgs` passes its automated validation and review.

## Submit A Published Release

Wait until both Windows installers are present on the final GitHub release, then use [Komac](https://github.com/russellbanks/Komac) to inspect the installers, retain package metadata such as ProductCode, and submit the update:

```bash
komac update Brows3Team.Brows3 \
  --version <version> \
  --urls \
    https://github.com/rgcsekaraa/brows3/releases/download/app-v<version>/Brows3_<version>_x64-setup.exe \
    https://github.com/rgcsekaraa/brows3/releases/download/app-v<version>/Brows3_<version>_x64_en-US.msi \
  --submit
```

Review the generated manifest before confirming submission. It should contain:

- package identifier `Brows3Team.Brows3`
- the exact release version and immutable release URLs
- SHA256 digests calculated from the published installers
- `nullsoft`/user scope for the EXE and `wix`/machine scope for the MSI
- the installer ProductCode and Apps & Features metadata discovered from the files

Track the resulting pull request until the validation and publish pipelines succeed. Microsoft documents the distinction between a merged manifest and the indexed public catalog in its [Winget repository submission guide](https://learn.microsoft.com/windows/package-manager/package/repository).

## Verify From Windows

After the pull request is merged and the catalog refreshes, verify from a Windows x64 system:

```powershell
winget source update
winget show --exact --id Brows3Team.Brows3
winget install --exact --id Brows3Team.Brows3
```

Confirm that `winget show` reports the new version and that a clean install launches successfully. The GitHub release remains the immediate download source while the community catalog is indexing.
