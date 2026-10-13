import { posix, win32 } from 'node:path'

/**
 * CHEMINS QU'UNE COMMANDE SHELL ÉCRIT EN LES NOMMANT.
 *
 * Le commit automatique du chat (`chat-turn-publication.ts`) ne publie un fichier que s'il est
 * PROUVÉ au fil. Une commande Bash n'en laissait aucune preuve : le fournisseur n'en garde que le
 * texte. Mesuré le 2026-10-13 : `npx prettier --write src/main/githooks-pre-push.test.ts` (conv-932,
 * d7af3730) et `cat >> src/main/relance-auto-moteur.test.ts <<'EOF'` (conv-933, dd0c3d6a) ont
 * retouché un test que le commit a laissé de côté, parce qu'un AUTRE fil l'avait seulement vu changer.
 *
 * Seules les formes d'écriture explicites comptent, et seulement pour un chemin EXACT : redirection
 * (`>`, `>>`, `>|`, `&>`, `N>`), `tee`, `sed -i`, `prettier --write`/`-w`, `eslint --fix` (et son
 * `--output-file`). Un chemin qui dépend d'une expansion (`$X`, `` ` ``, glob, `~`) n'est pas nommé.
 * Le corps d'un here-document et le texte entre guillemets ne sont jamais lus comme des opérateurs.
 * Un oubli laisse le fichier à la règle d'avant ; un chemin nommé à tort n'a d'effet que sur un
 * fichier déjà compté dans le tour du fil.
 */

type Jeton = { type: 'mot'; valeur: string } | { type: 'op'; valeur: string }

/** Du plus long au plus court : le premier qui correspond gagne. */
const OPERATEURS = [
  '&>>',
  '<<-',
  '<<<',
  '&&',
  '||',
  '|&',
  ';;',
  '>>',
  '>|',
  '>&',
  '&>',
  '<<',
  '<&',
  '<>',
  ';',
  '&',
  '|',
  '<',
  '>',
  '(',
  ')'
]
const SEPARATEURS = new Set([';', '&', '|', '&&', '||', '|&', ';;', '\n', '(', ')'])
/** `>&` en fait partie quand il n'est pas suivi d'un descripteur (`>&2`, `2>&1`). */
const REDIRECTIONS_EN_ECRITURE = new Set(['>', '>>', '>|', '&>', '&>>'])

function lireOperateur(commande: string, i: number): string {
  return OPERATEURS.find((op) => commande.startsWith(op, i)) ?? commande[i]
}

/** Position de la ligne qui suit les here-documents en attente, à partir du début de ligne `i`. */
function sauterHeredocs(
  commande: string,
  i: number,
  heredocs: { fin: string; tabs: boolean }[]
): number {
  let position = i
  for (const { fin, tabs } of heredocs.splice(0)) {
    while (position < commande.length) {
      const retour = commande.indexOf('\n', position)
      const stop = retour === -1 ? commande.length : retour
      const ligne = commande.slice(position, stop).replace(/\r$/, '')
      position = stop + 1
      if ((tabs ? ligne.replace(/^\t+/, '') : ligne) === fin) break
    }
  }
  return Math.min(position, commande.length)
}

/** Fin (exclue) d'une substitution `$( … )` qui commence en `i`. */
function finDeSubstitution(commande: string, i: number): number {
  let profondeur = 0
  for (let j = i + 1; j < commande.length; j++) {
    const c = commande[j]
    if (c === "'") {
      const fin = commande.indexOf("'", j + 1)
      if (fin === -1) return commande.length
      j = fin
    } else if (c === '(') profondeur++
    else if (c === ')' && --profondeur === 0) return j + 1
  }
  return commande.length
}

