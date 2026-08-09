import { describe, expect, it } from 'vitest'
import {
  eventTurnId,
  humanEventPreview,
  lastUserMessagePreview,
  parseEventJson,
  splitLabeledJson,
  trustworthyRagTrigger
} from './observatory-event-preview'
import type { HarnessTimelineEvent } from './harness-timeline-model'

/**
 * Extraites d'`ObservatoryView.tsx` le 2026-08-07. Aucune ne dependait de React, et elles decident
 * pourtant de ce que l'utilisateur LIT d'un evenement : la logique la plus visible de la vue etait la
 * moins testable, puisqu'il fallait monter le DOM entier pour l'exercer.
 *
 * Ces tests sont ecrits APRES l'extraction et documentent le comportement EXISTANT — ils servent de
 * filet pour tout remaniement ulterieur, pas de specification d'un nouveau comportement.
 */

describe('splitLabeledJson', () => {
  it('separe un prefixe libelle du JSON qui suit', () => {
    expect(splitLabeledJson('ÉTAT: {"a":1}')).toEqual({ prefix: 'ÉTAT:', json: '{"a":1}' })
  })

  it('rend null quand ce qui suit n’est pas du JSON valide', () => {
    expect(splitLabeledJson('ÉTAT: {pas du json')).toBeNull()
  })

  it('rend null quand il n’y a aucune accolade', () => {
    expect(splitLabeledJson('texte simple')).toBeNull()
  })
})

describe('parseEventJson', () => {
  it('parse un objet JSON', () => {
    expect(parseEventJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('refuse un TABLEAU — seuls les objets portent des paires lisibles', () => {
    expect(parseEventJson('[1,2]')).toBeNull()
  })

  it('refuse du texte libre sans jeter', () => {
    expect(parseEventJson('bonjour')).toBeNull()
  })
})

describe('humanEventPreview — jamais de JSON brut a l’ecran', () => {
  it('rend un reessai lisible avec sa tentative', () => {
    const preview = humanEventPreview('retry', '{"attempt":2,"maxAttempts":3,"reason":"timeout"}')
    expect(preview).toContain('tentative 2 sur 3')
    expect(preview).toContain('timeout')
  })

  it('rend une annulation utilisateur en clair', () => {
    expect(humanEventPreview('cancellation', '{"reason":"user"}')).toContain('utilisateur')
  })

  it('rend les options de passage au provider', () => {
    const preview = humanEventPreview('boundary', '{"stream":true,"model":"claude-opus-5"}')
    expect(preview).toContain('streaming')
    expect(preview).toContain('claude-opus-5')
  })

  it('ne laisse JAMAIS passer du JSON brut : tout objet retombe en paires cle : valeur', () => {
    const preview = humanEventPreview('inconnu', '{"foo":"bar"}')
    expect(preview).toContain('foo : bar')
    expect(preview.trim().startsWith('{')).toBe(false)
  })

  it('borne la longueur demandee', () => {
    const preview = humanEventPreview('boundary', '{"model":"' + 'x'.repeat(300) + '"}', 40)
    expect(preview.length).toBeLessThanOrEqual(41)
  })
})

describe('lastUserMessagePreview', () => {
  it('prend le DERNIER message utilisateur, pas le premier', () => {
    const preview = lastUserMessagePreview([
      { role: 'user', content: 'ancien' },
      { role: 'assistant', content: 'réponse' },
      { role: 'user', content: 'récent' }
    ])
    expect(preview).toContain('récent')
  })

  it('rend une chaine vide sans message utilisateur', () => {
    expect(lastUserMessagePreview([{ role: 'assistant', content: 'x' }])).toBe('')
  })
})

describe('trustworthyRagTrigger — refuse ce qui n’est pas une action humaine', () => {
  it('accepte un declencheur humain court', () => {
    expect(trustworthyRagTrigger('parle-moi des factures')).toContain('factures')
  })

  it('refuse une enveloppe provider (JSON)', () => {
    expect(trustworthyRagTrigger('{"messages":[]}')).toBe('')
  })

  it('refuse un contenu portant une cle d’enveloppe, meme non JSON en tete', () => {
    expect(trustworthyRagTrigger('bla "instructions": "..."')).toBe('')
  })

  it('refuse un contenu trop long pour etre une action humaine', () => {
    expect(trustworthyRagTrigger('a'.repeat(600))).toBe('')
  })
})

describe('eventTurnId', () => {
  it('extrait le turnId du brut', () => {
    expect(eventTurnId({ raw: { turnId: 't1' } } as unknown as HarnessTimelineEvent)).toBe('t1')
  })

  it('rend une chaine vide quand le brut est absent ou mal forme', () => {
    expect(eventTurnId({} as HarnessTimelineEvent)).toBe('')
    expect(eventTurnId({ raw: 'texte' } as unknown as HarnessTimelineEvent)).toBe('')
  })
})
