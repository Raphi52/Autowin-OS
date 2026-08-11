import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { readDurableJson, writeDurableJson } from './durable-json'
import { ALL_ROLES, type Role, type RoleBinding } from './roles'
import type { PipelinePhase } from './skill-pipeline'
import { graphDefects, graphFromPhases, type WorkflowGraph } from './workflow-graph'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'

/**
 * Sème le catalogue livré d'origine, UNE SEULE FOIS, quand aucun fichier n'existe encore.
 *
 * Une vue vide ne s'utilise pas : composer un graphe depuis une page blanche demande de connaître
 * les phases, les personas et les bornes de retour — c'est-à-dire tout ce que ces exemples montrent.
 * Le geste est explicite et séparé de la LECTURE : `loadWorkflowProfiles` ne doit jamais inventer du
 * contenu, sinon un fichier vidé volontairement se repeuplerait tout seul au prochain démarrage.
 */
export function seedDefaultWorkflows(path = workflowProfilesPath()): WorkflowProfilesFile {
  const actuel = loadWorkflowProfiles(path)
  // Semé une fois, tracé par MARQUEUR et non par l'existence du fichier : une installation qui
  // possédait déjà un profil n'aurait JAMAIS reçu le catalogue (constaté en réel — un seul profil
  // présent, six livrés invisibles). Le marqueur permet aussi de ne pas ressusciter au démarrage
  // suivant ce que l'utilisateur a délibérément supprimé.
  if (actuel.seeded) return actuel
  const connus = new Set(actuel.profiles.map((p) => p.id))
  const fichier: WorkflowProfilesFile = {
    ...actuel,
    seeded: true,
    profiles: [
      ...actuel.profiles,
      ...DEFAULT_WORKFLOWS.filter((p) => !connus.has(p.id)).map((profile) => ({ ...profile }))
    ]
  }
  saveWorkflowProfiles(fichier, path)
  return fichier
}

/**
 * Un WORKFLOW nommé : la façon de travailler, rendue sélectionnable et comparable.
 *
 * Aujourd'hui la manière dont un run se déroule est éparpillée en trois endroits — les modèles et
 * efforts dans les rôles, les phases dans le régime, les consignes dans les skills du kit. On ne
 * peut donc ni dire « ceci est le workflow Rapide, celui-là Rigoureux », ni rejouer le MÊME objectif
 * sous plusieurs façons de faire pour les comparer.
 *
 * Ce profil rassemble ces réglages sous un nom. Il ne remplace rien : ce qu'il ne dit pas reste régi
 * par la configuration en vigueur — un profil est un ENSEMBLE D'ÉCARTS, pas une configuration
 * complète. C'est ce qui permet d'en écrire un en trois lignes pour tester une seule variable.
 */

export type InstructionMode =
  /** La consigne s'AJOUTE aux skills du kit, qui gardent l'autorité. Défaut : le moins risqué. */
  | 'append'
  /** La consigne REMPLACE le corps de la phase — pour comparer deux méthodes, pas deux réglages. */
  | 'replace'

export interface WorkflowInstructions {
  mode: InstructionMode
  /** Consigne appliquée à toutes les phases. */
  text?: string
  /** Consigne spécifique à une phase — prime sur `text` pour cette phase. */
  perPhase?: Partial<Record<PipelinePhase, string>>
}

export interface WorkflowProfile {
  id: string
  name: string
  description?: string
  /** Écarts de provider/modèle/effort par rôle. Un rôle absent garde sa configuration courante. */
  roles?: Partial<Record<Role, Partial<RoleBinding>>>
  /**
   * Phases imposées, en chaîne. Absent → le régime décide, comportement actuel.
   * Conservé pour tout profil écrit avant le canevas : `graphOf()` le convertit à la lecture.
   */
  phases?: PipelinePhase[]
  /**
   * Le workflow comme GRAPHE : nœuds (une phase, ses agents, son quorum) et arêtes conditionnelles, dont les
   * retours bornés. Prime sur `phases`, qui n'en exprime que le cas linéaire.
   */
  graph?: WorkflowGraph
  /** Largeurs voulues : membres de panel par phase, taille du jury, plafond de sous-tâches. */
  allocation?: {
    phaseMembers?: Partial<Record<PipelinePhase, number>>
    judgeMembers?: number
    maxGreedyNodes?: number
  }
  instructions?: WorkflowInstructions
  /**
   * Le chat a-t-il le droit d'INVOQUER ce workflow de lui-même ?
   *
   * Absent vaut `true` : un profil écrit avant ce drapeau reste invocable, sans quoi une mise à jour
   * rendrait muet tout le catalogue existant. On désactive pour retirer un workflow du choix
   * automatique sans le supprimer — l'archiver en le gardant sous la main, plutôt que de devoir le
   * réécrire pour le réessayer.
   *
   * Ne touche PAS à la sélection manuelle : un workflow désactivé reste sélectionnable à la main.
   * Deux gestes différents, deux effets différents.
   */
  enabled?: boolean
}

