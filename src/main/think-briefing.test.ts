import { describe, expect, it } from 'vitest'
import {
  fichierCiteModifie,
  sansThinkPerime,
  sortieThinkAvecForme,
  titresBriefingManquants
} from './think-briefing'

/**
 * La garde de forme du briefing `think` (`think-briefing.ts`). Mesure du 2026-10-01 : 5 sorties
 * `think` sur 34 dans `run-state/` n'avaient pas les six titres de `skills/think/SKILL.md` §5.
 */
const COMPLET = [
  '## Localisation',
  '- src/main/orchestrator.ts:3643',
  '## Cartographie',
  'recordPhase lit SUITE.',
  '## Décisions',
  '- 2026-09-27 : pas de budget.',
  '## Constats',
  '- conv-1340 coupé.',
  '## Contraintes',
  '- filtre dans recordPhase.',
  '## Trous',
  '- Brain indisponible.'
].join('\n')

describe('garde de forme du briefing `think`', () => {
  it('laisse un briefing complet strictement inchangé', () => {
    expect(sortieThinkAvecForme(COMPLET)).toBe(COMPLET)
  })

  it('met un avertissement en TÊTE quand `## Trous` manque, et garde le texte entier', () => {
    const sansTrous = COMPLET.replace('## Trous\n- Brain indisponible.', '')
    const sortie = sortieThinkAvecForme(sansTrous)
    expect(sortie.startsWith('⚠️ Briefing `think` incomplet')).toBe(true)
    expect(sortie).toContain('`trous`')
    expect(sortie).not.toContain('`localisation`')
    expect(sortie.endsWith(sansTrous)).toBe(true)
  })

  it('reconnaît un SOP rendu à la place d’un briefing (cas mesuré)', () => {
    const sop = '## SOP\n1. lancer les tests\n\n## Besoin\nréparer'
    expect(titresBriefingManquants(sop)).toEqual([
      'localisation',
      'cartographie',
      'decisions',
      'constats',
      'contraintes',
      'trous'
    ])
  })

  it('accepte accents, casse, niveau de titre et précision après le titre', () => {
    const variante = COMPLET.replace('## Décisions', '### DECISIONS (options écartées)')
    expect(titresBriefingManquants(variante)).toEqual([])
  })

  it('ne compte pas un titre cité en prose', () => {
    const prose = COMPLET.replace('## Trous', 'Les trous :')
    expect(titresBriefingManquants(prose)).toEqual(['trous'])
  })

  it('est idempotente : appliquée deux fois, un seul avertissement', () => {
    const une = sortieThinkAvecForme('texte libre')
    expect(sortieThinkAvecForme(une)).toBe(une)
  })

  it('ne pose aucune ligne SUITE : elle ne relance rien', () => {
    expect(sortieThinkAvecForme('texte libre')).not.toMatch(/^\s*SUITE\s*:/imu)
  })
})

/**
 * UN BRIEFING REPRIS NE DOIT PAS POINTER DES LIGNES QUI ONT BOUGE.
 *
 * Objection du juge (run-85d8e7f57af2-1, reparation 2). Mesure conv-890 (2026-09-30) : entre le
 * `think` de `run-3180eec71b06-1` (10:36Z) et la relance (13:36Z), 4 commits d'autres fils ont touche
 * 27 fichiers. UN seul est cite par le briefing : `skill-routing.ts:130-152`, decale de 13 lignes par
 * `b6d2a3fc` (insertion a la ligne 76). Ses reperes etaient donc faux : le rejouer etait juste. Les
 * 26 autres ne le rendent pas perime, la ou « meme commit » strict le rejetterait pour chacun.
 * fix-ok: commentaire corrige apres mesure reelle (vite-node + git diff 5fb0730d..c7bac7b1).
 */
describe('reprise d’un briefing `think` : fichiers cites inchanges', () => {
  const BRIEFING = '## Localisation\n- `src/main/orchestrator.ts:3643`\n- `workflow-walk.ts:76`\n'

  it('rend le fichier cite qui a change, chemin complet ou nom seul', () => {
    expect(fichierCiteModifie(BRIEFING, ['src/main/index.ts', 'src/main/orchestrator.ts'])).toBe(
      'src/main/orchestrator.ts'
    )
    expect(fichierCiteModifie(BRIEFING, ['src/main/workflow-walk.ts'])).toBe(
      'src/main/workflow-walk.ts'
    )
  })

  it('ne rend rien quand aucun fichier cite n’a change', () => {
    expect(fichierCiteModifie(BRIEFING, ['src/main/brain-titres-du-tour.ts'])).toBeUndefined()
  })

  const acquis = [
    { phase: 'think', text: BRIEFING, codeSha: 'a'.repeat(40) },
    { phase: 'frame', text: '## Besoin' }
  ]

  it('garde `think` quand ses fichiers n’ont pas change depuis son commit', async () => {
    const lus: string[] = []
    const garde = await sansThinkPerime(acquis, async (sha) => {
      lus.push(sha)
      return ['src/main/brain-titres-du-tour.ts']
    })
    expect(garde.map((o) => o.phase)).toEqual(['think', 'frame'])
    expect(lus).toEqual(['a'.repeat(40)])
  })

  it('retire `think` quand un fichier cite a change, et garde le reste', async () => {
    const garde = await sansThinkPerime(acquis, async () => ['src/main/orchestrator.ts'])
    expect(garde.map((o) => o.phase)).toEqual(['frame'])
  })

  it('retire `think` quand on ne peut pas savoir ce qui a change', async () => {
    expect((await sansThinkPerime(acquis, async () => undefined)).map((o) => o.phase)).toEqual([
      'frame'
    ])
    const sansCommit = [{ phase: 'think', text: BRIEFING }]
    expect(await sansThinkPerime(sansCommit, async () => [])).toEqual([])
  })
})
