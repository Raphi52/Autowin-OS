import { describe, expect, it } from 'vitest'
import { refusLancementGraphique } from './garde-lancement-graphique'

/**
 * conv-611 (saisie 2026-09-16T13:49:06.312Z, turnId 6856bcec-e943-424c-8e9f-25a19ea2881a) :
 * « mes travaux en parallele se parasitent car ils utilise pas mon systeme de bureau virtuel ».
 * Le garde refusait les applications tierces mais laissait ouvrir AUTOWIN lui-meme sur l'ecran reel.
 */
describe('lancer l application elle-meme hors du bureau cache', () => {
  it.each(['npm run dev', 'npm start', 'yarn dev', 'pnpm run dev', 'electron .', 'npx electron .'])(
    'refuse %s',
    (commande) => {
      const motif = refusLancementGraphique(commande)
      expect(motif).toBeTruthy()
      expect(motif).toContain('avec-instance-headless.mjs')
    }
  )

  it.each([
    'node scripts/avec-instance-headless.mjs -- npm run dev',
    'node scripts/ui-capture.mjs --view chat --out a.png',
    'npm run build',
    'npm test',
    'npm run typecheck',
    'echo "npm run dev"'.replace('echo', 'grep -n')
  ])('laisse passer %s', (commande) => {
    expect(refusLancementGraphique(commande)).toBeUndefined()
  })
})
