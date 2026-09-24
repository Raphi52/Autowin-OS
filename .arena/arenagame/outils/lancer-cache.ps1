<#
  Lance un script bash d'arenagame DANS UN BUREAU WINDOWS CACHE, hors du Job du tour.
  Pourquoi (conv-826, 2026-09-24) : les essais ecrivent leurs propres verifier.mjs / equilibre.mjs qui
  appellent lune.exe par spawnSync SANS windowsHide : chaque appel ouvrait une console sur l'ecran
  de l'utilisateur (des centaines pendant les boucles d'equilibrage). Sur un bureau cache, toute
  fenetre d'un descendant s'ouvre la-bas, jamais sur l'ecran reel — quoi que le code des essais fasse.
  Usage : powershell -NoProfile -File lancer-cache.ps1 -Script D:/.../relance.sh -Id t4
  A appeler VIA scripts/lancer-detache.ps1 (WMI) pour survivre a la fin du tour.
#>
param([Parameter(Mandatory=$true)][string]$Script, [Parameter(Mandatory=$true)][string]$Id)
$bash = 'C:\Users\raphael.vilain\AppData\Local\Programs\Git\bin\bash.exe'
& powershell -NoProfile -File D:\AutoWinOS\scripts\hdesk-lancer.ps1 -Id "arena-$Id" -Executable $bash -Arguments "-lc `"$Script`"" -Travail "arenagame $Id (essais sur bureau cache)" -Conversation conv-826 -AttenteSecondes 20 -SurvieSecondes 3
exit $LASTEXITCODE
