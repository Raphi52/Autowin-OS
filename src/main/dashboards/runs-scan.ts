import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseRun, type RunSummary, STATUTS_VALIDES } from './runs'
import { publicationEnClair } from '../runs/run-interruption'
import { isBlocked } from '../../shared/run-blocked'

/**
 * Scanne les RUN.md vivants du kit autowin (~/.claude/runs/<session>/<sujet>-workspace/RUN.md)
 * et renvoie un résumé parsé de chacun — la "visualisation du workflow des skills"
 * (candidat ④). Lecture disque, côté main uniquement.
 */
export interface RunEntry {
  subject: string
  session: string
  path: string
  mtime: number
  summary: RunSummary
  /**
   * Conversation qui a produit ce run, quand elle est connue. La racine des runs ne la porte pas
   * (`<session>` y est un identifiant de session CLI) : le lien vit côté conversations, dans
   * `runPaths`. Sans lui, une ligne de run est un cul-de-sac — on voit « red · sujet » sans pouvoir
   * demander pourquoi.
   */
  conversationId?: string
  /**
   * État de PUBLICATION du travail de cette conversation, quand il est sans ambiguïté
   * (`held` = retenu, `blocked` = bloqué). Distinct du statut du RUN.md : un run peut être `green`
   * avec sa DoD complète ET son intégration retenue — c'est ce cas qui était invisible.
   */
  publication?: string
  /** Le même état en clair, dans le vocabulaire de `run-interruption` (une seule source). */
  publicationLabel?: string
}

/** États de publication qui réclament une attention : les seuls que le rail a besoin de nommer. */
const PUBLICATIONS_EN_ATTENTE = new Set(['held', 'blocked'])

/**
 * Rattache à chaque run l'état de publication de sa conversation, SANS jamais le deviner.
 *
 * Un RUN.md ne porte ni `runId` ni état de publication : le seul lien disponible est la
 * conversation. On n'attache donc l'état que si la conversation a EXACTEMENT UN travail en attente
 * (`held`/`blocked`) — au-delà, on ne saurait pas dire lequel des runs est concerné, et on préfère
 * ne rien afficher plutôt qu'attribuer un blocage au mauvais run.
 */
export function attachPublicationStates(
  entries: RunEntry[],
  records: readonly { conversationId?: string; publication: string }[]
): RunEntry[] {
  const enAttente = new Map<string, string[]>()
  for (const record of records) {
    if (!record.conversationId || !PUBLICATIONS_EN_ATTENTE.has(record.publication)) continue
    const deja = enAttente.get(record.conversationId) ?? []
    deja.push(record.publication)
    enAttente.set(record.conversationId, deja)
  }
  if (enAttente.size === 0) return entries
  return entries.map((entry) => {
    const cle = entry.conversationId ?? entry.session
    const etats = enAttente.get(cle)
    if (!etats || etats.length !== 1) return entry
    return { ...entry, publication: etats[0], publicationLabel: publicationEnClair(etats[0]) }
  })
}

/**
 * Rattache chaque run à la conversation dont les `runPaths` le citent. Comparaison sur chemin
 * NORMALISÉ (casse ignorée sous Windows), comme `deleteListedRun`.
 */
export function attachConversationIds(
  entries: RunEntry[],
  conversations: readonly { id: string; runPaths?: string[] }[]
): RunEntry[] {
  const parConversation = new Map<string, string>()
  for (const conversation of conversations) {
    for (const runPath of conversation.runPaths ?? []) {
      parConversation.set(comparablePath(runPath), conversation.id)
    }
  }
  if (parConversation.size === 0) return entries
  return entries.map((entry) => {
    const conversationId = parConversation.get(comparablePath(entry.path))
    return conversationId ? { ...entry, conversationId } : entry
  })
}

/** Racine des runs (override possible via AUTOWIN_RUN_ROOT). */
export function runsRoot(): string {
  if (process.env.AUTOWIN_RUN_ROOT) return process.env.AUTOWIN_RUN_ROOT
  return join(process.env.USERPROFILE ?? '.', '.claude', 'runs')
}

/** RUN.md ouverts en même temps au plus : la fenêtre du snapshot (24) tient en un paquet. */
const LECTURES_EN_PARALLELE = 32

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p)
  } catch {
    return []
  }
}

export interface ScanRunsOptions {
  /** Nombre maximum de RUN.md RÉELLEMENT lus et parsés (les plus récents d'abord). */
  limit?: number
  /** Restreint la traversée à ces sessions/conversations. Absent = toutes. */
  sessions?: string[]
}

