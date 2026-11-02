/**
 * GARDE DU MOD AUTOWIN (plan-387b99e7, lot 4 — reprise du lot 1, 2026-11-02).
 *
 * `mods/autowin` est passé à CHAQUE run par `--plugin-dir` (src/main/providers/claude.ts,
 * `argumentsModsAutowin`), et « un mod a tous les droits du CLI ». Un run qui écrit dans ce dossier
 * change donc le comportement de tous les runs suivants, sans passer par le contrôle final de son
 * propre run : sa copie de travail n'est fusionnée qu'en vert, mais ce dossier-là est lu tout de suite.
 *
 * Refuse, pour un agent de RUN (`AUTOWIN_HDESK_ID` posé par l'orchestrateur), une écriture sous le
 * dossier du mod CHARGÉ (`dossierModsAutowin`, fixé au démarrage) :
 *   - outils d'édition (Edit, Write, MultiEdit, NotebookEdit) : chemin résolu, `..` compris ;
 *   - terminal (Bash, PowerShell, Monitor) : commande qui NOMME ce dossier ET porte un geste
 *     d'écriture (redirection, cp/mv/rm, Set-Content, sed -i, writeFileSync…). Une lecture passe.
 * La copie de travail du run garde son propre `mods/autowin`, où il travaille librement.
 * La promotion explicite vers le dépôt principal est traitée à part (autre lot du même plan).
 *
 * Limite connue : une écriture qui n'écrit PAS le chemin du dossier en clair (`cd` puis chemin
 * relatif, `git -C <dépôt> checkout -- mods/autowin`, chemin construit dans un script) n'est pas vue.
 *
 * AUTOPORTÉE : sérialisée telle quelle dans le script du hook PreToolUse (`scriptHookGardes`).
 */
export function refusEcritureModAutowin(
  e: { outil: string; chemin: string; shell: string; cwd: string; estUnRun: boolean },
  dossierProtege: string | undefined
): string | undefined {
  if (!e || !e.estUnRun || !dossierProtege) return undefined
  // Forme comparable : minuscules (Windows), `/`, `/d/…` de Git Bash → `d:/…`.
  const norm = (s: string): string =>
    String(s ?? '')
      .split('\\')
      .join('/')
      .toLowerCase()
      .replace(/^\/([a-z])(?=\/|$)/, '$1:')
  const resoudre = (p: string, cwd: string): string => {
    let s = norm(p)
    if (!/^[a-z]:(\/|$)/.test(s) && !s.startsWith('/')) s = norm(cwd) + '/' + s
    const parts: string[] = []
    for (const seg of s.split('/')) {
      if (seg === '..') {
        if (parts.length > 1) parts.pop()
      } else if (seg !== '.' && seg !== '') parts.push(seg)
    }
    return (s.startsWith('/') ? '/' : '') + parts.join('/')
  }
  const base = resoudre(dossierProtege, '')
  const motif = (cible: string): string =>
    `écriture refusée : ${cible} est dans le mod Autowin chargé par TOUS les runs (${dossierProtege}). ` +
    'Un mod a tous les droits du CLI : un run qui le modifie change les runs suivants sans contrôle final. ' +
    'Modifie le mods/autowin de ta copie de travail (chemin relatif) ; il rejoint le dépôt principal ' +
    'quand le run est validé, ou par une promotion explicite.'

  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(e.outil ?? ''))) {
    if (!e.chemin) return undefined
    const cible = resoudre(e.chemin, e.cwd)
    return cible === base || cible.startsWith(base + '/') ? motif(e.chemin) : undefined
  }

  const brut = String(e.shell ?? '')
  if (!brut) return undefined
  // Chemins Git Bash `/d/…` n'importe où dans la ligne (après espace, guillemet, `=`, `>`, `(`).
  const ligne = norm(brut).replace(/(^|[\s"'=>(])\/([a-z])\//g, '$1$2:/')
  const echappe = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fin = `(?=$|[/\\s"';|&)<>\`])`
  if (!new RegExp(echappe + fin).test(ligne)) return undefined
  const ecrit =
    new RegExp(`>{1,2}\\s*["']?${echappe}${fin}`).test(ligne) ||
    /(^|[\s;&|(`{"'])(rm|rmdir|del|erase|rd|mv|move|cp|copy|xcopy|robocopy|tee|touch|mkdir|md|ln|truncate|install|set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|ni|ri|cpi|mi|sc|ac)(\.exe)?(?=$|[\s"';|&)])/.test(
      ligne
    ) ||
    /\bsed\b[^;|&]*\s-i/.test(ligne) ||
    /\bperl\b[^;|&]*\s-\w*i/.test(ligne) ||
    /(writefile|appendfile|copyfile|createwritestream|renamesync|unlinksync|rmsync|rmdirsync|mkdirsync|writealltext|writealllines|writeallbytes|\.write_text|\.write_bytes|shutil\.)/.test(
      ligne
    )
  return ecrit ? motif(dossierProtege) : undefined
}
