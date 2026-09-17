import { useEffect, useState } from 'react'

/**
 * L'inventaire des skills réellement installées, lu UNE fois au montage.
 *
 * Pourquoi un hook partagé : trois endroits en ont besoin (palette de briques, exécutabilité d'un
 * workflow, sonde d'Agent Studio). Deux lectures écrites à la main divergeraient, et une vue
 * accuserait « phase inconnue » ce que l'autre propose comme brique.
 *
 * `null` = appel EN VOL : un appelant ne conclut rien, c'est ce qui évite le faux positif
 * clignotant le temps d'un rendu. Une réponse — même vide — ou un canal absent/en échec donne `[]` :
 * l'inventaire est alors TRANCHÉ, et la validation retrouve exactement son comportement d'avant
 * plutôt que de rester muette pour toujours (ce qui blanchirait un workflow réellement cassé).
 */
export interface SkillInstallee {
  id: string
  description?: string
}

/**
 * L'inventaire COMPLET : id + description declaree dans le front-matter.
 *
 * `useSkillsInventory` n'en rend que les identifiants, ce qui suffit a l'executabilite et a la
 * palette de briques. La palette `/` du chat a besoin de la description : sans elle, chaque entree
 * s'affiche « Skill » et le menu n'aide plus a choisir. Meme lecture, meme source — une seule.
 */
export function useSkillsCatalog(): SkillInstallee[] | null {
  const [skills, setSkills] = useState<SkillInstallee[] | null>(null)
  const [revision, setRevision] = useState(0)
  /**
   * Relecture au RETOUR de focus. Defaut vecu le 2026-09-16 : une skill supprimee sur disque
   * restait proposee par la palette `/` jusqu'au redemarrage de l'app, parce que cet inventaire
   * n'etait lu qu'AU MONTAGE. Le disque est la verite ; le focus est le moment le moins cher ou
   * la reprendre (aucun sondage periodique, une lecture locale sans sous-processus).
   */
  useEffect(() => {
    const rafraichir = (): void => setRevision((n) => n + 1)
    window.addEventListener('focus', rafraichir)
    return () => window.removeEventListener('focus', rafraichir)
  }, [])
  useEffect(() => {
    let vivant = true
    void (async () => {
      try {
        const items = await window.api?.capabilityControls?.('skills')
        if (!vivant) return
        setSkills(
          Array.isArray(items)
            ? items
                .filter((item) => item.enabled !== false)
                .map((item) => ({ id: item.id, description: item.description }))
            : []
        )
      } catch {
        if (vivant) setSkills([])
      }
    })()
    return () => {
      vivant = false
    }
  }, [revision])
  return skills
}

/** Les seuls identifiants — ce dont l'executabilite et la palette de briques ont besoin. */
export function useSkillsInventory(): string[] | null {
  const catalogue = useSkillsCatalog()
  return catalogue ? catalogue.map((skill) => skill.id) : null
}
