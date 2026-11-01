<#
  TRACE LÉGÈRE D'UN BLOCAGE DISQUE — qui tient le fil pendant le prochain mur de 10 s ?

  Pourquoi (conv-1368, 2026-10-31) : des appels disque restaient bloqués jusqu'à 20 s alors que le SSD
  répondait en 420 ms au pire. Le mur se reproduit hors de l'app (`cmd /c move /y`), mais seulement
  sous charge : 6 000 remplacements de fichier sur un poste calme n'en ont donné aucun, un contrôle de
  typage lancé à côté en a donné un en quelques minutes. Une trace `wpr` pèse 600 Mo par minute et ne
  peut pas attendre des heures. Une pile lue PENDANT le blocage, si : le 31/10, 6 163 ms dans
  `ZwSetInformationFile` < `MoveFileWithProgressTransactedW`, sans aucun module tiers. Le fil attend
  donc dans le noyau, et `ekrn.exe` (ESET) touchait les deux fichiers à cet instant précis.

  Ce script lance donc une SENTINELLE, un petit `node` à lui qui remplace un fichier neuf toutes les
  demi-secondes, et lit la pile de son fil principal quatre fois par seconde. Il ne touche à aucun
  autre processus, n'écrit qu'un fichier de rapport, et s'arrête au premier blocage.

  `-Racine` choisit où la sentinelle travaille : pour juger une exclusion d'antivirus, la lancer dans
  le dossier exclu, puis ailleurs, sous la même charge.

  Usage : powershell -NoProfile -File scripts/trace-blocage-disque.ps1 [-Minutes 60] [-SeuilMs 3000]
                                                                        [-Racine <dossier>]
                                                                        [-Sortie <fichier.jsonl>]
  Sortie 0 = blocage capturé et rapporté ; 2 = aucun blocage pendant la durée demandée.
#>
param(
  [int]$Minutes = 60,
  [int]$SeuilMs = 3000,
  [string]$Racine = $env:TEMP,
  [string]$Sortie = (Join-Path $PSScriptRoot '..\.autowin-data\autowin-os\trace-blocages.jsonl')
)
$ErrorActionPreference = 'Stop'

$lecteur = @'
using System; using System.Collections.Generic; using System.Diagnostics;
using System.Runtime.InteropServices;
public static class LecteurDePile {
  [DllImport("kernel32")] static extern IntPtr OpenThread(uint acces, bool herite, int fil);
  [DllImport("kernel32")] static extern IntPtr OpenProcess(uint acces, bool herite, int pid);
  [DllImport("kernel32")] static extern uint SuspendThread(IntPtr h);
  [DllImport("kernel32")] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32")] static extern bool GetThreadContext(IntPtr h, IntPtr contexte);
  [DllImport("kernel32", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr m, string nom);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string nom);
  [DllImport("dbghelp", CharSet = CharSet.Ansi)] static extern bool SymInitialize(IntPtr h, string p, bool charger);
  [DllImport("dbghelp")] static extern bool StackWalk64(uint machine, IntPtr hp, IntPtr ht, IntPtr cadre,
    IntPtr contexte, IntPtr lecture, IntPtr table, IntPtr module, IntPtr traduction);
  const uint TOUT_PROCESSUS = 0x1F0FFF, TOUT_FIL = 0x1FFFFF, AMD64 = 0x8664;
  // Tailles et positions de CONTEXT et STACKFRAME64 en 64 bits (winnt.h, dbghelp.h).
  const int TAILLE_CONTEXTE = 1232, TAILLE_CADRE = 264, CONTEXTE_DRAPEAUX = 0x30, RSP = 0x98, RBP = 0xA0, RIP = 0xF8;
  static IntPtr hp, ht, table, module, contexte, cadre;
  static Process cible;

  public static void Ouvrir(int pid, int fil) {
    cible = Process.GetProcessById(pid);
    hp = OpenProcess(TOUT_PROCESSUS, false, pid);
    ht = OpenThread(TOUT_FIL, false, fil);
    IntPtr dbghelp = LoadLibraryW("dbghelp.dll");
    SymInitialize(hp, null, true);
    table = GetProcAddress(dbghelp, "SymFunctionTableAccess64");
    module = GetProcAddress(dbghelp, "SymGetModuleBase64");
    IntPtr brut = Marshal.AllocHGlobal(TAILLE_CONTEXTE + 16);
    contexte = new IntPtr((brut.ToInt64() + 15) & ~15L);
    cadre = Marshal.AllocHGlobal(TAILLE_CADRE);
  }

  static string Nom(ulong adresse) {
    cible.Refresh();
    foreach (ProcessModule m in cible.Modules) {
      ulong base_ = (ulong)m.BaseAddress.ToInt64();
      if (adresse >= base_ && adresse < base_ + (ulong)m.ModuleMemorySize)
        return m.ModuleName + "+0x" + (adresse - base_).ToString("x");
    }
    return "0x" + adresse.ToString("x");
  }

