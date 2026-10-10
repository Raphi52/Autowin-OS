import type { SkillInstallee } from './useSkillsInventory'

/**
 * Bandeau de skill d'une bulle envoyee (draft G1, 2026-10-10) : un message qui commence par
 * `/<skill>` affiche le nom de la skill dans un bandeau en haut de la bulle, et le prefixe est
 * RETIRE du texte. Seule une skill INSTALLEE est reconnue : un `/truc` inconnu reste du texte
 * normal, pour ne pas faire croire qu'une skill a ete lancee.
 */
export interface EnteteSkill {
  skill: string
  description?: string
  reste: string
}

export function decouperSkill(
  contenu: string,
  skills: readonly SkillInstallee[] | null | undefined
): EnteteSkill | null {
  if (!skills || skills.length === 0) return null
  const m = /^\s*\/([A-Za-z0-9][\w-]*)(?=\s|$)/.exec(contenu)
  if (!m) return null
  const nom = m[1].toLowerCase()
  const trouvee = skills.find((s) => s.id.toLowerCase() === nom)
  if (!trouvee) return null
  return {
    skill: trouvee.id,
    description: trouvee.description?.trim() || undefined,
    reste: contenu.slice(m[0].length).replace(/^\s+/, '')
  }
}
