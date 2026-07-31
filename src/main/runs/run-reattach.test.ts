import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentVerdict, resumeActionFor, runLiveness } from './run-reattach'

/**
 * Le risque le plus grave de la survie des runs : au redémarrage, l'app relançait le travail SANS
 * vérifier qu'un agent tournait encore. Deux agents sur la même copie s'écrasent l'un l'autre.
 */
describe('un agent est-il encore au travail ?', () => {
  const vivant = () => 'demarre-a-100|C:/cli.exe'

  it('processus disparu → terminé', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => undefined).state).toBe(
      'termine'
    )
  })

  it('même pid, même empreinte → vivant', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, vivant).state).toBe('vivant')
  })

  it('même pid, empreinte DIFFÉRENTE → pid recyclé, pas notre agent', () => {
    // Sans ce contrôle, un processus étranger ayant hérité du numéro ferait croire que l'agent
    // travaille encore — et le run ne reprendrait jamais.
    const verdict = agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => 'autre|X.exe')
    expect(verdict.state).toBe('pid-recycle')
  })

  it('sans pid connu → inconnu, on n’affirme rien', () => {
    expect(agentVerdict({ token: 't' }, vivant).state).toBe('inconnu')
  })

  it('sonde en échec → inconnu plutôt qu’un verdict inventé', () => {
    const verdict = agentVerdict({ token: 't', pid: 42 }, () => {
      throw new Error('sonde indisponible')
    })
    expect(verdict.state).toBe('inconnu')
  })

  it('pid vivant SANS empreinte capturée → on penche vers vivant', () => {
    // Relancer par-dessus un agent réel coûte plus cher qu'attendre : le doute profite à la prudence.
    expect(agentVerdict({ token: 't', pid: 42 }, vivant).state).toBe('vivant')
  })
})

describe('que faire du run au démarrage', () => {
  const mort = (): undefined => undefined
  const vivant = (): string => 'sig'

  it('un seul agent vivant suffit à INTERDIRE la relance', () => {
    const state = {
      agents: [
        { token: 'a', pid: 1, identity: 'sig' },
        { token: 'b', pid: 2, identity: 'autre' }
      ],
      phaseOutputs: []
    }
    const liveness = runLiveness(state, (pid) => (pid === 1 ? 'sig' : undefined))
    expect(liveness.working).toBe(true)
    expect(resumeActionFor(state, (pid) => (pid === 1 ? 'sig' : undefined))).toBe('rattacher')
  })

  it('tous les agents terminés → on relance, comportement historique', () => {
    const state = { agents: [{ token: 'a', pid: 1, identity: 'sig' }], phaseOutputs: [] }
    expect(resumeActionFor(state, mort)).toBe('relancer')
  })

  it('un run SANS agent connu se relance — rien ne prouve qu’il tourne', () => {
    expect(resumeActionFor({ agents: [], phaseOutputs: [] }, vivant)).toBe('relancer')
  })

  it('aucun run à reprendre → on ne fait rien', () => {
    expect(resumeActionFor(null, vivant)).toBe('ignorer')
  })
})

/**
 * CÂBLAGE. La logique de vivacité ne sert à rien si le démarrage ne la consulte pas — c'était
 * précisément le défaut : la reprise relançait sans jamais poser la question.
 */
describe('câblage — le démarrage consulte la garde avant de relancer', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('la reprise au démarrage passe par resumeActionFor', () => {
    expect(source).toContain('const reprise = resumeActionFor(resumableRun, defaultProcessIdentity)')
  })

  it('elle ne relance QUE si le verdict est « relancer »', () => {
    expect(source).toContain("if (resumableRun && reprise === 'relancer') {")
  })

  it('un agent encore au travail est SIGNALÉ, pas passé sous silence', () => {
    expect(source).toContain("un agent travaille ENCORE")
  })
})
