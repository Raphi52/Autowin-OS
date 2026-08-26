import { describe, expect, it } from 'vitest'
import { circonstanceDePublication } from './commands'

/**
 * CE QUE CE TEST ATTRAPE, mesuré EN DIRECT le 2026-08-26 en pilotant l'app.
 *
 * Une édition d'un SEUL fichier (`HomeView.css`) a été refusée en `blocked / base-dirty`. Le message
 * rendu à l'agent portait la catégorie toute nue — « base-dirty » — sans dire QUELS fichiers
 * bloquaient ni À QUI ils appartenaient. L'agent a comblé le vide en devinant : il a annoncé que le
 * bureau contenait « 10 fichiers dont 9 sans rapport », a refusé de publier, et a posé quatre
 * questions à l'utilisateur. Vérifié après coup : le bureau n'apportait QU'UN fichier
 * (`git diff --name-only base...HEAD` → `HomeView.css`). Le travail était publiable ; le message a
 * fait croire l'inverse.
 *
 * La cause est une ligne : `motif || liste(finalized.files)`. Dès qu'une `reason` existe — c'est
 * TOUJOURS le cas sur `blocked` — le `||` court-circuite et la liste de fichiers, que le manager a
 * pourtant calculée, n'est jamais transmise.
 *
 * Ces fichiers sont ceux de la BASE, pas du bureau : le code le sait (« Les fichiers remontés
 * diagnostiquent la base », worktree-manager.ts), le message doit le dire.
 */
describe('circonstanceDePublication — un refus nomme ce qui bloque, et à qui il appartient', () => {
  it('nomme les fichiers de la BASE qui bloquent, au lieu de la seule catégorie', () => {
    const circonstance = circonstanceDePublication({
      outcome: 'blocked',
      reason: 'base-dirty',
      files: ['src/main/commands.ts', 'src/main/store/cause-git.ts']
    })

    expect(circonstance).toContain('base-dirty')
    expect(circonstance).toContain('src/main/commands.ts')
    expect(circonstance).toContain('src/main/store/cause-git.ts')
    // La PROVENANCE, sans laquelle l'agent lit cette liste comme le contenu du bureau.
    expect(circonstance).toMatch(/base/i)
  })

  it('garde la cause réelle quand elle existe — la catégorie seule fait rediagnostiquer', () => {
    const circonstance = circonstanceDePublication({
      outcome: 'blocked',
      reason: 'merge-failed',
      detail: "cannot create directory: Filename too long",
      files: ['src/renderer/src/components/HomeView.css']
    })

    expect(circonstance).toContain('merge-failed')
    expect(circonstance).toContain('Filename too long')
  })

  it('reste utilisable quand aucun fichier n’est remonté', () => {
    expect(circonstanceDePublication({ outcome: 'blocked', reason: 'base-in-progress' })).toContain(
      'base-in-progress'
    )
  })

  it('ne touche pas aux autres issues — conflit et branche gardent leur forme', () => {
    expect(circonstanceDePublication({ outcome: 'conflict', files: ['a.ts', 'b.ts'] })).toBe('a.ts, b.ts')
    expect(
      circonstanceDePublication({ outcome: 'preserve-et-libere', branche: 'autowin/recovery/run-1' })
    ).toBe('autowin/recovery/run-1')
  })
})
