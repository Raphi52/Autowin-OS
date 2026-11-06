import { randomUUID } from 'node:crypto'
import type { WorkflowProfile, WorkflowProfilesFile } from './workflow-profiles'
import { sanitizeImportedProfile } from './workflow-profiles'

/**
 * Sortir un workflow de la machine, et en faire entrer un.
 *
 * Un workflow est une façon de travailler : elle se partage entre collègues, se versionne, se rejoue
 * ailleurs. Sans export elle reste prisonnière d'un `%APPDATA%` que personne ne va lire à la main.
 *
 * Règle cardinale de l'import : un fichier venu du dehors n'est JAMAIS cru. Il passe par le même
 * assainisseur que la relecture locale (`sanitizeImportedProfile`) — un second validateur finirait
 * par diverger, et c'est dans cet écart qu'un profil refusé au chargement passerait à l'import.
 */

/** Ce qu'on écrit sur le disque. Versionné : un format qui change doit pouvoir se reconnaître. */
export interface WorkflowExport {
  kind: 'autowin-workflows'
  version: 1
  exportedAt: string
  profiles: WorkflowProfile[]
}

export function buildExport(profiles: WorkflowProfile[], now: string): WorkflowExport {
  return { kind: 'autowin-workflows', version: 1, exportedAt: now, profiles }
}

/** Nom de fichier proposé. Sans caractère interdit sous Windows, sinon la boîte de dialogue refuse. */
export function suggestedFileName(profile?: WorkflowProfile): string {
  const base = profile?.name?.trim() || 'workflows'
  return `${base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)}.autowin-workflow.json`
}

export interface ImportOutcome {
  profiles: WorkflowProfile[]
  /** Ce qui a été écarté, et pourquoi — un import silencieux qui perd la moitié du fichier ment. */
  rejected: string[]
}

/**
 * Lit un contenu exporté et rend les profils RETENUS.
 *
 * Les identifiants sont RÉ-ATTRIBUÉS quand ils entrent en collision avec un profil déjà présent :
 * écraser en silence le workflow d'à côté parce qu'il porte le même id serait la pire des surprises.
 * Le nom, lui, est conservé et suffixé — c'est ce que l'utilisateur lit.
 */
export function readImport(raw: unknown, existants: WorkflowProfile[]): ImportOutcome {
  const rejected: string[] = []
  const candidats = extraireCandidats(raw, rejected)
  const idsPris = new Set(existants.map((p) => p.id))
  const nomsPris = new Set(existants.map((p) => p.name))
  const profiles: WorkflowProfile[] = []

  for (const candidat of candidats) {
    const propre = sanitizeImportedProfile(candidat)
    if (!propre) {
      rejected.push(descriptionCourte(candidat))
      continue
    }
    let { id, name } = propre
    if (idsPris.has(id)) id = `${id}-${randomUUID().slice(0, 8)}`
    if (nomsPris.has(name)) {
      let rang = 2
      while (nomsPris.has(`${name} (${rang})`)) rang += 1
      name = `${name} (${rang})`
    }
    idsPris.add(id)
    nomsPris.add(name)
    profiles.push({ ...propre, id, name })
  }
  return { profiles, rejected }
}

function extraireCandidats(raw: unknown, rejected: string[]): unknown[] {
  // Trois formes acceptées : l'enveloppe d'export, un fichier de profils brut, ou un profil seul.
  // Refuser les deux dernières obligerait à bricoler le JSON à la main pour partager UN workflow.
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const objet = raw as Partial<WorkflowExport> & Partial<WorkflowProfilesFile>
    if (Array.isArray(objet.profiles)) return objet.profiles
    return [raw]
  }
  rejected.push('contenu illisible')
  return []
}

function descriptionCourte(candidat: unknown): string {
  if (candidat && typeof candidat === 'object') {
    const nom = (candidat as { name?: unknown }).name
    if (typeof nom === 'string' && nom.trim()) return nom.trim()
    const id = (candidat as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return 'entrée sans nom ni identifiant'
}
