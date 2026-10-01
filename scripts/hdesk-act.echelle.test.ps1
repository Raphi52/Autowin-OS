<#
  BANC LIVE de scripts/hdesk-act.ps1 : le clic tombe au pixel PHYSIQUE de la capture hdesk-observe,
  quelle que soit l'echelle Windows, et -Touches poste des touches a la fenetre visee.

  Pourquoi (kaizen conv-873, 2026-09-27) : session Bureau a distance en portrait a 200 %. hdesk-observe
  rendait une capture en pixels PHYSIQUES (1080x2304) mais hdesk-act, non conscient de l'echelle,
  lisait X/Y en pixels LOGIQUES : le clic (140,798) vise sur l'entree « Publier sur Roblox » du menu
  de Studio atterrissait en (280,1596), sous le menu. Conclusion fausse de l'agent : « le bureau cache
  ne sait pas piloter Studio » -> il est passe sur l'ecran reel de l'utilisateur, qui a du intervenir.
  Second manque : aucune touche (fleches, Entree, Echap) ne pouvait etre postee, or c'est la seule voie
  qui active une entree de menu Qt (un clic poste l'ouvre sans l'activer).

  Cible : charmap.exe (Win32 classique, multi-instance). Case « Affichage avance » : la cocher agrandit
  la fenetre -> preuve que le clic a porte. Espace poste a la case, SANS clic -> elle se decoche et la
  fenetre reprend sa hauteur -> preuve que -Touches porte.
  Usage : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hdesk-act.echelle.test.ps1
  Code 0 = vert ; 1 = rouge ; 2 = banc impossible a monter (charmap absent, bureau non cree).
#>
$ErrorActionPreference = 'Stop'
$id = "hdtest-echelle-$PID"
$registre = Join-Path $env:TEMP "hdtest-registre-$PID"
New-Item -ItemType Directory -Force $registre | Out-Null
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Threading; using System.Runtime.InteropServices;
public static class SondeEchelle {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n, uint f, bool i, uint a);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr d, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr w, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  // Rend "hwnd;hauteur;cx;cy;dpi" de la fenetre visible du processus, et le centre PHYSIQUE de la case.
  public static string Mesurer(string bureau, int pid) {
    string res = "";
    var t = new Thread(() => {
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      IntPtr d = OpenDesktopW(bureau, 0, false, 0x10000000); if (d == IntPtr.Zero) return;
      SetThreadDesktop(d);
      IntPtr fen = IntPtr.Zero;
      int aire = 0; // la plus GRANDE fenetre visible du processus : il en a aussi de 100x100 (techniques)
      EnumDesktopWindows(d, (h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == (uint)pid && IsWindowVisible(h)) { RECT w; GetWindowRect(h, out w); int a = (w.R - w.L) * (w.B - w.T); if (a > aire) { aire = a; fen = h; } } return true; }, IntPtr.Zero);
      if (fen != IntPtr.Zero) {
        RECT r; GetWindowRect(fen, out r);
        IntPtr caseA = IntPtr.Zero;
        EnumChildWindows(fen, (h, l) => { var s = new StringBuilder(128); GetWindowTextW(h, s, 128); if (s.ToString().ToLower().Contains("avanc")) { caseA = h; return false; } return true; }, IntPtr.Zero);
        int cx = -1, cy = -1;
        if (caseA != IntPtr.Zero) { RECT c; GetWindowRect(caseA, out c); cx = c.L + 8; cy = (c.T + c.B) / 2; }
        res = fen.ToInt64() + ";" + (r.B - r.T) + ";" + cx + ";" + cy + ";" + GetDpiForWindow(fen);
      }
      CloseDesktop(d);
    });
    t.Start(); t.Join();
    return res;
  }
}
"@
$code = 1
$lanc = $null
try {
  $exe = Join-Path $env:WINDIR 'System32\charmap.exe'
  if (-not (Test-Path $exe)) { Write-Output 'BANC IMPOSSIBLE : charmap.exe absent'; exit 2 }
  $lanc = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'hdesk-lancer.ps1') `
    -Id $id -Executable $exe -Travail 'banc hdesk-act (echelle et touches)' -Conversation 'banc-hdesk' `
    -AttenteSecondes 20 -SurvieSecondes 1 -Registre $registre | ConvertFrom-Json
  if (-not $lanc.pret) { Write-Output "BANC IMPOSSIBLE : charmap n'a pas demarre ($($lanc.erreur))"; exit 2 }
  Start-Sleep -Milliseconds 800
  $avant = [SondeEchelle]::Mesurer("AutowinTest_$id", [int]$lanc.pid) -split ';'
  if ($avant.Count -lt 5 -or [int]$avant[2] -lt 0) { Write-Output "BANC IMPOSSIBLE : fenetre ou case introuvable ($($avant -join ';'))"; exit 2 }
  $clic = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'hdesk-act.ps1') -InstanceId $id -X ([int]$avant[2]) -Y ([int]$avant[3]) | ConvertFrom-Json
  Start-Sleep -Milliseconds 800
  $apres = [SondeEchelle]::Mesurer("AutowinTest_$id", [int]$lanc.pid) -split ';'
  $clicOk = ($apres.Count -ge 2) -and ([int]$apres[1] -ne [int]$avant[1])
  # Touches : Espace postee a la case sous le point, SANS clic -> elle se decoche, hauteur d'origine.
  $touchesOk = $false
  $fin = $apres
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'hdesk-act.ps1') -InstanceId $id -X ([int]$avant[2]) -Y ([int]$avant[3]) -SansClic -Touches '20' | Out-Null
    Start-Sleep -Milliseconds 800
    $fin = [SondeEchelle]::Mesurer("AutowinTest_$id", [int]$lanc.pid) -split ';'
    $touchesOk = $clicOk -and ($fin.Count -ge 2) -and ([int]$fin[1] -eq [int]$avant[1])
  } catch { $touchesOk = $false }
  [pscustomobject]@{ dpi = [int]$avant[4]; point = "$($avant[2]),$($avant[3])"; cible = $clic.cible
    hauteurAvant = [int]$avant[1]; hauteurApresClic = [int]$apres[1]; hauteurApresEspace = [int]$fin[1]; clicPorte = $clicOk; touchesPortent = $touchesOk } | ConvertTo-Json -Compress
  if ($clicOk -and $touchesOk) { Write-Output 'VERT : clic au pixel physique et touches postees'; $code = 0 }
  else { Write-Output 'ROUGE : clic hors cible ou touches sans effet' }
} finally {
  if ($lanc -and $lanc.pid) { Stop-Process -Id ([int]$lanc.pid) -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $registre -ErrorAction SilentlyContinue
}
exit $code
