import { describe, expect, it } from 'vitest'
import { dedupliquerDossier, paginerDossier, resumerAppelsOutils } from './retrospective-compacte'

const SYSTEME = 'CONSTITUTION '.repeat(80)

describe('dedupliquerDossier', () => {
  it('remplace une chaine identique par un renvoi au tour ou elle est apparue', () => {
    const sortie = dedupliquerDossier({
      turnEvents: [
        { turnId: 'a', payload: SYSTEME },
        { turnId: 'b', payload: SYSTEME }
      ]
    })
    expect(sortie.turnEvents[0].payload).toBe(SYSTEME)
    expect(sortie.turnEvents[1].payload).toBe('[identique a tour 1 (turnEvents[0].payload)]')
  })

  it('garde en clair ce qui differe apres un debut commun long', () => {
    const sortie = dedupliquerDossier({
      e: [
        { turnId: 'a', p: SYSTEME + 'question un' },
        { turnId: 'b', p: SYSTEME + 'question deux' }
      ]
    })
    expect(sortie.e[1].p).toMatch(/^\[\d+ premiers car\. identiques a tour 1 \(e\[0\]\.p\)\]/)
    expect(sortie.e[1].p.endsWith('deux')).toBe(true)
  })

  it('renvoie une reponse recopiee sous libelle vers le message deja lu', () => {
    const reponse = 'Plus cher, en general. '.repeat(30)
    const sortie = dedupliquerDossier({
      messages: [{ content: reponse }],
      causal: [{ turnId: 'x', payload: `model-response: ${reponse.slice(0, 400)}…[tronqué]` }]
    })
    expect(sortie.causal[0].payload).toBe('model-response: [identique a messages[0].content, 400 car.]')
  })

  it('laisse intactes les chaines courtes', () => {
    expect(dedupliquerDossier({ a: ['ok', 'ok'] })).toEqual({ a: ['ok', 'ok'] })
  })
})

describe('paginerDossier', () => {
  const texte = JSON.stringify({ x: 'a"b\\'.repeat(20_000) })

  it('rend des pages sous la taille, suite annoncee, et recompose le tout', () => {
    const premiere = paginerDossier(texte, 1)
    expect(premiere.pages).toBeGreaterThan(1)
    expect(premiere.note).toContain('page=2')
    let tout = ''
    for (let p = 1; p <= premiere.pages; p++) {
      const page = paginerDossier(texte, p)
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(20_000)
      tout += page.contenu
    }
    expect(tout).toBe(texte)
    expect(paginerDossier(texte, premiere.pages).note).toContain('fin du dossier')
  })

  it('ramene une page hors bornes a la plus proche', () => {
    expect(paginerDossier('{}', 0).page).toBe(1)
    expect(paginerDossier('{}', 99).page).toBe(1)
  })
})

describe('resumerAppelsOutils', () => {
  it('garde la commande entiere et le debut du resultat, en disant ce qui est coupe', () => {
    const commande = 'tool-call: git diff --stat ' + 'x'.repeat(500)
    const sortie = resumerAppelsOutils({
      causalEvents: [
        { type: 'tool-call', payload: `${commande} | tool-result: ${'r'.repeat(1000)}` },
        { type: 'model-response', payload: 'm'.repeat(1000) }
      ]
    })
    const [outil, reponse] = sortie.causalEvents
    expect(outil.payload.startsWith(`${commande} | tool-result: ${'r'.repeat(300)}…`)).toBe(true)
    expect(outil.payload).toContain('700 car. de plus')
    expect(reponse.payload).toBe('m'.repeat(1000))
  })

  it('laisse intact un resultat deja court', () => {
    const payload = 'tool-call: ls | tool-result: a.ts'
    expect(resumerAppelsOutils({ causalEvents: [{ type: 'tool-call', payload }] }).causalEvents[0].payload).toBe(payload)
  })
})