export interface ScanRunsResult {
  entries: RunEntry[]
  /** Candidats écartés par la borne. > 0 = la liste est TRONQUÉE, jamais en silence. */
  remaining: number
}

/**
 * Découvre et parse les RUN.md sous la racine, plus récent d'abord — avec une borne qui porte
 * sur les LECTURES, pas seulement sur la sortie.
 *
 * Pourquoi la borne ne pouvait pas rester un simple `slice` : la version précédente lisait et
 * parsait TOUS les fichiers puis tranchait. Sur la racine dev mesurée le 2026-08-18 (11 784
 * RUN.md), cela coûtait ~15 s à froid pour n'en garder que quelques dizaines — et `listConvRuns`
 * payait ce prix à chaque affichage d'une conversation. On stat d'abord (cheap), on trie, et on
 * ne `readFile` que les `limit` plus récents.
 */
type Candidat = { subject: string; session: string; path: string; mtime: number }

/** Racines sans doublon : une racine citée deux fois (AUTOWIN_RUN_ROOT = racine des conversations) n'est parcourue qu'une fois. */
function racinesUniques(root: string | readonly string[]): string[] {
  return [
    ...new Map(
      (typeof root === 'string' ? [root] : root).map((r) => [comparablePath(r), r])
    ).values()
  ]
}

/**
 * Liste les RUN.md sous les racines, plus récent d'abord, SANS les lire. Plusieurs racines : un seul
 * tri, pour que la borne porte sur leur UNION.
 */
async function listerLesCandidats(
  racines: readonly string[],
  sessionFilter?: Set<string>
): Promise<Candidat[]> {
  // TOUTES les dates lancées ensemble (2026-10-29) : attendre chaque `stat` avant le
  // suivant faisait ~1 150 allers-retours disque d'affilée sur le poste — 55 à 90 ms par scan,
  // 111 ms en médiane dans l'app (`snapshot:runs`), contre 16 à 39 ms ensemble, résultat identique.
  // L'ordre d'insertion reste celui des dossiers : le tri stable départage les dates égales pareil.
  const parRacine = await Promise.all(
    racines.map(async (racine) => {
      const sessions = sessionFilter
        ? (await safeReaddir(racine)).filter((s) => sessionFilter.has(s))
        : await safeReaddir(racine)
      return Promise.all(
        sessions.map(async (session) => {
          const sessionDir = join(racine, session)
          const datees = await Promise.all(
            (await safeReaddir(sessionDir)).map(async (ws): Promise<Candidat | null> => {
              const runPath = join(sessionDir, ws, 'RUN.md')
              try {
                const runStat = await stat(runPath)
                return {
                  subject: ws.replace(/-workspace$/, ''),
                  session,
                  path: runPath,
                  mtime: runStat.mtimeMs
                }
              } catch {
                return null // pas de RUN.md ici — ignoré
              }
            })
          )
          return datees.filter((c): c is Candidat => c !== null)
        })
      )
    })
  )
  const candidates = parRacine.flat(2)
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates
}

