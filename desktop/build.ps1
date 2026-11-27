# Builds the desktop app and the installer.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1
#
# Outputs:
#   desktop\dist\ENVIS Dashboard.exe        portable app (single file)
#   desktop\dist\ENVIS Dashboard Setup.exe  installer, app embedded inside
#
# The default app build is self-contained: the .NET runtime is packed inside the
# single .exe, so the target PC needs only Node.js (already required by the
# project) and the WebView2 runtime (installed with Windows 10/11 and Edge).
[CmdletBinding()]
param(
    # Smaller app exe that reuses an installed .NET 8 Desktop Runtime.
    [switch]$FrameworkDependent,

    # Skip the app, rebuild only the installer from desktop\dist.
    [switch]$SetupOnly,

    # Skip the installer, build only the portable app.
    [switch]$AppOnly
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$project = Join-Path $here 'EnvisDashboard.csproj'
$publish = Join-Path $here 'publish'
$dist = Join-Path $here 'dist'
$icon = Join-Path $here 'assets\envis.ico'

$setupProject = Join-Path $here 'installer\EnvisSetup.csproj'
$setupPublish = Join-Path $here 'installer\publish'
$offlineApp = Join-Path $here 'offline-app'
$offlineZip = Join-Path $here 'offline-app.zip'

$appTarget = Join-Path $dist 'ENVIS Dashboard.exe'
$setupTarget = Join-Path $dist 'ENVIS Dashboard Setup.exe'

function Format-Size([long]$bytes) {
    return [math]::Round($bytes / 1MB, 1)
}

if (-not (Test-Path $icon)) {
    & (Join-Path $here 'make-icon.ps1')
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

if (-not $SetupOnly) {
    if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }

    $selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }

    & dotnet publish $project `
        -c Release `
        -o $publish `
        --nologo `
        -p:SelfContained=$selfContained `
        -p:PublishSingleFile=true
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE"
    }

    $built = Get-ChildItem $publish -Filter 'ENVISDashboard.exe' -File |
        Select-Object -First 1
    if (-not $built) {
        throw "The published executable was not found in $publish"
    }

    Copy-Item $built.FullName $appTarget -Force

    Write-Output ''
    Write-Output ("App  : {0}  ({1} MB, {2})" -f $appTarget, (Format-Size (Get-Item $appTarget).Length), $(if ($FrameworkDependent) { 'framework-dependent' } else { 'self-contained' }))
}

if (-not $AppOnly) {
    if (-not (Test-Path $appTarget)) {
        throw "Build the app first: $appTarget was not found."
    }

    Write-Output ''
    Write-Output 'Building the offline dashboard copy (app + data + map tiles)...'
    & node (Join-Path $root 'scripts\build-offline-app.mjs')
    if ($LASTEXITCODE -ne 0) { throw "The offline copy failed to build (exit code $LASTEXITCODE)." }

    if (-not (Test-Path (Join-Path $offlineApp 'index.html'))) {
        throw "The offline copy was not produced in $offlineApp."
    }

    if (Test-Path $offlineZip) { Remove-Item $offlineZip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $offlineApp, $offlineZip,
        [System.IO.Compression.CompressionLevel]::Optimal, $false)

    if (Test-Path $setupPublish) { Remove-Item $setupPublish -Recurse -Force }

    & dotnet publish $setupProject `
        -c Release `
        -o $setupPublish `
        --nologo `
        -p:AppExePath="$appTarget" `
        -p:OfflineAppZip="$offlineZip"
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish (installer) failed with exit code $LASTEXITCODE"
    }

    $setupBuilt = Get-ChildItem $setupPublish -Filter 'ENVISDashboardSetup.exe' -File |
        Select-Object -First 1
    if (-not $setupBuilt) {
        throw "The published installer was not found in $setupPublish"
    }

    Copy-Item $setupBuilt.FullName $setupTarget -Force

    Write-Output ("Setup: {0}  ({1} MB, app embedded)" -f $setupTarget, (Format-Size (Get-Item $setupTarget).Length))
}

# Publish checksums so users can detect a tampered download. This is not a
# replacement for Authenticode signing, which needs a code-signing certificate.
$checksums = Join-Path $dist 'SHA256SUMS.txt'
$lines = @('# ENVIS Dashboard SHA-256 checksums')
foreach ($file in (Get-ChildItem $dist -File | Where-Object { $_.Name -like '*.exe' })) {
    $lines += ('{0}  {1}' -f (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $file.Name)
}
Set-Content -Path $checksums -Value $lines -Encoding UTF8

Write-Output ''
Write-Output ('Checksums: {0}' -f $checksums)
Write-Output 'Done. Nothing was started.'
