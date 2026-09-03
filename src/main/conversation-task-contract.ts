import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ciblesNommees } from './root-execution-contract'

/**
 * CONTRAT DE TÂCHE AU NIVEAU DE LA CONVERSATION — la pièce qui manquait à conv-1302.
 *
 * Défaut mesuré le 2026-08-18 : sur douze tours, quatre runs ont fermé `succeeded` avec un juge à
 * 96/100 en corrigeant un AUTRE fichier que celui demandé. La garde déterministe de clôture croise
 * bien les cibles ancrées (`chemin:ligne`) avec les fichiers réellement mutés — mais elle ne lit que
 * le texte du TOUR COURANT. Or les tours de relance ne nomment plus rien : « finis », « répare
 * jusqu'à finir », « c'est tout bon ? ». Plus rien ne contredisait la dérive, et le juge lui-même
 * ignorait la cible puisqu'on ne la lui donnait plus.
 *
 * Une première tentative a voulu combler ce trou par une heuristique locale sur le texte du tour.
 * Un panel adversarial l'a réfutée : onze faux blocages sur du travail légitime. La leçon retenue
 * est que le contrat ne se DEVINE pas, il se MÉMORISE — et qu'il n'a pas à bloquer.
 *
 * D'où ce module. Il ne crée AUCUN nouveau stockage : les `RUN.md` par conversation qu'Autowin écrit
 * déjà portent la tâche verbatim dans leur `## Besoin` et leur statut de clôture en tête. Le contrat
 * ouvert de la conversation s'en déduit, et sert à INFORMER le juge — jamais à rougir un run tout
 * seul. L'autorité de blocage reste au juge, qui peut peser un contexte qu'aucune regex ne pèse.
 */
export interface ContratTache {
  /** Cibles ancrées `chemin:ligne` du dernier besoin qui en nommait, encore non honorées. */
  cibles: string[]
  /** Le RUN.md qui porte ce contrat — pour que l'affirmation soit traçable. */
  source: string
  /** Statut de clôture de ce run : le juge doit pouvoir escompter un contrat douteux. */
  statut: string
  /** Distance en runs depuis le tour courant (1 = le run précédent). Un contrat lointain est faible. */
  rang: number
  /** Cibles écartées par le plafond : dites au juge, jamais tues. */
  omises: number
}

export interface RunLu {
  path: string
  content: string
}

/** Le `## Besoin` d'un RUN.md : la tâche verbatim, telle que l'utilisateur l'a formulée. */
export function besoinDuRun(content: string): string {
  const match = /^##[ \t]+Besoin[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|$(?![\s\S]))/mu.exec(content)
  return match ? match[1].trim() : ''
}

/** Le `status:` d'en-tête, lu dans les premières lignes seulement (le Journal en cite d'autres). */
export function statutDuRun(content: string): string {
  const entete = content.split(/\r?\n/u).slice(0, 14)
  for (const ligne of entete) {
    const match = /^status\s*:\s*([a-z-]+)/iu.exec(ligne.trim())
    if (match) return match[1].toLowerCase()
  }
  return ''
}

/** Un contrat est HONORÉ quand un run a fermé sur une livraison acceptée. */
const STATUTS_HONORES = new Set(['green', 'degraded-closed'])

/**
 * Un run ABANDONNÉ n'a rien dit : ce n'est ni un refus ni une livraison.
 *
 * `reconcileAbandonedConvRuns` (`runs/conv-runs.ts`) repeint en `red` tout run resté `open` plus de
 * 24 h — typiquement l'app fermée avant la clôture. Mesuré sur le store live : 23 % des contrats
 * produits venaient de ces runs-là. Les traiter comme des refus faisait ressusciter des contrats
 * dont la seule preuve est que quelqu'un a fermé l'application.
 */
/**
 * Plafond de cibles portées par un contrat.
 *
 * Mesuré sur le corpus réel : conv-349 et conv-356 produisaient SEIZE cibles. Une note de seize
 * chemins n'est pas un signal que le juge peut peser, c'est du bruit qu'il survolera. Les cibles
 * écartées ne sont pas tues pour autant — la note dit combien.
 */
const PLAFOND_CIBLES = 5

/**
 * Chemins qui ne sont PAS des cibles du dépôt : copies isolées de run, espaces applicatifs, et les
 * fragments qu'un chemin URL-encodé laisse derrière lui (`…/Autowin%20OS/…` → `20os/…`).
 *
 * Mesuré sur le corpus réel : conv-351, conv-357 et conv-1300 en portaient, et conv-1300 y voyait
 * le MÊME fichier deux fois — une fois dans le dépôt, une fois dans la copie du run.
 */
const CHEMIN_HORS_DEPOT =
  /(?:^|\/)(?:\.autowin-data|worktrees|appdata|node_modules|dist|out)(?:\/|$)|agent__run-|^20os\//iu

const MARQUEUR_ABANDON = /abandonn[eé]\s*:\s*l.app s.est arr[eê]t[eé]e/iu

function runAbandonne(content: string): boolean {
  return MARQUEUR_ABANDON.test(content.normalize('NFC'))
}

