import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseRun } from '../dashboards/runs'
import { scanRunsBounded, type RunEntry } from '../dashboards/runs-scan'
import type { OrchestrationStep } from '../orchestrator'
import { ensureAutowinAppData } from '../app-data'
import type { RunClosureObservation, RunFileStatus } from '../../shared/run-execution'
import { MARQUEUR_CIBLE_CONTEXTUALISEE } from '../../shared/relance-sans-objet'
import { rootDodLabels, rootRequirementChecks } from '../root-execution-contract'
import type { ExecutionEvidence } from '../providers/types'

/**
 * RUN.md PAR CONVERSATION — chaque tâche/orchestration lancée depuis une conversation
 * laisse son workflow dans `%APPDATA%\autowin-os\runs\<convId>\<slug>-workspace\RUN.md`,
 * au FORMAT autowin (status/DoD/Journal) : le parseur existant (parseRun/scanRuns) les
 * lit tels quels. Volontairement HORS de ~/.claude/runs (aucun conflit avec les hooks du kit).
 */

export function convRunsRoot(): string {
  return join(ensureAutowinAppData(), 'runs')
}

/**
 * REMPLISSAGE CONVERSATIONNEL. Le sujet d'un run était un bout BRUT de la phrase tapée :
 * « ensuite de la meme maniere si il veut un nouveau skill… » donnait
 * `ensuite-de-la-meme-maniere-si-il-veut-un-<ts>` — une pastille illisible et un `@run:`
 * impossible à recopier. Ces mots-outils ne nomment RIEN : ils sont écartés pour que le libellé
 * porte les mots PORTEURS. La liste est fermée et courte : aucun verbe, aucun substantif métier
 * n'y figure, donc une consigne déjà dense la traverse intacte.
 */
const MOTS_OUTILS = new Set([
  'a',
  'ah',
  'alors',
  'apres',
  'au',
  'aussi',
  'aux',
  'avec',
  'bien',
  'bon',
  'ca',
  'ce',
  'cela',
  'ces',
  'cette',
  'coup',
  'd',
  'dans',
  'de',
  'des',
  'donc',
  'du',
  'elle',
  'en',
  'ensuite',
  'est',
  'et',
  'faut',
  'il',
  'ils',
  'j',
  'je',
  'juste',
  'l',
  'la',
  'le',
  'les',
  'lui',
  'm',
  'maniere',
  'me',
  'meme',
  'mon',
  'n',
  'ne',
  'nous',
  'ok',
  'on',
  'ou',
  'par',
  'pas',
  'peut',
  'peux',
  'plus',
  'pour',
  'puis',
  'qu',
  'que',
  'qui',
  'quoi',
  's',
  'sa',
  'se',
  'si',
  'son',
  'stp',
  'sur',
  't',
  'ta',
  'te',
  'tes',
  'toi',
  'ton',
  'tres',
  'tu',
  'un',
  'une',
  'vazy',
  'voila',
  'vous',
  'y'
])

const SLUG_MOTS_MAX = 6
const SLUG_LONGUEUR_MAX = 40

function slugify(task: string): string {
  // Le marqueur d'une relance (`reprend\n\nCIBLE CONTEXTUALISEE : <sujet>`, commands.ts) ne nomme
  // rien : il prenait deux des six mots du libellé (`go-cible-contextualisee-traite-trois`,
  // conv-517). Seul le marqueur EXACT est retiré, en majuscules : un sujet qui parle de la cible
  // contextualisée garde ses mots.
  const tokens = task
    .split(MARQUEUR_CIBLE_CONTEXTUALISEE)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const porteurs = tokens.filter((t) => !MOTS_OUTILS.has(t))
  // Une phrase FAITE de mots-outils (« vazy stp ») n'a aucun mot porteur : on garde le brut
  // plutôt que de rendre un dossier anonyme.
  const retenus = (porteurs.length ? porteurs : tokens).slice(0, SLUG_MOTS_MAX)
  // Troncature au MOT, jamais au milieu d'un mot : un fragment coupé n'est pas un libellé.
  const s = retenus
    .reduce<string[]>((acc, mot) => {
      const longueur = acc.reduce((n, m) => n + m.length + 1, -1)
      return longueur + 1 + mot.length <= SLUG_LONGUEUR_MAX ? [...acc, mot] : acc
    }, [])
    .join('-')
  return s || 'tache'
}