function decouper(commande: string): Jeton[] {
  const jetons: Jeton[] = []
  const heredocs: { fin: string; tabs: boolean }[] = []
  let delimiteurAttendu: { tabs: boolean } | undefined
  let mot = ''
  let dansMot = false
  const finirMot = (): void => {
    if (!dansMot) return
    if (delimiteurAttendu) heredocs.push({ fin: mot, tabs: delimiteurAttendu.tabs })
    else jetons.push({ type: 'mot', valeur: mot })
    delimiteurAttendu = undefined
    mot = ''
    dansMot = false
  }
  let i = 0
  while (i < commande.length) {
    const c = commande[i]
    if (c === '\\') {
      if (commande[i + 1] !== '\n' && i + 1 < commande.length) {
        mot += commande[i + 1]
        dansMot = true
      }
      i += 2
    } else if (c === "'") {
      const fin = commande.indexOf("'", i + 1)
      const stop = fin === -1 ? commande.length : fin
      mot += commande.slice(i + 1, stop)
      dansMot = true
      i = stop + 1
    } else if (c === '"') {
      let j = i + 1
      while (j < commande.length && commande[j] !== '"') {
        const echappe = commande[j + 1]
        if (commande[j] === '\\' && echappe !== undefined && '$`"\\\n'.includes(echappe)) j++
        mot += commande[j]
        j++
      }
      dansMot = true
      i = j + 1
    } else if (c === '$' && commande[i + 1] === '(') {
      const fin = finDeSubstitution(commande, i + 1)
      mot += commande.slice(i, fin)
      dansMot = true
      i = fin
    } else if (c === '`') {
      const fin = commande.indexOf('`', i + 1)
      const stop = fin === -1 ? commande.length : fin + 1
      mot += commande.slice(i, stop)
      dansMot = true
      i = stop
    } else if (c === ' ' || c === '\t' || c === '\r') {
      finirMot()
      i++
    } else if (c === '\n') {
      finirMot()
      jetons.push({ type: 'op', valeur: '\n' })
      i = sauterHeredocs(commande, i + 1, heredocs)
    } else if (c === '#' && !dansMot) {
      const retour = commande.indexOf('\n', i)
      i = retour === -1 ? commande.length : retour
    } else if (';&|<>()'.includes(c)) {
      // `2>` : le numéro collé à la redirection désigne un descripteur, pas un mot.
      if ((c === '>' || c === '<') && dansMot && /^\d+$/.test(mot)) {
        mot = ''
        dansMot = false
      } else finirMot()
      const op = lireOperateur(commande, i)
      i += op.length
      if (op === '<<' || op === '<<-') delimiteurAttendu = { tabs: op === '<<-' }
      else jetons.push({ type: 'op', valeur: op })
    } else {
      mot += c
      dansMot = true
      i++
    }
  }
  finirMot()
  return jetons
}

interface CommandeSimple {
  argv: string[]
  /** Fichiers ouverts en écriture par une redirection. */
  cibles: string[]
}

function commandesSimples(jetons: Jeton[]): CommandeSimple[] {
  const commandes: CommandeSimple[] = []
  let courante: CommandeSimple = { argv: [], cibles: [] }
  for (let k = 0; k < jetons.length; k++) {
    const jeton = jetons[k]
    const suivant = jetons[k + 1]
    if (jeton.type === 'mot') {
      courante.argv.push(jeton.valeur)
    } else if (SEPARATEURS.has(jeton.valeur)) {
      commandes.push(courante)
      courante = { argv: [], cibles: [] }
    } else if (suivant?.type === 'mot') {
      // Toute redirection consomme le mot qui la suit ; seules celles en écriture le retiennent.
      k++
      const duplication = jeton.valeur === '>&' && /^(\d+|-)$/.test(suivant.valeur)
      if (REDIRECTIONS_EN_ECRITURE.has(jeton.valeur) || (jeton.valeur === '>&' && !duplication))
        courante.cibles.push(suivant.valeur)
    }
  }
  commandes.push(courante)
  return commandes.filter((commande) => commande.argv.length || commande.cibles.length)
}

/** `node_modules/.bin/prettier.cmd` → `prettier`. */
function nomDeProgramme(mot: string | undefined): string {
  const base = (mot ?? '').split(/[\\/]/).pop() ?? ''
  return base.toLowerCase().replace(/\.(cmd|exe|bat|ps1|[cm]?js)$/, '')
}