/** Un profil n'est invocable que s'il est autorisé ET structurellement exécutable. */
export function estInvocable(profile: WorkflowProfile): boolean {
  return profile.enabled !== false && workflowProfileIssues(profile).length === 0
}

/**
 * Le graphe effectif d'un profil : celui qu'il déclare, sinon la chaîne équivalente à ses phases.
 *
 * Un seul point de lecture pour que le reste du code n'ait jamais à savoir si le profil vient d'avant ou d'après
 * le canevas — sans quoi chaque appelant réimplémenterait la migration, et l'un d'eux l'oublierait.
 */
export function graphOf(profile: WorkflowProfile): WorkflowGraph | undefined {
  if (profile.graph?.nodes?.length) return profile.graph
  if (profile.phases?.length) return graphFromPhases(profile.phases)
  return undefined
}

export interface WorkflowProfilesFile {
  profiles: WorkflowProfile[]
  /** Profil sélectionné pour le prochain run. `null` = aucun, on garde la configuration courante. */
  activeId: string | null
  /**
   * Le catalogue d'origine a déjà été semé.
   *
   * Se fier à l'EXISTENCE du fichier ne marchait pas : une installation possédant déjà un profil
   * n'a jamais reçu les workflows livrés. Un marqueur explicite sème une fois, sans ressusciter
   * ensuite ce qui a été supprimé exprès.
   */
  seeded?: boolean
}

const EMPTY: WorkflowProfilesFile = { profiles: [], activeId: null }

export function workflowProfilesPath(base = ensureAutowinAppData()): string {
  return join(base, 'workflow-profiles.json')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Un identifiant sert de clé ET de nom de sélection : on refuse tout ce qui n'est pas simple. */
function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : undefined
}

/**
 * Un graphe relu du disque est refusé S'IL NE PEUT PAS TOURNER — notamment un retour sans borne, qui ferait
 * boucler un run indéfiniment. Mieux vaut retomber sur les phases du profil que charger un piège.
 */
function normalizeGraph(value: unknown): WorkflowGraph | undefined {
  if (!isPlainObject(value)) return undefined
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const edges = Array.isArray(value.edges) ? value.edges : []
  const candidate = {
    entry: typeof value.entry === 'string' ? value.entry : '',
    nodes,
    edges
  } as WorkflowGraph
  return graphDefects(candidate).length === 0 ? candidate : undefined
}

function normalizeInstructions(value: unknown): WorkflowInstructions | undefined {
  if (!isPlainObject(value)) return undefined
  const mode: InstructionMode = value.mode === 'replace' ? 'replace' : 'append'
  const text = typeof value.text === 'string' && value.text.trim() ? value.text : undefined
  const perPhaseRaw = isPlainObject(value.perPhase) ? value.perPhase : undefined
  const perPhase: Record<string, string> = {}
  for (const [phase, consigne] of Object.entries(perPhaseRaw ?? {})) {
    if (typeof consigne === 'string' && consigne.trim()) perPhase[phase] = consigne
  }
  if (!text && Object.keys(perPhase).length === 0) return undefined
  return {
    mode,
    ...(text ? { text } : {}),
    ...(Object.keys(perPhase).length
      ? { perPhase: perPhase as WorkflowInstructions['perPhase'] }
      : {})
  }
}

function normalizeRoles(value: unknown): WorkflowProfile['roles'] {
  if (!isPlainObject(value)) return undefined
  const roles: Partial<Record<Role, Partial<RoleBinding>>> = {}
  for (const role of ALL_ROLES) {
    const binding = value[role]
    if (!isPlainObject(binding)) continue
    const clean: Partial<RoleBinding> = {}
    if (typeof binding.provider === 'string' && binding.provider) clean.provider = binding.provider
    if (typeof binding.model === 'string' && binding.model) clean.model = binding.model
    if (typeof binding.reasoningEffort === 'string' && binding.reasoningEffort) {
      clean.reasoningEffort = binding.reasoningEffort as RoleBinding['reasoningEffort']
    }
    if (Object.keys(clean).length) roles[role] = clean
  }
  return Object.keys(roles).length ? roles : undefined
}