  /** Suspend le fil quelques microsecondes : la sentinelle est à nous, personne d'autre n'est touché. */
  public static ulong[] Lire() {
    var pile = new List<ulong>();
    SuspendThread(ht);
    try {
      for (int i = 0; i < TAILLE_CONTEXTE; i++) Marshal.WriteByte(contexte, i, 0);
      Marshal.WriteInt32(contexte, CONTEXTE_DRAPEAUX, 0x10000B);
      if (!GetThreadContext(ht, contexte)) return pile.ToArray();
      for (int i = 0; i < TAILLE_CADRE; i++) Marshal.WriteByte(cadre, i, 0);
      Marshal.WriteInt64(cadre, 0, Marshal.ReadInt64(contexte, RIP)); Marshal.WriteInt32(cadre, 12, 3);
      Marshal.WriteInt64(cadre, 32, Marshal.ReadInt64(contexte, RBP)); Marshal.WriteInt32(cadre, 44, 3);
      Marshal.WriteInt64(cadre, 48, Marshal.ReadInt64(contexte, RSP)); Marshal.WriteInt32(cadre, 60, 3);
      for (int n = 0; n < 48; n++) {
        if (!StackWalk64(AMD64, hp, ht, cadre, contexte, IntPtr.Zero, table, module, IntPtr.Zero)) break;
        ulong pc = (ulong)Marshal.ReadInt64(cadre, 0);
        if (pc == 0) break;
        pile.Add(pc);
      }
    } finally { ResumeThread(ht); }
    return pile.ToArray();
  }

  public static string[] Nommer(ulong[] pile) {
    var noms = new string[pile.Length];
    for (int i = 0; i < pile.Length; i++) noms[i] = Nom(pile[i]);
    return noms;
  }
}
'@
Add-Type -TypeDefinition $lecteur -Language CSharp

$dossier = Join-Path $Racine ("autowin-sentinelle-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
New-Item -ItemType Directory -Path $dossier | Out-Null
$code = "const fs=require('fs'),path=require('path');let n=0;setInterval(()=>{const f=path.join(process.argv[1],'f'+(n++)+'.json');fs.writeFileSync(f,'[]');fs.writeFileSync(f+'.tmp','[]');fs.renameSync(f+'.tmp',f);fs.rmSync(f,{force:true})},500)"
$sentinelle = Start-Process -FilePath 'node' -ArgumentList @('-e', "`"$code`"", $dossier) -WindowStyle Hidden -PassThru

try {
  Start-Sleep -Seconds 1
  $fil = ($sentinelle.Threads | Sort-Object StartTime | Select-Object -First 1).Id
  [LecteurDePile]::Ouvrir($sentinelle.Id, $fil)
  Write-Output "Sentinelle $($sentinelle.Id) sous surveillance, $Minutes min au plus, seuil $SeuilMs ms."

  $fin = (Get-Date).AddMinutes($Minutes)
  $comptes = @{}      # pile -> nombre d'échantillons : la plus fréquente est le fil au repos
  $precedente = ''
  $depuis = Get-Date
  while ((Get-Date) -lt $fin -and -not $sentinelle.HasExited) {
    $adresses = [LecteurDePile]::Lire()
    $pile = ($adresses | ForEach-Object { '{0:x}' -f $_ }) -join ','
    $comptes[$pile] = 1 + [int]$comptes[$pile]
    if ($pile -ne $precedente) { $precedente = $pile; $depuis = Get-Date }
    $repos = ($comptes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
    $immobile = ((Get-Date) - $depuis).TotalMilliseconds
    if ($pile -ne $repos -and $immobile -ge $SeuilMs) {
      # On laisse le blocage finir pour rapporter sa durée entière.
      while (-join ([LecteurDePile]::Lire() | ForEach-Object { '{0:x},' -f $_ }) -eq "$pile,") {
        Start-Sleep -Milliseconds 100
      }
      $duree = [int]((Get-Date) - $depuis).TotalMilliseconds
      $noms = [LecteurDePile]::Nommer($adresses)
      $tiers = @($noms | ForEach-Object { ($_ -split '\+')[0] } | Select-Object -Unique |
          Where-Object { $_ -notmatch '^(ntdll|KERNELBASE|KERNEL32|node|0x)' })
      $rapport = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); dureeMs = $duree; tiers = $tiers; pile = $noms }
      New-Item -ItemType Directory -Path (Split-Path $Sortie) -Force | Out-Null
      Add-Content -Path $Sortie -Value ($rapport | ConvertTo-Json -Compress) -Encoding utf8
      $qui = if ($tiers.Count) { $tiers -join ', ' } else { 'aucun, le fil attend dans le noyau' }
      Write-Output "Blocage de $duree ms capturé. Modules hors Windows sur la pile : $qui"
      $noms | Select-Object -First 16 | ForEach-Object { "  $_" }
      Write-Output "Rapport : $Sortie"
      exit 0
    }
    Start-Sleep -Milliseconds 250
  }
  Write-Output "Aucun blocage de $SeuilMs ms ou plus en $Minutes min."
  exit 2
}
finally {
  # Seule la sentinelle lancée ici est arrêtée, par son identifiant.
  if (-not $sentinelle.HasExited) { Stop-Process -Id $sentinelle.Id -Force }
  Remove-Item -LiteralPath $dossier -Recurse -Force -ErrorAction SilentlyContinue
}
