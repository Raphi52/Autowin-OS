// fix-ok: cause mesurée — le hook PreToolUse (matcher Bash|PowerShell seul) ne vérifiait que git destructeur ; prod-niveau/autorite/passphrase.json passaient par Bash et Edit/Write (test rouge 3/4 : « Unexpected end of JSON input », « expected [Bash, PowerShell] to include Edit »).
// Le MODULE importe ; les fonctions de garde, elles, restent autoportées (sérialisées dans le hook).
import { refusEcriturePythonCrlf } from './garde-python-crlf'
import { decouperHeredocs, sansHeredocsDeDonnees } from './heredocs'
import { refusArretHote, refusBoucle } from './garde-hote-et-boucle'

/**
 * GARDE : UN `git reset --hard` N'EFFACE PAS LE TRAVAIL EN COURS DE L'UTILISATEUR.
 *
 * Mesure conv-587 (2026-09-16, saisie ts=1789550244094) : pour nettoyer un `git revert -n` d'essai,
 * l'agent a lance `git reset --hard`. La commande porte sur TOUT l'arbre de travail : elle a detruit
 * trois fichiers modifies non commites et sans rapport avec la tache (skills/kaizen/SKILL.md,
 * src/main/providers/claude.ts, src/main/providers/claude-bin-resolution.test.ts). Perte
 * IRREVERSIBLE : `git fsck --lost-found` n'a rendu aucun blob correspondant, aucun revert ne repare.
 *
 * La constitution l'interdit deja en prose — et la prose n'a pas tenu. Ce garde refuse le geste
 * AVANT qu'il parte, et NOMME la voie recuperable.
 *
 * PORTEE VOLONTAIREMENT ETROITE : seules les formes qui effacent l'arbre ENTIER sont refusees.
 * `git checkout HEAD -- <chemin>`, `git restore <chemin>`, `git revert --abort` restent libres :
 * ce sont precisement les sorties de secours proposees.
 *
 * CONTRAINTE : fonction AUTOPORTEE (aucun import) — elle est serialisee telle quelle dans le script
 * de hook du CLI (`scriptHookGardes`).
 */
