# balde-acesso.ps1 - who can open a Balde folder on OneDrive/SharePoint, and applying the access a
# balde declares (balde-repo.json), via Microsoft Graph under the owner's OWN Microsoft login. Uses
# Microsoft's own "Graph Command Line Tools" app, so no app registration is needed wherever the
# tenant allows that app (admin- or user-consented), and no token ever reaches Balde. The owner
# runs this in cmd, sees the exact diff, confirms, and only their own SharePoint rights apply.
#
# Works on ANY synced folder ("repo anywhere"): the local path is mapped to its SharePoint URL via
# the OneDrive sync registry (HKCU\Software\SyncEngines\Providers\OneDrive, longest mount wins, so
# "Add shortcut to My files" shortcuts resolve to the real library), then to the Graph item.
#
# Modes:
#   (default)      Verificar: list who can open each folder, direct or inherited (read-only)
#   -ResolveOnly   map folder(s) to their SharePoint URL, no login
#   -Plano <json>  apply a plan written by the Balde page (balde-acesso-plano/1): diff, confirm
#                  (s/N), grant/revoke, write the receipt (balde-acesso-recibo/1), append the
#                  ledger. -Simular shows the diff and writes a "simulado" receipt only;
#                  -SemConfirmar skips the prompt; -IncluirForaDoBalde also revokes direct grants
#                  Balde did not create. A balde-pastas-plano/1 plan (Administracao > Pastas do
#                  compartilhamento) sets each share folder's own permissions and its Members
#                  group's role instead, and writes a balde-pastas-recibo/1 receipt.
#
# Rules when applying: open=false removes the non-owner broad groups (site Members/Visitors) from
# THAT folder (Graph breaks inheritance on it only; the parent is untouched). Owner-level groups
# always stay. People are granted BEFORE any group is removed, so nobody who stays loses access
# mid-way. Only grants Balde made (per the ledger) are revoked, and never the person running the
# plan. Graph can't grant Full Control, so owners without it get a warning.
#
# Usage (cmd; quoted paths, no trailing backslash):
#   pwsh -NoProfile -ExecutionPolicy Bypass -File balde-acesso.ps1 "C:\...\repos\corporate" "C:\...\repos\x"
#   pwsh -NoProfile -ExecutionPolicy Bypass -File balde-acesso.ps1 -Plano "C:\...\plano-p-xxx.json"
param(
  [switch]$ResolveOnly,
  [string]$Out = "",
  [string]$Plano = "",
  [switch]$Simular,
  [switch]$SemConfirmar,
  [switch]$IncluirForaDoBalde,
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$Folder
)
$ErrorActionPreference = "Stop"
$G = 'https://graph.microsoft.com/v1.0'
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# ---- folder -> SharePoint -> Graph ----------------------------------------------------------------