/**
 * Assainit un profil venu de l'EXTÉRIEUR (fichier importé) avec exactement la même règle que la
 * relecture du fichier local. Un second validateur divergerait du premier, et c'est par cet écart
 * qu'un profil refusé au chargement passerait à l'import.
 */
export function sanitizeImportedProfile(value: unknown): WorkflowProfile | undefined {
  return normalizeProfile(value)
}

function normalizeProfile(value: unknown): WorkflowProfile | undefined {
  if (!isPlainObject(value)) return undefined
  const id = safeId(value.id)
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  // Sans identifiant ni nom, un profil n'est ni sélectionnable ni lisible : on l'écarte plutôt que
  // d'afficher une ligne fantôme dans la liste.
  if (!id || !name) return undefined
  const phases = Array.isArray(value.phases)
    ? (value.phases.filter((phase) => typeof phase === 'string') as PipelinePhase[])
    : undefined
  const allocationRaw = isPlainObject(value.allocation) ? value.allocation : undefined
  const allocation = allocationRaw
    ? {
        ...(isPlainObject(allocationRaw.phaseMembers)
          ? { phaseMembers: allocationRaw.phaseMembers as Record<PipelinePhase, number> }
          : {}),
        ...(typeof allocationRaw.judgeMembers === 'number'
          ? { judgeMembers: allocationRaw.judgeMembers }
          : {}),
        ...(typeof allocationRaw.maxGreedyNodes === 'number'
          ? { maxGreedyNodes: allocationRaw.maxGreedyNodes }
          : {})
      }
    : undefined
  const roles = normalizeRoles(value.roles)
  const graph = normalizeGraph(value.graph)
  const instructions = normalizeInstructions(value.instructions)
  const description =
    typeof value.description === 'string' && value.description.trim()
      ? value.description.trim()
      : undefined
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(roles ? { roles } : {}),
    ...(phases && phases.length ? { phases } : {}),
    ...(graph ? { graph } : {}),
    ...(allocation && Object.keys(allocation).length ? { allocation } : {}),
    ...(instructions ? { instructions } : {})
  }
}

/**
 * Relit les profils. Un fichier absent, corrompu ou partiellement invalide ne fait JAMAIS échouer :
 * on rend ce qui est lisible. Un réglage de confort ne doit pas empêcher l'app de démarrer.
 */
function decodeWorkflowProfiles(parsed: unknown): WorkflowProfilesFile | undefined {
  if (!isPlainObject(parsed)) return undefined
  if (!Array.isArray(parsed.profiles)) return undefined
  if (parsed.activeId !== null && typeof parsed.activeId !== 'string') return undefined
  if (parsed.seeded !== undefined && typeof parsed.seeded !== 'boolean') return undefined
  const profiles: WorkflowProfile[] = []
  const seen = new Set<string>()
  for (const raw of parsed.profiles) {
    const profile = normalizeProfile(raw)
    // Deux profils de même identifiant rendraient la sélection ambiguë : le premier gagne.
    if (profile && !seen.has(profile.id)) {
      seen.add(profile.id)
      profiles.push(profile)
    }
  }
  const activeCandidate = safeId(parsed.activeId)
  // Un profil sélectionné qui n'existe plus vaut « aucun » : jamais une sélection fantôme.
  const activeId = activeCandidate && seen.has(activeCandidate) ? activeCandidate : null
  // Le marqueur de semis se RELIT : sans lui, chaque démarrage resèmerait le catalogue et
  // ressusciterait les workflows livrés que l'utilisateur a supprimés.
  return { profiles, activeId, ...(parsed.seeded === true ? { seeded: true } : {}) }
}

export function loadWorkflowProfiles(path = workflowProfilesPath()): WorkflowProfilesFile {
  try {
    return readDurableJson(path, decodeWorkflowProfiles) ?? { ...EMPTY }
  } catch {
    // Un réglage de confort corrompu ne doit pas empêcher le démarrage. Une version valide précédente
    // a déjà été tentée par readDurableJson ; sans elle, on repart d'un catalogue vide explicite.
    return { ...EMPTY }
  }
}

/** Écrit les profils de façon atomique. Toute erreur remonte avant l'application runtime. */
export function saveWorkflowProfiles(
  file: WorkflowProfilesFile,
  path = workflowProfilesPath()
): void {
  writeDurableJson(path, file, decodeWorkflowProfiles)
}

