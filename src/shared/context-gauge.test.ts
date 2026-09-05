import { describe, expect, it } from 'vitest'
import { contextGauge, CONTEXT_WINDOWS, doitCompacterAutomatiquement, COMPACT_REQUEST } from './context-gauge'

/**
 * LA JAUGE DE CONTEXTE — combien de la fenetre du modele ce fil occupe-t-il DEJA.
 *
 * Autowin mesurait finement ce que le contexte avait COUTE (cache-read, fresh, ledger, Observatory)
 * et ne disait nulle part ce qu'il PORTAIT. Un fil pouvait s'approcher de la saturation sans qu'un
 * seul ecran ne l'indique ; la seule reponse a la saturation etait une troncature brute des 40
 * derniers messages, muette (`chat-turn-messages.ts:62`).
 *
 * NUMERATEUR : `inputTokens` du DERNIER tour. C'est exactement ce que le modele vient de recevoir,
 * donc l'occupation reelle -- pas une somme des tours, qui compterait N fois le meme prefixe.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CES TESTS SI LA JAUGE MENT : un modele dont la fenetre n'est pas
 * connue doit rendre `undefined`, JAMAIS un pourcentage sur une taille supposee. Une jauge fausse
 * est pire qu'une jauge absente -- elle est crue.
 */
describe('jauge de contexte', () => {
  it('rend la part occupee de la fenetre du modele', () => {
    const jauge = contextGauge({ inputTokens: 100_000, model: 'claude-haiku-4-5' })
    expect(jauge?.limit).toBe(200_000)
    expect(jauge?.used).toBe(100_000)
    expect(jauge?.ratio).toBeCloseTo(0.5)
  })

  it('ne rend RIEN pour un modele dont la fenetre est inconnue', () => {
    // Pas de source citable pour ce modele : l'absence est la reponse honnete.
    expect(contextGauge({ inputTokens: 100_000, model: 'un-modele-jamais-vu' })).toBeUndefined()
    expect(contextGauge({ inputTokens: 100_000 })).toBeUndefined()
  })

  it('ne rend rien sans mesure d entree plutot qu une jauge a zero', () => {
    // Une jauge a 0 % se lit « le fil est vide », alors qu'on ne SAIT pas. Ce n'est pas pareil.
    expect(contextGauge({ model: 'claude-opus-5' })).toBeUndefined()
  })

  it('nomme trois paliers, pour que la couleur ne soit pas decidee dans la vue', () => {
    // Modele d'exemple : `haiku`, le SEUL de la famille Claude encore a 200 k. Opus et sonnet
    // portent 1 M depuis le 2026-03-13 — les prendre comme cobaye generique rendait leur valeur
    // impossible a changer sans casser des tests qui ne parlaient pas d'eux.
    expect(contextGauge({ inputTokens: 20_000, model: 'claude-haiku-4-5' })?.level).toBe('ok')
    expect(contextGauge({ inputTokens: 140_000, model: 'claude-haiku-4-5' })?.level).toBe('tendu')
    expect(contextGauge({ inputTokens: 190_000, model: 'claude-haiku-4-5' })?.level).toBe('critique')
  })

  it('borne a 1 un depassement plutot que d afficher 130 %', () => {
    const jauge = contextGauge({ inputTokens: 260_000, model: 'claude-haiku-4-5' })
    expect(jauge?.ratio).toBe(1)
    expect(jauge?.level).toBe('critique')
    // Le depassement reste LISIBLE : borner l'affichage ne doit pas effacer le fait.
    expect(jauge?.used).toBe(260_000)
  })

  it('distingue le contexte RELU du cache de ce qui a ete paye plein tarif', () => {
    const jauge = contextGauge({
      inputTokens: 100_000,
      cacheReadTokens: 90_000,
      model: 'claude-haiku-4-5'
    })
    expect(jauge?.cacheRead).toBe(90_000)
    expect(jauge?.fresh).toBe(10_000)
  })

  it('donne a CHAQUE provider servi sa vraie fenetre, pas celle d Anthropic', () => {
    // Les quatre providers de `main/models.ts` ont des fenetres qui vont de 200 k a 1 M.
    // Appliquer 200 k partout affichait « sature » a 20 % d'occupation reelle sur Gemini.
    // OPUS : 1 M, tranche par l'utilisateur (voir le commentaire de CONTEXT_WINDOWS). Cette ligne
    // est la garde qui empeche un futur passage de le rabaisser a 200 k « par coherence ».
    expect(contextGauge({ inputTokens: 10, model: 'claude-opus-5', provider: 'claude' })?.limit).toBe(1_000_000)
    expect(contextGauge({ inputTokens: 10, model: 'claude-haiku-4-5', provider: 'claude' })?.limit).toBe(200_000)
    expect(contextGauge({ inputTokens: 10, model: 'claude-sonnet-5', provider: 'claude' })?.limit).toBe(1_000_000)
    expect(contextGauge({ inputTokens: 10, model: 'claude-mythos-1', provider: 'claude' })?.limit).toBe(200_000)
    expect(contextGauge({ inputTokens: 10, model: 'gpt-5.6-sol', provider: 'codex' })?.limit).toBe(400_000)
    expect(contextGauge({ inputTokens: 10, model: 'gpt-5.4-mini', provider: 'codex' })?.limit).toBe(400_000)
    expect(
      contextGauge({ inputTokens: 10, model: 'Gemini 3.1 Pro (High)', provider: 'gemini' })?.limit
    ).toBe(1_000_000)
    expect(
      contextGauge({ inputTokens: 10, model: 'kimi-code/kimi-for-coding', provider: 'kimi' })?.limit
    ).toBe(256_000)
  })

  it('ne prete pas la fenetre d un provider a un autre', () => {
    // Un id `gemini-…` servi par un autre provider n'herite PAS de la fenetre de Google.
    expect(contextGauge({ inputTokens: 10, model: 'gemini-pro', provider: 'claude' })).toBeUndefined()
  })

  it('ne declare que des fenetres dont la source est citable', () => {
    for (const fenetre of CONTEXT_WINDOWS) {
      expect(fenetre.tokens).toBeGreaterThan(0)
      expect(fenetre.source.length).toBeGreaterThan(0)
    }
  })
})

describe('doitCompacterAutomatiquement', () => {
  const jauge = (ratio: number, model = 'haiku'): ReturnType<typeof contextGauge> =>
    contextGauge({ inputTokens: Math.round(200_000 * ratio), model, provider: 'claude' })

  it('declenche au palier critique', () => {
    expect(jauge(0.9)?.level).toBe('critique')
    expect(doitCompacterAutomatiquement(jauge(0.9), 'une demande quelconque')).toBe(true)
  })

  it('ne declenche ni a ok ni a tendu — la marge restante ne se gaspille pas', () => {
    expect(doitCompacterAutomatiquement(jauge(0.2), 'demande')).toBe(false)
    expect(doitCompacterAutomatiquement(jauge(0.7), 'demande')).toBe(false)
  })

  it('n agit pas sur une jauge absente : on ne sait pas, donc on ne fait rien', () => {
    expect(doitCompacterAutomatiquement(undefined, 'demande')).toBe(false)
  })

  it('ne relance PAS la compaction juste apres une compaction — pas de boucle', () => {
    expect(doitCompacterAutomatiquement(jauge(0.95), COMPACT_REQUEST)).toBe(false)
    expect(doitCompacterAutomatiquement(jauge(0.95), `  ${COMPACT_REQUEST}  `)).toBe(false)
  })
})