# OneDrive sync roots: local mount point -> SharePoint URL namespace.
function Get-SyncRoots {
  $roots = @()
  foreach ($k in @(Get-ChildItem 'HKCU:\Software\SyncEngines\Providers\OneDrive' -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty $k.PSPath
    if ($p.MountPoint -and ([string]$p.UrlNamespace) -like 'https://*') {
      $roots += [pscustomobject]@{ Mount = ([string]$p.MountPoint).TrimEnd('\'); Url = [string]$p.UrlNamespace; Type = [string]$p.LibraryType }
    }
  }
  return ,$roots
}

function Resolve-Folder([string]$path, $roots) {
  $full = [System.IO.Path]::GetFullPath($path.Trim('"')).TrimEnd('\')
  $root = $roots | Sort-Object { $_.Mount.Length } -Descending | Where-Object {
    ($full -ieq $_.Mount) -or $full.StartsWith($_.Mount + '\', [System.StringComparison]::OrdinalIgnoreCase)
  } | Select-Object -First 1
  if (-not $root) { throw "Pasta fora do OneDrive sincronizado: $full" }
  if ($root.Url -like '*d.docs.live.net*') { throw "Pasta num OneDrive de conta Microsoft pessoal (fora do tenant): $full" }
  $segs = @()
  foreach ($s in ($full.Substring($root.Mount.Length).TrimStart('\') -split '\\')) { if ($s) { $segs += [Uri]::EscapeDataString($s) } }
  $url = ([Uri]$root.Url).AbsoluteUri.TrimEnd('/')
  if ($segs.Count -gt 0) { $url = $url + '/' + ($segs -join '/') }
  return [pscustomobject]@{ Folder = $full; Url = $url; Rel = ($segs -join '/'); Type = $root.Type }
}

function ConvertTo-ShareId([string]$url) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($url))
  return 'u!' + $b64.TrimEnd('=').Replace('/', '_').Replace('+', '-')
}

# Graph item of a resolved folder. Own OneDrive: path addressing; libraries/shortcuts: /shares.
# A shortcut item carries remoteItem -> work on the REAL folder it points to.
function Get-GraphItem($r) {
  $sel = '?$select=id,name,webUrl,parentReference,remoteItem'
  if ($r.Type -eq 'mysite' -or $r.Type -eq 'personal') {
    $uri = "$G/me/drive/root"
    if ($r.Rel) { $uri = $uri + ':/' + $r.Rel + ':' }
  } else {
    $uri = "$G/shares/" + (ConvertTo-ShareId $r.Url) + '/driveItem'
  }
  $it = Invoke-MgGraphRequest -Method GET -Uri ($uri + $sel)
  if ($it.remoteItem) {
    return [pscustomobject]@{ DriveId = $it.remoteItem.parentReference.driveId; ItemId = $it.remoteItem.id; WebUrl = $it.remoteItem.webUrl; Atalho = $true }
  }
  return [pscustomobject]@{ DriveId = $it.parentReference.driveId; ItemId = $it.id; WebUrl = $it.webUrl; Atalho = $false }
}

function Connect-Graph {
  if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) {
    throw "Falta o modulo Microsoft.Graph.Authentication. Instale uma vez (sem admin): Install-Module Microsoft.Graph.Authentication -Scope CurrentUser"
  }
  Import-Module Microsoft.Graph.Authentication
  Connect-MgGraph -Scopes 'Files.ReadWrite.All' -NoWelcome
  Write-Host ('Conectado como ' + (Get-MgContext).Account) -ForegroundColor DarkGray
}

# ---- permissions ----------------------------------------------------------------------------------

function Norm([string]$e) { return ([string]$e).Trim().ToLowerInvariant() }

function Err($e) {
  $m = [string]$e.Exception.Message
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) { $m = $m + ' | ' + $e.ErrorDetails.Message }
  if ($m.Length -gt 240) { $m = $m.Substring(0, 240) }
  return $m
}

function Get-RawPerms($item) {
  $uri = "$G/drives/" + $item.DriveId + "/items/" + $item.ItemId + "/permissions"
  $perms = @()
  while ($uri) { $res = Invoke-MgGraphRequest -Method GET -Uri $uri; $perms += @($res.value); $uri = $res.'@odata.nextLink' }
  return ,$perms
}

function Get-Label($o) {
  foreach ($k in 'email', 'displayName', 'loginName') { if ($o.$k) { return [string]$o.$k } }
  return '?'
}

function Get-GroupSize([string]$gid, [bool]$owners = $false) {
  if (-not $gid) { return '' }
  $rel = 'transitiveMembers'; $what = 'pessoas'
  if ($owners) { $rel = 'owners'; $what = 'donos' }
  try {
    $n = Invoke-MgGraphRequest -Method GET -Uri ("$G/groups/" + $gid + "/" + $rel + "/`$count") -Headers @{ ConsistencyLevel = 'eventual' }
    return ' (' + $n + ' ' + $what + ')'
  } catch { return '' }
}

# Normalized e-mail of a grantee: a direct grantedToV2, or one entry of a link's grantedToIdentitiesV2.
function Get-Email($o) {
  if (-not $o) { return '' }
  if ($o.user -and $o.user.email) { return (Norm $o.user.email) }
  if ($o.siteUser -and $o.siteUser.loginName -and (([string]$o.siteUser.loginName) -match '\|([^|]+@[^|]+)$')) { return (Norm $Matches[1]) }
  return ''
}

# Display rows (Verificar table, receipt "after").
function ConvertTo-Rows($perms) {
  $rows = @()
  foreach ($p in @($perms)) {
    if (-not $p) { continue }
    $quem = @(); $tipo = ''
    $g = $p.grantedToV2
    if ($p.link) {
      $tipo = 'link ' + $p.link.scope + '/' + $p.link.type
      foreach ($i in @($p.grantedToIdentitiesV2)) { $e = Get-Email $i; if ($e) { $quem += $e } }
      if ($quem.Count -eq 0) { $quem += '(qualquer um com o link)' }
    } elseif ($g) {
      if ($g.user) { $tipo = 'pessoa'; $quem += (Get-Label $g.user) }
      elseif ($g.group) {
        # An M365 group's OWNERS appear as "<Group> Owners": count its owners, not its members.
        $dn = [string]$g.group.displayName
        if (-not $dn) { $dn = Get-Label $g.group }
        $tipo = 'grupo'; $quem += ($dn + (Get-GroupSize $g.group.id ($dn -like '* Owners')))
      }
      elseif ($g.siteGroup) { $tipo = 'grupo do site'; $quem += [string]$g.siteGroup.displayName }
      elseif ($g.siteUser) { $tipo = 'pessoa'; $quem += (Get-Label $g.siteUser) }
    }
    $origem = 'direta'
    if ($p.inheritedFrom) { $origem = 'herdada' }
    $rows += [pscustomobject]@{ Quem = ($quem -join ', '); Tipo = $tipo; Papel = (@($p.roles) -join ','); Origem = $origem; De = [string]$p.inheritedFrom.path; Id = [string]$p.id }
  }
  return ,$rows
}

# Person grants on the item: e-mail -> @( { Id; Roles; Kind = direta|link; Grantees; Inherited } ).
function Get-UserGrants($perms) {
  $map = @{}
  foreach ($p in @($perms)) {
    if (-not $p) { continue }
    $emails = @(); $kind = ''
    if ($p.link) {
      $kind = 'link'
      $emails = @(@($p.grantedToIdentitiesV2) | ForEach-Object { Get-Email $_ } | Where-Object { $_ })
    } else {
      $e = Get-Email $p.grantedToV2
      if ($e) { $kind = 'direta'; $emails = @($e) }
    }
    foreach ($e in $emails) {
      if (-not $map.ContainsKey($e)) { $map[$e] = @() }
      $map[$e] += [pscustomobject]@{ Id = [string]$p.id; Roles = @($p.roles); Kind = $kind; Grantees = $emails.Count; Inherited = [bool]$p.inheritedFrom }
    }
  }
  return $map
}

# Strongest role among grants: owner > write > read > ''.
function Get-BestRole($grants) {
  $r = ''
  foreach ($g in @($grants)) {
    if (-not $g) { continue }
    $roles = @($g.Roles)
    if ($roles -contains 'owner') { return 'owner' }
    if ($roles -contains 'write') { $r = 'write' }
    elseif (-not $r -and ($roles -contains 'read')) { $r = 'read' }
  }
  return $r
}

# Broad principals a private balde drops: site/Entra groups WITHOUT the owner role.
function Get-BroadGroups($perms) {
  $out = @()
  foreach ($p in @($perms)) {
    if (-not $p -or $p.link -or -not $p.grantedToV2) { continue }
    if (@($p.roles) -contains 'owner') { continue }
    $g = $p.grantedToV2
    if ($g.siteGroup) { $name = [string]$g.siteGroup.displayName } elseif ($g.group) { $name = [string]$g.group.displayName } else { continue }
    $out += [pscustomobject]@{ Id = [string]$p.id; Name = $name; Roles = @($p.roles); Inherited = [bool]$p.inheritedFrom }
  }
  return ,$out
}

# ---- ledger (who Balde granted) and receipt -------------------------------------------------------

function Get-LedgerPath($plan) {
  if ($plan.ledger) { return [string]$plan.ledger }
  return (Join-Path ([string]$plan.folder) '.balde\acesso-log.jsonl')
}

# e-mail -> role Balde last granted ('' once Balde revoked it).
function Read-Ledger([string]$path) {
  $m = @{}
  if ($path -and (Test-Path -LiteralPath $path)) {
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
      if (-not ([string]$line).Trim()) { continue }
      try { $e = $line | ConvertFrom-Json } catch { continue }
      if (-not $e.ok) { continue }
      $who = Norm $e.who
      if ($e.action -eq 'conceder') { $m[$who] = [string]$e.role }
      elseif ($e.action -eq 'revogar') { $m[$who] = '' }
    }
  }
  return $m
}

function Add-Ledger([string]$path, $entries) {
  $list = @($entries | Where-Object { $_ })
  if ($list.Count -eq 0) { return }
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  foreach ($e in $list) { [System.IO.File]::AppendAllText($path, (($e | ConvertTo-Json -Compress -Depth 5) + "`n"), $Utf8NoBom) }
}

function Write-Receipt($plan, $doc) {
  $path = [string]$plan.receipt
  if (-not $path) { return }
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 8), $Utf8NoBom)
  Write-Host ('Recibo: ' + $path) -ForegroundColor DarkGray
}

# ---- plan -> actions ------------------------------------------------------------------------------

# Diff between what the balde declares and what the folder grants. Pure: no Graph calls.
# O recibo só confirma o que a leitura efetiva de permissões conseguiu verificar.
function Get-AccessOutcome($calculation) {
  if (@($calculation.Acoes).Count -gt 0) { return 'verificacao-pendente' }
  if (@($calculation.Avisos).Count -gt 0) { return 'acao-manual' }
  return 'verificado'
}

function Build-Actions($plan, $perms, $ledger, [string]$me, [bool]$incluirFora) {
  $acts = @(); $warn = @(); $fora = @()
  $write = @(@($plan.write) | Where-Object { $_ } | ForEach-Object { Norm $_ } | Select-Object -Unique)
  $read = @(@($plan.read) | Where-Object { $_ } | ForEach-Object { Norm $_ } | Where-Object { $write -notcontains $_ } | Select-Object -Unique)
  $owners = @(@($plan.owners) | Where-Object { $_ } | ForEach-Object { Norm $_ } | Select-Object -Unique)
  $private = -not [bool]$plan.open
  $grants = Get-UserGrants $perms

  foreach ($e in $write) {
    if ($e -eq $me) { continue }
    $cur = Get-BestRole $grants[$e]
    if ($cur -eq 'owner' -or $cur -eq 'write') { continue }
    $det = 'novo'; if ($cur) { $det = 'hoje: ' + $cur }
    $acts += [pscustomobject]@{ Acao = 'conceder'; Quem = $e; Papel = 'write'; Detalhe = $det }
  }
  foreach ($e in $read) {
    if ($e -eq $me) { continue }
    $cur = Get-BestRole $grants[$e]
    if ($cur -eq 'write') {
      if ($ledger.ContainsKey($e) -and $ledger[$e] -eq 'write') { $acts += [pscustomobject]@{ Acao = 'rebaixar'; Quem = $e; Papel = 'read'; Detalhe = 'write -> read' } }
      else { $warn += ($e + ': tem escrita concedida fora do Balde; o balde diz leitura (nao mexo).') }
    } elseif (-not $cur -and $private) {
      # open baldes read through the site groups; a private one needs each reader explicitly
      $acts += [pscustomobject]@{ Acao = 'conceder'; Quem = $e; Papel = 'read'; Detalhe = 'novo' }
    }
  }
  $broad = Get-BroadGroups $perms   # returns its array intact (",$out"); wrapping it in @() would nest it
  if ($private) {
    foreach ($g in $broad) {
      $det = 'direto'; if ($g.Inherited) { $det = 'herdado' }
      $acts += [pscustomobject]@{ Acao = 'remover-grupo'; Quem = $g.Name; Papel = (@($g.Roles) -join ','); Detalhe = $det }
    }
  } elseif ($broad.Count -eq 0) {
    $warn += 'o balde e aberto, mas a pasta nao tem mais os grupos do site (Members/Visitors): reabrir exige "restaurar heranca" no SharePoint.'
  }
  foreach ($e in @($grants.Keys)) {
    if ($write -contains $e -or $read -contains $e -or $e -eq $me) { continue }
    $gs = @($grants[$e] | Where-Object { -not $_.Inherited })
    if ($gs.Count -eq 0) { continue }
    $cur = Get-BestRole $gs
    if ($cur -eq 'owner') { continue }
    $managed = $ledger.ContainsKey($e) -and [bool]$ledger[$e]
    if ($managed) { $acts += [pscustomobject]@{ Acao = 'revogar'; Quem = $e; Papel = $cur; Detalhe = 'concedido pelo Balde' } }
    elseif ($incluirFora) { $acts += [pscustomobject]@{ Acao = 'revogar'; Quem = $e; Papel = $cur; Detalhe = 'fora do Balde' } }
    else { $fora += [pscustomobject]@{ Quem = $e; Papel = $cur } }
  }
  foreach ($ug in @($plan.unresolvedGroups)) {
    if ($ug) { $warn += ('grupo do Balde ''' + $ug + ''' sem membros encontrados: ninguem recebe acesso por ele.') }
  }
  foreach ($o in $owners) {
    if ($o -eq $me) { continue }
    if ((Get-BestRole $grants[$o]) -ne 'owner') {
      $warn += ('dono ' + $o + ': sem Controle Total visivel nesta pasta (pode vir do grupo Owners do site). O script nao concede Controle Total (limite do Graph).')
    }
  }
  return [pscustomobject]@{ Acoes = $acts; Avisos = $warn; ForaDoBalde = $fora }
}

function Show-Plan($plan, $r, $calc) {
  $estado = 'aberto (o time le pelos grupos do site)'
  if (-not [bool]$plan.open) { $estado = 'fechado (so quem esta no balde)' }
  Write-Host ''
  Write-Host ('Plano ' + $plan.id + ' | balde ''' + $plan.balde + ''' | ' + $estado) -ForegroundColor Cyan
  Write-Host ('   SharePoint: ' + $r.Url)
  $acts = @($calc.Acoes)
  $line = { param($label, $items) if (@($items).Count -gt 0) { Write-Host ('   ' + $label + ': ' + (@($items) -join ', ')) } }
  & $line '+ escrita ' @($acts | Where-Object { $_.Acao -eq 'conceder' -and $_.Papel -eq 'write' } | ForEach-Object { $_.Quem + ' (' + $_.Detalhe + ')' })
  & $line '+ leitura ' @($acts | Where-Object { $_.Acao -eq 'conceder' -and $_.Papel -eq 'read' } | ForEach-Object { $_.Quem })
  & $line '~ rebaixar' @($acts | Where-Object { $_.Acao -eq 'rebaixar' } | ForEach-Object { $_.Quem + ' (' + $_.Detalhe + ')' })
  & $line '- grupos  ' @($acts | Where-Object { $_.Acao -eq 'remover-grupo' } | ForEach-Object { $_.Quem + ' (' + $_.Papel + ', ' + $_.Detalhe + ')' })
  & $line '- revogar ' @($acts | Where-Object { $_.Acao -eq 'revogar' } | ForEach-Object { $_.Quem + ' (' + $_.Detalhe + ')' })
  & $line '= fora do Balde, nao mexo (-IncluirForaDoBalde remove)' @($calc.ForaDoBalde | ForEach-Object { $_.Quem + ' (' + $_.Papel + ')' })
  foreach ($w in @($calc.Avisos)) { Write-Host ('   ! ' + $w) -ForegroundColor Yellow }
  if (@($acts | Where-Object { $_.Acao -eq 'conceder' }).Count -gt 0) {
    $conv = 'nao'; if ([bool]$plan.notify) { $conv = 'sim' }
    Write-Host ('   convite por e-mail da Microsoft: ' + $conv) -ForegroundColor DarkGray
  }
}

# ---- actions -> Graph -----------------------------------------------------------------------------

function Grant-Person([string]$base, [string]$email, [string]$role, $plan) {
  $body = @{ recipients = @(@{ email = $email }); roles = @($role); requireSignIn = $true; sendInvitation = [bool]$plan.notify }
  if ($plan.notify -and $plan.message) { $body.message = [string]$plan.message }
  $r = Invoke-MgGraphRequest -Method POST -Uri "$base/invite" -Body ($body | ConvertTo-Json -Depth 5) -ContentType 'application/json'
  return (@($r.value | ForEach-Object { $_.id }) -join ',')
}

# Remove a person's DIRECT access (optionally only grants carrying one of $onlyRoles). A shared
# "specific people" link keeps its other grantees: that person is taken off it with revokeGrants.
function Revoke-UserGrants([string]$base, $perms, [string]$email, [string[]]$onlyRoles) {
  $n = 0
  foreach ($p in @($perms)) {
    if (-not $p -or $p.inheritedFrom) { continue }
    $roles = @($p.roles)
    if ($roles -contains 'owner') { continue }
    if ($onlyRoles -and $onlyRoles.Count -gt 0 -and -not @($roles | Where-Object { $onlyRoles -contains $_ })) { continue }
    if ($p.link) {
      $gr = @(@($p.grantedToIdentitiesV2) | ForEach-Object { Get-Email $_ } | Where-Object { $_ })
      if ($gr -notcontains $email) { continue }
      if ($gr.Count -gt 1) {
        $body = @{ grantees = @(@{ email = $email }) } | ConvertTo-Json -Depth 4
        try { Invoke-MgGraphRequest -Method POST -Uri "$base/permissions/$($p.id)/revokeGrants" -Body $body -ContentType 'application/json' | Out-Null }
        catch { Invoke-MgGraphRequest -Method POST -Uri (($base -replace '/v1\.0/', '/beta/') + "/permissions/$($p.id)/revokeGrants") -Body $body -ContentType 'application/json' | Out-Null }
      } else {
        Invoke-MgGraphRequest -Method DELETE -Uri "$base/permissions/$($p.id)" | Out-Null
      }
      $n++
    } elseif ((Get-Email $p.grantedToV2) -eq $email) {
      Invoke-MgGraphRequest -Method DELETE -Uri "$base/permissions/$($p.id)" | Out-Null
      $n++
    }
  }
  if ($n -eq 0) { throw "nenhum acesso direto de $email para remover" }
}

# Ids change once inheritance breaks (the first removal copies the rest as direct grants), so the
# group is looked up fresh, by name, right before each delete.
function Remove-GroupByName([string]$base, $item, [string]$name) {
  foreach ($p in (Get-RawPerms $item)) {
    if (-not $p -or $p.link -or -not $p.grantedToV2) { continue }
    if (@($p.roles) -contains 'owner') { continue }
    $g = $p.grantedToV2
    $n = ''
    if ($g.siteGroup) { $n = [string]$g.siteGroup.displayName } elseif ($g.group) { $n = [string]$g.group.displayName }
    if ($n -eq $name) { Invoke-MgGraphRequest -Method DELETE -Uri "$base/permissions/$($p.id)" | Out-Null; return }
  }
  throw "grupo '$name' nao encontrado (ja removido?)"
}

# Order: grants (write, then read) -> downgrades -> broad groups -> revocations.
function Invoke-Actions($item, $plan, $acts, [string]$me) {
  $base = "$G/drives/" + $item.DriveId + "/items/" + $item.ItemId
  $private = -not [bool]$plan.open
  $results = @(); $ledger = @()
  foreach ($kind in @('conceder', 'rebaixar', 'remover-grupo', 'revogar')) {
    $batch = @($acts | Where-Object { $_.Acao -eq $kind })
    if ($kind -eq 'conceder') { $batch = @($batch | Sort-Object { if ($_.Papel -eq 'write') { 0 } else { 1 } }) }
    foreach ($a in $batch) {
      $res = 'ok'
      $at = (Get-Date).ToUniversalTime().ToString('o')
      try {
        switch ($kind) {
          'conceder' {
            $ids = Grant-Person $base $a.Quem $a.Papel $plan
            $ledger += [ordered]@{ at = $at; by = $me; plano = $plan.id; action = 'conceder'; who = $a.Quem; role = $a.Papel; permissionIds = $ids; ok = $true }
          }
          'rebaixar' {
            Revoke-UserGrants $base (Get-RawPerms $item) $a.Quem @('write')
            if ($private) {
              $ids = Grant-Person $base $a.Quem 'read' $plan
              $ledger += [ordered]@{ at = $at; by = $me; plano = $plan.id; action = 'conceder'; who = $a.Quem; role = 'read'; permissionIds = $ids; ok = $true }
            } else {
              $ledger += [ordered]@{ at = $at; by = $me; plano = $plan.id; action = 'revogar'; who = $a.Quem; role = ''; ok = $true }
            }
          }
          'remover-grupo' {
            Remove-GroupByName $base $item $a.Quem
            $ledger += [ordered]@{ at = $at; by = $me; plano = $plan.id; action = 'remover-grupo'; who = $a.Quem; role = ''; ok = $true }
          }
          'revogar' {
            Revoke-UserGrants $base (Get-RawPerms $item) $a.Quem @()
            $ledger += [ordered]@{ at = $at; by = $me; plano = $plan.id; action = 'revogar'; who = $a.Quem; role = ''; ok = $true }
          }
        }
      } catch { $res = 'erro: ' + (Err $_) }
      $color = 'Green'; if ($res -ne 'ok') { $color = 'Red' }
      Write-Host ('   ' + $a.Acao + ' ' + $a.Quem + ' -> ' + $res) -ForegroundColor $color
      $results += [ordered]@{ acao = $a.Acao; quem = $a.Quem; papel = $a.Papel; resultado = $res }
    }
  }
  return [pscustomobject]@{ Resultados = $results; Ledger = $ledger }
}

# ---- pastas do compartilhamento (balde-pastas-plano/1) ------------------------------------------------
# Administracao > Pastas do compartilhamento pede, para cada pasta do compartilhamento, um acesso
# esperado: permissoes proprias e o grupo do site Membros gravando (exchange, onde fica a pasta de envio
# de cada pessoa) ou so lendo (app, corpus, docs, admin e a raiz). Duas operacoes do Graph, verificadas
# em pastas de teste (tests/sharepoint/teste-permissoes.ps1, 2026-10-13): mudar o papel do grupo do site
# Membros (PATCH roles; numa pasta que herda, o SharePoint copia para ela todas as permissoes de cima e
# muda so esse grupo) e dar permissoes proprias sem tirar ninguem (compartilhar com quem roda o plano,
# o que copia as permissoes, e tirar esse compartilhamento em seguida).

# The site group Members on the item, or $null: "<site> Members" on an English site, "Membros de <site>"
# on a Portuguese one.
function Get-MembersGrant($perms) {
  foreach ($p in @($perms)) {
    if (-not $p -or $p.link -or -not $p.grantedToV2 -or -not $p.grantedToV2.siteGroup) { continue }
    if ([string]$p.grantedToV2.siteGroup.displayName -match '(Members$|^Membros\b)') { return $p }
  }
  return $null
}

# What the folder has today: whether it inherits, and the Members group's role ('' when absent).
function Get-FolderState($perms) {
  $role = ''
  $m = Get-MembersGrant $perms
  if ($m) {
    $roles = @($m.roles)
    if ($roles -contains 'owner') { $role = 'owner' } elseif ($roles -contains 'write') { $role = 'write' } elseif ($roles -contains 'read') { $role = 'read' }
  }
  $inherits = @(@($perms) | Where-Object { $_ -and $_.inheritedFrom }).Count -gt 0
  return [pscustomobject]@{ Inherits = $inherits; Membros = $role }
}

# What one folder needs to reach its expected access. Pure: no Graph calls.
#   nivel-membros    the Members group to the expected role; on an inheriting folder this also gives the
#                    folder its own permissions, keeping everyone else;
#   parar-de-herdar  own permissions with the same grants, when that is all that is missing.
# A Members group with Full Control is never lowered.
function Build-FolderActions($want, $state) {
  $acts = @(); $warn = @()
  $desired = [string]$want.membros
  if ($desired) {
    if (-not $state.Membros) { $warn += 'a pasta nao tem o grupo do site Membros: o nivel dele so pode ser posto no SharePoint.' }
    elseif ($state.Membros -ne $desired -and $state.Membros -ne 'owner') {
      $acts += [pscustomobject]@{ Acao = 'nivel-membros'; De = $state.Membros; Para = $desired }
    }
  }
  if ([bool]$want.proprias -and $state.Inherits -and $acts.Count -eq 0) {
    $acts += [pscustomobject]@{ Acao = 'parar-de-herdar'; De = 'herda'; Para = 'propria' }
  }
  return [pscustomobject]@{ Acoes = $acts; Avisos = $warn }
}

function Test-FolderOk($want, $state) {
  if (-not $state) { return $false }
  if ([bool]$want.proprias -and $state.Inherits) { return $false }
  if ([string]$want.membros -and $state.Membros -ne [string]$want.membros) { return $false }
  return $true
}

# A folder whose Members go down to read must not have, below it, a plan folder where Members keep
# writing and that still inherits: lowering the parent would take that writing away too (exchange
# under the share's root). Returns that folder's entry, or $null.
function Get-BlockingDescendant([string]$folder, $entries) {
  $prefix = $folder.TrimEnd('\') + '\'
  foreach ($e in @($entries)) {
    if (-not $e -or -not $e.State -or -not $e.Folder) { continue }
    if (-not ([string]$e.Folder).StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    if ([string]$e.Want.membros -eq 'write' -and $e.State.Inherits) { return $e }
  }
  return $null
}

function Format-Role([string]$role) {
  switch ($role) { 'write' { return 'gravam' } 'read' { return 'leem' } 'owner' { return 'com controle total' } default { return 'sem acesso' } }
}

function Format-FolderState($s) {
  if (-not $s) { return '?' }
  $m = 'sem o grupo Membros'; if ($s.Membros) { $m = 'membros ' + (Format-Role $s.Membros) }
  $h = 'herda'; if (-not $s.Inherits) { $h = 'permissoes proprias' }
  return $m + ', ' + $h
}

function Format-FolderAction($a) {
  if ($a.Acao -eq 'nivel-membros') { return 'membros: ' + (Format-Role $a.De) + ' -> ' + (Format-Role $a.Para) }
  return 'parar de herdar, mantendo todas as permissoes'
}

function Set-MembersRole($item, [string]$role) {
  $base = "$G/drives/" + $item.DriveId + "/items/" + $item.ItemId
  $m = Get-MembersGrant (Get-RawPerms $item)
  if (-not $m) { throw 'grupo do site Membros nao encontrado nesta pasta' }
  $body = @{ roles = @($role) } | ConvertTo-Json -Depth 4
  Invoke-MgGraphRequest -Method PATCH -Uri "$base/permissions/$($m.id)" -Body $body -ContentType 'application/json' | Out-Null
}

# Own permissions keeping everyone: sharing the folder with whoever runs the plan makes SharePoint copy
# the inherited grants into it; that share is then removed. Only a grant this call created is removed.
function Stop-Inheriting($item, [string]$me) {
  $base = "$G/drives/" + $item.DriveId + "/items/" + $item.ItemId
  $before = @((Get-RawPerms $item) | Where-Object { $_ -and -not $_.inheritedFrom } | ForEach-Object { [string]$_.id })
  $body = @{ recipients = @(@{ email = $me }); roles = @('read'); requireSignIn = $true; sendInvitation = $false } | ConvertTo-Json -Depth 5
  $r = Invoke-MgGraphRequest -Method POST -Uri "$base/invite" -Body $body -ContentType 'application/json'
  Start-Sleep -Seconds 2
  $removed = 0
  foreach ($id in @($r.value | ForEach-Object { [string]$_.id })) {
    if (-not $id -or $before -contains $id) { continue }
    Invoke-MgGraphRequest -Method DELETE -Uri "$base/permissions/$id" | Out-Null
    $removed++
  }
  if ($removed -eq 0) { throw ('a pasta ganhou permissoes proprias, mas o compartilhamento temporario com ' + $me + ' (leitura) ficou: tire no SharePoint') }
}

function Invoke-FolderAction($e, $a, [string]$me) {
  $res = 'ok'
  try {
    if ($a.Acao -eq 'nivel-membros') { Set-MembersRole $e.Item $a.Para } else { Stop-Inheriting $e.Item $me }
  } catch { $res = 'erro: ' + (Err $_) }
  $color = 'Green'; if ($res -ne 'ok') { $color = 'Red' }
  Write-Host ('   ' + $e.Key + ': ' + (Format-FolderAction $a) + ' -> ' + $res) -ForegroundColor $color
  $e.Results += [ordered]@{ acao = $a.Acao; de = $a.De; para = $a.Para; resultado = $res }
}

function Show-PastasPlan($plan, $entries) {
  Write-Host ''
  Write-Host ('Plano ' + $plan.id + ' | pastas do compartilhamento | ' + $plan.share) -ForegroundColor Cyan
  foreach ($e in $entries) {
    Write-Host ('   ' + $e.Key + ': ' + $e.Folder)
    if ($e.Error) { Write-Host ('      ERRO: ' + $e.Error) -ForegroundColor Red; continue }
    $want = 'membros leem'; if ([string]$e.Want.membros -eq 'write') { $want = 'membros gravam' }
    Write-Host ('      hoje: ' + (Format-FolderState $e.State) + ' | esperado: ' + $want + ', permissoes proprias')
    foreach ($a in @($e.Calc.Acoes)) { Write-Host ('      ~ ' + (Format-FolderAction $a)) -ForegroundColor Yellow }
    foreach ($w in @($e.Calc.Avisos)) { Write-Host ('      ! ' + $w) -ForegroundColor Yellow }
    if (@($e.Calc.Acoes).Count -eq 0 -and @($e.Calc.Avisos).Count -eq 0) { Write-Host '      = como esperado' -ForegroundColor Green }
  }
}

function Invoke-PastasPlanMode($plan, [string]$planPath, $roots) {
  if (-not $plan.receipt) { $plan | Add-Member -NotePropertyName receipt -NotePropertyValue (Join-Path (Split-Path -Parent $planPath) ('recibo-' + $plan.id + '.json')) -Force }
  $doc = [ordered]@{ format = 'balde-pastas-recibo/1'; plano = [string]$plan.id; share = [string]$plan.share; at = ''; by = ''; status = 'erro'; folders = @(); warnings = @() }
  $entries = @()
  try {
    Connect-Graph
    $me = Norm ((Get-MgContext).Account)
    $doc.by = $me
    foreach ($w in @($plan.folders)) {
      $e = [pscustomobject]@{ Key = [string]$w.key; Folder = [string]$w.folder; Want = $w; Item = $null; State = $null; Before = $null; Calc = $null; Url = ''; WebUrl = ''; Error = ''; Results = @() }
      try {
        $r = Resolve-Folder $e.Folder $roots
        $e.Url = $r.Url
        $e.Item = Get-GraphItem $r
        $e.WebUrl = [string]$e.Item.WebUrl
        $e.State = Get-FolderState (Get-RawPerms $e.Item)
        $e.Before = $e.State
        $e.Calc = Build-FolderActions $w $e.State
      } catch { $e.Error = Err $_ }
      $entries += $e
    }
    Show-PastasPlan $plan $entries
    $todo = @($entries | Where-Object { $_.Calc } | ForEach-Object { @($_.Calc.Acoes) })
    if ($todo.Count -eq 0) {
      $doc.status = 'verificado'
      Write-Host 'Nada a aplicar.' -ForegroundColor Green
    } elseif ($Simular) {
      $doc.status = 'simulado'
      foreach ($e in $entries) { foreach ($a in @($e.Calc.Acoes)) { $e.Results += [ordered]@{ acao = $a.Acao; de = $a.De; para = $a.Para; resultado = 'simulado' } } }
      Write-Host 'Simulacao: nada foi alterado.' -ForegroundColor Yellow
    } else {
      $ok = [bool]$SemConfirmar
      if (-not $ok) { $ans = Read-Host ('Aplicar ' + $todo.Count + ' mudanca(s)? (s/N)'); $ok = ($ans -match '^\s*(s|sim|y|yes)\s*$') }
      if (-not $ok) {
        $doc.status = 'cancelado'
        Write-Host 'Cancelado: nada foi alterado.' -ForegroundColor Yellow
      } else {
        # Fase 1: o que nunca tira acesso de ninguem (permissoes proprias, Membros subindo).
        foreach ($e in $entries) {
          foreach ($a in @($e.Calc.Acoes)) { if ($a.Acao -eq 'parar-de-herdar' -or $a.Para -eq 'write') { Invoke-FolderAction $e $a $me } }
        }
        # Fase 2: Membros descendo para leitura, das pastas mais fundas para a raiz.
        foreach ($e in @($entries | Sort-Object { ([string]$_.Folder).Length } -Descending)) {
          foreach ($a in @($e.Calc.Acoes | Where-Object { $_.Acao -eq 'nivel-membros' -and $_.Para -ne 'write' })) {
            foreach ($d in $entries) { if ($d.Item -and [string]$d.Want.membros -eq 'write') { $d.State = Get-FolderState (Get-RawPerms $d.Item) } }
            $block = Get-BlockingDescendant $e.Folder $entries
            if ($block) {
              $res = 'pulado: ' + $block.Key + ' ainda herda, e os membros perderiam a escrita nela'
              Write-Host ('   ' + $e.Key + ': ' + (Format-FolderAction $a) + ' -> ' + $res) -ForegroundColor Yellow
              $e.Results += [ordered]@{ acao = $a.Acao; de = $a.De; para = $a.Para; resultado = $res }
            } else {
              Invoke-FolderAction $e $a $me
            }
          }
        }
        $doc.status = 'aplicado'
      }
    }
  } catch {
    $doc.warnings = @($doc.warnings) + ('falha: ' + (Err $_))
    Write-Host ('ERRO: ' + (Err $_)) -ForegroundColor Red
  } finally {
    # O recibo sempre sai (a pagina espera por ele), com o estado de cada pasta relido agora.
    $allOk = $entries.Count -gt 0
    foreach ($e in $entries) {
      $after = $null; $rows = @()
      if ($e.Item) {
        try { $perms = Get-RawPerms $e.Item; $after = Get-FolderState $perms; $rows = ConvertTo-Rows $perms } catch { if (-not $e.Error) { $e.Error = Err $_ } }
      }
      $fine = Test-FolderOk $e.Want $after
      if (-not $fine) { $allOk = $false }
      $situacao = 'diferente'; if ($fine) { $situacao = 'ok' } elseif ($e.Error) { $situacao = 'erro' }
      $avisos = @(); if ($e.Calc) { $avisos = @($e.Calc.Avisos) }
      $doc.folders += [ordered]@{
        key = $e.Key; folder = $e.Folder; url = $e.Url; webUrl = $e.WebUrl
        esperado = [ordered]@{ proprias = [bool]$e.Want.proprias; membros = [string]$e.Want.membros }
        antes = $(if ($e.Before) { [ordered]@{ inherits = [bool]$e.Before.Inherits; membros = [string]$e.Before.Membros } } else { $null })
        acoes = @($e.Results)
        depois = $(if ($after) { [ordered]@{ inherits = [bool]$after.Inherits; membros = [string]$after.Membros; permissions = @($rows | ForEach-Object { [ordered]@{ quem = $_.Quem; tipo = $_.Tipo; papel = $_.Papel; origem = $_.Origem } }) } } else { $null })
        situacao = $situacao; erro = $e.Error; avisos = $avisos
      }
    }
    if ($doc.status -eq 'aplicado') {
      $applied = @($entries | ForEach-Object { @($_.Results) } | Where-Object { $_.resultado -eq 'ok' }).Count
      if ($allOk) { $doc.status = 'aplicado' } elseif ($applied -gt 0) { $doc.status = 'parcial' } else { $doc.status = 'erro' }
    } elseif ($doc.status -eq 'verificado' -and -not $allOk) {
      $doc.status = 'acao-manual'
    }
    $doc.at = (Get-Date).ToUniversalTime().ToString('o')
    Write-Receipt $plan $doc
  }
}

function Invoke-PlanMode([string]$path, $roots) {
  # The page polls for a receipt, so one is ALWAYS written, even when the plan itself is unusable:
  # then it goes to the conventional path next to it (plano-<id>.json -> recibo-<id>.json).
  $leaf = Split-Path -Leaf $path
  $conv = 'recibo-' + $leaf
  if ($leaf -like 'plano-*') { $conv = 'recibo-' + $leaf.Substring(6) }
  $fallback = Join-Path (Split-Path -Parent $path) $conv
  $plan = $null; $problem = ''
  try { $plan = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { $problem = 'plano ilegivel: ' + (Err $_) }
  if (-not $problem -and $plan.format -eq 'balde-pastas-plano/1') { Invoke-PastasPlanMode $plan $path $roots; return }
  if (-not $problem -and $plan.format -ne 'balde-acesso-plano/1') { $problem = 'formato de plano desconhecido: ' + $plan.format }
  if (-not $problem -and -not $plan.folder) { $problem = 'plano sem "folder"' }
  if ($problem) {
    $rp = $fallback; if ($plan -and $plan.receipt) { $rp = [string]$plan.receipt }
    $id = ''; $balde = ''; $fold = ''
    if ($plan) { $id = [string]$plan.id; $balde = [string]$plan.balde; $fold = [string]$plan.folder }
    Write-Host ('ERRO: ' + $problem) -ForegroundColor Red
    Write-Receipt ([pscustomobject]@{ receipt = $rp }) ([ordered]@{
      format = 'balde-acesso-recibo/1'; plano = $id; balde = $balde; folder = $fold; url = ''; webUrl = ''
      at = (Get-Date).ToUniversalTime().ToString('o'); by = ''; status = 'erro'; changes = @(); warnings = @($problem); foraDoBalde = @(); after = $null
    })
    return
  }
  if (-not $plan.receipt) { $plan | Add-Member -NotePropertyName receipt -NotePropertyValue (Join-Path (Split-Path -Parent $path) ('recibo-' + $plan.id + '.json')) -Force }
  $doc = [ordered]@{
    format = 'balde-acesso-recibo/1'; plano = $plan.id; balde = $plan.balde; folder = $plan.folder; url = ''; webUrl = ''
    at = ''; by = ''; status = 'erro'; changes = @(); warnings = @(); foraDoBalde = @(); after = $null
  }
  try {
    $r = Resolve-Folder ([string]$plan.folder) $roots
    $doc.url = $r.Url
    Connect-Graph
    $me = Norm ((Get-MgContext).Account)
    $doc.by = $me
    $item = Get-GraphItem $r
    $doc.webUrl = $item.WebUrl
    $ledgerPath = Get-LedgerPath $plan
    $calc = Build-Actions $plan (Get-RawPerms $item) (Read-Ledger $ledgerPath) $me ([bool]$IncluirForaDoBalde)
    $doc.warnings = @($calc.Avisos)
    $doc.foraDoBalde = @($calc.ForaDoBalde | ForEach-Object { [ordered]@{ quem = $_.Quem; papel = $_.Papel } })
    Show-Plan $plan $r $calc
    $acts = @($calc.Acoes)
    if ($acts.Count -eq 0) {
      if ((Get-AccessOutcome $calc) -eq 'acao-manual') {
        $doc.status = 'acao-manual'
        Write-Host 'Aplicacao pendente: resolva os avisos e verifique novamente.' -ForegroundColor Yellow
      } else {
        $doc.status = 'verificado'
        Write-Host 'Permissoes verificadas: nenhuma mudanca gerenciada pendente.' -ForegroundColor Green
      }
    } elseif ($Simular) {
      $doc.status = 'simulado'
      $doc.changes = @($acts | ForEach-Object { [ordered]@{ acao = $_.Acao; quem = $_.Quem; papel = $_.Papel; resultado = 'simulado' } })
      Write-Host 'Simulacao: nada foi alterado.' -ForegroundColor Yellow
    } else {
      $ok = [bool]$SemConfirmar
      if (-not $ok) { $ans = Read-Host ('Aplicar ' + $acts.Count + ' mudanca(s)? (s/N)'); $ok = ($ans -match '^\s*(s|sim|y|yes)\s*$') }
      if (-not $ok) {
        $doc.status = 'cancelado'
        Write-Host 'Cancelado: nada foi alterado.' -ForegroundColor Yellow
      } else {
        $res = Invoke-Actions $item $plan $acts $me
        $doc.changes = @($res.Resultados)
        Add-Ledger $ledgerPath $res.Ledger
        $bad = @($res.Resultados | Where-Object { $_.resultado -ne 'ok' }).Count
        if ($bad -eq 0) { $doc.status = 'aplicado' } elseif ($bad -lt $acts.Count) { $doc.status = 'parcial' } else { $doc.status = 'erro' }
      }
    }
    $rows = ConvertTo-Rows (Get-RawPerms $item)
    $doc.after = [ordered]@{
      inherits = (@($rows | Where-Object { $_.Origem -eq 'herdada' }).Count -gt 0)
      permissions = @($rows | ForEach-Object { [ordered]@{ quem = $_.Quem; tipo = $_.Tipo; papel = $_.Papel; origem = $_.Origem } })
    }
    if ($doc.status -eq 'aplicado') {
      $verification = Build-Actions $plan (Get-RawPerms $item) (Read-Ledger $ledgerPath) $me ([bool]$IncluirForaDoBalde)
      $doc.warnings = @($verification.Avisos)
      $doc.status = Get-AccessOutcome $verification
    }
    if ($doc.status -eq 'aplicado' -or $doc.status -eq 'parcial') {
      $rows | Sort-Object Origem, Tipo, Quem | Format-Table Quem, Tipo, Papel, Origem -AutoSize -Wrap | Out-String -Width 200 | Write-Host
    }
  } catch {
    $doc.status = 'erro'
    $doc.warnings = @($doc.warnings) + ('falha: ' + (Err $_))
    Write-Host ('ERRO: ' + (Err $_)) -ForegroundColor Red
  } finally {
    $doc.at = (Get-Date).ToUniversalTime().ToString('o')
    Write-Receipt $plan $doc
  }
}

# ---- main -----------------------------------------------------------------------------------------

if ($MyInvocation.InvocationName -eq '.') { return }   # dot-sourced by tests: functions only

$roots = Get-SyncRoots
if ($Plano) { Invoke-PlanMode $Plano $roots; return }
if (-not $Folder -or $Folder.Count -eq 0) { throw "Informe ao menos uma pasta (ou -Plano)." }
# Verificar. With -Out the snapshot is ALWAYS written (the page polls for it): a folder that fails
# gets { folder, error }, and a failure before any folder (login, missing module) sets a top-level
# "error". Shape: { checkedAt, by, [error], folders: [ { folder, url, webUrl, driveId, itemId,
# inherits, permissions: [ { quem, tipo, papel, origem } ] } ] } (inner part = the receipt's "after").
$snapshot = @(); $fatal = ''
try {
  if (-not $ResolveOnly) { Connect-Graph }
  foreach ($f in $Folder) {
    try {
      $r = Resolve-Folder $f $roots
      Write-Host ''
      Write-Host ('== ' + $r.Folder) -ForegroundColor Cyan
      Write-Host ('   SharePoint: ' + $r.Url)
      if ($ResolveOnly) { continue }
      $item = Get-GraphItem $r
      if ($item.Atalho) { Write-Host '   (atalho em Meus arquivos: mostrando a pasta real)' -ForegroundColor DarkGray }
      $rows = ConvertTo-Rows (Get-RawPerms $item)
      $herdadas = @($rows | Where-Object { $_.Origem -eq 'herdada' })
      if ($herdadas.Count -gt 0) {
        $de = ($herdadas | Select-Object -First 1).De
        $onde = ' da pasta/biblioteca acima'
        if ($de) { $onde = ' de ' + $de }
        Write-Host ('   HERDA permissoes' + $onde + ': revogar aqui nao restringe o que vem de cima.') -ForegroundColor Yellow
      } else {
        Write-Host '   Permissoes proprias (nao herda): conceder/revogar aqui vale por completo.' -ForegroundColor Green
      }
      $rows | Sort-Object Origem, Tipo, Quem | Format-Table Quem, Tipo, Papel, Origem -AutoSize -Wrap | Out-String -Width 200 | Write-Host
      $snapshot += [pscustomobject]@{
        folder = $r.Folder; url = $r.Url; webUrl = $item.WebUrl; driveId = $item.DriveId; itemId = $item.ItemId
        inherits = ($herdadas.Count -gt 0)
        permissions = @($rows | ForEach-Object { [ordered]@{ quem = $_.Quem; tipo = $_.Tipo; papel = $_.Papel; origem = $_.Origem } })
      }
    } catch {
      Write-Host ('   ERRO em ' + $f + ': ' + (Err $_)) -ForegroundColor Red
      $snapshot += [pscustomobject]@{ folder = $f; error = (Err $_) }
    }
  }
} catch {
  $fatal = Err $_
  Write-Host ('ERRO: ' + $fatal) -ForegroundColor Red
} finally {
  if ($Out -and -not $ResolveOnly) {
    $by = ''; try { $by = [string](Get-MgContext).Account } catch { $by = '' }
    $doc = [ordered]@{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); by = $by; folders = @($snapshot) }
    if ($fatal) { $doc.error = $fatal }
    $dir = Split-Path -Parent $Out
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Out, ($doc | ConvertTo-Json -Depth 8), $Utf8NoBom)
    Write-Host ('Snapshot salvo em ' + $Out) -ForegroundColor DarkGray
  }
}