export function refusGitDestructeur(commande: string): string | undefined {
  const c = String(commande ?? '')
  if (!c.trim()) return undefined
  const motif = (quoi: string, voie: string): string =>
    `Effacement du travail en cours refusé (${quoi}) : cette commande porte sur TOUT l'arbre de travail ` +
    `et supprime définitivement les fichiers modifiés non commités, y compris ceux qui n'ont rien à voir ` +
    `avec ta tâche (mesuré conv-587 : 3 fichiers perdus, irrécupérables). ` +
    `Voie récupérable : ${voie}. ` +
    `Si l'effacement large est vraiment voulu, demande-le à l'utilisateur en nommant ce qui disparaît.`

  /** Un APPEL de git (mots de la commande, `mots[0]` = git) : efface-t-il le travail en cours ? */
  const jugerGit = (appel: string[]): string | undefined => {
    // La SOUS-COMMANDE, pas un mot quelconque de la ligne : `git log -S "reset --hard"` cherche du
    // texte, il n'efface rien. Les options globales (-C <chemin>, -c k=v, --no-pager) sont sautees.
    const mots = appel.slice(1)
    let i = 0
    while (i < mots.length && /^-/.test(mots[i])) {
      i += /^(-C|-c|--git-dir|--work-tree|--exec-path)$/i.test(mots[i]) ? 2 : 1
    }
    const sous = (mots[i] ?? '').toLowerCase()
    const reste = mots.slice(i + 1)
    const a = (re: RegExp): boolean => reste.some((m) => re.test(m))
    // 1. reset --hard : git refuse de toute facon `reset --hard <chemin>`, la portee est l'arbre entier.
    if (sous === 'reset' && a(/^--hard$/i)) {
      return motif(
        'git reset --hard',
        'git revert --abort, git checkout HEAD -- <chemin>, ou copie la version commitée à part : git show HEAD:<chemin> > /tmp/<nom>'
      )
    }
    // 2. checkout/restore de l'arbre entier : le dernier argument vise tout (`.`, `:/`, `*`).
    if (
      (sous === 'checkout' || sous === 'restore') &&
      /^(\.|:\/|\*)$/.test(reste[reste.length - 1] ?? '')
    ) {
      return motif(
        "rétablissement de tout l'arbre",
        'vise le seul fichier concerné : git checkout HEAD -- <chemin>'
      )
    }
    // 4. stash (hors lectures list/show) : la pile refs/stash est PARTAGEE par tous les worktrees du
    // depot principal. Un stash d'agent y melange son etat a celui de l'utilisateur ; un pop/drop/clear
    // peut emporter la remise de cote de quelqu'un d'autre. On lit la version commitee a part.
    if (sous === 'stash' && !/^(list|show)$/i.test(reste[0] ?? '')) {
      return (
        `git stash refusé pour un agent : la pile de remises de côté est partagée avec le dépôt principal ` +
        `de l'utilisateur, un stash/pop/drop peut y mélanger ou perdre son travail. ` +
        `Voie sûre : lis la version commitée à part, sans toucher l'arbre — git show HEAD:<chemin> > /tmp/<nom>.`
      )
    }
    // 3. clean -f : les fichiers non suivis n'ont AUCUN objet git, rien ne les recupere.
    if (sous === 'clean' && a(/^-[a-z]*f/i) && !a(/^(-n|--dry-run)$/i)) {
      return motif('git clean', "git clean -n d'abord, puis supprime nommément ce que tu as vérifié")
    }
    return undefined
  }

  /*
   * SEUL UN APPEL EST REFUSE, jamais une simple MENTION (conv-770, 2026-09-28). L'ancienne lecture
   * coupait la ligne sur `;` `|` `&&` MEME ENTRE GUILLEMETS : `grep -o 'x\|git stash [a-z]' f` y
   * devenait un segment `git stash [a-z]'` et etait refuse, comme `git commit -m "a; git reset
   * --hard"`. Elle laissait pourtant passer de vrais appels : `bash -c "git reset --hard"`,
   * `cmd /c git clean -fd`, `"C:\…\git.exe" reset --hard`, `sudo git stash`.
   * On lit donc la ligne comme un shell : guillemets respectes, sous-commandes `$(…)` et `` `…` ``,
   * code passe a `bash -c` / `cmd /c` / `powershell -Command` / `eval`, prefixes (`sudo`, `env`,
   * `xargs`, `VAR=x`…). DANS LE DOUTE — guillemet non ferme, imbrication trop profonde —
   * l'ancienne lecture s'applique : elle coupe partout, donc elle refuse PLUS, jamais moins.
   * Meme construction que `refusSqlAgent` (src/main/prod-run-guard.ts). Limite : le texte d'un
   * heredoc est lu ligne a ligne comme avant (refus en trop possible, jamais en moins).
   */
  const lectureLarge = (texte: string): string | undefined => {
    for (const brut of texte.split(/;|&&|\|\||\||\r?\n/)) {
      const seg = brut.trim().replace(/^&\s*/, '')
      if (!/^git\b/i.test(seg)) continue
      const refus = jugerGit(seg.split(/\s+/))
      if (refus) return refus
    }
    return undefined
  }
  const nomDe = (mot: string): string =>
    (mot.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
  const prefixes =
    /^(sudo|exec|env|time|nohup|command|builtin|call|start|start-process|xargs|timeout|nice)$/
  const optionAValeur = /^(-u|-g|-c|-s|-k|-i|--user|--group|--chdir|--signal|--kill-after)$/
  const coquilles = /^(bash|sh|zsh|dash|cmd|powershell|pwsh|eval|iex|invoke-expression)$/
  const analyser = (mots: string[], profondeur: number): string | undefined => {
    let k = 0
    while (k < mots.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[k])) k++
    for (let tour = 0; tour < 8 && k < mots.length; tour++) {
      const nom = nomDe(mots[k])
      if (nom === 'git') return jugerGit(mots.slice(k))
      if (prefixes.test(nom)) {
        k++
        while (k < mots.length) {
          const m = mots[k].toLowerCase()
          // `sudo -i git …` : `-i` est un drapeau ici, pas une option a valeur. Une option ne mange
          // donc jamais le mot suivant quand c'est git, un shell ou un autre prefixe.
          const suivant = nomDe(mots[k + 1] ?? '')
          const mange = suivant !== 'git' && !coquilles.test(suivant) && !prefixes.test(suivant)
          if (optionAValeur.test(m) && mange) k += 2
          else if (
            m.startsWith('-') ||
            /^\d+[smhd]?$/.test(m) ||
            /^[A-Za-z_][A-Za-z0-9_]*=/.test(m)
          )
            k++
          else break
        }
        continue
      }
      if (coquilles.test(nom)) {
        const reste = mots.slice(k + 1)
        const i = reste.findIndex((m) => /^(-c|-command|\/c|\/k)$/i.test(m))
        const code = (i >= 0 ? reste.slice(i + 1) : reste.filter((m) => !m.startsWith('-'))).join(
          ' '
        )
        return code ? chercher(code, profondeur + 1) : undefined
      }
      return undefined
    }
    return undefined
  }
  function chercher(source: string, profondeur: number): string | undefined {
    if (profondeur > 4) return lectureLarge(source)
    const commandes: string[][] = [[]]
    const imbriques: string[] = []
    let mot = ''
    let ouvert = false
    let q: string | null = null
    const finMot = (): void => {
      if (ouvert) commandes[commandes.length - 1].push(mot)
      mot = ''
      ouvert = false
    }
    for (let i = 0; i < source.length; i++) {
      const ch = source[i]
      if (q === "'") {
        if (ch === "'") q = null
        else mot += ch
        continue
      }
      if (ch === '$' && source[i + 1] === '(') {
        // Sous-commande `$(…)` : executee, meme entre guillemets doubles.
        let prof = 0
        let fin = -1
        for (let j = i + 1; j < source.length; j++) {
          if (source[j] === '(') prof++
          else if (source[j] === ')' && --prof === 0) {
            fin = j
            break
          }
        }
        if (fin < 0) return lectureLarge(source)
        imbriques.push(source.slice(i + 2, fin))
        i = fin
        ouvert = true
        continue
      }
      if (ch === '`') {
        if (q === '"' && source[i + 1] === '"') {
          mot += '"'
          i++
          continue
        }
        const fin = source.indexOf('`', i + 1)
        if (fin > i) {
          imbriques.push(source.slice(i + 1, fin))
          i = fin
          ouvert = true
          continue
        }
      }
      if (q === '"') {
        if (ch === '"') q = null
        else if (ch === '\\' && source[i + 1] === '"') {
          mot += '"'
          i++
        } else mot += ch
        continue
      }
      if (ch === "'" || ch === '"') {
        q = ch
        ouvert = true
      } else if (ch === ' ' || ch === '\t') finMot()
      else if ('\r\n;|&(){}'.includes(ch)) {
        finMot()
        commandes.push([])
      } else {
        mot += ch
        ouvert = true
      }
    }
    if (q) return lectureLarge(source)
    finMot()
    for (const code of imbriques) {
      const refus = chercher(code, profondeur + 1)
      if (refus) return refus
    }
    for (const mots of commandes) {
      const refus = analyser(mots, profondeur)
      if (refus) return refus
    }
    return undefined
  }
  return chercher(c, 0)
}