/** Retire ce qui ENVELOPPE le programme réel : affectations, `npx`, `timeout`, `node <script>`… */
function sansEnveloppe(argv: readonly string[]): string[] {
  let a = [...argv]
  for (;;) {
    while (a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0])) a.shift()
    const nom = nomDeProgramme(a[0])
    if (['env', 'command', 'exec', 'nohup', 'sudo'].includes(nom)) {
      a.shift()
      while (a[0]?.startsWith('-')) a.shift()
    } else if (nom === 'timeout') {
      a.shift()
      while (a[0]?.startsWith('-')) {
        const option = a.shift()
        if (['-s', '-k', '--signal', '--kill-after'].includes(option ?? '')) a.shift()
      }
      a.shift()
    } else if (['npx', 'pnpx', 'bunx'].includes(nom)) {
      a.shift()
      while (a[0]?.startsWith('-')) {
        const option = a.shift()
        if (option === '-p' || option === '--package') a.shift()
      }
    } else if (['npm', 'pnpm'].includes(nom) && ['exec', 'x', 'dlx'].includes(a[1] ?? '')) {
      a = a.slice(2)
      if (a[0] === '--') a.shift()
    } else if (nom === 'yarn' && a[1] && !a[1].startsWith('-')) {
      a.shift()
      if (a[0] === 'exec' || a[0] === 'dlx') a.shift()
    } else if (nom === 'node' && a[1] && !a[1].startsWith('-')) {
      a.shift()
    } else return a
  }
}

/** Arguments qui ne sont pas des options ; une option de `avecValeur` consomme le mot suivant. */
function operandes(args: readonly string[], avecValeur: ReadonlySet<string>): string[] {
  const resultat: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '--') return [...resultat, ...args.slice(k + 1)]
    if (a.startsWith('-') && a.length > 1) {
      if (avecValeur.has(a)) k++
    } else resultat.push(a)
  }
  return resultat
}

function valeursDOption(args: readonly string[], noms: readonly string[]): string[] {
  const valeurs: string[] = []
  for (let k = 0; k < args.length; k++) {
    const egal = noms.find((nom) => args[k].startsWith(`${nom}=`))
    if (egal) valeurs.push(args[k].slice(egal.length + 1))
    else if (noms.includes(args[k]) && args[k + 1] !== undefined) valeurs.push(args[++k])
  }
  return valeurs
}

const OPTIONS_PRETTIER_A_VALEUR = new Set([
  '--arrow-parens',
  '--cache-location',
  '--cache-strategy',
  '--config',
  '--config-precedence',
  '--cursor-offset',
  '--embedded-language-formatting',
  '--end-of-line',
  '--html-whitespace-sensitivity',
  '--ignore-path',
  '--log-level',
  '--object-wrap',
  '--parser',
  '--plugin',
  '--print-width',
  '--prose-wrap',
  '--quote-props',
  '--range-end',
  '--range-start',
  '--stdin-filepath',
  '--tab-width',
  '--trailing-comma'
])

const OPTIONS_ESLINT_A_VALEUR = new Set([
  '-c',
  '--config',
  '--cache-location',
  '--cache-strategy',
  '--concurrency',
  '--env',
  '--ext',
  '-f',
  '--fix-type',
  '--flag',
  '--format',
  '--global',
  '--ignore-path',
  '--ignore-pattern',
  '--max-warnings',
  '-o',
  '--output-file',
  '--parser',
  '--parser-options',
  '--plugin',
  '--report-unused-disable-directives-severity',
  '--resolve-plugins-relative-to',
  '--rule',
  '--rulesdir'
])

