import { describe, expect, it } from 'vitest'
import {
  BRAIN_QUERY_MAX_CHARS,
  BRAIN_RESULT_CAP,
  buildBrainOutcome,
  capBrainResult,
  decideBrainQuery
} from './brain-query-command'

describe('decideBrainQuery — bornage de la question', () => {
  it('accepte et normalise une question utilisable', () => {
    expect(decideBrainQuery('  Quelle   décision   sur le RAG ?  ')).toEqual({
      allowed: true,
      query: 'Quelle décision sur le RAG ?'
    })
  })

  it('refuse une question vide ou non textuelle', () => {
    for (const bad of ['', '   ', '\n\t', undefined, null, 42, {}]) {
      expect(decideBrainQuery(bad).allowed).toBe(false)
    }
  })

  it('TRONQUE une question demesuree au lieu de la refuser', () => {
    const decision = decideBrainQuery('x'.repeat(5_000))
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.query.length).toBe(BRAIN_QUERY_MAX_CHARS)
  })
})

describe('capBrainResult — le savoir n’inonde pas le tour', () => {
  it('laisse passer un résultat court', () => {
    expect(capBrainResult('  décision X actée  ')).toBe('décision X actée')
  })

  it('respecte le plafond, marqueur COMPRIS', () => {
    const capped = capBrainResult('y'.repeat(BRAIN_RESULT_CAP * 2))
    expect(capped.length).toBeLessThanOrEqual(BRAIN_RESULT_CAP)
    expect(capped).toContain('tronqué')
  })

  it('garde le DÉBUT (le retriever classe par pertinence)', () => {
    const capped = capBrainResult(`LE_PLUS_PERTINENT${'z'.repeat(BRAIN_RESULT_CAP * 2)}`)
    expect(capped.startsWith('LE_PLUS_PERTINENT')).toBe(true)
  })
})

describe('buildBrainOutcome — distingue « rien trouvé » d’une panne', () => {
  it('rend le savoir quand il y en a', () => {
    const outcome = buildBrainOutcome('ma question', 'la connaissance curée')
    expect(outcome).toMatchObject({ found: true, knowledge: 'la connaissance curée' })
    expect(outcome.note).toBeUndefined()
  })

  it('quand rien ne revient, INTERDIT de conclure au négatif', () => {
    // Le Brain absent et le Brain qui ne sait rien rendent la meme chose (''). L'agent ne doit pas
    // transformer ce silence en « la reponse est non » — d'ou la note explicite.
    const outcome = buildBrainOutcome('ma question', '')
    expect(outcome.found).toBe(false)
    expect(outcome.note).toContain('ne pas conclure')
    expect(outcome.note).toContain('indisponible')
  })

  it('borne aussi le savoir rendu par le chemin complet', () => {
    const outcome = buildBrainOutcome('q', 'w'.repeat(BRAIN_RESULT_CAP * 3))
    expect(outcome.knowledge.length).toBeLessThanOrEqual(BRAIN_RESULT_CAP)
  })
})

/** Contrat de CABLAGE : une commande declaree mais jamais atteignable resterait du theatre. */
describe('cablage de brain_query', () => {
  const commands = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'commands.ts'), 'utf8')
  }

  it('est declaree au catalogue avec sa question, et annoncee en LECTURE SEULE', () => {
    const source = commands()
    const spec = source.slice(source.indexOf("name: 'brain_query'"), source.indexOf("name: 'brain_query'") + 600)
    expect(spec).toContain('question')
    expect(spec).toContain('readOnlyHint: true')
  })

  it('passe par la decision bornee et le retriever reel', () => {
    const source = commands()
    expect(source).toContain('decideBrainQuery(')
    expect(source).toContain('retrieveBrainContext(')
    expect(source).toContain('buildBrainOutcome(')
  })

  it('un refus n’appelle PAS le Brain', () => {
    const source = commands()
    const impl = source.slice(source.indexOf('private async runBrainQuery'))
    const refusal = impl.slice(0, impl.indexOf('retrieveBrainContext('))
    expect(refusal).toContain('if (!decision.allowed)')
    expect(refusal).not.toContain('await retrieveBrainContext')
  })
})
