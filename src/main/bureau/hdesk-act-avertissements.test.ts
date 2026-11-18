/**
 * AVERTISSEMENT « clic + flèches d'un seul geste » de scripts/hdesk-act.ps1.
 *
 * Pourquoi : `hdesk-act.ps1 -X -Y -Touches "28,0D"` clique une liste déroulante, descend d'une ligne
 * et valide dans le MÊME geste : la liste s'ouvre et se referme avant la capture. Le 18/11/2026, une
 * liste de thèmes a été « testée » ainsi ; ses lignes (texte clair sur une liste blanche) étaient
 * illisibles, et c'est l'utilisateur qui l'a vu. Le geste doit donc dire, au moment même, que la
 * liste ouverte n'a pas été regardée — et se taire pour un clic seul, une frappe ou des touches
 * envoyées sans clic sur une liste déjà ouverte.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const module = join(__dirname, '..', '..', '..', 'scripts', 'hdesk-act-avertissements.ps1')

/** Rend la réponse de Test-ClicPuisNavigation pour ces touches, telle que hdesk-act.ps1 la lit. */
function navigue(touches: string, touche = ''): boolean {
  const commande =
    `. '${module.replace(/'/g, "''")}'; ` +
    `if (Test-ClicPuisNavigation -Touches '${touches}' -Touche '${touche}') { 'OUI' } else { 'NON' }`
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', commande], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  })
  expect(r.status, r.stderr).toBe(0)
  return r.stdout.trim() === 'OUI'
}

describe.skipIf(process.platform !== 'win32')(
  'hdesk-act : clic puis flèches d un seul geste',
  () => {
    it('reconnaît le geste qui a caché la liste des thèmes : -Touches "28,0D"', () => {
      expect(navigue('28,0D')).toBe(true)
    })

    it('reconnaît flèche haut répétée, page bas et les touches nommées Haut / Bas', () => {
      expect(navigue('26x3,0D')).toBe(true)
      expect(navigue('22')).toBe(true)
      expect(navigue('', 'Bas')).toBe(true)
      expect(navigue('', 'Haut')).toBe(true)
    })

    it('se tait sans flèche : rien, Entrée seule, Tab, Échap, raccourci Ctrl+A', () => {
      expect(navigue('')).toBe(false)
      expect(navigue('0D')).toBe(false)
      expect(navigue('', 'Tab')).toBe(false)
      expect(navigue('', 'Echap')).toBe(false)
      expect(navigue('', 'CtrlA')).toBe(false)
      expect(navigue('1B')).toBe(false)
    })

    it('hdesk-act.ps1 charge le module et n avertit que si le geste a CLIQUÉ', async () => {
      const { readFileSync } = await import('node:fs')
      const script = readFileSync(
        join(__dirname, '..', '..', '..', 'scripts', 'hdesk-act.ps1'),
        'utf8'
      )
      expect(script).toContain("hdesk-act-avertissements.ps1')")
      expect(script).toMatch(
        /if \(-not \$SansClic -and \(Test-ClicPuisNavigation -Touches \$Touches -Touche \$Touche\)\)/
      )
    })
  }
)
