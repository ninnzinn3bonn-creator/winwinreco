param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 defaults to legacy encodings for several file cmdlets.
# This script pins the current session to UTF-8 so reading repo files does not
# produce mojibake and new files are not accidentally written as UTF-16LE/ANSI.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$script:OutputEncoding = $Utf8NoBom

try {
    chcp 65001 | Out-Null
} catch {
    # chcp can fail in restricted hosts. Console Encoding above is the primary
    # guard, so keep the setup usable when chcp is unavailable.
}

$FileEncoding = if ($PSVersionTable.PSVersion.Major -ge 6) { 'utf8NoBOM' } else { 'UTF8' }

# These defaults cover the cmdlets most likely to create or inspect text files
# during agent work. They are session-scoped and do not change the user's
# global PowerShell profile.
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'
$PSDefaultParameterValues['Set-Content:Encoding'] = $FileEncoding
$PSDefaultParameterValues['Add-Content:Encoding'] = $FileEncoding
$PSDefaultParameterValues['Out-File:Encoding'] = $FileEncoding
$PSDefaultParameterValues['Export-Csv:Encoding'] = $FileEncoding
$PSDefaultParameterValues['Import-Csv:Encoding'] = 'UTF8'
$PSDefaultParameterValues['Select-String:Encoding'] = 'UTF8'

if (-not $Quiet) {
    Write-Host "PowerShell UTF-8 session configured"
    Write-Host "PowerShell: $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)"
    Write-Host "Console input: $([Console]::InputEncoding.WebName)"
    Write-Host "Console output: $([Console]::OutputEncoding.WebName)"
    Write-Host "File cmdlet encoding: $FileEncoding"
    Write-Host "Tip: avoid bare > redirection in Windows PowerShell 5.1; use Set-Content/Out-File after this script."
}
