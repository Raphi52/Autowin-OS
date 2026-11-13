<#
Lance un long travail qui SURVIT à la fin du tour de chat Autowin.

Cause : le CLI du chat tourne dans un Job Windows JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
(src/main/runs/survivable-spawn.ts). Tout descendant — tâche Bash run_in_background,
Start-Process compris — appartient à ce Job et meurt quand il se ferme.
Ici le processus est créé par le service WMI (Win32_Process.Create) : son parent est
WmiPrvSE.exe, hors du Job du tour. Il n'hérite donc pas de la fermeture.

Usage :
  powershell -NoProfile -File scripts/lancer-detache.ps1 -Commande '"C:\Program Files\Git\bin\bash.exe" -lc "/d/banc/lance.sh"' -Dossier D:\banc
  -Visible : fenêtre affichée (ShowWindow = SW_SHOWNORMAL) au lieu de cachée. Pour une application
  graphique ouverte À LA DEMANDE de l'utilisateur sur son écran : sans ce mode, la première
  ShowWindow d'une app WPF/WinForms reprend SW_HIDE et sa fenêtre reste invisible ; et lancée par
  Start-Process, elle mourrait avec le tour : l'utilisateur la verrait « se fermer seule ».
Sortie : une ligne JSON {pid, horsJob, commande}. Code 0 = lancé ET vérifié hors Job.
#>
param(
  [Parameter(Mandatory = $true)][string]$Commande,
  [string]$Dossier = (Get-Location).Path,
  [switch]$Visible
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class JobProbe {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr p, IntPtr job, out bool r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int InAnyJob(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return -1;
    try { bool r; if (!IsProcessInJob(h, IntPtr.Zero, out r)) return -1; return r ? 1 : 0; } finally { CloseHandle(h); }
  }
}
'@

# Fenêtre cachée par défaut : ShowWindow = 0 (SW_HIDE) ; -Visible : 1 (SW_SHOWNORMAL).
$affichage = if ($Visible) { [uint16]1 } else { [uint16]0 }
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = $affichage }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $Commande; CurrentDirectory = $Dossier; ProcessStartupInformation = $startup
}
if ($r.ReturnValue -ne 0) {
  [pscustomobject]@{ erreur = "Win32_Process.Create a rendu $($r.ReturnValue)"; commande = $Commande } | ConvertTo-Json -Compress
  exit 1
}
$procId = [int]$r.ProcessId
$inJob = [JobProbe]::InAnyJob($procId)
[pscustomobject]@{ pid = $procId; horsJob = ($inJob -eq 0); commande = $Commande } | ConvertTo-Json -Compress
# 1 = dans un Job (il mourrait peut-être avec le tour) ; -1 = processus déjà fini ou illisible.
if ($inJob -eq 0) { exit 0 } elseif ($inJob -eq 1) { exit 2 } else { exit 3 }