/**
 * Le contrat OUVERT de la conversation, déduit de ses runs (ordonnés du plus ancien au plus récent).
 *
 * On remonte du plus RÉCENT vers le plus ancien et on s'arrête à la première de ces trois rencontres.
 *
 * 1. Un run ABANDONNÉ est sauté : il n'a rendu aucun verdict, il ne dit donc rien du contrat.
 * 2. Une LIVRAISON ACCEPTÉE (`green` / `degraded-closed`) solde tout ce qui précède, qu'elle ait
 *    ancré une cible ou non. C'est la correction du défaut le plus grave de la première version :
 *    elle ne consultait le statut que sur le run qui ancrait, si bien qu'un chantier livré vert sans
 *    `chemin:ligne` dans son besoin ne libérait rien. Mesuré sur le store live : conv-1063,
 *    conv-1065 et conv-76 portaient ainsi un contrat MORT, prêt à faire refuser du travail juste.
 *    L'ancrage `chemin:ligne` est rare — 31 conversations sur 1086 — donc miser la péremption du
 *    contrat sur son apparition était miser sur un événement qui n'arrive presque jamais.
 * 3. Un besoin qui ancre des cibles fait le contrat, avec sa provenance et son éloignement.
 */
export function contratDepuisRuns(runs: readonly RunLu[]): ContratTache | undefined {
  const recents = [...runs].reverse()
  for (const [index, run] of recents.entries()) {
    if (runAbandonne(run.content)) continue
    const statut = statutDuRun(run.content)
    if (STATUTS_HONORES.has(statut)) return undefined
    const cibles = ciblesNommees(besoinDuRun(run.content)).filter(
      (cible) => !CHEMIN_HORS_DEPOT.test(cible)
    )
    if (cibles.length > 0) {
      return {
        cibles: cibles.slice(0, PLAFOND_CIBLES),
        source: run.path,
        statut,
        rang: index + 1,
        omises: Math.max(0, cibles.length - PLAFOND_CIBLES)
      }
    }
  }
  return undefined
}

/**
 * La note à injecter dans le prompt du juge — `undefined` quand il n'y a rien à dire.
 *
 * Rendue SEULEMENT sur un tour qui ne nomme aucune cible : sinon la matrice `cible demandée →
 * fichier modifié` du brief du juge couvre déjà le cas, et répéter la consigne l'affaiblirait.
 *
 * La note porte sa PROVENANCE — quel run, quel statut, à quelle distance. Sans elle, le juge
 * recevait un ordre nu qu'il ne pouvait pas escompter : un contrat vieux de onze runs pesait autant
 * qu'un contrat du tour précédent. Et l'exception admise exige désormais une PREUVE dans l'agrégat,
 * non une simple affirmation : c'est l'agent qui a dérivé qui écrit cet agrégat, donc une phrase de
 * justification de sa propre main ne peut pas être la clé de sa propre sortie.
 */
export function noteContratPourJuge(task: string, contrat?: ContratTache): string | undefined {
  if (!contrat || contrat.cibles.length === 0) return undefined
  if (ciblesNommees(task).length > 0) return undefined
  // Aucun antislash litteral ici : les chaines de ce fichier ont deja ete normalisees trois fois
  // par des outils de formatage concurrents, et une regex `[/\]` y perdait son echappement.
  const dossier =
    contrat.source.split(String.fromCharCode(92)).join('/').split('/').slice(-2, -1)[0] ??
    contrat.source
  const provenance = `${dossier}, clôture « ${contrat.statut || 'inconnue'} », ${contrat.rang} run(s) en arrière`
  return (
    `CONTRAT OUVERT DE LA CONVERSATION : ce tour ne nomme aucune cible. La dernière demande non ` +
    `soldée de cette conversation en ancrait — ${contrat.cibles.join(', ')} — d'après ${provenance}. ` +
    (contrat.omises > 0 ? `(et ${contrat.omises} autres cibles, non listées ici.) ` : '') +
    `Un tour de relance (« finis », « répare », « c'est bon ? ») en hérite. Si le livrable ne touche ` +
    `AUCUNE de ces cibles, DIS-LE dans tes objections : un travail de bonne qualité ailleurs ne vaut ` +
    `pas la demande. N'accorde le VALIDE que si l'agrégat PROUVE le déplacement (mesure, lecture de ` +
    `code, cause nommée), jamais sur la seule affirmation de l'agent qui a produit le livrable. ` +
    `Escompte cette note si sa provenance la rend douteuse : un contrat lointain ou issu d'un run ` +
    `sans verdict pèse peu.
`
  )
}

/** Nombre de RUN.md relus par conversation : au-delà, le contrat pertinent est déjà passé. */
const LIMITE_RUNS = 24

/**
 * Lit les runs d'une conversation, du plus ancien au plus récent, et en déduit le contrat ouvert.
 *
 * Ordonné par date de MODIFICATION et non par nom : les dossiers de run portent un suffixe aléatoire,
 * donc un tri alphabétique n'a rien de chronologique. Ne jette jamais : un contrat indisponible doit
 * dégrader vers « aucune note au juge », jamais vers une erreur de run.
 */
export function contratDeLaConversation(
  conversationId: string,
  runsRoot: string
): ContratTache | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) return undefined
  try {
    const root = join(runsRoot, conversationId)
    if (!existsSync(root)) return undefined
    const runs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'RUN.md'))
      .filter((path) => existsSync(path))
      .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(-LIMITE_RUNS)
      .map((entry) => ({ path: entry.path, content: readFileSync(entry.path, 'utf8') }))
    return contratDepuisRuns(runs)
  } catch {
    return undefined
  }
}