/** Fichiers modifiés par `sed` : seulement avec `-i` / `--in-place`, après le script. */
function fichiersDeSed(args: readonly string[]): string[] {
  let enPlace = false
  let scriptVu = false
  const fichiers: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (['-e', '--expression', '-f', '--file'].includes(a)) {
      scriptVu = true
      k++
    } else if (a.startsWith('--expression=') || a.startsWith('--file=')) scriptVu = true
    else if (a === '--in-place' || a.startsWith('--in-place=')) enPlace = true
    else if (a === '-l' || a === '--line-length') k++
    else if (/^-[a-zA-Z]/.test(a)) {
      // Grappe d'options courtes : `-i`, `-i.bak`, `-Ei`, `-ne` (dont le script suit).
      const lettres = a.slice(1)
      const suffixe = lettres.indexOf('i')
      if (suffixe !== -1) enPlace = true
      const script = lettres.search(/[ef]/)
      if (script === lettres.length - 1 && (suffixe === -1 || script < suffixe)) {
        scriptVu = true
        k++
      }
    } else if (!scriptVu) scriptVu = true
    else fichiers.push(a)
  }
  return enPlace ? fichiers : []
}

/** Fichiers que le programme ÉCRIT d'après ses propres arguments (hors redirections). */
function fichiersEcritsParLeProgramme(argv: readonly string[]): string[] {
  const [programme, ...args] = argv
  switch (nomDeProgramme(programme)) {
    case 'tee':
      return args.filter((a) => !a.startsWith('-'))
    case 'sed':
      return fichiersDeSed(args)
    case 'prettier':
      return args.includes('--write') || args.includes('-w')
        ? operandes(args, OPTIONS_PRETTIER_A_VALEUR)
        : []
    case 'eslint':
      return [
        ...(args.includes('--fix') ? operandes(args, OPTIONS_ESLINT_A_VALEUR) : []),
        ...valeursDOption(args, ['-o', '--output-file'])
      ]
    default:
      return []
  }
}

/** Chemin absolu d'un mot, ou `undefined` s'il dépend d'une expansion ou ne désigne aucun fichier. */
function cheminAbsolu(mot: string, dossier: string, chemins: typeof win32): string | undefined {
  if (!mot || mot === '-' || /[$`*?[\]{}]/.test(mot) || mot.startsWith('~')) return undefined
  if (/^\/dev\//.test(mot) || /^(nul|con)$/i.test(mot)) return undefined
  // Git Bash sous Windows : `/d/AutoWinOS/x` désigne `D:/AutoWinOS/x`.
  const lecteur = chemins === win32 ? /^\/([a-zA-Z])(\/.*)?$/.exec(mot) : null
  const brut = lecteur ? `${lecteur[1].toUpperCase()}:${lecteur[2] ?? '/'}` : mot
  return chemins.resolve(dossier, brut)
}

/**
 * Chemins ABSOLUS que `commande`, lancée dans `dossier`, écrit en les nommant. Un `cd <dossier>` en
 * tête d'une commande simple déplace la base des chemins relatifs qui suivent.
 */
export function cheminsEcritsParCommande(
  commande: string,
  dossier: string,
  plateforme: NodeJS.Platform = process.platform
): string[] {
  const chemins = plateforme === 'win32' ? win32 : posix
  const ecrits = new Map<string, string>()
  let courant = dossier
  const ajouter = (mot: string): void => {
    const absolu = cheminAbsolu(mot, courant, chemins)
    if (!absolu) return
    const cle = plateforme === 'win32' ? absolu.toLowerCase() : absolu
    if (!ecrits.has(cle)) ecrits.set(cle, absolu)
  }
  for (const { argv, cibles } of commandesSimples(decouper(commande))) {
    for (const cible of cibles) ajouter(cible)
    const programme = sansEnveloppe(argv)
    const nom = nomDeProgramme(programme[0])
    if ((nom === 'cd' || nom === 'pushd') && programme.length === 2) {
      courant = cheminAbsolu(programme[1], courant, chemins) ?? courant
      continue
    }
    for (const fichier of fichiersEcritsParLeProgramme(programme)) ajouter(fichier)
  }
  return [...ecrits.values()]
}
