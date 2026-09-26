# Liste les fenetres VISIBLES du bureau reel de l'utilisateur (pid|classe|titre) : controle anti-consoles .rokit.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public class E { public delegate bool P(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
 public static List<string> L() { var r = new List<string>(); EnumWindows((h,l)=>{ if(IsWindowVisible(h)){ uint p; GetWindowThreadProcessId(h,out p); var c=new StringBuilder(256); GetClassNameW(h,c,256); var t=new StringBuilder(256); GetWindowTextW(h,t,256); r.Add(p.ToString()+"|"+c.ToString()+"|"+t.ToString());} return true; }, IntPtr.Zero); return r; } }
"@
$l = [E]::L()
$l | Where-Object { $_ -match 'Console|CASCADIA|bash|lune|mintty' }
"total visibles=" + $l.Count
