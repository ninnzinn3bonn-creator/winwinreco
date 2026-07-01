param(
    [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

# PowerShell 7 uses UTF-8 no BOM as the normal file encoding, which removes a
# major source of mojibake compared with Windows PowerShell 5.1. Installation is
# intentionally explicit because it changes the developer machine, not just the
# repository.
$ExistingPwsh = Get-Command pwsh -ErrorAction SilentlyContinue
if ($ExistingPwsh) {
    $VersionText = & $ExistingPwsh.Source -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
    Write-Host "PowerShell 7 is already available: $($ExistingPwsh.Source) ($VersionText)"
    exit 0
}

$Winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $Winget) {
    throw "winget is not available. Install PowerShell 7 from https://github.com/PowerShell/PowerShell/releases"
}

$InstallArgs = @(
    'install',
    '--id', 'Microsoft.PowerShell',
    '--exact',
    '--source', 'winget',
    '--scope', 'user',
    '--accept-package-agreements',
    '--accept-source-agreements'
)

if ($WhatIfOnly) {
    Write-Host "winget $($InstallArgs -join ' ')"
    exit 0
}

& $Winget.Source @InstallArgs

$InstalledPwsh = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $InstalledPwsh) {
    Write-Warning "Install command finished, but pwsh was not found on PATH. Restart the terminal and run 'pwsh -NoLogo'."
    exit 0
}

$InstalledVersion = & $InstalledPwsh.Source -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
Write-Host "PowerShell 7 installed: $($InstalledPwsh.Source) ($InstalledVersion)"
