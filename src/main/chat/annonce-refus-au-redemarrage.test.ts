import { describe, expect, it } from 'vitest'
import { annonceRefusAuFil, annonceRefusDuProjet, type FilDuRefus } from './annonce-commit-local'
import { phraseDuRefus, refusDePublication } from '../../shared/echec-publication'

const REFUS = refusDePublication({ status: 'skipped', reason: 'tests-rouges' })!

/** Un fil de test : `conv-1` existe et porte `messages` ; ce qui y est posé s'ajoute à la suite. */
function filFactice(messages: Array<{ role: string; content: string }> = []): FilDuRefus & {
  ecrits: Array<{ role: string; content: string }>
} {
  const ecrits: Array<{ role: string; content: string }> = []
  return {
    ecrits,
    get: (id) => (id === 'conv-1' ? { messages: [...messages, ...ecrits] } : undefined),
    append: (_id, m) => {
      ecrits.push(m)
    }
  }
}

describe('annonceRefusAuFil (publication reprise au démarrage)', () => {
  it('pose le refus dans le fil une seule fois : le rejeu suivant ne le répète pas', () => {
    const fil = filFactice()
    expect(annonceRefusAuFil(fil, 'conv-1', REFUS)).toBe(true)
    expect(annonceRefusAuFil(fil, 'conv-1', REFUS)).toBe(false)
    expect(fil.ecrits).toEqual([{ role: 'assistant', content: phraseDuRefus(REFUS) }])
  })

  it('un refus déjà présent dans le fil (posé avant le redémarrage) n’est pas doublé', () => {
    const fil = filFactice([{ role: 'assistant', content: phraseDuRefus(REFUS) }])
    expect(annonceRefusAuFil(fil, 'conv-1', REFUS)).toBe(false)
    expect(fil.ecrits).toEqual([])
  })

  it('une conversation disparue : rien n’est posé, et rien ne plante', () => {
    const fil = filFactice()
    expect(annonceRefusAuFil(fil, 'conv-absente', REFUS)).toBe(false)
    expect(fil.ecrits).toEqual([])
  })

  it('une réponse de run qui contient déjà la phrase (refus annoncé pendant la fusion) n’est pas redite', () => {
    const fil = filFactice([
      { role: 'user', content: 'lance le run' },
      {
        role: 'assistant',
        content: `Commit local créé, non poussé.\n\n${phraseDuRefus(REFUS)}`
      }
    ])
    expect(annonceRefusAuFil(fil, 'conv-1', REFUS)).toBe(false)
    expect(fil.ecrits).toEqual([])
  })

  it('un refus identique d’un tour précédent est posé de nouveau pour un nouveau tour', () => {
    const fil = filFactice([
      { role: 'user', content: 'premier message' },
      { role: 'assistant', content: phraseDuRefus(REFUS) },
      { role: 'user', content: 'deuxième message' }
    ])
    expect(annonceRefusAuFil(fil, 'conv-1', REFUS)).toBe(true)
    expect(fil.ecrits).toEqual([{ role: 'assistant', content: phraseDuRefus(REFUS) }])
  })
})

describe('annonceRefusDuProjet (rapport d’une publication : fin de run reprise, ou tour de chat)', () => {
  it('une porte qui refuse un tour : le refus va dans le fil de ce tour', () => {
    const fil = filFactice([{ role: 'user', content: 'modifie le fichier' }])
    expect(
      annonceRefusDuProjet(fil, 'conv-1', {
        status: 'skipped',
        reason: 'porte-refusee',
        detail: 'Publication refusée : conflit avec la base sur a.ts.'
      })
    ).toBe(true)
    expect(fil.ecrits[0]?.content).toContain('⛔ Envoi refusé')
  })

  it('une porte qui attend (fichier non commité ailleurs) n’est pas un refus : rien n’est posé', () => {
    const fil = filFactice()
    expect(
      annonceRefusDuProjet(fil, 'conv-1', { status: 'skipped', reason: 'porte-en-attente' })
    ).toBe(false)
    expect(fil.ecrits).toEqual([])
  })

  it('une publication poussée : rien n’est posé', () => {
    const fil = filFactice()
    expect(annonceRefusDuProjet(fil, 'conv-1', { status: 'pushed', branch: 'main' })).toBe(false)
    expect(fil.ecrits).toEqual([])
  })

  it('un envoi parti avec une réserve (contrôle non fait) : la réserve se dit une fois, sans être un refus', () => {
    const fil = filFactice()
    const projet = {
      status: 'pushed',
      branch: 'travail',
      files: 1,
      rejoue: { distantAvant: 'a', sha: 'b', brancheLocaleRattachee: true, controleNonFait: true }
    }
    expect(annonceRefusDuProjet(fil, 'conv-1', projet)).toBe(true)
    expect(annonceRefusDuProjet(fil, 'conv-1', projet)).toBe(false)
    expect(fil.ecrits).toHaveLength(1)
    expect(fil.ecrits[0]?.content).toContain('mal formé')
    expect(fil.ecrits[0]?.content.startsWith('⛔')).toBe(false)
  })
})
