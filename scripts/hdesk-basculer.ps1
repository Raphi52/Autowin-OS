<#
  BASCULE DE L'ECRAN REEL VERS UN BUREAU CACHE (conv-35, 2026-10-01), avec RETOUR GARANTI.
  Option de la TV interactive : l'utilisateur VOIT et manipule directement le bureau AutowinTest_<id>.

  Le bureau cache n'a ni barre des taches ni Explorer : sans sortie, l'utilisateur serait coince.
  Ce script porte donc lui-meme les trois sorties, sur le bureau cache :
    1. une fenetre « Revenir a mon bureau » toujours au premier plan ;
    2. le raccourci Echap (enregistre sur le thread du bureau cache, sinon il ne se declenche pas) ;
    3. une minuterie de retour automatique (-MaxSecondes, 120 par defaut, plafond 600).
  Le retour vers « Default » est fait dans un finally : une exception le declenche aussi.
  Limite : un arret BRUTAL de ce processus (kill) saute le finally — d'ou un processus detache qui ne
  depend pas d'Autowin.

  Usage : powershell -NoProfile -File scripts/hdesk-basculer.ps1 -InstanceId <id> [-MaxSecondes 120] [-Statut <fichier.json>]
  Sortie : JSON {instanceId, bascule, retour, motif} ; exit 0 = revenu, 1 = echec avant bascule.

  -Statut (conv-951, 2026-10-16) : l'app lance ce script DETACHE par WMI (scripts/lancer-detache.ps1) et
  ne voit donc ni sa sortie ni son code. Le script lui ecrit son verdict dans ce fichier, des qu'il le
  connait : {"etat":"bascule"} juste apres SwitchDesktop, ou {"etat":"erreur","message":...} si la
  bascule echoue. Sans ce fichier, un echec redevient muet pour l'utilisateur.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$InstanceId,
  [ValidateRange(5, 600)][int]$MaxSecondes = 120,
  [string]$Statut = ''
)
$ErrorActionPreference = 'Stop'
function Ecrire-Statut([hashtable]$Etat) {
  if (-not $Statut) { return }
  try {
    [System.IO.File]::WriteAllText($Statut, ($Etat | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
  } catch {
    [Console]::Error.WriteLine("Fichier d'etat illisible ou inaccessible : $Statut")
  }
}
trap {
  # Message de la cause, pas l'enveloppe « Exception lors de l'appel de Basculer avec 3 argument(s) ».
  $cause = $_.Exception
  while ($cause.InnerException) { $cause = $cause.InnerException }
  [Console]::Error.WriteLine($cause.Message)
  Ecrire-Statut @{ etat = 'erreur'; message = $cause.Message }
  exit 1
}
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class AutowinHdeskBascule {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenDesktopW(string n, uint f, bool i, uint a);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SwitchDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr w, int id, uint mod, uint vk);
  const uint GENERIC_ALL = 0x10000000;
  const uint MOD_NONE = 0, VK_ESCAPE = 0x1B;

  class Garde : Form {
    public string Motif = "minuterie";
    public Garde(int max) {
      Text = "Autowin"; TopMost = true; FormBorderStyle = FormBorderStyle.FixedToolWindow;
      StartPosition = FormStartPosition.Manual; Location = new Point(20, 20); ClientSize = new Size(300, 70);
      var b = new Button { Text = "Revenir a mon bureau  (Echap)", Dock = DockStyle.Fill };
      b.Click += (s, e) => { Motif = "bouton"; Close(); };
      Controls.Add(b);
      var t = new System.Windows.Forms.Timer { Interval = max * 1000 };
      t.Tick += (s, e) => { Motif = "minuterie"; Close(); };
      t.Start();
    }
    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      RegisterHotKey(Handle, 1, MOD_NONE, VK_ESCAPE);
    }
    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x0312) { Motif = "raccourci"; Close(); return; }
      base.WndProc(ref m);
    }
  }

  public static string Basculer(string nom, int max, string statut) {
    IntPtr cache = OpenDesktopW(nom, 0, false, GENERIC_ALL);
    if (cache == IntPtr.Zero) throw new Exception("Bureau cache introuvable : " + nom + " (Win32 " + Marshal.GetLastWin32Error() + ").");
    IntPtr defaut = OpenDesktopW("Default", 0, false, GENERIC_ALL);
    if (defaut == IntPtr.Zero) { CloseDesktop(cache); throw new Exception("Bureau Default inaccessible : bascule refusee (retour non garanti)."); }
    string motif = "erreur";
    var pret = new ManualResetEvent(false);
    Exception echec = null;
    var th = new Thread(() => {
      try {
        if (!SetThreadDesktop(cache)) throw new Exception("SetThreadDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ").");
        var g = new Garde(max);
        g.Shown += (s, e) => pret.Set();
        Application.Run(g);
        motif = g.Motif;
      } catch (Exception e) { echec = e; pret.Set(); }
    });
    th.SetApartmentState(ApartmentState.STA);
    th.IsBackground = true;
    th.Start();
    // Pas de bascule tant que la sortie (fenetre + raccourci) n'existe pas sur le bureau cache.
    if (!pret.WaitOne(15000) || echec != null) {
      CloseDesktop(cache); CloseDesktop(defaut);
      throw new Exception("Sortie du bureau cache non prete : bascule annulee. " + (echec != null ? echec.Message : ""));
    }
    try {
      if (!SwitchDesktop(cache)) throw new Exception("SwitchDesktop a echoue (Win32 " + Marshal.GetLastWin32Error() + ").");
      // L'ecran a bascule : l'app qui attend ce verdict peut repondre « ok » a l'utilisateur.
      if (!string.IsNullOrEmpty(statut)) {
        try { System.IO.File.WriteAllText(statut, "{\"etat\":\"bascule\"}"); }
        catch (Exception e) { Console.Error.WriteLine("Fichier d'etat non ecrit : " + e.Message); }
      }
      th.Join((max + 5) * 1000);
      if (th.IsAlive) motif = "minuterie";
    } finally {
      SwitchDesktop(defaut);
      CloseDesktop(cache); CloseDesktop(defaut);
    }
    return motif;
  }
}
'@
$motif = [AutowinHdeskBascule]::Basculer("AutowinTest_$InstanceId", $MaxSecondes, $Statut)
[pscustomobject]@{ instanceId = $InstanceId; bascule = $true; retour = $true; motif = $motif } | ConvertTo-Json -Compress