function comparableTask(task: string): string {
  return task
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Crée le RUN.md (status: open) d'une tâche lancée depuis une conversation.
 *
 * POURQUOI AUCUNE CASE DE DoD N'EST PRÉ-REMPLIE. Le gabarit en posait une : « le juge valide le
 * résultat et le gate autorise la clôture ». Elle était nuisible pour trois raisons cumulées :
 * 1. Ce n'était pas un critère du TRAVAIL, mais le report du verdict de clôture — elle ne disait rien
 *    de ce que le run devait obtenir, donc elle n'aidait personne à juger s'il avait réussi.
 * 2. Le gate ne la lisait JAMAIS : `orchestrator.ts` synthétise l'état qu'il évalue depuis le verdict
 *    du juge, sans ouvrir le fichier. Elle était donc décorative côté décision.
 * 3. Mais pas côté AFFICHAGE : `dashboards/runs.ts` compte les cases et `isBlocked` classe un run « à
 *    traiter » sur `dodChecked < dodTotal`. Chaque run rouge affichait donc « DoD 0/1 », comme si un
 *    critère avait été manqué alors qu'aucun n'avait jamais été défini — un reproche fantôme.
 *
 * Le remède n'est pas d'inventer un critère à la place de l'auteur du prompt : c'est de ne pas en
 * poser, et de laisser le STATUT porter le signal — il le portait déjà (`isBlocked` teste le statut
 * en premier). Le support de la DoD reste entier : une case posée par un humain ou par la phase
 * terrain est comptée et bloque comme avant.
 *
 * L'AUTRE MOITIÉ, et c'est le même reproche fantôme rentré par une autre porte (2026-08-18). Les
 * cases restantes viennent de `rootDodLabels(task)`, qui les dérivait du SEUL texte du besoin. Une
 * demande limitée à la phase `frame` mais phrasée comme une mutation (« traite ce candidat… ») se
 * voyait donc semer « mutation produite », « tests exécutés », « commit publié » — trois cases
 * qu'un run sans phase d'écriture ne peut PAS cocher, affichées ensuite en « DoD 0/1 » sur un
 * livrable pourtant complet. D'où `phasesProgrammees` : les obligations sont croisées avec ce que
 * le run va réellement jouer. Rien n'est retiré au seeding — il pose de vraies obligations ; il lui
 * manquait seulement de savoir sur quoi le run allait être jugé. Paramètre OPTIONNEL et sans effet
 * quand il est absent : un appelant non migré garde exactement le comportement d'avant.
 */
export function createConvRun(
  convId: string,
  task: string,
  root = convRunsRoot(),
  now: () => number = () => Date.now(),
  phasesProgrammees?: readonly string[]
): string {
  // suffixe horodaté → pas de collision si la même tâche est relancée
  const dir = join(root, convId, `${slugify(task)}-${now().toString(36)}-workspace`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'RUN.md')
  const date = new Date(now()).toISOString().slice(0, 10)
  const dod = rootDodLabels(task, phasesProgrammees)
    .map((label) => `- [ ] ${label}`)
    .join('\n')
  writeFileSync(
    path,
    `status: open
session: ${convId}
regime: standard
signal: verdict du juge + gate déterministe (orchestration in-app)

## Besoin
${task}

**Critere de succes (DoD cochable)** :
${dod || '<!-- Aucune obligation falsifiable explicite detectee dans ce besoin. -->'}

## Contraintes
<!-- bornes de la solution (HARD/SOFT), source + conséquence si violée -->

## Options
<!-- si un choix d'approche est engagé : >=3 options scorées + ligne Décision -->

## SOP
<!-- terrain : procédure opératoire spécifique à la tâche — action -> commande/outil -> signal attendu -> fallback/arrêt -->

## Journal
[${date}] Orchestration lancée depuis la conversation ${convId}.

## Défauts

## Reprise
Goal:
Hypothesis:
Tried:
Next:
Blockers:

## Cicatrices

## Checks
`,
    'utf8'
  )
  return path
}

/**
 * Plafond de RUN.md LUS en cherchant un workflow réutilisable. Distinct de `CONV_RUNS_READ_LIMIT`
 * (qui borne l'AFFICHAGE d'une liste) : ici on ne cherche qu'UN candidat, et les candidats sont
 * déjà réduits à ceux qui portent le slug de la tâche.
 */
export const CONV_RUN_REUSE_READ_LIMIT = 200

/**
 * `<slug>-<ts36>-workspace` → l'instant de création porté par le NOM du dossier. Lire le nom évite
 * un `stat` par dossier, c'est-à-dire exactement l'I/O que cette borne existe pour supprimer.
 * Un nom sans horodatage (dossier écrit à la main) est traité comme le plus ancien possible.
 */
function workspaceStamp(name: string): number {
  const marque = /-([0-9a-z]+)-workspace$/.exec(name)
  const ts = marque ? Number.parseInt(marque[1], 36) : Number.NaN
  return Number.isFinite(ts) ? ts : 0
}

/** Réutilise un workflow ouvert de la même conversation/tâche, sinon en crée un. */
export async function reuseOrCreateConvRun(
  convId: string,
  task: string,
  root = convRunsRoot(),
  now: () => number = () => Date.now(),
  phasesProgrammees?: readonly string[]
): Promise<{ path: string; reused: boolean }> {
  try {
    // Les RUN d'une conversation vivent sous leur propre dossier : borner le scan ici évite
    // de relire tout l'historique Autowin avant chaque envoi.
    const conversationRoot = join(root, convId)
    /*
     * DEUX BORNES, PARCE QU'IL Y A DEUX FAÇONS DE FAIRE ENFLER CE DOSSIER.
     *
     * Sans elles, la recherche lisait chaque `RUN.md` jusqu'à trouver un run ouvert apparié — donc
     * TOUS quand aucun n'apparie, ce qui est le cas ORDINAIRE d'une nouvelle tâche. Mesuré le
     * 2026-08-26 : 10 037 workspaces sous une seule conversation, 8,0 s à froid et 1,2 s à chaud
     * pour UN appel, deux appels par envoi. Le coût grandissait avec l'historique de la
     * conversation. `listConvRuns` avait reçu sa borne le 2026-08-18 ; celle-ci avait été oubliée.
     *
     * 1. SLUG — un run réutilisable porte forcément le même nom de dossier que la tâche demandée :
     *    `slugify` et `comparableTask` dérivent de la MÊME suite de tokens normalisés, donc deux
     *    tâches appariables produisent le même slug. Filtrer sur le nom écarte les tâches sans
     *    rapport sans ouvrir un seul fichier. (Un dossier écrit par une version antérieure de
     *    `slugify` cesserait d'être candidat : on créerait un nouveau workflow au lieu d'en rouvrir
     *    un ancien — une dégradation visible, jamais une perte.)
     * 2. RÉCENCE — la même tâche relancée sans fin resterait, elle, non bornée. On garde les
     *    `CONV_RUN_REUSE_READ_LIMIT` plus récents, et la troncature est JOURNALISÉE, jamais muette :
     *    même parti pris que le listage.
     */
    const prefixe = `${slugify(task)}-`
    const tous = (await readdir(conversationRoot)).filter((nom) => nom.startsWith(prefixe))
    const candidats = tous
      .sort((a, b) => workspaceStamp(b) - workspaceStamp(a))
      .slice(0, CONV_RUN_REUSE_READ_LIMIT)
    if (tous.length > candidats.length) {
      console.warn(
        '[conv-runs]',
        convId,
        `recherche de workflow tronquée : ${candidats.length} runs examinés, ` +
          `${tous.length - candidats.length} plus anciens non lus`
      )
    }
    for (const workspace of candidats) {
      const path = join(conversationRoot, workspace, 'RUN.md')
      try {
        const md = await readFile(path, 'utf8')
        const storedTask =
          md.match(/## Besoin\s*\n([\s\S]*?)\n\s*\*\*Critere de succes/i)?.[1]?.trim() ?? ''
        if (parseRun(md).status === 'open' && comparableTask(storedTask) === comparableTask(task)) {
          return { path, reused: true }
        }
      } catch {
        // Un RUN isolé illisible ne masque pas les autres workflows de la conversation.
      }
    }
  } catch {
    // La recherche de workflow est une optimisation : une source illisible ne bloque pas le run.
  }
  return { path: createConvRun(convId, task, root, now, phasesProgrammees), reused: false }
}

/** Extrait le contenu d'une section `## Nom` d'un markdown (jusqu'à la prochaine `## ` ou la fin). */
function extractSection(md: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

/**
 * J2 — peuple le RUN.md de la conversation avec le VRAI livrable des phases : le sous-agent
 * produit son travail structuré (Contraintes/Options/SOP…) dans sa réponse, mais le RUN.md que
 * Workflows affiche restait un template vide. On remplit les placeholders `<!-- -->` avec le
 * meilleur contenu (le plus complet) trouvé sur l'ensemble des phases, et on annexe l'agrégat.
 */
export function populateConvRunSections(
  runPath: string,
  phaseOutputs: { phase: string; text: string; executionEvidence?: ExecutionEvidence[] }[],
  proofs: { publishedCommitSha?: string } = {}
): void {
  if (!phaseOutputs?.length) return
  try {
    let md = readFileSync(runPath, 'utf8')
    const rootTask =
      md.match(/## Besoin\s*\n([\s\S]*?)\n\s*\*\*Critere de succes/i)?.[1]?.trim() ?? ''
    for (const check of rootRequirementChecks(rootTask, {
      phases: phaseOutputs,
      publishedCommitSha: proofs.publishedCommitSha
    })) {
      if (!check.checked) continue
      md = md.replace(`- [ ] ${check.label}`, `- [x] ${check.label}`)
    }
    for (const section of ['Contraintes', 'Options', 'SOP']) {
      // le contenu le plus long parmi les phases = le plus complet (résiste à une phase qui dérive)
      const best = phaseOutputs
        .map((p) => extractSection(p.text, section))
        .filter((c) => c && !c.startsWith('<!--'))
        .sort((a, b) => b.length - a.length)[0]
      if (!best) continue
      const placeholder = new RegExp(`(##\\s+${section}\\n)<!--[\\s\\S]*?-->`, 'i')
      if (placeholder.test(md)) md = md.replace(placeholder, `$1${best}`)
    }
    /*
     * `## Défauts` ne peut PAS rejoindre la boucle ci-dessus : les autres sections se remplissent en
     * remplaçant leur commentaire gabarit `<!-- … -->`, or celle-ci naît sans commentaire. On écrit
     * donc SOUS le titre, en REMPLAÇANT son contenu — le peuplement est rejoué à chaque phase, il
     * doit rester idempotent (sinon le compteur enflerait à chaque passage).
     * Sans cela `dashboards/runs.ts` comptait une section que personne n'écrivait : « Défauts 0 »
     * sur tous les runs, y compris rouges.
     */
    const defauts = phaseOutputs
      .map((p) => extractSection(p.text, 'Défauts'))
      .filter((c) => c && !c.startsWith('<!--'))
      .sort((a, b) => b.length - a.length)[0]
    /*
     * UNE REPRISE (`salvage`) EST UN DÉFAUT DU RUN, MÊME QUAND LE RUN EST VERT — mesure du
     * 2026-09-16, conv-597, turnId 4e502786-4887-4101-85b3-ea2dee304091.
     *
     * Déroulé lu dans le dossier de ce tour : le juge valide (12:33:59), la clôture est autorisée,
     * puis `salvage` rend à 12:35:13 « J'ai trouvé le jeu. Ma conclusion précédente était trop
     * courte » — la conclusion du run était FAUSSE. Le RUN.md, lui, est resté `status: green`,
     * Journal « Juge: validé », `## Défauts` VIDE : le panneau Workflows montrait un run vert dont
     * la conclusion avait été démentie 70 secondes plus tard, sans une ligne pour le dire.
     *
     * `salvage` n'écrit presque jamais de section `## Défauts` — son livrable est une prose de
     * rattrapage — donc le filtre ci-dessus le laissait tomber. Sa seule EXISTENCE avec du texte
     * suffit à qualifier le défaut : la phase ne se joue que pour rattraper ce que le run a raté.
     * On l'inscrit donc telle quelle, repliée en une ligne, et de façon idempotente (le peuplement
     * est rejoué à chaque phase).
     */
    const reprise = phaseOutputs
      .filter((p) => p.phase === 'salvage' && p.text?.trim())
      .map((p) => `- Reprise (salvage) : ${p.text.replace(/\s*\n\s*/g, ' · ').trim().slice(0, 600)}`)
      .slice(-1)[0]
    const contenuDefauts = [defauts, reprise].filter(Boolean).join('\n')
    if (contenuDefauts) {
      md = md.replace(/(\n##\s+Défauts\s*\n)[\s\S]*?(?=\n##\s)/, `$1${contenuDefauts}\n`)
    }

    const annexe = phaseOutputs
      .map((p) => `### phase ${p.phase}\n${p.text.slice(0, 2000)}`)
      .join('\n\n')
    const section = `## Livrable des phases\n${annexe}\n`
    if (md.includes('## Livrable des phases')) {
      // A3 — peuplement LIVE : la section est réécrite à chaque phase (idempotent), pas dupliquée.
      md = md.replace(/## Livrable des phases\n[\s\S]*?(?=\n## Reprise)/, section)
    } else {
      md = md.replace(/\n## Reprise/, `\n${section}\n## Reprise`)
    }
    writeFileSync(runPath, md, 'utf8')
  } catch {
    /* peuplement best-effort : un RUN.md template reste lisible, pas fatal */
  }
}

/** Applique au RUN le statut exact du lifecycle ; `open` n'est pas une clôture. */
/**
 * Met une erreur d'orchestration en UNE ligne de Journal.
 *
 * Deux contraintes qui se contredisent naivement : le Journal est un format une-entree-par-ligne
 * (`closeConvRun` ecrit `[date] <ligne>`), et la RAISON de l'echec vit apres le premier retour a la
 * ligne du message. Plafonner brutalement detruit la raison ; garder les retours a la ligne casse
 * le format. On replie donc AVANT de plafonner.
 */
export function ligneJournalDErreur(e: unknown): string {
  return String(e)
    .replace(/\s*\n\s*/g, ' · ')
    .slice(0, 600)
}

/** Texte d'un RUN.md une fois clos : partagé par la clôture synchrone et la réconciliation. */
function texteClos(md: string, status: RunFileStatus, journalLine: string): string {
  // Le cochage auto de « le juge valide … » est retiré avec la case elle-même : il cochait un
  // pseudo-critère au moment où le statut le disait déjà. Une DoD RÉELLE, elle, n'est jamais cochée
  // par la clôture — c'est à celui qui produit la preuve de la cocher, sinon la case ne prouve rien.
  return md
    .replace(/^status: open/m, `status: ${status}`)
    .replace(/^## Journal$/m, `## Journal`)
    .replace(/(## Journal\n)/, `$1[${new Date().toISOString().slice(0, 10)}] ${journalLine}\n`)
}

/**
 * LE STATUT DU RUN.md À PARTIR DE LA CLÔTURE DU MOTEUR (piste 4, conv-1070) : une clôture `red` qui
 * nomme une cause extérieure devient `interrupted` — ni échec, ni bloqué. Tout le reste passe tel
 * quel : un refus du juge reste `red`.
 */
export function statutDuRunMd(
  closure: Pick<RunClosureObservation, 'status' | 'interruption'>
): RunFileStatus {
  return closure.status === 'red' && closure.interruption ? 'interrupted' : closure.status
}

export function closeConvRun(path: string, status: RunFileStatus, journalLine: string): void {
  if (status === 'open') return
  try {
    writeFileSync(path, texteClos(readFileSync(path, 'utf8'), status, journalLine), 'utf8')
  } catch {
    /* clôture best-effort : un RUN resté open est visible, pas fatal */
  }
}

/**
 * Vrai si le fichier COMMENCE par ce texte, en ne lisant que les premiers octets.
 *
 * La réconciliation examine des centaines de RUN.md dont l'immense majorité est déjà close : les
 * charger entiers pour ne regarder que leur première ligne coûterait des dizaines de mégaoctets.
 * ASYNCHRONE : la forme `openSync`/`readSync` gelait la fenêtre au démarrage (voir
 * `reconcileAbandonedConvRuns`).
 */
async function commencePar(path: string, prefixe: string): Promise<boolean> {
  const tampon = Buffer.alloc(Buffer.byteLength(prefixe, 'utf8'))
  const fichier = await open(path, 'r')
  try {
    const { bytesRead } = await fichier.read(tampon, 0, tampon.length, 0)
    return bytesRead === tampon.length && tampon.toString('utf8') === prefixe
  } finally {
    await fichier.close()
  }
}

/** Taille des lots d'entrées-sorties : la file de libuv n'a que quatre fils, la fenêtre aussi en lit. */
const RECONCILIATION_LOT = 8

/**
 * Fichier mémo de la réconciliation, À CÔTÉ de la racine des runs (jamais dedans : tout ce qui
 * parcourt la racine y lit des dossiers de conversation). Production :
 * `%APPDATA%\autowin-os\runs-reconciliation.json`.
 */
export function cheminMemoReconciliation(root: string): string {
  return join(dirname(root), `${basename(root)}-reconciliation.json`)
}

/** Borne lue dans le mémo ; 0 (tout réexaminer) si le mémo est absent, illisible ou incohérent. */
async function lireBorneVerifiee(memoPath: string): Promise<number> {
  try {
    const memo = JSON.parse(await readFile(memoPath, 'utf8')) as {
      verifieAvant?: unknown
      ecritLe?: unknown
    }
    // Un mémo écrit « dans le futur » trahit une horloge revenue en arrière : les `mtime` posés
    // depuis peuvent être antérieurs à sa borne sans avoir été examinés.
    if (typeof memo.ecritLe !== 'number' || memo.ecritLe > Date.now()) return 0
    return typeof memo.verifieAvant === 'number' && Number.isFinite(memo.verifieAvant)
      ? memo.verifieAvant
      : 0
  } catch {
    return 0
  }
}

/** Découpe une liste en lots consécutifs. */
function enLots<T>(elements: T[], taille: number): T[][] {
  const lots: T[][] = []
  for (let i = 0; i < elements.length; i += taille) lots.push(elements.slice(i, i + taille))
  return lots
}

function estAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

type ExamenRun = 'absent' | 'recent' | 'deja-verifie' | 'clos' | 'ouvert' | 'illisible'

/**
 * Clôture ASYNCHRONE d'un run abandonné ; faux si l'écriture n'a pas abouti. `interrupted`, pas
 * `red` (piste 4, conv-1070) : l'app s'est arrêtée sous lui, aucun juge ne l'a refusé — `red` le
 * laissait « bloqué » pour toujours (482 RUN.md ainsi clos, comptés le 2026-10-22).
 * fix-ok: conv-1070 — cause mesurée : cette fonction écrivait `red` ; le test « clos `interrupted`
 * … et ne bloque pas » (conv-runs-reconcile.test.ts) rendait « expected 'status: red' » avant, vert
 * après. Le texte « Abandonné : » reste : `runAbandonne` le relit, et sa reformulation rougit le test
 * du contrat de tâche du même fichier.
 */
async function clorePourAbandon(path: string): Promise<boolean> {
  try {
    const md = await readFile(path, 'utf8')
    await writeFile(
      path,
      texteClos(
        md,
        'interrupted',
        // Texte inchangé : `runAbandonne` (conversation-task-contract.ts) le relit à la lettre.
        "Abandonné : l'app s'est arrêtée avant la clôture, aucun verdict n'a été rendu."
      ),
      'utf8'
    )
    return true
  } catch {
    return false
  }
}

/**
 * Clôt les runs restés `open` alors que plus personne ne les porte.
 *
 * `closeConvRun` n'est appelé qu'à la FIN d'une orchestration : si l'app s'arrête avant — crash,
 * fermeture, coupure — le `RUN.md` garde `status: open` et rien ne l'en sort jamais. Mesuré le
 * 2026-08-05 sur l'état réel (8888 workspaces) : 151 runs `open` dont **141 vieux de plus de 24 h**.
 * Le taux de réussite se lisant dans ces fichiers, ces 141 le faussaient en silence. Ils étaient clos
 * `red` ; depuis conv-1070 ils le sont `interrupted` : arrêtés avec l'app, pas jugés — `red` les
 * comptait parmi les échecs et les gardait « bloqués » pour toujours.
 *
 * Le SEUIL protège les runs en vol et ceux que la reprise va récupérer : ceux-là ont un `mtime` de
 * quelques secondes, jamais de plusieurs heures. Le PLAFOND borne le travail au démarrage, et le
 * reste est RENVOYÉ pour être journalisé — une troncature muette se lirait « tout est traité ».
 *
 * Ne lit que le début de chaque fichier : le statut est en première ligne, inutile de charger 8888
 * documents entiers.
 *
 * ASYNCHRONE DE BOUT EN BOUT. Mesure (`gels.jsonl`) : « démarrage : construction de la fenêtre »
 * bloquée 1 034 ms le 2026-09-22 07:03, dont 779 ms d'`openSync` en 705 appels, et encore 1 216 ms
 * dont 900 ms d'`openSync` en 826 appels le 2026-10-13 14:10 — tous venus d'ici. L'appel partait
 * déjà par `setImmediate` « sans rien attendre », mais un corps synchrone reste sur le fil de la
 * fenêtre : différer ne rend pas non bloquant. Les lectures passent donc par `fs/promises`, en
 * lots de `RECONCILIATION_LOT`.
 *
 * MÉMO DE LA DERNIÈRE VÉRIFICATION (`memoPath`, `null` pour s'en passer). Il retient la borne
 * `verifieAvant` : tout RUN.md dont le `mtime` lui est antérieur a déjà été examiné, et toute
 * écriture postérieure (une clôture, une reprise) aurait avancé ce `mtime`. Ces fichiers ne sont
 * donc plus rouverts : au démarrage suivant, seul un `stat` les touche. La borne est celle de la
 * passe (`now - olderThanMs`), jamais `now` : un run trop jeune pour être examiné doit l'être une
 * fois vieilli. Elle n'avance QUE si la passe a tout examiné — plafond atteint, fichier illisible
 * ou clôture ratée laissent l'ancienne borne, et le reste est repris au démarrage suivant. Angle
 * mort assumé : un RUN.md recopié en conservant un `mtime` ancien ne serait pas relu.
 */
export async function reconcileAbandonedConvRuns(options: {
  root?: string
  now?: number
  olderThanMs?: number
  max?: number
  memoPath?: string | null
}): Promise<{ closed: number; remaining: number; dejaVerifies: number }> {
  const root = options.root ?? convRunsRoot()
  const debutReel = Date.now()
  const now = options.now ?? debutReel
  const olderThanMs = options.olderThanMs ?? 24 * 3_600_000
  const max = options.max ?? 500
  const memoPath =
    options.memoPath === undefined ? cheminMemoReconciliation(root) : options.memoPath
  // Examiné ssi `mtime < borne` : même règle que le seuil historique (`now - mtime > olderThanMs`).
  const borne = now - olderThanMs
  const dejaVerifieAvant = memoPath ? await lireBorneVerifiee(memoPath) : 0
  let closed = 0
  let remaining = 0
  let dejaVerifies = 0
  let complet = true

  let convs: string[]
  try {
    convs = await readdir(root)
  } catch {
    // racine absente : rien à réconcilier, et surtout rien à casser
    return { closed: 0, remaining: 0, dejaVerifies: 0 }
  }

  const chemins: string[] = []
  for (const lot of enLots(convs, RECONCILIATION_LOT)) {
    const listes = await Promise.all(
      lot.map(async (conv) => {
        try {
          // Seuls les workspaces portent un RUN.md à clore ; un worktree d'agent n'en est pas un.
          return (await readdir(join(root, conv)))
            .filter((ws) => ws.endsWith('-workspace'))
            .map((ws) => join(root, conv, ws, 'RUN.md'))
        } catch {
          return [] // un fichier à la racine, ou un dossier disparu entre-temps
        }
      })
    )
    for (const liste of listes) chemins.push(...liste)
  }

  const examiner = async (path: string): Promise<ExamenRun> => {
    let mtime: number
    try {
      mtime = (await stat(path)).mtimeMs
    } catch (error) {
      return estAbsent(error) ? 'absent' : 'illisible'
    }
    if (mtime >= borne) return 'recent'
    if (mtime < dejaVerifieAvant) return 'deja-verifie'
    try {
      return (await commencePar(path, 'status: open')) ? 'ouvert' : 'clos'
    } catch (error) {
      // Un dossier supprimé pendant la passe (ramasse-miettes) n'a plus rien à vérifier.
      return estAbsent(error) ? 'absent' : 'illisible'
    }
  }

  for (const lot of enLots(chemins, RECONCILIATION_LOT)) {
    const examens = await Promise.all(lot.map(examiner))
    for (let i = 0; i < lot.length; i++) {
      const examen = examens[i]
      if (examen === 'deja-verifie') dejaVerifies += 1
      if (examen === 'illisible') complet = false
      if (examen !== 'ouvert') continue
      if (closed >= max || !(await clorePourAbandon(lot[i]))) {
        remaining += 1
        complet = false
        continue
      }
      closed += 1
    }
  }

  if (memoPath && complet) {
    try {
      // `min` avec l'heure réelle : une passe jouée avec un `now` dans le futur ne doit pas
      // déclarer vérifiés des fichiers qui seront encore écrits avant cette date.
      const memo = { verifieAvant: Math.min(borne, debutReel), ecritLe: Date.now() }
      await writeFile(memoPath, JSON.stringify(memo), 'utf8')
    } catch {
      /* mémo best-effort : sans lui, la passe suivante réexamine tout, rien de plus */
    }
  }
  return { closed, remaining, dejaVerifies }
}

/** Chemin du sidecar de trace (fil des sous-agents) d'un RUN.md. */
function tracePath(runPath: string): string {
  return join(dirname(runPath), 'trace.json')
}

const STEP_TEXT_CAP = 4000

/**
 * Persiste le FIL des sous-agents (exec/juge/gate avec contenu) à côté du RUN.md.
 * Sidecar JSON séparé → ne casse pas le format autowin du .md. Contenu cappé.
 */
export function saveConvRunTrace(runPath: string, steps: OrchestrationStep[]): void {
  try {
    const trimmed = steps.map((s) => ({
      ...s,
      text: s.text && s.text.length > STEP_TEXT_CAP ? `${s.text.slice(0, STEP_TEXT_CAP)}…` : s.text
    }))
    writeFileSync(tracePath(runPath), JSON.stringify(trimmed), 'utf8')
  } catch {
    /* la trace est un bonus d'affichage : son échec ne casse rien */
  }
}

/** Relit le fil des sous-agents d'un run (null si absent/illisible). */
export function loadConvRunTrace(runPath: string): OrchestrationStep[] | null {
  try {
    const p = tracePath(runPath)
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(data) ? (data as OrchestrationStep[]) : null
  } catch {
    return null
  }
}

/**
 * Plafond de runs LUS pour une conversation. Borné PAR CONVERSATION et non globalement : un
 * plafond global ferait disparaître l'historique d'une conversation dormante dès qu'on travaille
 * ailleurs.
 */
export const CONV_RUNS_READ_LIMIT = 200

/**
 * Runs d'UNE conversation : ceux créés dans son dossier + les RUN.md attachés.
 *
 * Ne traverse plus que le dossier de la conversation, et ne lit que les `CONV_RUNS_READ_LIMIT`
 * plus récents. Avant : `scanRuns(root)` lisait et parsait l'arbre ENTIER (11 784 fichiers
 * mesurés sur la racine dev le 2026-08-18) pour n'en garder que ceux d'une conversation.
 * La troncature est JOURNALISÉE, jamais muette — même raison que le `remaining` de
 * `reconcileAbandonedConvRuns`.
 */
export function listConvRuns(
  convId: string,
  attachedPaths: string[] = [],
  root = convRunsRoot()
): Promise<RunEntry[]> {
  return scanRunsBounded(join(root), {
    sessions: [convId],
    limit: CONV_RUNS_READ_LIMIT
  }).then(async ({ entries: runs, remaining }) => {
    if (remaining > 0) {
      console.warn(
        '[conv-runs]',
        convId,
        `liste tronquée : ${CONV_RUNS_READ_LIMIT} runs affichés, ${remaining} plus anciens non lus`
      )
    }
    const own = runs.filter((r) => r.session === convId)
    const attached = (
      await Promise.all(
        attachedPaths.map(async (p): Promise<RunEntry | null> => {
          try {
            const [md, runStat] = await Promise.all([readFile(p, 'utf8'), stat(p)])
            const subject = dirname(p)
              .split(/[\\/]/)
              .pop()!
              .replace(/-workspace$/, '')
            return {
              subject,
              session: 'attaché',
              path: p,
              mtime: runStat.mtimeMs,
              summary: parseRun(md, subject)
            }
          } catch {
            return null
          }
        })
      )
    ).filter((entry): entry is RunEntry => entry !== null)
    return [...own, ...attached].sort((a, b) => b.mtime - a.mtime)
  })
}

function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

/**
 * Retire un RUN de la conversation sans accepter de chemin arbitraire venant du renderer.
 * Les runs natifs appartiennent à Autowin : leur workspace complet (trace comprise) est supprimé.
 * Un RUN externe reste la propriété de son outil d'origine : il est uniquement détaché.
 */
export async function deleteConvRun(
  convId: string,
  runPath: string,
  attachedPaths: string[] = [],
  root = convRunsRoot()
): Promise<{ kind: 'deleted' } | { kind: 'detached'; attachedPath: string }> {
  const candidate = resolve(runPath)
  const attachedPath = attachedPaths.find((path) => samePath(path, candidate))
  if (attachedPath) {
    return { kind: 'detached', attachedPath }
  }

  const conversationRoot = resolve(root, convId)
  const workspace = dirname(candidate)
  const workspaceRelative = relative(conversationRoot, workspace)
  const isDirectNativeWorkspace =
    workspaceRelative !== '' &&
    workspaceRelative !== '..' &&
    !workspaceRelative.startsWith(`..${sep}`) &&
    !isAbsolute(workspaceRelative) &&
    !workspaceRelative.includes(sep) &&
    basename(candidate).toLocaleLowerCase('en-US') === 'run.md'

  if (isDirectNativeWorkspace) {
    const allowed = (await listConvRuns(convId, attachedPaths, root)).some(
      (run) => run.session === convId && samePath(run.path, candidate)
    )
    if (!allowed) throw new Error('RUN non autorisé pour cette conversation')
    await rm(workspace, { recursive: true, force: false })
    return { kind: 'deleted' }
  }

  throw new Error('RUN non autorisé pour cette conversation')
}