/**
 * INVENTAIRE des gardes portées par le script de hook — ce que la vue Settings › Hooks affiche
 * (conv-58). Un test vérifie que cette liste et la ligne `const motif = …` du script nomment
 * EXACTEMENT les mêmes fonctions : ajouter une garde sans l'inscrire ici fait échouer le test.
 * `tousOutils` : la garde voit aussi les outils hors terminal/édition (2e entrée du réglage).
 */
export const GARDES_DU_HOOK: readonly { fn: string; label: string; description: string; tousOutils?: true }[] = [
  {
    fn: 'refusBoucle',
    label: 'Détecteur de boucle',
    description: "Refuse le 3e appel d'outil identique d'affilée (même outil, mêmes arguments) dans une même session.",
    tousOutils: true
  },
  {
    fn: 'refusArretHote',
    label: "Arrêt de l'app hôte",
    description: "Refuse l'arrêt d'Electron/node PAR NOM (taskkill /IM, Stop-Process -Name, pkill…) : il tuerait Autowin. Un arrêt par PID reste libre."
  },
  {
    fn: 'refusGitDestructeur',
    label: 'Effacement de travail git',
    description: "Refuse git reset --hard, checkout/restore de tout l'arbre, clean -f et stash : ils détruisent du travail non commité."
  },
  {
    fn: 'refusEcriturePythonCrlf',
    label: 'Écriture Python en CRLF',
    description: 'Refuse une écriture Python en mode texte qui passerait un fichier du dépôt en fins de ligne CRLF.'
  },
  {
    fn: 'refusReglageProd',
    label: 'Réglages de la protection de prod',
    description: "Refuse toute écriture des fichiers de la protection de prod, par le terminal comme par les outils d'édition."
  },
  {
    fn: 'refusSqlAgent',
    label: 'Client SQL vers la prod',
    description: 'Refuse un client SQL lancé par un agent, sauf vers une base déclarée non-prod.'
  }
]

