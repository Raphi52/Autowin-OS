import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./ModelQuotaIndicator.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./ModelQuotaIndicator.css', import.meta.url), 'utf8')

describe('barre de quota cliquable', () => {
  it('rend une barre pilotée par le pourcentage restant, et plus aucune roue', () => {
    expect(component).toContain('model-quota-bar')
    expect(component).toContain('model-quota-bar-fill')
    expect(component).toContain("'--quota-fill': `${remaining ?? 0}%`")
    // La roue est SUPPRIMÉE : plus de SVG ni d'arc, ni dans le composant ni dans les styles.
    expect(component).not.toContain('model-quota-wheel')
    expect(component).not.toContain('pathLength')
    expect(component).not.toContain('--quota-angle')
    expect(styles).not.toContain('model-quota-wheel')
  })

  /**
   * REFERENCE RECALEE le 2026-09-04 : ces assertions decrivaient encore le premier degre
   * (#ef4444 / #f59e0b / #facc15), remplace depuis par le degrade A PALIERS demande par
   * l'utilisateur (commit e7e233b2, conv-240 : « le degrade passait au vert des 62 %, et une seule
   * teinte ambre servait d'orange ET de jaune »). Elles etaient donc ROUGES tout en protegeant une
   * version abandonnee : un garde-fou qui refuse la barre reelle ne garde plus rien. Les quatre
   * teintes et l'ORDRE restent verrouilles — seules les valeurs suivent le CSS servi.
   */
  it('garde le dégradé rouge → orange → jaune → vert dans ce sens, calé sur la barre entière', () => {
    // Paliers PLATS (deux arrets par teinte) : chaque couleur tient une plage lisible au lieu de
    // fondre dans la suivante. Retirer un palier ou reordonner les teintes fait echouer ceci.
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*linear-gradient\(\s*90deg,\s*#b8201a 0%,\s*#b8201a 12%,\s*#e0641e 30%,\s*#e0641e 42%,\s*#efc023 56%,\s*#efc023 68%,\s*#35d07f 86%,\s*#35d07f 100%\s*\);/s
    )
    // Le vert n'arrive qu'a 86 % : le defaut nomme en conv-240 etait un basculement au vert des
    // 62 %, qui faisait passer un quota entame pour sain.
    expect(styles).not.toMatch(/#35d07f (?:[0-7]\d|8[0-5])%/)
    // Le restant DÉCOUPE le dégradé au lieu de le compresser : à 10 % restant il ne reste que du
    // rouge, alors qu'une largeur portée par l'élément laisserait du vert au bord droit.
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*clip-path:\s*inset\(0 calc\(100% - var\(--quota-fill, 0%\)\) 0 0\);/s
    )
  })

  it('conserve les quatre états de couleur du nombre', () => {
    // Teintes SERVIES par la barre actuelle (cf. `.model-quota-trigger.is-*` dans le CSS).
    const stateColors = {
      healthy: '#35d07f',
      warning: '#f0a020',
      critical: '#b8201a',
      unknown: '#687782'
    }
    for (const [level, color] of Object.entries(stateColors)) {
      expect(styles).toMatch(
        new RegExp(`\\.model-quota-trigger\\.is-${level}\\s*{[^}]*--quota-color:\\s*${color};`, 's')
      )
    }
    expect(styles).toContain('--quota-color, #35d07f')
    expect(styles).toMatch(
      /\.model-quota-meter i\s*{[^}]*linear-gradient\(90deg,\s*#b8201a 0%,\s*#f0a020 45%,\s*#35d07f 100%\);/s
    )
  })

  it('conserve le popover existant, désormais ouvert par la barre', () => {
    expect(component).toContain('model-quota-popover')
    expect(component).toContain('Quotas fournisseurs')
  })
})
