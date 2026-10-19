import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SEUIL_COUPE_SESSION_TOKENS, coupesParPoids, seuilCoupeSession } from './chat-session-poids'
import { loadConvActivity } from './activity/conv-activity'
import { persistChatUsageSettlement } from './activity/chat-usage-settlement'
import { TraceStore } from './activity/trace-store'

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

/*
 * LA COUPE NE S'EST JAMAIS DECLENCHEE. Mesure conv-338 (kaizen du 2026-10-19) : six tours sur la
 * MEME session CLI (b0b8264c), occupation 260 866 puis jusqu'a 582 617 tokens au dernier appel du
 * tour 8ce6230c-374c-4de3-9429-583a648e286c — 46 $ pour six tours, 10,18 $ pour passer un point en
 * bleu. Cause : la coupe ne lisait que `kind: 'chat'`, alors que le reglement d'usage ecrit
 * `kind: 'chat-usage'` depuis le 2026-08-04 ; sur le poste, 1 782 entrees `chat-usage` contre 7
 * `chat`, aucune avec une occupation. Les tests ci-dessus fabriquaient des `chat` a la main, donc
 * passaient. Celui-ci passe par le VRAI ecrivain : un renommage futur le fera rougir.
 */
describe('coupe de session par poids — lue sur le journal ecrit par le reglement d usage', () => {
  it('compte le franchissement d’une entrée écrite par persistChatUsageSettlement', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-coupe-poids-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))
    // Pas de rmSync : la trace s'ecrit encore a la fermeture (ENOTEMPTY) ; comme les tests voisins
    // du meme ecrivain, le dossier `autowin-*` est laisse au nettoyage global de la suite.
    {
      for (const [turnId, derniereEntree] of [
        ['tour-a', 120_000],
        ['8ce6230c-374c-4de3-9429-583a648e286c', 582_617]
      ] as const) {
        persistChatUsageSettlement({
          conversationId: 'conv-poids',
          turnId,
          usage: {
            quoteId: `quote-${turnId}`,
            startedCalls: 1,
            completedCalls: 1,
            failedCalls: 0,
            activeCalls: 0,
            inputTokens: derniereEntree,
            outputTokens: 10,
            cacheReadTokens: 0,
            totalTokens: derniereEntree + 10,
            freshTokens: derniereEntree + 10,
            knownCostUsd: 1,
            unpricedCalls: 0,
            unmeteredCalls: 0,
            tokenCoverage: 'complete'
          },
          provider: 'claude',
          model: 'claude-opus-5-5',
          label: 'met le bleu au lieu de jaune le dernier node du rail',
          derniereEntree,
          activityRoot,
          traceStore
        })
      }
      expect(coupesParPoids(loadConvActivity('conv-poids', activityRoot), 200_000)).toBe(1)
    }
  })
})
