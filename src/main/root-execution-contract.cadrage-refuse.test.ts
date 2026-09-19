import { describe, expect, it } from 'vitest'
import { etatDeCloture } from './root-execution-contract'
import { sortieFrameAvecCasLimites } from './frame-cas-limites'

/*
 * CAS REEL conv-687 (18/09) : « scout comment améliorer le gameplay ». Le run joue scout puis frame ;
 * la garde des cas limites REFUSE le cadrage (« ⛔ Cadrage incomplet … SUITE: frame »), et le run
 * s'affichait pourtant « succeeded ». Un cadrage refusé n'est pas un livrable validé.
 */
const TACHE = 'scout comment améliorer le gameplay'
const SCOUT = { phase: 'scout', text: '## Cible\nLigne 1 : un robot réactif.\n\nSUITE: frame' }
const FRAME_SANS_CAS = sortieFrameAvecCasLimites(
  '## Besoin\nLe robot réagit ; option `--sim` de build.py pour mesurer 8 parties.\n'
)

describe('un cadrage refusé par le contrôle des cas limites ferme le run en rouge', () => {
  it('le texte rejoué porte bien le refus (précondition)', () => {
    expect(FRAME_SANS_CAS).toMatch(/^⛔ Cadrage incomplet/u)
  })

  it('scout + frame refusé → rouge, avec la raison nommée', () => {
    const cloture = etatDeCloture(TACHE, [SCOUT, { phase: 'frame', text: FRAME_SANS_CAS }], true, false)
    expect(cloture.status).toBe('red')
    expect(cloture.dod.some((c) => !c.checked && /cas limites/i.test(c.label))).toBe(true)
  })

  it('cadrage refusé mais build prouvé APRÈS → la garde ne bloque pas (conv-710)', () => {
    const cloture = etatDeCloture(
      'Rends lisibles les commits des runs dans worktree-manager.ts',
      [
        { phase: 'frame', text: FRAME_SANS_CAS },
        { phase: 'build', text: 'Tests rouges puis verts.' },
        { phase: 'clean', text: 'ok' }
      ],
      true,
      false
    )
    expect(cloture.dod.some((c) => /cas limites/i.test(c.label))).toBe(false)
    expect(cloture.status).toBe('green')
  })

  it('un cadrage refusé PUIS refait correctement → vert', () => {
    const refait = {
      phase: 'frame',
      text: "## Besoin\nok\n### Cas limites d'entree\n- absente : refus\n- vide : refus\n- hors bornes : borne\n"
    }
    const cloture = etatDeCloture(
      TACHE,
      [SCOUT, { phase: 'frame', text: FRAME_SANS_CAS }, refait],
      true,
      false
    )
    expect(cloture.status).toBe('green')
  })
})
