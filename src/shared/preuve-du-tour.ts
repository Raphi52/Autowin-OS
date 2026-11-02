/**
 * UN ROUGE RACHETÉ PAR UN VERT QUI LE COUVRE (conv-1423, 2026-11-01).
 *
 * Mesuré du 29/10 au 01/11 sur les demandes qui ont écrit du code : 66 % finissent « Bloqué » sur un
 * test rouge, et une partie a pourtant rejoué ce test, vert, dans une ligne plus large. Le Board
 * gardait une clé par ligne de commande EXACTE (`carte-du-fil.ts`) : `vitest run a.ts` rouge puis
 * `vitest run a.ts b.ts` vert restaient deux vérifications sans rapport.
 *
 * La carte du fil (interface) et la relance de fin de tour (processus principal) lisent CETTE règle :
 * le Board et la relance ne peuvent pas se contredire. Elle reçoit des données neutres, parce que le
 * résumé d'une vérification (`action-outcome-summary.ts`) vit côté interface.
 *
 * « Couvre » est prudent, et penche toujours vers le rouge — un faux vert coûte bien plus cher qu'un
 * faux « Bloqué ». Un vert ne couvre un rouge que si la commande est lue ENTIÈREMENT : même outil,
 * chaque cible du rouge est rejouée, pas de filtre plus étroit. Toute option inconnue, toute chaîne
 * de commandes, tout script au périmètre inconnu, toute commande coupée : INCONNU = NE COUVRE PAS.
 *
 * Un test lancé après un `cd` entre dans cette règle : les appelants passent sa forme jouée
 * (`commandeJouee`), qui est une chaîne. Ni couvrant, ni couvert, même entre deux lignes au même
 * `cd` : un `cd` relatif ne dit pas où il arrive. Un `cd` vers le dossier du tour ne compte pas.
 * Même chose pour ce qui rend le verbe illisible dans la ligne : `eval`, `alias`, `$c ../x`. Cette
 * lecture a des limites, listées sur `dossierAvant` (`tests-du-terminal.ts`) : ce qu'elle ne voit pas
 * passe pour un test du dossier courant.
 *
 * `npm test` vert couvre les rouges de TEST, jamais le typage ni le lint. C'est la règle de conv-76,
 * verrouillée dans `carte-du-fil.test.ts` (`typecheck exit 1` puis `npm test exit 0` reste refusé) :
 * dans ce dépôt `npm test` joue les trois, mais rien ne le dit pour un autre projet ouvert dans le chat.
 *
 * Pas de lecture du `package.json` : l'interface n'a pas accès au disque, et le verdict d'une étape
 * passée ne doit pas changer parce qu'un script a changé depuis.
 *
 * fix-ok: trois faux verts mesurés par des essais exécutés sur `vertCouvreRouge` (conv-1423) :
 * `--bail` avalait la cible suivante comme sa valeur, ce qui laissait « tout l'outil » ; le nom des
 * options passait en minuscules, donc `pytest -V` (la version, aucun test) se lisait `-v` ; la
 * longueur de coupure se mesurait après le `trim` de `lireTestsDuTerminal`, qui retire l'espace
 * final d'un morceau coupé juste après un espace.
 *
 * fix-ok: `npm run test:unit -- src/a.test.ts`, le libellé d'un `verify` ciblé (`commands.ts`), se
 * lisait inconnu : la relance proposait donc une preuve que cette règle refusait, et le faux « Bloqué »
 * restait (reproduit par le contrôle final sur `carteDuFil` et `preuveManquanteDuTour`). 291 `verify`
 * sur 551 ont cette forme depuis le 20/10 (journaux de tour, 01/11). `scriptSurFichiers` la lit, sans
 * ouvrir `npm run test:unit` nu, dont rien ne dit le périmètre.
 */
import { COMMANDE_DE_TEST_MAX } from './chat-turn'

/** Plafond de la commande gardée avant conv-1423 : une commande de CETTE longueur a pu être coupée. */
const ANCIEN_PLAFOND_DE_COMMANDE = 300

/**
 * Coupée, ou peut-être : elle montrerait moins de cibles qu'elle n'en a. Le morceau peut finir sur
 * un espace, que `lireTestsDuTerminal` retire : un de moins que le plafond est donc suspect aussi.
 * Il n'y en a jamais deux hors guillemets : le lecteur rejoint les mots par une seule espace, et une
 * coupure entre guillemets laisse le guillemet ouvert, donc illisible (`motsDeLaCommande`). `>=` pour
 * un plafond qui baisserait un jour.
 */
