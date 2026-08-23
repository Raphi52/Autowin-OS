<#
.SYNOPSIS
  Publier un travail sur `main` SANS jamais toucher l'arbre partagé.

.DESCRIPTION
  L'arbre `C:\Amitel\Autowin OS` a quatre écrivains simultanés : l'humain, Claude Code, Codex et
  l'étape de publication d'Autowin. Committer dedans mêle son diff à celui des autres, et un
  `git pull` concurrent a déjà EFFACÉ du travail par auto-stash (mesuré le 2026-08-13).

  La parade était connue mais jamais scriptée : créer un worktree sur `origin/main`, y appliquer son
  diff, committer, pousser, supprimer le worktree. Refaite À LA MAIN une dizaine de fois le
  2026-08-23, elle a laissé trois worktrees orphelins — d'où ce script, et son nettoyage garanti.

  Ne touche JAMAIS l'arbre partagé : il n'y est fait que des lectures (`git diff`).

.PARAMETER Fichiers
  Les fichiers à publier. Rien d'autre ne part : le reste de l'arbre sale est ignoré, ce qui évite
  d'emporter le travail en cours d'une autre session.

.PARAMETER Message
  Le message de commit. Multi-ligne accepté.

.PARAMETER SansPousser
  Prépare et commite dans le worktree, mais ne pousse pas. Pour vérifier avant l'acte sortant.

.EXAMPLE
  .\scripts\publier-isole.ps1 -Fichiers src/main/a.ts,src/main/a.test.ts -Message "fix(a): ..."
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Fichiers,
  [Parameter(Mandatory = $true)][string]$Message,
  [switch]$SansPousser
)

$ErrorActionPreference = 'Stop'

<#
  LIRE LE CODE DE RETOUR DE GIT. `$ErrorActionPreference = 'Stop'` ne leve PAS sur l'echec d'une
  commande NATIVE : seule une cmdlet PowerShell y obeit.

  Mesure du 2026-08-23, par ce script meme : `git apply` a echoue sur cinq fichiers (« patch does
  not apply »), le script a continue, et a pousse un commit AMPUTE en affichant « Publie : … ».
  Les quatre fichiers NEUFS etaient passes -- ils sont copies, pas patches -- ce qui rendait le
  succes credible. `main` s'est retrouve rouge en moins d'une minute.
#>
function Git-OuEchouer {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [string]$Contexte)
  $sortie = & git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("git " + ($Arguments -join ' ') + " a echoue (code $LASTEXITCODE)" +
      $(if ($Contexte) { " -- $Contexte" }) + "`n" + ($sortie -join "`n"))
  }
  return $sortie
}
$depot = Split-Path -Parent $PSScriptRoot
Set-Location $depot

# Le worktree vit hors du dépôt : dedans, il serait ramassé par les agents et par `git status`.
$travail = Join-Path ([System.IO.Path]::GetTempPath()) ("publier-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$patch = Join-Path ([System.IO.Path]::GetTempPath()) ("publier-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.patch')

function Nettoyer {
  # NETTOYAGE GARANTI, y compris sur échec : trois worktrees orphelins ont été retrouvés le
  # 2026-08-23 parce que la danse manuelle s'interrompait avant sa dernière étape.
  if (Test-Path $patch) { Remove-Item $patch -Force -ErrorAction SilentlyContinue }
  if (Test-Path $travail) {
    git -C $depot worktree remove --force $travail 2>$null | Out-Null
    Remove-Item $travail -Recurse -Force -ErrorAction SilentlyContinue
  }
  git -C $depot worktree prune 2>$null | Out-Null
}

try {
  $manquants = $Fichiers | Where-Object { -not (Test-Path (Join-Path $depot $_)) }
  if ($manquants) { throw "Fichier(s) introuvable(s) : $($manquants -join ', ')" }

  git fetch origin main --quiet
  # Le diff est pris contre `origin/main`, PAS contre HEAD : la branche locale peut être en retard
  # ou divergente sans que rien ne le signale (constaté le 2026-08-23).
  # C'est GIT qui ecrit son patch, jamais PowerShell. Mesure du 2026-08-23 : passer par
  # `| Out-File -Encoding utf8` produisait un fichier en CRLF avec BOM, que `git apply` rejetait
  # (« trailing whitespace », puis « patch does not apply ») -- alors que le diff etait parfaitement
  # valide. `--output` contourne entierement l'encodage du shell ; `--binary` preserve les fichiers
  # non textuels.
  Git-OuEchouer -Arguments (@('diff', '--binary', "--output=$patch", 'origin/main', '--') + $Fichiers) -Contexte 'lecture du diff' | Out-Null
  # Les fichiers NON SUIVIS n'apparaissent pas dans un `git diff` : ils sont copiés à part, sinon un
  # fichier neuf serait silencieusement omis de la publication.
  $suivis = git ls-files -- $Fichiers
  $nouveaux = @($Fichiers | Where-Object { $suivis -notcontains $_ })

  $tailleDuPatch = (Get-Item $patch).Length
  if ($tailleDuPatch -eq 0 -and $nouveaux.Count -eq 0) {
    Write-Host 'Rien à publier : ces fichiers sont déjà identiques à origin/main.'
    return
  }

  Git-OuEchouer -Arguments @('worktree', 'add', '--quiet', '--detach', $travail, 'origin/main') | Out-Null
  if ($tailleDuPatch -gt 0) { Git-OuEchouer -Arguments @('-C', $travail, 'apply', $patch) -Contexte 'le patch ne s applique pas sur origin/main -- rien n a ete publie' }
  foreach ($f in $nouveaux) { Copy-Item (Join-Path $depot $f) (Join-Path $travail $f) -Force }

  Git-OuEchouer -Arguments (@('-C', $travail, 'add', '--') + $Fichiers) | Out-Null
  Git-OuEchouer -Arguments @('-C', $travail, 'commit', '--quiet', '-m', $Message) | Out-Null
  $sha = (git -C $travail rev-parse --short HEAD).Trim()

  # CONTROLE DE COMPLETUDE avant l'acte sortant : le commit doit porter TOUS les fichiers demandes,
  # ni plus ni moins. Sans lui, un `git apply` partiel produit un commit ampute qui a l'air reussi.
  $commites = @(Git-OuEchouer -Arguments @('-C', $travail, 'show', '--pretty=format:', '--name-only', 'HEAD') |
    Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
  $omis = @($Fichiers | Where-Object { $commites -notcontains $_ })
  if ($omis.Count -gt 0) {
    throw "Commit INCOMPLET, rien n'est pousse. Fichier(s) absent(s) du commit : $($omis -join ', ')"
  }

  if ($SansPousser) {
    Write-Host "Commit $sha prêt dans $travail (non poussé)."
    Write-Host 'Le worktree est conservé pour inspection ; supprime-le avec git worktree remove.'
    $travail = $null  # on ne nettoie pas ce que l'utilisateur veut inspecter
    return
  }

  # Rebase avant push : un push concurrent d'une autre session a déjà fait rejeter le mien.
  git -C $travail fetch origin main --quiet
  Git-OuEchouer -Arguments @('-C', $travail, 'rebase', 'origin/main', '--quiet') | Out-Null
  Git-OuEchouer -Arguments @('-C', $travail, 'push', 'origin', 'HEAD:main') | Out-Null
  Write-Host "Publié : $sha"
}
finally {
  Nettoyer
}
