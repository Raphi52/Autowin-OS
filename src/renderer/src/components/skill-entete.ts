import { skillNommeeEnTete } from '../../../shared/skill-nommee'
import type { SkillInstallee } from './useSkillsInventory'

/**
 * Bandeau de skill d'une bulle envoyee (draft G1, 2026-10-10) : un message qui commence par
 * `/<skill>` affiche le nom de la skill dans un bandeau en haut de la bulle, et le prefixe est
 * RETIRE du texte. Seule une skill INSTALLEE est reconnue : un `/truc` inconnu reste du texte
 * normal, pour ne pas faire croire qu'une skill a ete lancee.
 *
 * Depuis conv-988 (2026-10-16), le nom NU en tete (« draft des animations… ») porte le meme
 * bandeau : la regle vit dans `shared/skill-nommee.ts`, la meme que celle qui CHARGE la skill cote
 * main — le bandeau ne s'allume donc que sur un message dont la procedure est reellement chargee.
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
  const nommee = skillNommeeEnTete(
    contenu,
    skills.map((s) => s.id)
  )
  if (!nommee) return null
  const trouvee = skills.find((s) => s.id === nommee.skill)
  return {
    skill: nommee.skill,
    description: trouvee?.description?.trim() || undefined,
    reste: nommee.reste
  }
}
