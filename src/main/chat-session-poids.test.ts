import { describe, expect, it } from 'vitest'
import { SEUIL_COUPE_SESSION_TOKENS, coupesParPoids, seuilCoupeSession } from './chat-session-poids'

const tour = (derniereEntree: number, kind = 'chat'): { kind: string; derniereEntree: number } => ({
  kind,
  derniereEntree
})

describe('coupe de session par poids', () => {
  it('ne coupe rien tant que le fil reste sous le seuil', () => {
    expect(coupesParPoids([tour(10_000), tour(150_000)], 200_000)).toBe(0)
  })

  it('compte un franchissement quand un tour depasse le seuil', () => {
    // Le cas mesure conv-632 : 491 636 tokens d'entree pour 4 779 caracteres envoyes par Autowin.
    expect(coupesParPoids([tour(10_000), tour(491_636)], 200_000)).toBe(1)
  })

  it('ne recompte pas le meme depassement tour apres tour', () => {
    expect(coupesParPoids([tour(300_000), tour(400_000), tour(500_000)], 200_000)).toBe(1)
  })

  it('recompte apres un retour sous le seuil — la session a ete coupee entre-temps', () => {
    expect(coupesParPoids([tour(300_000), tour(12_000), tour(260_000)], 200_000)).toBe(2)
  })

  it('ignore les lignes qui ne sont pas des tours de chat et celles sans occupation', () => {
    expect(coupesParPoids([tour(900_000, 'exec'), { kind: 'chat' }], 200_000)).toBe(0)
  })

  it('un seuil nul desactive la coupe', () => {
    expect(coupesParPoids([tour(900_000)], 0)).toBe(0)
  })

  it('lit le seuil dans l environnement, et retombe sur le defaut si la valeur est absurde', () => {
    expect(seuilCoupeSession({ AUTOWIN_SESSION_RESET_TOKENS: '120000' } as NodeJS.ProcessEnv)).toBe(120_000)
    expect(seuilCoupeSession({ AUTOWIN_SESSION_RESET_TOKENS: 'beaucoup' } as NodeJS.ProcessEnv)).toBe(
      SEUIL_COUPE_SESSION_TOKENS
    )
    expect(seuilCoupeSession({} as NodeJS.ProcessEnv)).toBe(SEUIL_COUPE_SESSION_TOKENS)
  })
})
