import { describe, expect, it } from 'vitest'
import type { ModelQuotaSnapshot } from '../../../shared/model-quotas'
import { summaryForProvider, summaryWindowId, windowIdLabel } from './ModelQuotaIndicator'

/**
 * Constate sur capture (2026-07-29, modele « GPT-5.4 · ChatGPT » selectionne) : la wheel resumait la
 * fenetre 5 h alors que sur ces offres c'est le quota HEBDOMADAIRE qui contraint reellement l'usage.
 * La wheel etait donc rassurante et sans rapport avec la limite reellement atteinte.
 */
const snapshot = (windows: Array<{ id: string; remainingPercent: number }>, provider: string):
  ModelQuotaSnapshot =>
  ({
    observedAt: '2026-07-29T13:00:00.000Z',
    summary: { remainingPercent: 99, status: 'healthy' },
    models: [
      {
        modelId: `${provider}/x`,
        model: 'x',
        label: 'X',
        provider,
        shared: true,
        status: 'available',
        source: 'test',
        observedAt: '2026-07-29T13:00:00.000Z',
        windows: windows.map((w) => ({ ...w, label: w.id, limitKnown: true }))
      }
    ]
  }) as unknown as ModelQuotaSnapshot

describe('fenetre resumee par la wheel', () => {
  // Reecrit : le libelle ne se derive plus du provider (c'etait la cause du mensonge d'affichage) mais
  // de l'ID de fenetre RETENU. On teste donc `windowIdLabel` sur des IDs.
  it('ChatGPT (codex) → 7 j, et NON la 5 h', () => {
    expect(summaryWindowId('codex')).toBe('seven-day')
    expect(windowIdLabel('seven-day')).toBe('7 j')
  })

  it('les autres providers gardent la 5 h (capacite immediate)', () => {
    for (const provider of ['claude', 'gemini', 'kimi', undefined]) {
      expect(summaryWindowId(provider)).toBe('five-hour')
    }
    expect(windowIdLabel('five-hour')).toBe('5 h')
  })

  it('sur ChatGPT, resume le 7 j meme quand la 5 h est PLUS BASSE', () => {
    // Le discriminant : avant le fix, le minimum de la 5 h (12 %) gagnait.
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 12 },
        { id: 'seven-day', remainingPercent: 64 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.remainingPercent).toBe(64)
  })

  it('sur Claude, resume toujours la 5 h meme quand le 7 j est plus bas', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 80 },
        { id: 'seven-day', remainingPercent: 5 }
      ],
      'claude'
    )
    expect(summaryForProvider(snap, 'claude')?.remainingPercent).toBe(80)
  })

  // Reecrit : le statut ne suit plus la seule fenetre RETENUE mais la plus SEVERE ; ici la 7 j a 4 %
  // reste la plus severe, donc le contrat observable est inchange.
  it('7 j bas → critique sur ChatGPT', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 100 },
        { id: 'seven-day', remainingPercent: 4 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.status).toBe('critical')
  })

  it('ChatGPT avec mesure ANCIENNE (stale) → wheel chiffree, pas grise', () => {
    // Discriminant du bug : le quota codex vient d'un fichier local, donc `stale` des qu'on
    // n'utilise pas la CLI. Avant le fix, `status === 'available'` seul → summary `unknown` (grise).
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 12 },
        { id: 'seven-day', remainingPercent: 41 }
      ],
      'codex'
    )
    snap.models[0].status = 'stale'
    const summary = summaryForProvider(snap, 'codex')
    expect(summary?.remainingPercent).toBe(41)
    expect(summary?.status).not.toBe('unknown')
  })

  it('ChatGPT sans mesure du tout (unavailable) → reste inconnu', () => {
    const snap = snapshot([{ id: 'seven-day', remainingPercent: 41 }], 'codex')
    snap.models[0].status = 'unavailable'
    expect(summaryForProvider(snap, 'codex')?.status).toBe('unknown')
  })

  it('ChatGPT sans fenetre 7 j exposee → repli sur ce qui est connu, pas de wheel vide', () => {
    const snap = snapshot([{ id: 'five-hour', remainingPercent: 37 }], 'codex')
    expect(summaryForProvider(snap, 'codex')?.remainingPercent).toBe(37)
  })

  // DEFAUT MAJEUR : au repli, le libelle affirmait « 7 j » en montrant le chiffre de la 5 h.
  // Declencheur : compte ChatGPT dont l'echantillon n'expose que `five-hour`.
  it('ChatGPT sans fenetre 7 j → le libelle dit 5 h et n’affirme JAMAIS « 7 j »', () => {
    const snap = snapshot([{ id: 'five-hour', remainingPercent: 37 }], 'codex')
    const summary = summaryForProvider(snap, 'codex')
    expect(summary?.remainingPercent).toBe(37)
    expect(summary?.windowLabel).toContain('5 h')
    expect(summary?.windowLabel).not.toContain('7 j')
    // Le repli doit rester VISIBLE, pas silencieux.
    expect(summary?.windowLabel).toMatch(/non expos/i)
  })

  it('ChatGPT avec la 7 j exposee → libelle « 7 j » tout court', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 90 },
        { id: 'seven-day', remainingPercent: 64 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.windowLabel).toBe('7 j')
  })

  // MINEUR 1 : la couleur ne doit pas rassurer alors que l'utilisateur est bloque pour les heures qui
  // viennent. La VALEUR reste le 7 j (voulu), le STATUT prend la fenetre la plus severe.
  it('ChatGPT 5 h a 2 % / 7 j a 70 % → valeur 70 mais statut critique', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 2 },
        { id: 'seven-day', remainingPercent: 70 }
      ],
      'codex'
    )
    const summary = summaryForProvider(snap, 'codex')
    expect(summary?.remainingPercent).toBe(70)
    expect(summary?.windowLabel).toBe('7 j')
    expect(summary?.status).toBe('critical')
    expect(summary?.statusWindowLabel).toBe('5 h')
  })

  it('aucune divergence de severite → pas de marqueur de fenetre parasite', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 88 },
        { id: 'seven-day', remainingPercent: 70 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.statusWindowLabel).toBeUndefined()
  })
})

/**
 * NON-REGRESSION contre une decision assumee. Le correctif « le statut suit la fenetre qui bloque
 * MAINTENANT » a d'abord agrege TOUTES les fenetres du provider — et rendait donc la wheel Claude
 * ROUGE sur un 7 j bas, alors que la capacite immediate etait intacte. C'est exactement ce que la
 * justification d'origine interdit (`summaryWindowId` : « un weekly plus bas ne doit pas alarmer sur
 * une capacite immediate disponible »). Le statut ne retient que la fenetre AFFICHEE et la 5 h.
 */
describe('statut de la wheel — un weekly bas n’alarme pas a tort', () => {
  it('Claude : 5 h saine + 7 j critique → la wheel reste saine', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 80 },
        { id: 'seven-day', remainingPercent: 4 }
      ],
      'claude'
    )
    const summary = summaryForProvider(snap, 'claude')
    expect(summary?.remainingPercent).toBe(80)
    expect(summary?.status).toBe('healthy')
  })

  it('ChatGPT : 7 j affiche + 5 h a 2 % → la couleur alerte quand meme', () => {
    // L'autre sens, qui doit rester acquis : la 5 h bloque MAINTENANT, elle dicte la couleur.
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 2 },
        { id: 'seven-day', remainingPercent: 70 }
      ],
      'codex'
    )
    const summary = summaryForProvider(snap, 'codex')
    expect(summary?.remainingPercent).toBe(70)
    expect(summary?.status).toBe('critical')
  })
})
