import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import type { Role } from './roles'

export type CapabilityKind = 'skills' | 'hooks' | 'tools'
export interface CapabilityProfile { id: string; name: string; description: string; selections: Record<CapabilityKind, Record<string, boolean>>; updatedAt: string }
export interface CapabilityProfileState { profiles: CapabilityProfile[]; assignments: Record<Role, string> }
const now = () => new Date().toISOString()
const defaults = (): CapabilityProfileState => ({
  profiles: [
    { id: 'lean', name: 'Lean', description: 'Contexte minimal, coût et surface d’action réduits.', selections: { skills: {}, hooks: {}, tools: {} }, updatedAt: now() },
    { id: 'balanced', name: 'Équilibré', description: 'Profil standard : toutes les capacités découvertes sont autorisées.', selections: { skills: {}, hooks: {}, tools: {} }, updatedAt: now() },
    { id: 'full', name: 'Complet', description: 'Profil d’exploration avec toutes les capacités autorisées.', selections: { skills: {}, hooks: {}, tools: {} }, updatedAt: now() }
  ], assignments: { orchestrator: 'balanced', subagent: 'balanced', judge: 'lean', scout: 'full' }
})
const profilePath = () => join(ensureAutowinAppData(), 'capability-profiles.json')
export function loadCapabilityProfiles(): CapabilityProfileState {
  try { const p = profilePath(); if (!existsSync(p)) return defaults(); const raw = JSON.parse(readFileSync(p, 'utf8')) as CapabilityProfileState; return Array.isArray(raw.profiles) && raw.assignments ? raw : defaults() } catch { return defaults() }
}
export function saveCapabilityProfiles(state: CapabilityProfileState): CapabilityProfileState {
  const p = profilePath(); mkdirSync(dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8'); renameSync(tmp, p); return state
}
/** Directive injectée dans les appels par rôle. Les réglages CLI externes restent inchangés. */
export function capabilityInstruction(profileId?: string): string {
  const profile = loadCapabilityProfiles().profiles.find((candidate) => candidate.id === profileId)
  if (!profile) return ''
  const denied = Object.entries(profile.selections).flatMap(([kind, selection]) =>
    Object.entries(selection).filter(([, enabled]) => !enabled).map(([id]) => `${kind}:${id}`)
  )
  return `\nProfil de capacités: ${profile.name}. ${denied.length ? `N'utilise pas: ${denied.join(', ')}.` : 'Utilise uniquement les capacités nécessaires.'}`
}
