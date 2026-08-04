import { describe, expect, it } from 'vitest'
import { consumeStreamedPrefix } from './agent-pilot'

/**
 * T1b — `consumeStreamedPrefix` est l'UNIQUE endroit qui reconstruit le texte final moins ce qui a
 * déjà été streamé (auparavant dupliqué à deux endroits de `chat()`, avec la même logique de
 * `startsWith`). Testé ici en isolation, à part du reste de `chat()`.
 */
describe('consumeStreamedPrefix', () => {
  it('renvoie tout le texte quand rien n’a encore été streamé', () => {
    expect(consumeStreamedPrefix('bonjour', '')).toEqual({ visible: 'bonjour', prefixRemaining: '' })
  })

  it('consomme le préfixe streamé quand le texte final le couvre entièrement', () => {
    expect(consumeStreamedPrefix('bonjour le monde', 'bonjour ')).toEqual({
      visible: 'le monde',
      prefixRemaining: ''
    })
  })

  it('réduit le préfixe restant quand le texte est plus court que ce qui a déjà été streamé', () => {
    expect(consumeStreamedPrefix('bon', 'bonjour ')).toEqual({
      visible: '',
      prefixRemaining: 'jour '
    })
  })

  it('n’émet rien si le préfixe streamé ne correspond plus au texte final (divergence)', () => {
    expect(consumeStreamedPrefix('autre chose', 'bonjour ')).toEqual({
      visible: '',
      prefixRemaining: ''
    })
  })
})

// T2 — garde de régression COMPILE-TIME : l'union `PilotEventVariant` doit rejeter un `command`
// sans `name`/`actionId` (le trou exact que l'ancienne interface fourre-tout laissait passer).
// Si quelqu'un élargit la variante par erreur, ce `@ts-expect-error` devient superflu et TSC
// signale la directive inutilisée — la garde se casse de façon VISIBLE, jamais silencieuse.
// @ts-expect-error command sans name/actionId : ne doit PAS compiler.
const _t2Probe: import('./agent-pilot').PilotEventVariant = { kind: 'command', args: {} }
void _t2Probe
