import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTCOME_LEARNING_SCHEMA, type OutcomeLearningEventV1 } from '../../shared/run-learning'
import { OutcomeLearningLedger } from './outcome-learning-ledger'

const proposal = (eventId = 'proposal-1'): OutcomeLearningEventV1 => ({
  kind: 'proposal',
  value: {
    schema: OUTCOME_LEARNING_SCHEMA,
    eventId,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    createdAt: '2026-08-11T10:00:00.000Z',
    outcome: 'success',
    title: 'Leçon',
    body: 'Corps autoporté',
    type: 'lesson',
    scope: 'autowin-os',
    source: 'session:turn-1',
    tags: [],
    confidence: 'high',
    candidateId: 'inbox/a.md',
    stored: true,
    truncated: false
  }
})

function path(): string {
  return join(mkdtempSync(join(tmpdir(), 'autowin-learning-ledger-')), 'events.jsonl')
}

describe('OutcomeLearningLedger', () => {
  it('persiste et relit les événements dans leur ordre exact', () => {
    const ledger = new OutcomeLearningLedger(path())
    expect(ledger.append(proposal('a'))).toBe(true)
    expect(ledger.append(proposal('b'))).toBe(true)
    expect(ledger.read()).toEqual({
      events: [proposal('a'), proposal('b')],
      truncatedTail: false,
      // Champ ajoute avec la tolerance par ligne. On COMPLETE l'attente au lieu de passer en
      // `toMatchObject` : l'egalite stricte est la bonne exigence, et la relacher masquerait tout
      // champ futur ajoute par erreur.
      ecartees: 0
    })
  })

  it('rend un doublon neutre, même depuis une seconde instance', () => {
    const file = path()
    expect(new OutcomeLearningLedger(file).append(proposal('same'))).toBe(true)
    expect(new OutcomeLearningLedger(file).append(proposal('same'))).toBe(false)
    expect(new OutcomeLearningLedger(file).read().events).toHaveLength(1)
  })

  it('réserve atomiquement un tour entre deux instances avant le dépôt Brain', () => {
    const file = path()
    const first = new OutcomeLearningLedger(file)
    const second = new OutcomeLearningLedger(file)
    const release = first.reserveProposalTurn('conv-1', 'turn-1')
    expect(release).toBeTypeOf('function')
    expect(second.reserveProposalTurn('conv-1', 'turn-1')).toBeUndefined()
    first.append(proposal())
    release?.()
    expect(second.reserveProposalTurn('conv-1', 'turn-1')).toBeUndefined()
  })

  it('récupère un verrou orphelin après expiration de sa lease', () => {
    const file = path()
    const key = createHash('sha256').update('conv-1\0turn-1').digest('hex')
    writeFileSync(
      `${file}.${key}.proposal.lock`,
      JSON.stringify({ pid: 999_999, createdAtMs: Date.now() - 120_000 }),
      'utf8'
    )
    const release = new OutcomeLearningLedger(file).reserveProposalTurn('conv-1', 'turn-1')
    expect(release).toBeTypeOf('function')
    release?.()
  })

  it('ignore seulement une queue tronquée après crash', () => {
    const file = path()
    const ledger = new OutcomeLearningLedger(file)
    ledger.append(proposal('safe'))
    appendFileSync(file, '{"kind":"proposal"', 'utf8')
    expect(ledger.read()).toEqual({ events: [proposal('safe')], truncatedTail: true, ecartees: 0 })
  })

  it('échoue fermé sur une ligne corrompue au milieu du journal', () => {
    const file = path()
    appendFileSync(
      file,
      `${JSON.stringify(proposal('a'))}\nnot-json\n${JSON.stringify(proposal('b'))}\n`
    )
    expect(() => new OutcomeLearningLedger(file).read()).toThrow(/ligne 2/i)
  })

  /*
   * LE DEFAUT, meme classe que celui vecu le 2026-08-24 sur le journal des conversations : une
   * seule ligne refusee POUR SA FORME faisait echouer tout le chargement. Cout dispropportionne --
   * un evenement contre le registre entier, donc contre toute la fonction d'apprentissage.
   *
   * LA COUPURE est celle deja eprouvee ailleurs, et ce n'est PAS un desserrage : un JSON ILLISIBLE
   * reste fatal (le test « echoue ferme » juste au-dessus le verrouille, il ecrit `not-json`), parce
   * qu'on ne sait pas ce qu'on perd. Une forme REFUSEE, elle, est identifiee ligne par ligne : on
   * l'ecarte, on la compte, on la journalise, et on charge le reste.
   *
   * DIFFERENCE ASSUMEE avec les conversations : la-bas une ligne ecartee est une conversation
   * perdue, VISIBLE. Ici c'est un apprentissage biaise, INVISIBLE. D'ou le compte rendu dans
   * `read()` plutot qu'un simple `console.warn` -- la degradation doit etre representable, pas
   * seulement tracee.
   */
  it('ecarte une ligne de FORME refusee au lieu de perdre tout le registre', () => {
    const file = path()
    appendFileSync(
      file,
      `${JSON.stringify(proposal('a'))}
${JSON.stringify({ kind: 'proposal', value: { pas: 'la bonne forme' } })}
${JSON.stringify(proposal('b'))}
`
    )

    const relu = new OutcomeLearningLedger(file).read()

    expect(relu.events.map((e) => e.value.eventId)).toEqual(['a', 'b'])
  })

  it('COMPTE les lignes ecartees, pour que la degradation soit visible', () => {
    const file = path()
    appendFileSync(
      file,
      `${JSON.stringify(proposal('a'))}
${JSON.stringify({ kind: 'proposal', value: {} })}
`
    )

    expect(new OutcomeLearningLedger(file).read().ecartees).toBe(1)
  })

  it('ne compte RIEN quand le journal est sain', () => {
    // L'entree qui doit faire echouer un comptage bavard.
    const file = path()
    const ledger = new OutcomeLearningLedger(file)
    ledger.append(proposal('a'))

    expect(ledger.read().ecartees).toBe(0)
  })

  it('refuse une version future inconnue avant toute écriture', () => {
    const ledger = new OutcomeLearningLedger(path())
    const future = proposal() as unknown as { kind: 'proposal'; value: { schema: string } }
    future.value.schema = 'autowin.learning/v99'
    expect(() => ledger.append(future as OutcomeLearningEventV1)).toThrow(/schema/i)
    expect(ledger.read().events).toHaveLength(0)
  })
})
