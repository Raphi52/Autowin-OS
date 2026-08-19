import { describe, expect, it } from 'vitest'
import { bilanDuTour, formaterBilan } from './bilan-tour'

/**
 * UN TOUR ARRETE DOIT DIRE CE QU'IL A DEJA FAIT.
 *
 * Vécu le 2026-08-19 : l'application a livré un correctif de production en DEUX commits fusionnés
 * dans `main`, puis son tour a été coupé. À l'écran, l'utilisateur n'a lu que « ⚠️ Le tour a échoué —
 * budget duree depasse (2700000 ms) ». Rien sur le travail livré. Verdict de l'utilisateur, et il a
 * raison : « si j'ai pas de compte rendu de ce qui s'est passé je considère ça comme un échec total ».
 *
 * Le travail était pourtant SOUS LES YEUX du rendu : les actions du tour vivent dans le même message
 * que l'erreur. Il n'y avait rien à aller chercher, juste à le dire.
 */
const action = (
  name: string,
  ok: boolean | undefined,
  data?: unknown
): { kind: 'action'; name: string; ok?: boolean; data?: unknown } => ({
  kind: 'action',
  name,
  ...(ok === undefined ? {} : { ok }),
  ...(data === undefined ? {} : { data })
})

describe('bilanDuTour — ce qui a été accompli avant l’arrêt', () => {
  it('sépare ce qui a RÉUSSI de ce qui a échoué', () => {
    const bilan = bilanDuTour([
      { kind: 'text', text: 'je commence' } as never,
      action('edit_file', true, { path: 'src/main/activity/brain-trace-spool.ts' }),
      action('edit_file', true, { path: 'src/main/activity/brain-trace-spool.ts' }),
      action('verify', false, { command: 'npm run test:unit', exitCode: 1 }),
      { kind: 'error', cause: 'turn', message: 'budget duree depasse' } as never
    ])
    expect(bilan.reussies).toEqual([
      'edit_file src/main/activity/brain-trace-spool.ts',
      'edit_file src/main/activity/brain-trace-spool.ts'
    ])
    expect(bilan.echouees).toEqual(['verify npm run test:unit'])
  })

  it('n’invente rien quand le tour n’a rien fait', () => {
    const bilan = bilanDuTour([{ kind: 'error', cause: 'turn', message: 'coupé' } as never])
    expect(bilan.reussies).toEqual([])
    expect(bilan.echouees).toEqual([])
    expect(formaterBilan(bilan)).toBeUndefined()
  })

  it('une action SANS issue connue est comptée à part, jamais en réussite', () => {
    const bilan = bilanDuTour([action('edit_file', undefined, { path: 'src/a.ts' })])
    expect(bilan.reussies).toEqual([])
    expect(bilan.sansIssue).toBe(1)
  })

  it('le texte rendu dit le compte et nomme les actions', () => {
    const texte = formaterBilan(
      bilanDuTour([
        action('edit_file', true, { path: 'src/a.ts' }),
        action('verify', false, { command: 'npm test' })
      ])
    )
    expect(texte).toContain('1 réussie')
    expect(texte).toContain('edit_file src/a.ts')
    expect(texte).toContain('1 échouée')
  })

  it('borne la liste : un tour de cinquante actions reste lisible', () => {
    const parts = Array.from({ length: 50 }, (_, i) =>
      action('edit_file', true, { path: `src/f${i}.ts` })
    )
    const texte = formaterBilan(bilanDuTour(parts)) ?? ''
    expect(texte).toContain('50 réussies')
    expect(texte.split('·').length).toBeLessThan(12)
  })
})

/**
 * CABLAGE — un bilan que le bloc d'erreur ne recoit jamais ne dit rien a personne. C'est exactement
 * le « expose mais pas branche » que cette session passe a corriger.
 */
describe('câblage — le bloc d’erreur reçoit et affiche le bilan', () => {
  const source = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'ChatMessageRow.tsx'), 'utf8')
  }

  it('le bilan est calculé depuis les parts du MÊME message', () => {
    expect(source()).toContain('formaterBilan(bilanDuTour(message.parts))')
  })

  it('il est rendu, et repérable pour un test de vue', () => {
    const src = source()
    expect(src).toContain('data-testid="erreur-bilan"')
    expect(src).toContain('{bilan}')
  })

  it('il est déclaré dans les props, sinon React l’ignorerait en silence', () => {
    const src = source()
    const debut = src.indexOf('export function ChatErrorBlock({')
    const destructuration = src.slice(debut, src.indexOf('}: {', debut))
    expect(destructuration).toContain('bilan')
  })
})
