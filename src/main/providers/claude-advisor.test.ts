import { describe, expect, it } from 'vitest'
import { advisorAccepte } from './claude-advisor'
import { appendClaudeSelectionArgs } from './claude'

/*
 * L'ADVISOR NE PART QUE SUR UN ACCORD QUE LE CLI ACCEPTE (conv-1083, 2026-10-22).
 *
 * Source copiée : https://code.claude.com/docs/en/advisor, « Choose an advisor model ». Hors table,
 * le CLI 2.1.308 tourne sans advisor (advisor classé sous le principal) ou s'arrête au lancement
 * (Haiku 4.5 advisor : code 1) — mesuré le 2026-10-22, conforme à la doc, `claude-advisor.ts`.
 * L'entrée qui ferait échouer ce banc si le contrôle était faux : principal `claude-opus-5-5` +
 * advisor `claude-sonnet-5-5` (un advisor moins fort que le principal).
 *
 * fix-ok: conv-1083 — pas un correctif à l'aveugle : fichier neuf, écrit rouge avant le code, puis
 * retouché en forme et en en-tête. Retouches de fond : cet en-tête, réécrit après MESURE sur le CLI
 * 2.1.308, puis corrigé (objection du contrôle final) pour ne plus étendre à tout accord refusé le
 * seul cas mesuré alors ; et le cas Haiku 4.5 advisor ajouté, celui qui ferait tomber le lancement.
 * Les assertions exigent toujours l'argv exact (`--advisor` présent ou absent).
 */
describe('advisorAccepte — table de la documentation Claude Code', () => {
  it('Sonnet 5.5 accepte Opus 5 ou plus, Fable, Sonnet 5.5 — refuse Opus 4.8', () => {
    expect(advisorAccepte('claude-sonnet-5-5', 'claude-opus-5-5').accepte).toBe(true)
    expect(advisorAccepte('claude-sonnet-5-5', 'claude-opus-5').accepte).toBe(true)
    expect(advisorAccepte('claude-sonnet-5-5', 'claude-fable-5').accepte).toBe(true)
    expect(advisorAccepte('claude-sonnet-5-5', 'claude-sonnet-5-5').accepte).toBe(true)
    expect(advisorAccepte('claude-sonnet-5-5', 'claude-opus-4-8').accepte).toBe(false)
  })

  it('Opus 5.5 refuse un advisor Sonnet (moins fort) et accepte Opus 5 ou plus', () => {
    const refus = advisorAccepte('claude-opus-5-5', 'claude-sonnet-5-5')
    expect(refus.accepte).toBe(false)
    expect(refus.raison).toMatch(/Opus 5\.5/)
    expect(advisorAccepte('claude-opus-5-5', 'claude-opus-5-5').accepte).toBe(true)
    expect(advisorAccepte('claude-opus-5', 'claude-fable-5-1').accepte).toBe(true)
  })

  it('Fable 5 n’accepte que Fable 5 ou 5.1 ; Fable 5.1 que Fable 5.1', () => {
    expect(advisorAccepte('claude-fable-5', 'claude-fable-5-1').accepte).toBe(true)
    expect(advisorAccepte('claude-fable-5', 'claude-fable-5').accepte).toBe(true)
    expect(advisorAccepte('claude-fable-5', 'claude-opus-5-5').accepte).toBe(false)
    expect(advisorAccepte('claude-fable-5-1', 'claude-fable-5').accepte).toBe(false)
  })

  it('Haiku 4.5 accepte un alias de famille non versionné ; Haiku 4.5 ne peut pas être advisor', () => {
    expect(advisorAccepte('claude-haiku-4-5-20251001', 'opus').accepte).toBe(true)
    expect(advisorAccepte('claude-sonnet-4-6', 'claude-haiku-4-5').accepte).toBe(false)
    expect(advisorAccepte('claude-sonnet-4-6', 'claude-haiku-5-5').accepte).toBe(true)
  })

  it('un alias dont la version décide (opus sous Sonnet 5.5) est refusé : sa version dépend du CLI', () => {
    expect(advisorAccepte('claude-sonnet-5-5', 'opus').accepte).toBe(false)
  })

  it('principal absent ou inconnu → refusé, jamais deviné', () => {
    expect(advisorAccepte(undefined, 'claude-opus-5-5').accepte).toBe(false)
    expect(advisorAccepte('gpt-5', 'claude-opus-5-5').accepte).toBe(false)
  })
})

describe('appendClaudeSelectionArgs — drapeau --advisor', () => {
  it('accord accepté → `--advisor <modèle>` part', () => {
    const args: string[] = []
    appendClaudeSelectionArgs(args, { model: 'claude-sonnet-5-5', advisorModel: 'claude-opus-5-5' })
    expect(args.slice(0, 4)).toEqual([
      '--model',
      'claude-sonnet-5-5',
      '--advisor',
      'claude-opus-5-5'
    ])
  })

  it('accord refusé (Opus 5.5 + Sonnet 5.5) → aucun `--advisor` envoyé', () => {
    const args: string[] = []
    appendClaudeSelectionArgs(args, { model: 'claude-opus-5-5', advisorModel: 'claude-sonnet-5-5' })
    expect(args).not.toContain('--advisor')
  })

  it('accord qui ferait tomber le lancement (Sonnet 5.5 + Haiku 4.5, code 1 mesuré) → pas de `--advisor`', () => {
    const args: string[] = []
    appendClaudeSelectionArgs(args, {
      model: 'claude-sonnet-5-5',
      advisorModel: 'claude-haiku-4-5'
    })
    // Le reste de l'argv (`--autocompact` pour Sonnet 5.5) ne dépend pas de l'advisor.
    expect(args.slice(0, 2)).toEqual(['--model', 'claude-sonnet-5-5'])
    expect(args).not.toContain('--advisor')
    expect(args).not.toContain('claude-haiku-4-5')
  })

  it('sans advisor demandé → argv inchangé', () => {
    const args: string[] = []
    appendClaudeSelectionArgs(args, { model: 'claude-sonnet-5-5' })
    expect(args).not.toContain('--advisor')
  })
})
