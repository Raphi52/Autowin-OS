import { describe, expect, it } from 'vitest'
import { brainDepositTimeoutMs, rememberFact } from './brain-remember'

/**
 * LE DELAI D'ATTENTE DU DEPOT NE PEUT PAS ETRE FIGE A 2 s — conv-143, 2026-09-02.
 *
 * DEFAUT VECU : un depot legitime est ressorti « delai depasse (2000 ms) — etat du depot INCONNU »
 * alors que le serveur du Brain repondait ; l'ecriture passe par un partage reseau, donc une
 * seconde de plus suffit a la faire echouer. Pire, cet etat INCONNU marque durablement le fait dans
 * le journal local et BLOQUE tout nouvel essai jusqu'au redemarrage. Le plafond doit donc etre
 * genereux ET reglable sans toucher au code.
 */
describe('délai du dépôt Brain', () => {
  it('vaut 15 s par défaut', () => {
    expect(brainDepositTimeoutMs({} as NodeJS.ProcessEnv)).toBe(15_000)
  })

  it('se règle par AUTOWIN_BRAIN_TIMEOUT_MS', () => {
    expect(
      brainDepositTimeoutMs({ AUTOWIN_BRAIN_TIMEOUT_MS: '45000' } as NodeJS.ProcessEnv)
    ).toBe(45_000)
  })

  it('ignore une valeur inexploitable', () => {
    expect(brainDepositTimeoutMs({ AUTOWIN_BRAIN_TIMEOUT_MS: 'plus tard' } as NodeJS.ProcessEnv)).toBe(
      15_000
    )
    expect(brainDepositTimeoutMs({ AUTOWIN_BRAIN_TIMEOUT_MS: '-1' } as NodeJS.ProcessEnv)).toBe(15_000)
  })

  it('un dépôt sans délai explicite applique la valeur réglée, pas 2000 ms', async () => {
    const avant = process.env.AUTOWIN_BRAIN_TIMEOUT_MS
    process.env.AUTOWIN_BRAIN_TIMEOUT_MS = '60'
    try {
      const outcome = await rememberFact(
        {
          title: 'Un dépôt qui traîne doit citer le délai réglé',
          fact: 'Fait de banc pour mesurer le plafond effectif du dépôt au Brain, sans toucher au réseau réel.',
          type: 'lesson',
          scope: 'global',
          source: 'session:banc-delai'
        },
        {
          token: 'jeton-de-banc',
          deposited: new Map<string, string>(),
          fetchFn: ((_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              )
            })) as unknown as typeof fetch
        }
      )
      expect(outcome.stored).toBe(false)
      expect(outcome.unknown).toBe(true)
      expect(outcome.detail).toContain('60 ms')
    } finally {
      if (avant === undefined) delete process.env.AUTOWIN_BRAIN_TIMEOUT_MS
      else process.env.AUTOWIN_BRAIN_TIMEOUT_MS = avant
    }
  })
})
