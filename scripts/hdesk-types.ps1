<#
  CHARGER UN TYPE C# DES SCRIPTS HDESK SANS LE RECOMPILER A CHAQUE APPEL.

  Pourquoi : hdesk-arbre.ps1 et hdesk-act.ps1 compilaient leur C# (Add-Type -TypeDefinition) a CHAQUE
  geste ; un appui par nom en compilait deux. Mesure du 2026-11-08 (Table des caracteres, bureau
  cache) : lecture de l'arbre ~0,9 s, appui par nom ~1,7 s, dont ~0,2 s de compilation par fichier.
  Ici, la DLL compilee est gardee sous %LOCALAPPDATA%\autowin-hdesk\types, nommee par l'empreinte
  SHA-256 de la source et des references : une source modifiee donne une autre DLL, jamais une
  ancienne.

  Usage (dot-source) : . (Join-Path $PSScriptRoot 'hdesk-types.ps1')
                       Import-HdeskType -Source <chemin .cs> -Type <NomDeClasse> [-References <dll...>]
  Mesure : Add-Type -OutputAssembly compile la DLL SANS charger le type dans la session : on la charge
  ensuite par Add-Type -Path. Cache illisible ou en ecriture refusee : compilation en memoire.
#>
function Import-HdeskType {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Type,
    [string[]]$References = @()
  )
  if ($Type -as [type]) { return }
  $code = Get-Content -Raw -Encoding UTF8 -LiteralPath $Source
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $octets = [Text.Encoding]::UTF8.GetBytes($code + "`n" + ($References -join '|') + "`n" + $PSVersionTable.CLRVersion)
    $empreinte = (($sha.ComputeHash($octets) | Select-Object -First 8 | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
  $nom = [IO.Path]::GetFileNameWithoutExtension($Source)
  $dossier = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'autowin-hdesk\types'
  $dll = Join-Path $dossier "$nom-$empreinte.dll"
  try {
    if (-not (Test-Path -LiteralPath $dll)) {
      New-Item -ItemType Directory -Force -Path $dossier | Out-Null
      # Deux gestes simultanes peuvent compiler en meme temps : chacun ecrit sa copie, le premier
      # deplacement gagne, l'autre copie est jetee.
      $tmp = Join-Path $dossier "$nom-$empreinte.$PID.tmp.dll"
      $p = @{ TypeDefinition = $code; OutputAssembly = $tmp; OutputType = 'Library' }
      if ($References.Count -gt 0) { $p.ReferencedAssemblies = $References }
      Add-Type @p
      try { [IO.File]::Move($tmp, $dll) } catch { }
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath ($tmp -replace '\.dll$', '.pdb') -Force -ErrorAction SilentlyContinue
      # Les DLL d'une source plus ancienne ne servent plus. Une DLL chargee par un geste en cours est
      # verrouillee : on la laisse, le prochain passage la reprend.
      Get-ChildItem -LiteralPath $dossier -Filter "$nom-*.dll" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -ne $dll } | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Add-Type -Path $dll
  } catch {
    if ($Type -as [type]) { return }
    $p = @{ TypeDefinition = $code }
    if ($References.Count -gt 0) { $p.ReferencedAssemblies = $References }
    Add-Type @p
  }
}
