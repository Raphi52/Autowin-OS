import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideRemember, rememberFact } from './brain-remember'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * SE SOUVENIR — la seule régression mécanique face à claude.exe.
 *
 * claude.exe a une mémoire que le modèle ÉCRIT. Autowin avait coupé la LECTURE automatique des fiches
 * (552 Ko, ~9 200 tokens par appel) et la lecture à la demande existait déjà (`brain_query`) : restait
 * un trou d'ÉCRITURE, mesuré le 2026-07-29 — aucun chemin d'écriture dans tout `src/`, et zéro
 * occurrence de « mémoire » dans le prompt de pilotage.
 */
const FAIT_VALIDE = {
  title: 'Le CLI claude se résout via le préfixe npm',
  fact: "Sur Windows le PATH n'expose que des shims .cmd ; il faut résoudre le vrai claude.exe.",
  type: 'lesson',
  scope: 'autowin-os',
  source: 'file:src/main/providers/npm-global-resolve.ts'
}

describe('decideRemember — refuser TÔT, et en disant pourquoi', () => {
  it('un fait complet est accepté et normalisé', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, tags: ['cli', ' windows '] })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.type).toBe('lesson')
    expect(decision.tags).toEqual(['cli', 'windows'])
    expect(decision.confidence).toBe('medium')
  })

  it('un titre manquant est refusé — un fait sans titre est introuvable', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, title: '   ' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toContain('titre')
  })

  it('un fait vide est refusé', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, fact: '' })
    expect(decision.allowed).toBe(false)
  })

  it('un TYPE hors liste est refusé, et la liste est DITE', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, type: 'règle-de-comportement' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    // Le refus doit ENSEIGNER : l'agent ne peut pas deviner la liste fermée du serveur.
    expect(decision.reason).toContain('lesson')
    expect(decision.reason).toContain('decision')
  })

  it('une source NON traçable est refusée, avec les préfixes attendus', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, source: 'je me souviens' })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toContain('file:')
    expect(decision.reason).toContain('ticket:')
  })

  it('une portée manquante est refusée', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, scope: '' })
    expect(decision.allowed).toBe(false)
  })

  it('les quatre types du garde du Brain sont acceptés', () => {
    for (const type of ['lesson', 'decision', 'preference', 'domain']) {
      expect(decideRemember({ ...FAIT_VALIDE, type }).allowed).toBe(true)
    }
  })

  it('une confiance farfelue retombe sur « medium » au lieu d’échouer', () => {
    const decision = decideRemember({ ...FAIT_VALIDE, confidence: 'certain' })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.confidence).toBe('medium')
  })

  it('les tags sont plafonnés (une note n’est pas un nuage de mots)', () => {
    const decision = decideRemember({
      ...FAIT_VALIDE,
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`)
    })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.tags).toHaveLength(8)
  })
})

describe('rememberFact — ce qui est DÉPOSÉ, jamais « mémorisé »', () => {
  it('envoie le candidat sur /ingest avec le jeton', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, note: '2026-07-29-cli.md' }), { status: 200 })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(true)
    expect(outcome.note).toBe('2026-07-29-cli.md')
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(call[0])).toContain('/ingest')
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jeton' })
  })

  it('le compte-rendu dit CANDIDAT, la promotion humaine et la réindexation', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as
      unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.detail).toMatch(/candidat/i)
    expect(outcome.detail).toMatch(/humain/i)
    expect(outcome.detail).toMatch(/réindexation/i)
    // JAMAIS un « c'est memorise » qui ferait croire a une relecture immediate.
    expect(outcome.detail).not.toMatch(/mémorisé|je m'en souviendrai/i)
  })

  it('un REFUS du serveur est rendu tel quel, pas maquillé en succès', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'likely secret detected; candidate rejected' }), {
        status: 400
      })
    ) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('likely secret detected')
  })

  it('sans jeton, rien n’est écrit et c’est DIT', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: '', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('jeton')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('un Brain injoignable ne casse PAS le tour', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const outcome = await rememberFact(FAIT_VALIDE, { token: 'jeton', fetchFn })
    expect(outcome.stored).toBe(false)
    expect(outcome.detail).toContain('ECONNREFUSED')
  })

  it('un candidat invalide n’atteint JAMAIS le réseau', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const outcome = await rememberFact({ ...FAIT_VALIDE, source: 'de mémoire' }, {
      token: 'jeton',
      fetchFn
    })
    expect(outcome.allowed).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

/**
 * CÂBLAGE — une capacité que le modèle ne sait pas employer est une façade. C'est le défaut rencontré
 * trois fois le 2026-07-29 (le canal de coût sans appelant, la portée non appliquée à la voie à la
 * demande, l'argument `phase` sans mode d'emploi).
 */
describe('câblage — la commande existe et le prompt enseigne quand l’employer', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('la commande `remember` est au catalogue et dispatchée', () => {
    const source = read('commands.ts')
    expect(source).toContain("name: 'remember'")
    expect(source).toContain("case 'remember':")
    expect(source).toContain('rememberFact(a, {')
  })

  it('le prompt dit QUAND retenir et QUAND ne pas', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('`remember`')
    expect(prompt).toMatch(/durable/i)
    expect(prompt).toMatch(/Ne retiens PAS/)
    expect(prompt).toMatch(/r.gle de comportement/i)
  })

  it('le prompt annonce la MÉCANIQUE réelle, pas une mémoire immédiate', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/candidat/i)
    expect(prompt).toMatch(/r.indexation/i)
    expect(prompt).toMatch(/pas au tour suivant/i)
  })

  it('la LECTURE reste couverte par `brain_query` — pas de régression', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('brain_query')
    expect(read('commands.ts')).toContain("name: 'brain_query'")
  })
})
