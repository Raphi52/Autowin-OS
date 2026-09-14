/**
 * GARDE : UNE APPLICATION GRAPHIQUE NE S'OUVRE PAS AU PREMIER PLAN.
 *
 * Mesure conv-526 (2026-09-13) : malgre une consigne ecrite, l'agent a lance deux fois
 * `RobloxStudioBeta.exe` sur l'ecran reel de l'utilisateur (par l'outil Bash, puis par
 * `powershell Start-Process ... -WindowStyle Maximized`). L'utilisateur a du annuler les deux tours.
 * La consigne en prose ne suffisait pas : ce garde refuse le geste AVANT qu'il parte.
 *
 * Voie imposee : `scripts/hdesk-lancer.ps1` (bureau Windows cache), puis `scripts/hdesk-observe.ps1`.
 *
 * CONTRAINTE : la fonction est AUTOPORTEE (aucun import, aucune reference exterieure) — elle est
 * serialisee telle quelle par `Function.prototype.toString` dans le script de hook ecrit a cote du
 * settings temporaire du CLI (cf. `scriptHookGardeGraphique`).
 */
export function refusLancementGraphique(commande: string): string | undefined {
  const c = String(commande ?? '')
  if (!c.trim()) return undefined
  // Voies approuvees : le lanceur de bureau cache et l'instance Autowin cachee.
  // hors-ecran-capture.ps1 : voie 3D (rendu GPU illisible sur bureau cache, mesure conv-526).
  if (/hdesk-lancer\.ps1|hors-ecran-capture\.ps1|autowin-headless\.ps1|avec-instance-headless\.mjs/i.test(c)) {
    return undefined
  }

  const motif = (quoi: string): string =>
    `Lancement graphique au premier plan refusé (${quoi}) : il ouvrirait une fenêtre sur l'écran de l'utilisateur. ` +
    `Lance-le dans un bureau caché : powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id <id> -Executable "<chemin.exe>" -Arguments "<args>", ` +
    `puis capture avec scripts/hdesk-observe.ps1 -InstanceId <id> -Output <png>. ` +
    `Si l'app dessine en 3D (vue restée unie, code 3) : powershell -NoProfile -File scripts/hors-ecran-capture.ps1 -Executable "<chemin.exe>" -Arguments "<args>" -Output <png>.`

  // 1. Start-Process / start / Invoke-Item : ouvrent une fenetre, sauf lancement explicitement cache.
  const startProcess = /\b(start-process|saps)\b/i.test(c)
  if (startProcess && !/-windowstyle\s+hidden|-nonewwindow/i.test(c)) return motif('Start-Process')
  if (/\binvoke-item\b|(^|[;&|]\s*)ii\s/i.test(c)) return motif('Invoke-Item')
  if (/(^|[;&|(]\s*)(cmd(\.exe)?\s+\/c\s+)?start\s+("|[a-z]:|\/)/i.test(c)) return motif('start')
  if (/\bexplorer(\.exe)?\s+\S/i.test(c)) return motif('explorer')

  // 2 et 3. Le PROGRAMME LANCE, jamais un chemin passe en argument. Faux positif vecu le
  // 2026-09-13 : un `grep -a` qui LISAIT le binaire de Studio etait refuse comme un lancement.
  // Chaque commande de la ligne (separee par ; && || | ou un saut de ligne) est lue a part ; son
  // premier mot, apres un eventuel operateur d'appel PowerShell `&`, est le programme.
  // `powershell|pwsh|cmd -Command/-c//c "..."` : le texte interne est relu comme une commande.
  const graphiques =
    /^(robloxstudio\w*|robloxplayer\w*|notepad|mspaint|calc|charmap|wordpad|winword|excel|powerpnt|outlook|msedge|chrome|firefox|brave|code|devenv|unity|unityhub|blender|godot\w*|obs64|spotify|teams|ms-teams)(\.exe)?$/i
  const affectation = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s*/
  const programmeRefuse = (ligne: string, profondeur: number): string | undefined => {
    for (const brut of ligne.split(/;|&&|\|\||\||\r?\n/)) {
      let seg = brut.trim().replace(/^&\s*/, '')
      while (affectation.test(seg)) seg = seg.replace(affectation, '')
      const m = seg.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/)
      if (!m) continue
      const programme = (m[1] ?? m[2] ?? m[3] ?? '').split('/').join('\\')
      const base = programme.split('\\').pop() ?? ''
      if (graphiques.test(base)) return base.replace(/\.exe$/i, '').toLowerCase()
      if (/\.exe$/i.test(programme) && /program files|appdata\\local\\programs/i.test(programme)) {
        return 'application installée'
      }
      if (profondeur < 2 && /^(powershell|pwsh|cmd)(\.exe)?$/i.test(base)) {
        const interne = seg.match(/\s(?:-command|-c|\/c)\s+(?:"([^"]*)"?|'([^']*)'?|(.*))$/i)
        if (interne) {
          const r = programmeRefuse(interne[1] ?? interne[2] ?? interne[3] ?? '', profondeur + 1)
          if (r) return r
        }
      }
    }
    return undefined
  }
  const refuse = programmeRefuse(c, 0)
  if (refuse) return motif(refuse)
  return undefined
}

/**
 * Corps du script de hook PreToolUse (Bash) du CLI. Refus = JSON `permissionDecision: deny` sur
 * stdout (https://code.claude.com/docs/en/hooks). Mesure 2026-09-13 : avec exit 2 + stderr, l'appel
 * etait bien bloque mais l'agent recevait un resultat VIDE, sans le motif ni la voie a suivre.
 */
export function scriptHookGardeGraphique(): string {
  return `const refusLancementGraphique = ${refusLancementGraphique.toString()};
let d = '';
process.stdin.on('data', (b) => (d += b));
process.stdin.on('end', () => {
  let cmd = '';
  try { const j = JSON.parse(d); cmd = (j.tool_input && j.tool_input.command) || ''; } catch {}
  const motif = refusLancementGraphique(cmd);
  if (motif) {
    // Refus structure documente (hooks PreToolUse) : le motif est rendu a l'agent.
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motif } }));
    process.exit(0);
  }
  process.exit(0);
});
`
}
