# SONDE DE DEMARRAGE — qui occupe le disque pendant qu'Autowin OS demarre ?
#
# Demande utilisateur du 2026-10-18 : « c quoi qui rend ca lent ? ». Les premiers lancements du matin
# (17/10, 18/10) ont mis ~10 min a afficher la fenetre. D: est un disque MECANIQUE (TOSHIBA HDWD220).
# Indice deja releve : ces deux matins-la, Dofus (installe sur D:\Dofus-dofus3) a ete lance en meme
# temps qu'Autowin (zaap\application.log, [SPAWN]). La sonde le MESURE au lieu de le deduire.
#
# Lancee par scripts/launch_dev.py, UNE fois, quand `.autowin-data/sonde-demarrage.armee` existe (le
# lanceur supprime le fichier en la lancant). Sans droits administrateur : compteurs WMI seulement.
#
# Sortie : .autowin-data/sonde-demarrage/<horodatage>.csv, une ligne toutes les 5 s :
#   heure ; % occupation D: ; file d'attente D: ; Mo/s lus D: ; % occupation C: ; 5 plus gros lecteurs (Mo lus)
param(
    [string]$Racine = (Split-Path -Parent $PSScriptRoot),
    [int]$DureeS = 900,
    [int]$PasS = 5
)

$ErrorActionPreference = 'SilentlyContinue'
$dossier = Join-Path $Racine '.autowin-data\sonde-demarrage'
New-Item -ItemType Directory -Force $dossier | Out-Null
$sortie = Join-Path $dossier ((Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.csv')
'heure;occupation_D_pct;file_D;lu_D_Mo_s;occupation_C_pct;plus_gros_lecteurs_Mo' | Set-Content $sortie -Encoding utf8

# Lectures cumulees par processus (octets) : on en fait des deltas a chaque pas.
function Lectures {
    $t = @{}
    foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, Name, ReadTransferCount) {
        $t[[int]$p.ProcessId] = @($p.Name, [double]$p.ReadTransferCount)
    }
    $t
}

$avant = Lectures
$fin = (Get-Date).AddSeconds($DureeS)
while ((Get-Date) -lt $fin) {
    Start-Sleep -Seconds $PasS  # sleep-ok: cadence d'echantillonnage de la sonde
    $disques = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk
    $d = $disques | Where-Object { $_.Name -match 'D:' } | Select-Object -First 1
    $c = $disques | Where-Object { $_.Name -match 'C:' } | Select-Object -First 1
    $apres = Lectures
    $deltas = foreach ($k in $apres.Keys) {
        $base = if ($avant.ContainsKey($k)) { $avant[$k][1] } else { $apres[$k][1] }
        [pscustomobject]@{ Nom = $apres[$k][0]; Mo = ($apres[$k][1] - $base) / 1MB }
    }
    # Regroupe par nom : Electron, node ou Dofus tournent en plusieurs processus.
    $top = $deltas | Group-Object Nom | ForEach-Object {
        [pscustomobject]@{ Nom = $_.Name; Mo = ($_.Group | Measure-Object Mo -Sum).Sum }
    } | Where-Object { $_.Mo -ge 1 } | Sort-Object Mo -Descending | Select-Object -First 5
    $lecteurs = ($top | ForEach-Object { '{0}={1:N0}' -f $_.Nom, $_.Mo }) -join ' '
    $ligne = '{0};{1};{2};{3:N1};{4};{5}' -f (Get-Date -Format 'HH:mm:ss'),
        (100 - [int]$d.PercentIdleTime), [int]$d.CurrentDiskQueueLength, ([double]$d.DiskReadBytesPersec / 1MB),
        (100 - [int]$c.PercentIdleTime), $lecteurs
    Add-Content $sortie $ligne -Encoding utf8
    $avant = $apres
}