/**
 * Corps du script de hook PreToolUse (Bash) du CLI. Refus = JSON `permissionDecision: deny` sur
 * stdout (https://code.claude.com/docs/en/hooks). Mesure 2026-09-13 : avec exit 2 + stderr, l'appel
 * etait bien bloque mais l'agent recevait un resultat VIDE, sans le motif ni la voie a suivre.
 *
 * Porte aussi, depuis le 2026-10-01, l'écriture Python en mode texte qui passe un fichier en CRLF
 * (`refusEcriturePythonCrlf`, garde-python-crlf.ts : 47 fichiers du dépôt réécrits ainsi).
 *
 * NE PORTE PLUS QUE L'EFFACEMENT DE TRAVAIL (conv-587). Le refus des lancements graphiques au
 * premier plan a ete RETIRE le 2026-09-17 sur demande explicite de l'utilisateur (conv-631) : il
 * bloquait l'ouverture d'un simple fichier sur son propre ecran, qu'il demandait nommement, et
 * aucun chemin de contournement ne restait. Le bureau cache (`scripts/hdesk-lancer.ps1`) reste la
 * VOIE PAR DEFAUT, portee par la consigne en prose du prompt de pilotage — plus par un blocage.
 */
export function scriptHookGardes(
  // Garde des réglages de la protection de prod (`refusReglageProd`, src/main/prod-run-guard.ts),
  // passée par l'appelant : shared/ n'importe pas main/. Fonction autoportée, sérialisée telle quelle.
  refusReglageProd: (texte: string) => string | undefined,
  // Garde SQL des agents (`refusSqlAgent`, même module) et bases déclarées non-prod : sans elles,
  // aucun client SQL n'est bloqué (compatibilité des appelants qui ne portent pas la prod).
  refusSqlAgent?: (texte: string, basesNonProd: readonly string[]) => string | undefined,
  basesNonProd: readonly string[] = []
): string {
  // Le découpage des heredocs est PASSÉ aux fonctions qui en ont besoin, jamais appelé par nom :
  // vitest et les bundlers réécrivent un appel importé (voir src/shared/heredocs.ts).
  return `const decouperHeredocs = ${decouperHeredocs.toString()};
const sansHeredocsDeDonnees = ${sansHeredocsDeDonnees.toString()};
const refusGitDestructeur = ${refusGitDestructeur.toString()};
const refusEcriturePythonCrlf = ${refusEcriturePythonCrlf.toString()};
const refusArretHote = ${refusArretHote.toString()};
const refusBoucle = ${refusBoucle.toString()};
const refusReglageProd = ${refusReglageProd.toString()};
const refusSqlAgent = ${refusSqlAgent ? refusSqlAgent.toString() : '() => undefined'};
const basesNonProd = ${JSON.stringify(basesNonProd)};
let d = '';
process.stdin.on('data', (b) => (d += b));
process.stdin.on('end', () => {
  let cmd = '';
  let chemin = '';
  let j = {};
  try {
    j = JSON.parse(d);
    const t = j.tool_input || {};
    cmd = t.command || '';
    chemin = t.file_path || t.notebook_path || '';
  } catch {}
  // Le corps d'un heredoc de simple texte n'est pas du shell (rejeu du 2026-10-01, heredocs.ts).
  const shell = sansHeredocsDeDonnees(cmd, decouperHeredocs);
  // Détecteur de boucle (conv-58) : historique PAR SESSION, à côté du script (dossier temporaire du
  // run, nettoyé avec lui). Sans session_id, aucun état : le garde se tait.
  let motifBoucle;
  try {
    const sid = String(j.session_id || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (sid) {
      // Script .mjs : pas de require ; getBuiltinModule existe depuis Node 20.16.
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const p = path.join(path.dirname(process.argv[1]), 'boucle-' + sid + '.json');
      let h = [];
      try { h = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      const cle = String(j.tool_name || '') + ' ' + JSON.stringify(j.tool_input || {});
      motifBoucle = refusBoucle(h, cle);
      fs.writeFileSync(p, JSON.stringify(h.concat([cle]).slice(-20)));
    }
  } catch {}
  const motif = motifBoucle || refusArretHote(shell) || refusGitDestructeur(shell) || refusEcriturePythonCrlf(cmd, decouperHeredocs) || refusReglageProd(shell) || refusReglageProd(chemin) || refusSqlAgent(shell, basesNonProd);
  if (motif) {
    // Refus structure documente (hooks PreToolUse) : le motif est rendu a l'agent.
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motif } }));
    process.exit(0);
  }
  process.exit(0);
});
`
}