export async function scanRunsBounded(
  root: string | readonly string[] = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<ScanRunsResult> {
  const sessionFilter = options.sessions ? new Set(options.sessions) : undefined
  const candidates = await listerLesCandidats(racinesUniques(root), sessionFilter)
  const limit =
    options.limit === undefined ? candidates.length : Math.max(0, Math.floor(options.limit))
  const retenus = candidates.slice(0, limit)

  // Les RUN.md retenus, lus ensemble eux aussi, mais par paquets : un `readFile` garde son fichier
  // ouvert jusqu'au bout, et `scanRuns()` sans borne (os.ts) en lirait des milliers d'un coup.
  // L'ordre de la liste reste celui du tri.
  const entries: RunEntry[] = []
  for (let debut = 0; debut < retenus.length; debut += LECTURES_EN_PARALLELE) {
    const lus = await Promise.all(
      retenus.slice(debut, debut + LECTURES_EN_PARALLELE).map(async (candidate) => {
        try {
          const md = await readFile(candidate.path, 'utf8')
          return { ...candidate, summary: parseRun(md, candidate.subject) }
        } catch (erreur) {
          // fix-ok: cause mesurée — le `catch` rendait null en silence : un RUN.md illisible sortait de la liste sans trace.
          // Le scan continue sans lui ; le chemin dit lequel regarder.
          console.warn(`[runs] RUN.md illisible, ignoré : ${candidate.path}`, erreur)
          return null
        }
      })
    )
    for (const entree of lus) if (entree) entries.push(entree)
  }

  return { entries, remaining: candidates.length - retenus.length }
}

/** Variante historique : la liste seule. */
export async function scanRuns(
  root = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<RunEntry[]> {
  return (await scanRunsBounded(root, options)).entries
}

function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

/** Supprime uniquement un workspace dont le RUN.md figure encore dans le scan global courant. */
export async function deleteListedRun(runPath: string, root = runsRoot()): Promise<void> {
  const candidate = comparablePath(runPath)
  const listedRun = (await scanRuns(root)).find((run) => comparablePath(run.path) === candidate)
  if (!listedRun) throw new Error('RUN non autorisé dans la liste globale')
  await rm(dirname(listedRun.path), { recursive: true, force: false })
}

/**
 * Borne du scan sur le CHEMIN CHAUD (`snapshot()` d'un tour de chat).
 *
 * Mesure du 2026-08-28 (onglet Latence, 1 290 tours réels) : le segment `snapshot` coûtait p95
 * 1 288 ms et jusqu'à 19 250 ms par tour, parce que `runsWithGate()` scannait TOUS les RUN.md pour
 * n'en garder que 12. 24 laisse une marge franche au-dessus de ce que le snapshot affiche, sans
 * jamais payer la racine entière.
 */
export const LIMITE_RUNS_SNAPSHOT = 24

/**
 * Une fenêtre de runs qui SAIT ce qu'elle n'a pas lu : `horsFenetre` = RUN.md écartés par la borne ;
 * `horsFenetreARegarder` = ceux, parmi eux, qui demandent encore un regard (absent tant que le
 * premier compte n'est pas prêt, voir `compteHorsFenetrePourLeChat`).
 * Tableau conservé (et non objet `{ entries, remaining }`) pour que les doubles de test existants,
 * qui rendent `[]`, restent valides.
 */
export type FenetreRuns<T> = T[] & { horsFenetre: number; horsFenetreARegarder?: number }

/**
 * Variante BORNÉE destinée au chemin chaud — jamais `scanRuns()` sans borne.
 *
 * Elle passait par `scanRuns`, qui JETTE `remaining` : au-delà des 24 plus récents, un run bloqué
 * disparaissait de `runsBlocked` sans aucun signal (constat, 2026-09-25 : ranger des runs
 * récents a fait REMONTER 6 anciens runs bloqués, invisibles jusque-là). Le compte voyage désormais.
 */
export async function scanRunsPourSnapshot(
  root: string | readonly string[] = runsRoot()
): Promise<FenetreRuns<RunEntry>> {
  const { entries, remaining } = await scanRunsBounded(root, { limit: LIMITE_RUNS_SNAPSHOT })
  // fix-ok: cause mesurée — `remaining` compte tout le hors-fenêtre sans lire l'état des RUN.md ; le chat reçoit donc le compte à regarder, calculé hors du tour.
  return Object.assign(entries, {
    horsFenetre: remaining,
    horsFenetreARegarder: compteHorsFenetrePourLeChat(root)
  })
}

/**
 * Âge au-delà duquel un RUN.md ROUGE ne demande plus de regard au chat. Hors fenêtre, le Board n'en
 * garde que le nombre total (`runsNonOuverts`) : il ne les liste pas.
 */
export const SEUIL_ROUGE_ANCIEN_JOURS = 30

/**
 * Ce que le chat lit à côté du compte. Le nom `runsNonExamines` ne dit pas ce qu'il compte, et un
 * nombre nu se lit « 128 non examinés » : la légende voyage avec lui, dans l'état du tour comme
 * dans `get_state`. Elle suit la règle (`demandeUnRegard`) et les constantes qu'elle cite.
 */
export const LEGENDE_RUNS_NON_EXAMINES =
  `RUN.md hors des ${LIMITE_RUNS_SNAPSHOT} plus récents qui demandent encore un regard : ` +
  `décision attendue ; rouge non coupé de moins de ${SEUIL_ROUGE_ANCIEN_JOURS} jours ; travail resté ouvert, ` +
  'figé, échoué ou au statut illisible, sans limite d’âge ; publication refusée ; reprise bloquée à l’intégration. ' +
  '0 = rien à regarder. Ne comptent pas : les verts validés, les rouges plus anciens, les rouges coupés ' +
  '(Stop, quota), les autres interrompus, les abandons (l’app s’est arrêtée, aucun verdict).'

const JOUR_MS = 86_400_000

/**
 * Marque du journal d'une reprise arrêtée à l'intégration locale : la base porte des fichiers non
 * commités, et la publication ne passe pas. Le libellé est écrit par `relaunch-resumable-run.ts`
 * (`Reprise — gate BLOQUÉ: …`) et recopié ici : un changement là-bas le ferait sortir du compte sans bruit.
 */
const MARQUE_INTEGRATION_BLOQUEE =
  /^\[\d{4}-\d{2}-\d{2}\] Reprise — gate BLOQUÉ: intégration locale non terminée/m

/** Vrai si le journal d'un RUN.md porte une reprise arrêtée à l'intégration locale. */
export function integrationBloqueeDans(md: string): boolean {
  return MARQUE_INTEGRATION_BLOQUEE.test(md)
}

/**
 * Marque d'un abandon : l'app s'est arrêtée sous le run, aucun verdict n'a été rendu. Écrite par
 * `clorePourAbandon` (`conv-runs.ts`) en tête du Journal, et relue mot pour mot par `runAbandonne`
 * (`conversation-task-contract.ts`, non exportée) : le texte est recopié ici, un changement là-bas
 * ferait compter ces abandons sans bruit. Ancrée sur la ligne de journal : une note qui CITE la
 * phrase n'est pas un abandon.
 */
const MARQUE_ABANDON =
  /^\[\d{4}-\d{2}-\d{2}\] Abandonné : l['’]app s['’]est arrêtée avant la clôture/m

/** Vrai si le journal d'un RUN.md porte un abandon (l'app s'est arrêtée, aucun verdict). */
export function abandonDans(md: string): boolean {
  return MARQUE_ABANDON.test(md)
}

/**
 * Vrai si un run hors fenêtre demande encore un regard.
 * Compté : un run qui attend la réponse de l'utilisateur ; un run bloqué (rouge non coupé, ouvert
 * sans fin, DoD incomplète) ; un run validé dont la publication a été refusée ; un run dont la reprise
 * reste arrêtée à l'intégration locale (`integrationBloquee`). Hors compte : un VERT (le juge a validé,
 * DoD incomplète ou non), un rouge de plus de `SEUIL_ROUGE_ANCIEN_JOURS` jours, un run interrompu par
 * Stop ou quota, un rouge coupé, un abandon (`abandonne` : l'app s'est arrêtée, aucune cause écrite).
 */
export function demandeUnRegard(
  summary: RunSummary,
  ageJours: number,
  integrationBloquee = false,
  abandonne = false
): boolean {
  if (summary.decisionAttendue === true) return true
  // fix-ok: cause mesurée — `isBlocked` ne voit jamais un run `interrupted` : sans cette ligne, une publication refusée sortirait du compte sans rien le dire.
  // Validé, mais sa publication a été refusée par une base occupée. La reprise automatique ne le
  // prend que si son état de publication le permet, et la fiche ne le dit pas : on le compte.
  if (summary.status === 'interrupted' && summary.interruption === 'publication') return true
  // fix-ok: cause mesurée — la règle ne lisait que `interruption === 'publication'` : les reprises bloquées à l'intégration sortaient du compte sans rien le dire.
  // La base a des fichiers non commités : rien ne la range seul, le travail ne rejoint pas le produit.
  if (summary.status === 'interrupted' && integrationBloquee) return true
  // fix-ok: cause mesurée — la règle ne lisait pas la mention d'abandon : deux rouges de moins de 30 jours dont le Journal porte `[date] Abandonné : …` comptaient à tort, contre la légende servie au chat.
  // Une perte de travail, pas un échec : aucun verdict n'a été rendu, rien ne demande de regard.
  if (abandonne) return false
  if (!isBlocked(summary)) return false
  if (STATUTS_VALIDES.has(summary.status)) return false
  if (summary.status === 'red' && ageJours > SEUIL_ROUGE_ANCIEN_JOURS) return false
  return true
}

/**
 * Date de création d'un run : la plus ancienne date du journal (`[AAAA-MM-JJ]`). La date du fichier
 * ne sert qu'à défaut : une clôture réécrit le RUN.md et le rajeunirait à tort.
 */
function dateDeDebut(md: string, mtime: number): number {
  const dates = [...md.matchAll(/^\[(\d{4}-\d{2}-\d{2})\]/gm)]
    .map((m) => Date.parse(`${m[1]}T00:00:00Z`))
    .filter(Number.isFinite)
  return dates.length > 0 ? Math.min(...dates) : mtime
}

interface Releve {
  mtime: number
  summary: RunSummary
  debut: number
  integrationBloquee: boolean
  abandonne: boolean
}

/** Relevés des RUN.md hors fenêtre déjà lus : un fichier n'est relu que si sa date a changé. */
let releveHorsFenetre = new Map<string, Releve>()

/**
 * Nombre de RUN.md hors fenêtre qui demandent encore un regard (voir `demandeUnRegard`).
 *
 * LIT les RUN.md hors fenêtre : c'est son travail, donc il ne se fait JAMAIS sur le chemin chaud
 * d'un tour (`scanRunsPourSnapshot` ne lit que la fenêtre). Il tourne hors du tour, par
 * `compteHorsFenetrePourLeChat`.
 */
export async function compterHorsFenetreARegarder(
  root: string | readonly string[] = runsRoot(),
  maintenant = Date.now()
): Promise<number> {
  const horsFenetre = (await listerLesCandidats(racinesUniques(root))).slice(LIMITE_RUNS_SNAPSHOT)
  const releve = new Map<string, Releve>()
  for (let debut = 0; debut < horsFenetre.length; debut += LECTURES_EN_PARALLELE) {
    const lus = await Promise.all(
      horsFenetre.slice(debut, debut + LECTURES_EN_PARALLELE).map(async (candidat) => {
        const deja = releveHorsFenetre.get(candidat.path)
        if (deja && deja.mtime === candidat.mtime) return [candidat.path, deja] as const
        try {
          const md = await readFile(candidat.path, 'utf8')
          const fiche: Releve = {
            mtime: candidat.mtime,
            summary: parseRun(md, candidat.subject),
            debut: dateDeDebut(md, candidat.mtime),
            integrationBloquee: integrationBloqueeDans(md),
            abandonne: abandonDans(md)
          }
          return [candidat.path, fiche] as const
        } catch (erreur) {
          // fix-ok: cause mesurée — le `catch` rendait null en silence : un RUN.md illisible sortait du compte sans trace.
          // Sans état connu, le fichier n'entre pas dans le compte ; il n'est pas non plus mis en cache,
          // donc le calcul suivant le relit. Le chemin dit lequel, pour qu'on aille le regarder.
          console.warn(`[compteur du chat] RUN.md illisible, non compté : ${candidat.path}`, erreur)
          return null
        }
      })
    )
    for (const entree of lus) if (entree) releve.set(entree[0], entree[1])
  }
  releveHorsFenetre = releve
  let nombre = 0
  for (const { summary, debut, integrationBloquee, abandonne } of releve.values()) {
    if (demandeUnRegard(summary, (maintenant - debut) / JOUR_MS, integrationBloquee, abandonne)) {
      nombre += 1
    }
  }
  return nombre
}

/** Âge maximal d'un compte servi au chat : au-delà, il est recalculé hors du tour. */
const DELAI_DU_COMPTE_MS = 60_000

interface EtatDuCompte {
  valeur?: number
  calculeLe?: number
  enCours: boolean
}

/** Un état par jeu de racines (la conversation et le kit ne se mélangent pas). */
const comptesParRacines = new Map<string, EtatDuCompte>()

/**
 * Le compte servi au chat, SANS attendre : rend la dernière valeur connue (absente au tout premier
 * appel) et relance le calcul en arrière-plan quand elle est périmée. Un tour de chat ne paie donc
 * jamais la relecture des RUN.md anciens : elle se fait hors du tour.
 */
export function compteHorsFenetrePourLeChat(
  root: string | readonly string[],
  // Injectable : un recalcul en échec doit se prouver sans casser un vrai disque.
  calcul: (racines: string | readonly string[]) => Promise<number> = compterHorsFenetreARegarder
): number | undefined {
  const cle = racinesUniques(root).map(comparablePath).sort().join('|')
  const etat = comptesParRacines.get(cle) ?? { enCours: false }
  comptesParRacines.set(cle, etat)
  const perime = etat.calculeLe === undefined || Date.now() - etat.calculeLe > DELAI_DU_COMPTE_MS
  if (perime && !etat.enCours) {
    etat.enCours = true
    // Différé d'une tâche : la lecture ne doit même pas commencer pendant que le tour se construit.
    setImmediate(() => {
      calcul(root)
        .then((valeur) => {
          etat.valeur = valeur
          etat.calculeLe = Date.now()
        })
        // Un échec garde le compte précédent et le dit dans la console : sans cela, un compte figé
        // passerait pour exact. `calculeLe` n'avance pas : le calcul repart au tour suivant.
        .catch((erreur: unknown) => {
          console.warn(
            '[compteur du chat] recalcul des RUN.md hors fenêtre échoué ; le compte précédent reste servi.',
            erreur
          )
        })
        .finally(() => {
          etat.enCours = false
        })
    })
  }
  return etat.valeur
}
