$ErrorActionPreference = 'Stop'
$version = $env:RELEASE_VERSION
$bundleRoot = 'src-tauri/target/release/bundle'
$msi = Get-Item "$bundleRoot/msi/Brows3_${version}_x64_en-US.msi"
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msi.FullName, 0)
$view = $database.OpenView("SELECT Value FROM Property WHERE Property = 'ProductVersion'")
$view.Execute()
$record = $view.Fetch()
if ($record.StringData(1) -ne $version) { throw 'MSI version does not match the release' }
$view.Close()

$nsis = Get-Item "$bundleRoot/nsis/Brows3_${version}_x64-setup.exe"
$installPath = Join-Path $env:RUNNER_TEMP 'brows3-install-smoke'
$install = Start-Process -FilePath $nsis.FullName -ArgumentList '/S', "/D=$installPath" -PassThru
if (-not $install.WaitForExit(180000)) {
    $install.Kill($true)
    throw 'NSIS installation timed out'
}
if ($install.ExitCode -ne 0) { throw "NSIS installation failed with $($install.ExitCode)" }
if (-not (Test-Path "$installPath/brows3.exe")) { throw 'NSIS did not install the application' }

$portablePath = Join-Path $env:RUNNER_TEMP 'brows3-portable-smoke'
Expand-Archive -Path "$bundleRoot/portable/Brows3_${version}_x64-portable.zip" -DestinationPath $portablePath
$binary = Get-ChildItem $portablePath -Filter Brows3.exe -Recurse | Select-Object -First 1
if (-not $binary) { throw 'Portable archive has no executable' }
if (-not (Test-Path (Join-Path $binary.DirectoryName 'brows3.portable'))) { throw 'Portable marker is missing' }
$app = Start-Process -FilePath $binary.FullName -PassThru
try {
    if ($app.WaitForExit(10000)) { throw "Portable application exited during startup with $($app.ExitCode)" }
} finally {
    if (-not $app.HasExited) {
        $null = $app.CloseMainWindow()
        if (-not $app.WaitForExit(5000)) { $app.Kill($true) }
    }
}
Write-Output "Validated MSI metadata, NSIS installation and portable startup for $version"