const peutEtreCoupee = (longueur: number): boolean =>
  longueur === ANCIEN_PLAFOND_DE_COMMANDE ||
  longueur === ANCIEN_PLAFOND_DE_COMMANDE - 1 ||
  longueur >= COMMANDE_DE_TEST_MAX - 1

/**
 * Ce que le vert doit rejouer. `projet` : le `test` du projet, au contenu non lu ici.
 * `script-sur-fichiers` : un script de test suivi de fichiers nommés, l'outil lancé reste inconnu.
 */
type Famille = 'vitest' | 'jest' | 'pytest' | 'typage' | 'lint' | 'projet' | 'script-sur-fichiers'

interface CommandeLue {
  famille: Famille
  /** Chemins visés, normalisés. Vide = tout l'outil. */
  cibles: string[]
  /** Les mêmes, tels qu'écrits : `verify` distingue `a.test.ts` de `A.Test.ts`, la comparaison non. */
  ciblesEcrites?: string[]
  /** Filtres de nom (`-t`). Vide = aucun filtre. */
  filtres: string[]
}

/** Les familles qu'un `npm test` vert rachète : des TESTS, pas le typage ni le lint (conv-76). */
const FAMILLES_DE_TESTS: ReadonlySet<Famille> = new Set([
  'vitest',
  'jest',
  'projet',
  'script-sur-fichiers'
])

/** Options qui ne changent rien à ce qui est testé. Toute autre option rend la commande inconnue. */
interface VocabulaireDOptions {
  sansValeur: ReadonlySet<string>
  aValeur: ReadonlySet<string>
  /** Valeur facultative, toujours un nombre : le mot suivant reste une cible s'il n'en est pas un. */
  aNombreFacultatif: ReadonlySet<string>
  filtres: ReadonlySet<string>
}

const OPTIONS_DE_TEST: VocabulaireDOptions = {
  sansValeur: new Set([
    '--run',
    '--silent',
    '--color',
    '--no-color',
    '--no-coverage',
    '--verbose',
    '--ci',
    '--runinband',
    '-i'
  ]),
  aValeur: new Set(['--reporter', '--reporters', '--outputfile', '--testtimeout']),
  aNombreFacultatif: new Set(['--bail']),
  filtres: new Set(['-t', '--testnamepattern'])
}

const OPTIONS_DE_LINT: VocabulaireDOptions = {
  sansValeur: new Set([
    '--color',
    '--no-color',
    '--cache',
    '--fix',
    '--quiet',
    '--no-warn-ignored'
  ]),
  aValeur: new Set(['-f', '--format', '-o', '--output-file', '--cache-location']),
  aNombreFacultatif: new Set(),
  filtres: new Set()
}

const OPTIONS_DE_PYTEST: VocabulaireDOptions = {
  sansValeur: new Set(['-q', '-v', '-x', '-s', '--quiet', '--verbose']),
  aValeur: new Set(['--tb']),
  aNombreFacultatif: new Set(),
  filtres: new Set(['-k'])
}

/**
 * Les mots de la commande, guillemets retirés. `null` dès qu'un opérateur du shell apparaît hors
 * guillemets : une chaîne, un tube ou une substitution ne se lit pas comme UNE commande.
 */
