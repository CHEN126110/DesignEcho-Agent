param(
  [Parameter(Mandatory = $true)]
  [string]$ShareName,

  [Parameter(Mandatory = $true)]
  [string]$SharePath,

  [ValidateSet("Read", "Change", "Full")]
  [string]$ShareRight = "Read",

  [switch]$CreateShareIfMissing
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script in an elevated PowerShell window (Run as Administrator)."
  }
}

Assert-Admin

if (-not (Test-Path -LiteralPath $SharePath)) {
  throw "Share path does not exist: $SharePath"
}

$share = Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue
if (-not $share) {
  if ($CreateShareIfMissing) {
    New-SmbShare -Name $ShareName -Path $SharePath -ReadAccess "Everyone" | Out-Null
  } else {
    throw "SMB share not found: $ShareName. Add -CreateShareIfMissing to create it."
  }
}

Set-Service -Name LanmanServer -StartupType Automatic
Start-Service -Name LanmanServer
Set-Service -Name FDResPub -StartupType Automatic
Start-Service -Name FDResPub

Get-NetFirewallRule -Name "FPS-*" -ErrorAction Stop | Set-NetFirewallRule -Enabled True | Out-Null
Get-NetFirewallRule -Name "NETDIS-*" -ErrorAction Stop | Set-NetFirewallRule -Enabled True | Out-Null

# Allow passwordless guest/anonymous SMB access (LAN only; reduced security).
cmd /c "net user guest /active:yes" | Out-Null
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "forceguest" -Type DWord -Value 1
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "everyoneincludesanonymous" -Type DWord -Value 1

$lanmanParams = "HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters"
Set-ItemProperty -Path $lanmanParams -Name "RestrictNullSessAccess" -Type DWord -Value 0
$existingNullShares = @()
try {
  $existingNullShares = @( (Get-ItemProperty -Path $lanmanParams -Name "NullSessionShares" -ErrorAction Stop).NullSessionShares )
} catch {}
if ($existingNullShares -notcontains $ShareName) {
  $newNullShares = @($existingNullShares + $ShareName | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique)
  Set-ItemProperty -Path $lanmanParams -Name "NullSessionShares" -Type MultiString -Value $newNullShares
}

Set-SmbServerConfiguration -EnableAuthenticateUserSharing $false -Confirm:$false -Force

$fsRight = switch ($ShareRight) {
  "Read" { "RX" }
  "Change" { "M" }
  "Full" { "F" }
}

Revoke-SmbShareAccess -Name $ShareName -AccountName "Everyone" -Force -ErrorAction SilentlyContinue | Out-Null
Grant-SmbShareAccess -Name $ShareName -AccountName "Everyone" -AccessRight $ShareRight -Force | Out-Null

& icacls.exe "$SharePath" /grant "Everyone:(OI)(CI)$fsRight" /T /C | Out-Null

Write-Host ""
Write-Host "Configuration complete."
Write-Host "Share: $ShareName"
Write-Host "Access: Everyone ($ShareRight), passwordless guest enabled"
Write-Host "Open from other PCs:"
Write-Host "\\$env:COMPUTERNAME\\$ShareName"
Write-Host ""
Write-Host "If client PCs are blocked by policy, run this on each client as admin:"
Write-Host "reg add \"HKLM\SOFTWARE\Policies\Microsoft\Windows\LanmanWorkstation\" /v AllowInsecureGuestAuth /t REG_DWORD /d 1 /f"
