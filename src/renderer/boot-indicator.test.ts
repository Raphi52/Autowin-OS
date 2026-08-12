import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * L'écran d'attente du démarrage vit dans `index.html`, en HTML STATIQUE.
 *
 * Pourquoi le tester ici plutôt que via un composant : tout ce qui passe par React arriverait APRÈS
 * le moment qu'il s'agit de couvrir. Mesuré au chronomètre sur deux lancements en mode dev, cache
 * chaud : la fenêtre n'existe qu'à 44 s et React ne monte qu'à 70 s — soit 26 secondes de fenêtre
 * BLANCHE, pendant lesquelles on relance l'application en croyant qu'elle n'a pas démarré.
 *
 * Ces tests verrouillent les quatre propriétés qui font que l'écran remplit son office. Chacune est
 * une façon dont il cesserait silencieusement de servir.
 */

const html = readFileSync(join(__dirname, 'index.html'), 'utf8')

describe('écran d’attente du démarrage', () => {
  it('existe, et porte un statut annoncé aux lecteurs d’écran', () => {
    expect(html).toContain('id="autowin-boot"')
    expect(html).toMatch(/role="status"/)
    expect(html).toMatch(/aria-live="polite"/)
  })

  it('vit DANS `#root`, pour que React l’efface tout seul', () => {
    // Placé à côté de `#root`, il resterait affiché PAR-DESSUS l'application, et il faudrait du code
    // de nettoyage — donc un endroit de plus où oublier de le retirer.
    const root = html.indexOf('<div id="root">')
    const boot = html.indexOf('id="autowin-boot"')
    const fermeture = html.indexOf('</div>', boot)
    expect(root).toBeGreaterThan(-1)
    expect(boot).toBeGreaterThan(root)
    expect(fermeture).toBeGreaterThan(boot)
  })

  it('n’a besoin d’AUCUN script : le bundle est justement ce qu’on attend', () => {
    // Un écran d'attente qui dépendrait du bundle n'apparaîtrait qu'une fois l'attente terminée.
    const bloc = html.slice(html.indexOf('id="autowin-boot"'))
    const jusquAuScript = bloc.slice(0, bloc.indexOf('<script'))
    expect(jusquAuScript).not.toContain('<script')
    expect(html.indexOf('id="autowin-boot"')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('reste une barre INDÉTERMINÉE, sans pourcentage inventé', () => {
    // La page ne peut pas connaître le temps restant : ce qui le saurait n'est pas encore chargé.
    // Un chiffre serait une invention, et une fausse précision est pire qu'aucune.
    expect(html).toContain('autowin-boot-slide')
    expect(html).not.toMatch(/\b\d{1,3}\s*%\s*<\/span>/)
    expect(html).toMatch(/prefers-reduced-motion/)
  })
})
