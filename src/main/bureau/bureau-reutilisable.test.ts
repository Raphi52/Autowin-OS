import { describe, expect, it } from 'vitest'
import { cleDeBureau, decisionDeReutilisation } from './bureau-reutilisable'

/**
 * UN BUREAU PAR TÂCHE, PAS UN PAR TENTATIVE.
 *
 * DÉFAUT MESURÉ le 2026-08-25 : 10 bureaux (~50 Mo pièce) pour 10 tentatives d'UNE édition, tous
 * porteurs du même JSX non compilable. La source des résidus n'est pas l'échec, c'est qu'un échec
 * fabrique un objet neuf au lieu de reprendre le sien.
 *
 * La règle tranchée par l'utilisateur : réinitialiser, SAUF si le bureau porte du travail
 * qu'aucune tentative précédente sur cette cible n'explique.
 */
describe('cleDeBureau — deux tentatives de la même tâche retombent au même endroit', () => {
  it('rend la MÊME clé pour la même commande, cible et conversation', () => {
    const a = cleDeBureau('edit', 'conv-1404', 'src/renderer/src/components/WorkflowsPanel.tsx')
    const b = cleDeBureau('edit', 'conv-1404', 'src/renderer/src/components/WorkflowsPanel.tsx')

    expect(a).toBe(b)
    expect(a).toBeTruthy()
  })

  it('ignore la façon d’écrire le chemin — sinon deux écritures feraient deux bureaux', () => {
    const unix = cleDeBureau('edit', 'conv-1', 'src/main/Commands.ts')
    const windows = cleDeBureau('edit', 'conv-1', 'src\\main\\commands.ts')

    expect(unix).toBe(windows)
  })

  it('sépare deux cibles distinctes, et deux conversations distinctes', () => {
    const cibleA = cleDeBureau('edit', 'conv-1', 'src/a.ts')
    const cibleB = cleDeBureau('edit', 'conv-1', 'src/b.ts')
    const autreConv = cleDeBureau('edit', 'conv-2', 'src/a.ts')

    expect(cibleA).not.toBe(cibleB)
    expect(cibleA).not.toBe(autreConv)
  })

  it('sans cible, ne rend AUCUNE clé — deux tâches distinctes ne doivent pas collisionner', () => {
    expect(cleDeBureau('edit', 'conv-1', undefined)).toBeUndefined()
    expect(cleDeBureau('edit', 'conv-1', '   ')).toBeUndefined()
  })

  it('la clé reste un identifiant sûr, quel que soit le chemin reçu', () => {
    const cle = cleDeBureau('edit', 'conv/1..', 'src/../../etc/pass wd.ts')

    expect(cle).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('decisionDeReutilisation — réinitialiser, sauf si du travail est en jeu', () => {
  it('bureau vide : rien à perdre, on réinitialise', () => {
    expect(decisionDeReutilisation([], ['src/a.ts'])).toBe('reinitialiser')
  })

  it('ne contient que la cible de la tâche : c’est le brouillon de l’essai précédent', () => {
    // Le cas conv-1404 : 10 bureaux ne portant QUE WorkflowsPanel.tsx, non compilable.
    const decision = decisionDeReutilisation(
      ['src/renderer/src/components/WorkflowsPanel.tsx'],
      ['src/renderer/src/components/WorkflowsPanel.tsx']
    )

    expect(decision).toBe('reinitialiser')
  })

  it('porte UN fichier inattendu : on préserve tout — la contrainte HARD prime', () => {
    // Le cas `agent__run-979c3cefc4e3-1` : des tests neufs jamais publiés, à ne surtout pas détruire.
    const decision = decisionDeReutilisation(
      ['src/a.ts', 'src/main/runs/conv-runs.trace-thinking.test.ts'],
      ['src/a.ts']
    )

    expect(decision).toBe('preserver')
  })

  it('aucune cible connue : on préserve — on ne détruit jamais sur une base incertaine', () => {
    expect(decisionDeReutilisation(['src/a.ts'], [])).toBe('preserver')
  })

  it('compare les chemins sans se laisser piéger par la casse ni les séparateurs', () => {
    const decision = decisionDeReutilisation(['src\\Main\\Commands.ts'], ['src/main/commands.ts'])

    expect(decision).toBe('reinitialiser')
  })
})