/** Ajoute ou remplace un profil, en conservant la sélection courante quand elle reste valide. */
export function upsertWorkflowProfile(
  file: WorkflowProfilesFile,
  profile: WorkflowProfile
): WorkflowProfilesFile {
  const normalized = normalizeProfile(profile)
  if (!normalized) return file
  const profiles = file.profiles.some((candidate) => candidate.id === normalized.id)
    ? file.profiles.map((candidate) => (candidate.id === normalized.id ? normalized : candidate))
    : [...file.profiles, normalized]
  return { ...file, profiles, activeId: file.activeId }
}

/** Supprime un profil. Supprimer celui qui est SÉLECTIONNÉ remet la sélection à « aucun ». */
export function removeWorkflowProfile(
  file: WorkflowProfilesFile,
  id: string
): WorkflowProfilesFile {
  const profiles = file.profiles.filter((profile) => profile.id !== id)
  // `...file` : sans lui, supprimer un profil effaçait le marqueur de semis — et le catalogue
  // entier revenait au démarrage suivant, y compris ce qu'on venait de supprimer.
  return { ...file, profiles, activeId: file.activeId === id ? null : file.activeId }
}

/** Sélectionne un profil. Un identifiant inconnu vaut « aucun » plutôt qu'une sélection invalide. */
export function selectWorkflowProfile(
  file: WorkflowProfilesFile,
  id: string | null
): WorkflowProfilesFile {
  if (id === null) return { ...file, activeId: null }
  return { ...file, activeId: file.profiles.some((profile) => profile.id === id) ? id : null }
}

/**
 * Ce qui empêche un profil de tourner, en clair. Liste vide = jouable.
 *
 * Un profil SANS topologie n'a aucun défaut : il n'exprime que des écarts (modèles, consignes) et le
 * régime décide des phases. Le défaut visé ici est l'autre cas — une topologie DÉCLARÉE mais morte.
 */
export function workflowProfileIssues(profile: WorkflowProfile): string[] {
  const graph = graphOf(profile)
  if (!graph) return []
  if (!graph.nodes.length) return ['workflow vide : aucune phase à jouer']
  return graphDefects(graph).map((defect) => defect.message)
}

/**
 * Le profil sélectionné REFUSÉ, s'il l'est — avec de quoi le dire à l'utilisateur.
 *
 * `activeId` n'était revérifié que sur l'EXISTENCE de l'id : un workflow imposé au chat puis cassé
 * par une édition restait porté au moteur, et le prompt suivant partait sur un graphe injouable.
 */
export function activeWorkflowRefusal(
  file: WorkflowProfilesFile
): { profile: WorkflowProfile; issues: string[]; message: string } | undefined {
  const selected = file.profiles.find((profile) => profile.id === file.activeId)
  if (!selected) return undefined
  const issues = workflowProfileIssues(selected)
  if (!issues.length) return undefined
  return {
    profile: selected,
    issues,
    message: `Workflow « ${selected.name} » imposé au chat mais non exécutable : ${issues.join(' ; ')}. Il ne sera pas joué — corrige-le ou désélectionne-le.`
  }
}

/**
 * Boîte aux lettres mono-consommation du refus actif.
 *
 * L'application applique le profil persistant AVANT de créer sa fenêtre. Un simple événement live
 * est donc perdu au démarrage ; cette boîte conserve le message jusqu'au premier Chat monté.
 */
export class WorkflowRefusalMailbox {
  private pending: { id: number; text: string } | null = null
  private sequence = 0

  update(file: WorkflowProfilesFile): ReturnType<typeof activeWorkflowRefusal> {
    const refusal = activeWorkflowRefusal(file)
    this.pending = refusal ? { id: ++this.sequence, text: refusal.message } : null
    return refusal
  }

  peek(): { id: number; text: string } | null {
    return this.pending ? { ...this.pending } : null
  }

  acknowledge(id: number): boolean {
    if (this.pending?.id !== id) return false
    this.pending = null
    return true
  }
}

/**
 * Le profil sélectionné, ou `undefined` — auquel cas la configuration courante s'applique. Un profil
 * sélectionné mais INEXÉCUTABLE vaut `undefined` : mieux vaut le régime courant qu'un graphe mort.
 */
export function activeWorkflowProfile(file: WorkflowProfilesFile): WorkflowProfile | undefined {
  const selected = file.profiles.find((profile) => profile.id === file.activeId)
  if (!selected) return undefined
  return workflowProfileIssues(selected).length ? undefined : selected
}