function motsDeLaCommande(commande: string): string[] | null {
  const mots: string[] = []
  let courant = ''
  let dansUnMot = false
  let guillemet: string | null = null
  for (const c of commande) {
    if (guillemet) {
      if (c === guillemet) guillemet = null
      else courant += c
      continue
    }
    if (c === '"' || c === "'") {
      guillemet = c
      dansUnMot = true
      continue
    }
    if (/[|&;<>`$()]/u.test(c)) return null
    if (/\s/u.test(c)) {
      if (dansUnMot) mots.push(courant)
      courant = ''
      dansUnMot = false
      continue
    }
    courant += c
    dansUnMot = true
  }
  if (guillemet) return null
  if (dansUnMot) mots.push(courant)
  return mots
}

const verbeNu = (mot: string | undefined): string =>
  (mot ?? '')
    .toLowerCase()
    .replace(/^.*[\\/]/u, '')
    .replace(/\.(?:cmd|exe)$/u, '')

const cheminNu = (mot: string): string =>
  mot
    .replaceAll('\\', '/')
    .toLowerCase()
    .replace(/^(?:\.\/)+/u, '')
    .replace(/\/+$/u, '')

/** Lit les arguments d'un outil. `null` : une option hors vocabulaire, on ne sait plus ce qui tourne. */
function argumentsLus(
  args: readonly string[],
  options: VocabulaireDOptions
): { cibles: string[]; ciblesEcrites: string[]; filtres: string[] } | null {
  const cibles: string[] = []
  const ciblesEcrites: string[] = []
  const filtres: string[] = []
  for (let rang = 0; rang < args.length; rang += 1) {
    const mot = args[rang]
    if (!mot.startsWith('-')) {
      cibles.push(cheminNu(mot))
      ciblesEcrites.push(mot)
      continue
    }
    const egal = mot.indexOf('=')
    const brut = egal < 0 ? mot : mot.slice(0, egal)
    // Seules les options longues sont libres de casse : `pytest -V` n'est pas `pytest -v`.
    const nom = brut.startsWith('--') ? brut.toLowerCase() : brut
    const collee = egal < 0 ? undefined : mot.slice(egal + 1)
    if (options.filtres.has(nom)) {
      const valeur = collee ?? args[(rang += 1)]
      if (valeur === undefined) return null
      filtres.push(valeur)
    } else if (options.aValeur.has(nom)) {
      if (collee === undefined && args[(rang += 1)] === undefined) return null
    } else if (options.aNombreFacultatif.has(nom)) {
      if (collee === undefined && /^\d+$/u.test(args[rang + 1] ?? '')) rang += 1
    } else if (!options.sansValeur.has(nom)) return null
  }
  return { cibles, ciblesEcrites, filtres }
}

function outilDeTest(
  famille: 'vitest' | 'jest' | 'pytest',
  args: readonly string[]
): CommandeLue | null {
  // `vitest related`, `vitest watch`… : un autre mode, au périmètre inconnu. Seul `run` est lu.
  const reste = famille === 'vitest' && args[0] === 'run' ? args.slice(1) : args
  if (
    famille === 'vitest' &&
    reste[0] !== undefined &&
    /^(?:related|watch|dev|list|bench)$/u.test(reste[0])
  )
    return null
  const lus = argumentsLus(reste, famille === 'pytest' ? OPTIONS_DE_PYTEST : OPTIONS_DE_TEST)
  return lus && { famille, ...lus }
}

function eslintLu(args: readonly string[]): CommandeLue | null {
  const lus = argumentsLus(args, OPTIONS_DE_LINT)
  if (!lus) return null
  // `eslint .` lit tout ce que lit `npm run lint` : il n'a pas de cible qui le restreigne.
  return { famille: 'lint', cibles: lus.cibles.filter((c) => c !== '.' && c !== ''), filtres: [] }
}

/**
 * `tsc` n'a qu'une forme lisible : un projet (`-p`). Sans `-p`, il vise le `tsconfig.json` de la
 * racine, qui dans un dépôt à références peut ne rien typer du tout : il ne vaut donc pas le typage
 * complet (`npm run typecheck`), et reste une cible comme une autre.
 */
function tscLu(args: readonly string[]): CommandeLue | null {
  let projet = 'tsconfig.json'
  for (let rang = 0; rang < args.length; rang += 1) {
    const mot = args[rang].toLowerCase()
    if (mot === '--noemit') continue
    // `--composite false` : la forme des scripts `typecheck:node` et `typecheck:web` de ce dépôt.
    if (mot === '--pretty' || mot === '--composite') {
      if (args[rang + 1] === 'false' || args[rang + 1] === 'true') rang += 1
      continue
    }
    if (mot === '-p' || mot === '--project') {
      const valeur = args[(rang += 1)]
      if (valeur === undefined) return null
      projet = valeur
      continue
    }
    return null
  }
  return { famille: 'typage', cibles: [cheminNu(projet)], filtres: [] }
}

/** Les scripts que `verify` sait jouer : `ALLOWED_COMMANDS` (`verify-command.ts`), que le test relit. */
const SCRIPTS_DE_TEST: ReadonlySet<string> = new Set(['test', 'test:unit', 'test:run', 'tests'])

/** La forme qu'accepte `cibleDeVerification`. Un motif (`src/*.test.ts`) ne couvre que lui-même. */
const FICHIER_DE_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/u

/**
 * `npm run test:unit -- src/a.test.ts`, seule forme lue de ce qui suit `--`. vitest et jest jouent le
 * fichier nommé, ou sortent en erreur s'il n'existe pas. Le contenu du script reste non lu, comme pour
 * `npm test` : un script qui ignorerait ses arguments passerait ici aussi.
 */
function scriptSurFichiers(script: string, args: readonly string[]): CommandeLue | null {
  if (!SCRIPTS_DE_TEST.has(script)) return null
  const lus = argumentsLus(args, OPTIONS_DE_TEST)
  if (!lus || lus.cibles.length === 0) return null
  if (!lus.cibles.every((cible) => FICHIER_DE_TEST.test(cible))) return null
  return { famille: 'script-sur-fichiers', ...lus }
}

function scriptLu(script: string | undefined, reste: readonly string[]): CommandeLue | null {
  if (!script) return null
  const separateur = reste.indexOf('--')
  const duLanceur = separateur < 0 ? reste : reste.slice(0, separateur)
  if (duLanceur.some((mot) => mot !== '--silent' && mot !== '-s')) return null
  if (separateur >= 0) return scriptSurFichiers(script, reste.slice(separateur + 1))
  if (script === 'test') return { famille: 'projet', cibles: [], filtres: [] }
  const [tete, sousScript] = script.split(/:(.*)/su)
  const famille = tete === 'typecheck' ? 'typage' : tete === 'lint' ? 'lint' : null
  if (!famille) return null
  return { famille, cibles: sousScript ? [`script:${sousScript}`] : [], filtres: [] }
}

function outilLu(verbe: string, args: readonly string[]): CommandeLue | null {
  if (verbe === 'vitest' || verbe === 'jest' || verbe === 'pytest') return outilDeTest(verbe, args)
  if (verbe === 'eslint') return eslintLu(args)
  if (verbe === 'tsc') return tscLu(args)
  return null
}

/** Ce que joue `commande`, ou `null` si on ne peut pas le dire avec certitude. */
function commandeLue(commande: string): CommandeLue | null {
  const nette = commande.trim()
  if (peutEtreCoupee(nette.length)) return null
  const mots = motsDeLaCommande(nette)
  if (!mots || mots.length === 0) return null
  const verbe = verbeNu(mots[0])
  const args = mots.slice(1)
  if (verbe === 'npx') {
    const reste = args[0] === '--no-install' || args[0] === '-y' ? args.slice(1) : args
    return outilLu(verbeNu(reste[0]), reste.slice(1))
  }
  if (verbe === 'npm' || verbe === 'pnpm' || verbe === 'yarn') {
    if (verbe === 'pnpm' && args[0] === 'exec') return outilLu(verbeNu(args[1]), args.slice(2))
    if (args[0] === 'test' || args[0] === 't') return scriptLu('test', args.slice(1))
    if (args[0] === 'run' || args[0] === 'run-script') return scriptLu(args[1], args.slice(2))
    return verbe === 'npm' ? null : scriptLu(args[0], args.slice(1))
  }
  if (verbe === 'python' || verbe === 'python3' || verbe === 'py')
    return args[0] === '-m' && args[1] === 'pytest' ? outilLu('pytest', args.slice(2)) : null
  return outilLu(verbe, args)
}

/** La cible du vert contient-elle celle du rouge ? Le dossier s'arrête à un `/`, le fichier à `::`. */
function cibleContient(large: string, etroite: string): boolean {
  return large === etroite || etroite.startsWith(`${large}/`) || etroite.startsWith(`${large}::`)
}

/**
 * La commande verte a-t-elle rejoué tout ce que la commande rouge visait ?
 * Pure. Deux commandes IDENTIQUES ne passent pas ici : elles partagent déjà une clé.
 */
export function vertCouvreRouge(vert: string, rouge: string): boolean {
  return couvre(commandeLue(vert), commandeLue(rouge))
}

/**
 * Un `verify` vert sur le fichier de ce rouge le lèverait-il ? La relance ne propose `verify` que si
 * oui. fix-ok: elle le proposait à tout rouge ; sur `cd sous && npx vitest run src/a.test.ts`, l'agent
 * obéissait, `verify` passait au vert et le rouge restait (reproduit par le contrôle final avec
 * `preuveManquanteDuTour`). La réponse vient de `vertCouvreRouge` sur le libellé réel de `verify`, pour
 * que la proposition ne puisse pas s'écarter de ce que le Board acceptera.
 *
 * fix-ok: ce fichier recopiait les refus de `cibleDeVerification`, sur un chemin passé en minuscules.
 * Sonde contre le vrai contrôle : 3 écarts sur 28 formes (`.git/`, `src/.git/`, `.Test.`). Ce module
 * est lu par l'interface et n'a pas le disque : `libelleDuVerify` est donc `verify` lui-même, qui
 * rend le libellé qu'il écrirait pour ce fichier, ou `null` (`libelleDuVerifySur`, `verify-command.ts`).
 */
export function verifyPeutLeverCeRouge(
  rouge: string,
  libelleDuVerify: (fichier: string) => string | null
): boolean {
  // Seul le premier fichier : `verify` n'en prend qu'un, et un second resterait non couvert.
  const [fichier] = commandeLue(rouge)?.ciblesEcrites ?? []
  if (fichier === undefined) return false
  const libelle = libelleDuVerify(fichier)
  return libelle !== null && vertCouvreRouge(libelle, rouge)
}

/** Un script sur fichiers ne dit pas quel outil tourne : il se compare à tout outil de test. */
function memeOutil(a: Famille, b: Famille): boolean {
  if (a === b) return true
  const unScript = a === 'script-sur-fichiers' || b === 'script-sur-fichiers'
  return unScript && FAMILLES_DE_TESTS.has(a) && FAMILLES_DE_TESTS.has(b)
}

function couvre(large: CommandeLue | null, etroite: CommandeLue | null): boolean {
  if (!large || !etroite) return false
  if (large.famille === 'projet') return FAMILLES_DE_TESTS.has(etroite.famille)
  if (!memeOutil(large.famille, etroite.famille)) return false
  if (!large.filtres.every((filtre) => etroite.filtres.includes(filtre))) return false
  // `npx vitest run` ne dit pas qu'il lit la configuration du script : un fichier se nomme ici.
  if (large.cibles.length === 0) return large.famille === etroite.famille
  return (
    etroite.cibles.length > 0 &&
    etroite.cibles.every((cible) => large.cibles.some((c) => cibleContient(c, cible)))
  )
}

/** Une vérification constatée, d'où qu'elle vienne. Sans `commande` : ni couverte, ni couvrante. */
export interface ConstatDePreuve {
  cle: string
  commande?: string
  /** `ok` = vert, `failed` = rouge. Tout autre état ne couvre rien et n'est jamais couvert. */
  etat: string
}

/**
 * La DERNIÈRE issue de chaque vérification distincte, moins les rouges couverts par un vert PLUS
 * RÉCENT. `constats` est dans l'ordre réel : un vert antérieur au rouge ne couvre donc rien, et un
 * rouge rejoué après son vert revient. Une clé rejouée passe à sa nouvelle place (le dernier constat
 * retenu est la dernière preuve).
 */
export function constatsRetenus<Constat extends ConstatDePreuve>(
  constats: Iterable<Constat>
): Constat[] {
  // Chaque commande n'est lue qu'une fois : le Board calcule tous les fils sur le processus principal,
  // et 100 rouges face à 100 verts de 3 900 caractères coûtaient 2,8 s relus à chaque comparaison.
  const lues = new Map<string, CommandeLue | null>()
  const lue = (commande: string): CommandeLue | null => {
    const connue = lues.get(commande)
    if (connue !== undefined) return connue
    const neuve = commandeLue(commande)
    lues.set(commande, neuve)
    return neuve
  }
  const retenus = new Map<string, Constat>()
  for (const constat of constats) {
    retenus.delete(constat.cle)
    retenus.set(constat.cle, constat)
    if (constat.etat !== 'ok' || !constat.commande) continue
    for (const [cle, autre] of retenus)
      if (
        autre.etat === 'failed' &&
        autre.commande &&
        couvre(lue(constat.commande), lue(autre.commande))
      )
        retenus.delete(cle)
  }
  return [...retenus.values()]
}

/** Les commandes restées rouges à la fin de `constats`, dans l'ordre des dernières issues. */
export function rougesRestants(constats: Iterable<ConstatDePreuve>): string[] {
  return constatsRetenus(constats).flatMap((constat) =>
    constat.etat === 'failed' && constat.commande ? [constat.commande] : []
  )
}
