# balde-sp.ps1 - SharePoint folder-permission sync for local Balde deployments (PnP.PowerShell).
# The balde registry (repos.json members) is the source of truth; this script pushes it to the
# folder ACLs that ENFORCE access in local mode. Called by the admin server (Administracao >
# Baldes > Sincronizar SharePoint) or by hand.
#
# Requires: Install-Module PnP.PowerShell -Scope CurrentUser  +  an approved Entra app (ClientId).
# First run opens an interactive login; PnP caches the token for subsequent runs.
#
# Actions:
#   status                           - module/config check (never writes)
#   setup  -TeamEmails "a,b"         - zone permissions: corpus=Read(team), exchange=Edit(team), app=Read(team)
#   sync-balde -Name X -Emails "a,b" - group "Balde X - Leitura" with those e-mails, Read on corpus/repos/X
# Common: -SiteUrl -ClientId -Library -RootPath (or envs SP_SITE_URL/SP_CLIENT_ID/SP_LIBRARY/SP_ROOT_PATH), -DryRun
param(
  [Parameter(Mandatory = $true)][ValidateSet("status", "setup", "sync-balde")][string]$Action,
  [string]$SiteUrl = $env:SP_SITE_URL,
  [string]$ClientId = $env:SP_CLIENT_ID,
  [string]$Library = $env:SP_LIBRARY,
  [string]$RootPath = $env:SP_ROOT_PATH,
  [string]$Name = "",
  [string]$Emails = "",
  [string]$TeamEmails = "",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

function SplitEmails([string]$raw) {
  $out = New-Object System.Collections.ArrayList
  foreach ($part in $raw.Split(@(",", ";", " "), [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $e = $part.Trim()
    if ($e.Length -gt 0) { [void]$out.Add($e) }
  }
  return ,$out
}

if ($Action -eq "status") {
  $mod = Get-Module -ListAvailable PnP.PowerShell | Select-Object -First 1
  if (-not $mod) { Write-Output "MODULE:missing" } else { Write-Output ("MODULE:" + $mod.Version) }
  if (-not $SiteUrl -or -not $ClientId) { Write-Output "CONFIG:incomplete" } else { Write-Output "CONFIG:ok" }
  exit 0
}

if (-not $SiteUrl -or -not $ClientId -or -not $Library -or -not $RootPath) {
  throw "Config incompleta: SiteUrl/ClientId/Library/RootPath (envs SP_* ou parametros)."
}

$planned = New-Object System.Collections.ArrayList
function Plan([string]$cmd) { [void]$planned.Add($cmd) }

function Connect-Balde {
  if ($DryRun) { Plan ("Connect-PnPOnline -Url " + $SiteUrl + " -Interactive -ClientId " + $ClientId); return }
  Import-Module PnP.PowerShell -ErrorAction Stop
  Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId
}

function Ensure-Group([string]$title, [string]$role) {
  if ($DryRun) { Plan ("New-PnPGroup -Title '" + $title + "' (se nao existir) + Set-PnPGroupPermissions -AddRole " + $role); return }
  $g = Get-PnPGroup -Identity $title -ErrorAction SilentlyContinue
  if (-not $g) { New-PnPGroup -Title $title | Out-Null }
  Set-PnPGroupPermissions -Identity $title -AddRole $role
}

function Sync-GroupMembers([string]$title, $wanted) {
  if ($DryRun) { Plan ("Sync membros de '" + $title + "': " + ($wanted -join ", ")); return }
  $current = @()
  foreach ($m in @(Get-PnPGroupMember -Identity $title -ErrorAction SilentlyContinue)) {
    if ($m -and $m.Email) { $current += $m.Email }
  }
  foreach ($e in $wanted) { if ($current -notcontains $e) { Add-PnPGroupMember -Identity $title -EmailAddress $e } }
  foreach ($c in $current) { if ($wanted -notcontains $c) { Remove-PnPGroupMember -Identity $title -EmailAddress $c } }
}

function Grant-Folder([string]$folderUrl, [string]$group, [string]$role) {
  if ($DryRun) { Plan ("Set-PnPListItemPermission -List '" + $Library + "' em '" + $folderUrl + "' -Group '" + $group + "' -AddRole " + $role); return }
  $folder = Get-PnPFolder -Url $folderUrl -Includes ListItemAllFields
  Set-PnPListItemPermission -List $Library -Identity $folder.ListItemAllFields.Id -Group $group -AddRole $role
}

Connect-Balde

if ($Action -eq "setup") {
  $team = SplitEmails $TeamEmails
  Ensure-Group "Balde - Leitura" "Read"
  Ensure-Group "Balde - Colaboracao" "Edit"
  if ($team.Count -gt 0) {
    Sync-GroupMembers "Balde - Leitura" $team
    Sync-GroupMembers "Balde - Colaboracao" $team
  }
  Grant-Folder ($RootPath + "/corpus") "Balde - Leitura" "Read"
  Grant-Folder ($RootPath + "/exchange") "Balde - Colaboracao" "Edit"
  Grant-Folder ($RootPath + "/app") "Balde - Leitura" "Read"
  Write-Output "SETUP:ok"
}

if ($Action -eq "sync-balde") {
  if (-not $Name) { throw "Informe -Name (o slug do balde)." }
  $emailList = SplitEmails $Emails
  $group = "Balde " + $Name + " - Leitura"
  Ensure-Group $group "Read"
  Sync-GroupMembers $group $emailList
  Grant-Folder ($RootPath + "/corpus/repos/" + $Name) $group "Read"
  Write-Output ("SYNC:" + $Name + ":" + $emailList.Count + " membro(s)")
}

if ($DryRun) {
  Write-Output "DRYRUN - comandos planejados:"
  foreach ($p in $planned) { Write-Output ("  " + $p) }
}
