import { refusGitDestructeur } from './garde-git-destructeur'

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
  /*
   * LE CORPS D'UN HEREDOC EST DU TEXTE, PAS DES COMMANDES — faux positif MESURE le 2026-09-16
   * pendant le kaizen de conv-597 (deux refus d'affilee, turnId 4e502786-4887-4101-85b3-ea2dee304091).
   *
   * Le geste etait `node /tmp/fix1.cjs` avec, dans le heredoc, le texte d'un motif regex contenant
   * « ...|commits?|branche|code|travail|... ». Le controle decoupe la ligne sur `|` : le morceau
   * « code » devenait le premier mot d'une commande, donc « lancement de VS Code », et l'edition
   * etait refusee. Deux tours perdus pour ecrire un fichier.
   *
   * On retire donc le CORPS des documents en ligne avant l'analyse. La ligne qui les LANCE reste
   * analysee entierement, et tout ce qui suit le marqueur de fin aussi : le garde ne perd rien de
   * ce qui s'execute vraiment. Un heredoc non termine n'est pas coupe (aucune fin trouvee).
   */
  const c = String(commande ?? '').replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    '<<HEREDOC'
  )
  if (!c.trim()) return undefined
  // Voies approuvees : le lanceur de bureau cache et l'instance Autowin cachee.
  // `hors-ecran-capture.ps1` N'EST PLUS une exception (2026-09-14, conv-529). Elle avait ete posee
  // quand ce script laissait apparaitre la fenetre sur l'ecran avant de la deplacer. Depuis, il
  // cree le processus SUSPENDU et sort chaque fenetre de la zone d'ecran des son affichage :
  // mesure sur Roblox Studio, ecranMs 32596 -> 18-33 ms, capture 3D a 244-249 couleurs. Il passe
  // donc le controle comme n'importe quelle commande, sans passe-droit.
  if (/hdesk-lancer\.ps1|autowin-headless\.ps1|avec-instance-headless\.mjs/i.test(c)) {
    return undefined
  }

  const motif = (quoi: string): string =>
    `Lancement graphique au premier plan refusé (${quoi}) : il ouvrirait une fenêtre sur l'écran de l'utilisateur. ` +
    `Lance-le dans un bureau caché : powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id <id> -Executable "<chemin.exe>" -Arguments "<args>", ` +
    `puis capture avec scripts/hdesk-observe.ps1 -InstanceId <id> -Output <png>. ` +
    `Si l'app dessine en 3D (vue restée unie, code 3) : powershell -NoProfile -File scripts/hors-ecran-capture.ps1 -Executable "<chemin.exe>" -Arguments "<args>" -Output <png>.`

  const motifIsole = (quoi: string): string =>
    `Lancement de l'application au premier plan refusé (${quoi}) : il ouvrirait une fenêtre Autowin sur l'écran ` +
    `de l'utilisateur, et deux travaux en parallèle se disputeraient la même instance et le même port. ` +
    `Passe par l'instance isolée : node scripts/avec-instance-headless.mjs -- <ta commande>, ` +
    `ou capture une vue avec node scripts/ui-capture.mjs --view <vue> --out <chemin.png> (déjà caché par défaut).`

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

  /*
   * L'APPLICATION ELLE-MEME. Mesure conv-611 (saisie 2026-09-16T13:49:06.312Z, turnId
   * 6856bcec-e943-424c-8e9f-25a19ea2881a) : « mes travaux en parallele se parasitent car ils
   * utilisent pas mon systeme de bureau virtuel ». Cause : ce garde refusait Roblox, Code, Chrome...
   * mais laissait passer `npm run dev`, `npm start`, `electron .` — le lancement le plus probable
   * DANS ce depot. Chaque copie de travail ouvrait donc une fenetre Autowin sur l'ecran reel, et
   * toutes se disputaient le meme port de debogage (9223) : les sondes d'un travail pilotaient
   * l'instance d'un autre. La voie isolee existe deja (instance + port + bureau cache reserves).
   */
  const lignes = c.split(/;|&&|\|\||\r?\n/)
  for (const brut of lignes) {
    const seg = brut.trim().replace(/^&\s*/, '')
    if (/^(npm|pnpm|yarn|bun)(\.cmd)?\s+(run\s+)?(dev|start|preview|dev:\S*)\b/i.test(seg)) {
      return motifIsole(seg.split(/\s+/).slice(0, 3).join(' '))
    }
    if (/^(npx\s+)?electron(\.exe|\.cmd)?(\s|$)/i.test(seg)) return motifIsole('electron')
  }
  return undefined
}

/**
 * Corps du script de hook PreToolUse (Bash) du CLI. Refus = JSON `permissionDecision: deny` sur
 * stdout (https://code.claude.com/docs/en/hooks). Mesure 2026-09-13 : avec exit 2 + stderr, l'appel
 * etait bien bloque mais l'agent recevait un resultat VIDE, sans le motif ni la voie a suivre.
 */
export function scriptHookGardeGraphique(): string {
  return `const refusLancementGraphique = ${refusLancementGraphique.toString()};
const refusGitDestructeur = ${refusGitDestructeur.toString()};
let d = '';
process.stdin.on('data', (b) => (d += b));
process.stdin.on('end', () => {
  let cmd = '';
  try { const j = JSON.parse(d); cmd = (j.tool_input && j.tool_input.command) || ''; } catch {}
  const motif = refusLancementGraphique(cmd) || refusGitDestructeur(cmd);
  if (motif) {
    // Refus structure documente (hooks PreToolUse) : le motif est rendu a l'agent.
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motif } }));
    process.exit(0);
  }
  process.exit(0);
});
`
}
