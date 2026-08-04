import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { ALL_ROLES, type Role, type RoleBinding } from './roles'
import type { PipelinePhase } from './skill-pipeline'

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
  /** Phases imposées. Absent → le régime décide, comportement actuel. */
  phases?: PipelinePhase[]
  /** Largeurs voulues : membres de panel par phase, taille du jury, plafond de sous-tâches. */
  allocation?: {
    phaseMembers?: Partial<Record<PipelinePhase, number>>
    judgeMembers?: number
    maxGreedyNodes?: number
  }
  instructions?: WorkflowInstructions
}

export interface WorkflowProfilesFile {
  profiles: WorkflowProfile[]
  /** Profil sélectionné pour le prochain run. `null` = aucun, on garde la configuration courante. */
  activeId: string | null
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
    ...(allocation && Object.keys(allocation).length ? { allocation } : {}),
    ...(instructions ? { instructions } : {})
  }
}

/**
 * Relit les profils. Un fichier absent, corrompu ou partiellement invalide ne fait JAMAIS échouer :
 * on rend ce qui est lisible. Un réglage de confort ne doit pas empêcher l'app de démarrer.
 */
export function loadWorkflowProfiles(path = workflowProfilesPath()): WorkflowProfilesFile {
  if (!existsSync(path)) return { ...EMPTY }
  let parsed: unknown
  try {
    // Le BOM est retiré : sous Windows, presque tout ce qui écrit un fichier à la main en pose un.
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch {
    return { ...EMPTY }
  }
  if (!isPlainObject(parsed)) return { ...EMPTY }
  const profiles: WorkflowProfile[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(parsed.profiles) ? parsed.profiles : []) {
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
  return { profiles, activeId }
}

/** Écrit les profils. Best-effort : un disque en échec ne casse pas le réglage en cours. */
export function saveWorkflowProfiles(
  file: WorkflowProfilesFile,
  path = workflowProfilesPath()
): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(file, null, 2), 'utf8')
  } catch {
    /* le réglage vaut pour cette session ; il ne survivra pas — sans rien casser */
  }
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
  return { profiles, activeId: file.activeId }
}

/** Supprime un profil. Supprimer celui qui est SÉLECTIONNÉ remet la sélection à « aucun ». */
export function removeWorkflowProfile(
  file: WorkflowProfilesFile,
  id: string
): WorkflowProfilesFile {
  const profiles = file.profiles.filter((profile) => profile.id !== id)
  return { profiles, activeId: file.activeId === id ? null : file.activeId }
}

/** Sélectionne un profil. Un identifiant inconnu vaut « aucun » plutôt qu'une sélection invalide. */
export function selectWorkflowProfile(
  file: WorkflowProfilesFile,
  id: string | null
): WorkflowProfilesFile {
  if (id === null) return { ...file, activeId: null }
  return { ...file, activeId: file.profiles.some((profile) => profile.id === id) ? id : null }
}

/** Le profil sélectionné, ou `undefined` — auquel cas la configuration courante s'applique. */
export function activeWorkflowProfile(file: WorkflowProfilesFile): WorkflowProfile | undefined {
  return file.profiles.find((profile) => profile.id === file.activeId)
}
