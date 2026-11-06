import { describe, expect, it } from 'vitest'
import { creerSuiviDesPublications, PLAFOND_PUBLICATION_MS } from './publications-en-vol'
import { sourceProcessPrincipal } from '../app/source-process-principal.test-helpers'

/**
 * LE REDÉMARRAGE ATTEND LA PUBLICATION D'UN TOUR FINI (maintenance du 2026-11-01, conv-1048).
 *
 * Vécu : le 31/10 à 23:33, puis le 01/11 à 07:25, la publication d'un tour fini a été coupée par un
 * redémarrage une minute plus tard. Ses fichiers sont restés non commités. Les deux chemins de
 * redémarrage doivent la voir : la relance au repos (`auRepos`) ET l'appel direct de `restart_app`
 * (`bus.conversationsEnVol`). Un correctif qui n'en couvrirait qu'un laisserait l'autre couper.
 */
describe('publications en vol', () => {
  it('une publication compte de son début à sa fin', () => {
    const suivi = creerSuiviDesPublications()
    const fin = suivi.debut('conv-1')
    expect(suivi.conversations()).toEqual(['conv-1'])
    fin()
    expect(suivi.conversations()).toEqual([])
  })

  it('deux publications du même fil : il reste occupé jusqu’à la seconde', () => {
    const suivi = creerSuiviDesPublications()
    const premiere = suivi.debut('conv-1')
    const seconde = suivi.debut('conv-1')
    expect(suivi.conversations()).toEqual(['conv-1'])
    premiere()
    expect(suivi.conversations()).toEqual(['conv-1'])
    seconde()
    expect(suivi.conversations()).toEqual([])
  })

  it('une publication bloquée n’interdit pas le redémarrage pour toujours', () => {
    let horloge = 1_000
    const suivi = creerSuiviDesPublications(() => horloge)
    suivi.debut('conv-1')
    horloge += PLAFOND_PUBLICATION_MS - 1
    expect(suivi.conversations()).toEqual(['conv-1'])
    horloge += 1
    expect(suivi.conversations()).toEqual([])
  })
})

describe('câblage dans le processus principal', () => {
  const source = sourceProcessPrincipal().replace(/\r\n/g, '\n')

  it('la relance au repos attend les publications', () => {
    const auRepos = source.slice(
      source.indexOf('auRepos: () =>'),
      source.indexOf('annoncer: (text)')
    )
    expect(auRepos).toContain('conversationsOccupees()')
    expect(source).toMatch(
      /const conversationsOccupees = [\s\S]{0,160}publicationsEnVol\.conversations\(\)/
    )
  })

  it('restart_app voit les mêmes publications', () => {
    expect(source).toContain('bus.conversationsEnVol = conversationsOccupees')
  })

  it('la publication du tour est comptée, et sa fin l’est quoi qu’il arrive', () => {
    const debut = source.indexOf('const finPublication = publicationsEnVol.debut(conversationId)')
    const lancement = source.indexOf('.publishChatTurn({')
    const fin = source.indexOf('.finally(finPublication)')
    expect(debut).toBeGreaterThan(-1)
    expect(debut).toBeLessThan(lancement)
    expect(fin).toBeGreaterThan(lancement)
  })
})
