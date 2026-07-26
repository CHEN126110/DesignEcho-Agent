param(
  [string]$Server = "192.168.2.201",
  [Parameter(Mandatory = $true)]
  [string]$ShareName,
  [string]$SubPath = "C-1041",
  [switch]$FixGuestPolicy
)

$ErrorActionPreference = "Continue"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Result {
  param(
    [string]$Label,
    [string]$Value
  )

  "{0,-28} {1}" -f $Label, $Value
}

$rootPath = "\\$Server\$ShareName"
$childPath = Join-Path $rootPath $SubPath
$isAdmin = Test-IsAdmin

Write-Host "LAN Share Client Diagnostics"
Write-Host ""
Write-Host (Write-Result "Server" $Server)
Write-Host (Write-Result "RootShare" $rootPath)
Write-Host (Write-Result "SubPath" $childPath)
Write-Host (Write-Result "RunAsAdmin" $isAdmin)
Write-Host ""

Write-Host "[1] Clear cached SMB sessions"
cmd /c "net use \\$Server /delete /y >nul 2>&1"
Write-Host (Write-Result "NetUseCleared" "Done")
Write-Host ""

Write-Host "[2] Network reachability"
$pingOk = Test-Connection -ComputerName $Server -Count 1 -Quiet
$port445 = Test-NetConnection -ComputerName $Server -Port 445 -InformationLevel Quiet
$workstation = Get-Service -Name LanmanWorkstation -ErrorAction SilentlyContinue
Write-Host (Write-Result "Ping" $pingOk)
Write-Host (Write-Result "TCP445" $port445)
if ($workstation) {
  Write-Host (Write-Result "LanmanWorkstation" $workstation.Status)
}
Write-Host ""

Write-Host "[3] SMB path checks"
$rootExists = Test-Path -LiteralPath $rootPath
$childExists = Test-Path -LiteralPath $childPath
Write-Host (Write-Result "RootExists" $rootExists)
Write-Host (Write-Result "ChildExists" $childExists)
if ($rootExists) {
  try {
    $rootItems = Get-ChildItem -LiteralPath $rootPath -ErrorAction Stop | Select-Object -First 10 -ExpandProperty Name
    Write-Host (Write-Result "RootList" (($rootItems -join ", ")))
  } catch {
    Write-Host (Write-Result "RootListError" $_.Exception.Message)
  }
}
if ($childExists) {
  try {
    $childItems = Get-ChildItem -LiteralPath $childPath -ErrorAction Stop | Select-Object -First 10 -ExpandProperty Name
    Write-Host (Write-Result "ChildList" (($childItems -join ", ")))
  } catch {
    Write-Host (Write-Result "ChildListError" $_.Exception.Message)
  }
}
Write-Host ""

Write-Host "[4] Guest / insecure guest policy"
$guestPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\LanmanWorkstation"
$guestPolicyName = "AllowInsecureGuestAuth"
$guestPolicyValue = $null
try {
  $guestPolicyValue = (Get-ItemProperty -Path $guestPolicyPath -Name $guestPolicyName -ErrorAction Stop).$guestPolicyName
} catch {
  $guestPolicyValue = "<not set>"
}
Write-Host (Write-Result "AllowInsecureGuestAuth" $guestPolicyValue)

if ($FixGuestPolicy) {
  if (-not $isAdmin) {
    Write-Host (Write-Result "GuestPolicyFix" "Skipped: run as Administrator")
  } else {
    New-Item -Path $guestPolicyPath -Force | Out-Null
    New-ItemProperty -Path $guestPolicyPath -Name $guestPolicyName -PropertyType DWord -Value 1 -Force | Out-Null
    Write-Host (Write-Result "GuestPolicyFix" "Applied")
  }
}
Write-Host ""

Write-Host "[5] Current SMB mappings"
cmd /c "net use"
Write-Host ""

Write-Host "[6] Summary"
if (-not $pingOk) {
  Write-Host "Network issue: client cannot ping server $Server."
} elseif (-not $port445) {
  Write-Host "SMB blocked: TCP 445 is not reachable."
} elseif ($workstation -and $workstation.Status -ne "Running") {
  Write-Host "Client SMB service is not running: LanmanWorkstation."
} elseif (-not $rootExists) {
  Write-Host "Client cannot open the root share. Common causes: stale SMB session, guest access blocked, endpoint security, or local policy."
} elseif (-not $childExists) {
  Write-Host "Root share opens but subfolder path fails. Common causes: old shortcut, typo in subfolder name, or delayed folder refresh."
} else {
  Write-Host "Share path is reachable from this client."
}
