import { describe, expect, it } from 'vitest'
import { messageEmpreinteBrain } from './brain-empreinte-message'

/**
 * UNE PANNE N'EST PAS UN RESULTAT VIDE.
 *
 * Defaut mesure conv-9 (2026-08-31) : trace Brain du tour = `status: 'unavailable'`,
 * `injectedChars: 0` ; message affiche = « Aucune empreinte de depot dans le Brain ». Le lecteur en
 * conclut que la base ne sait rien, alors que le serveur n'a jamais repondu.
 *
 * Entree qui DOIT faire rougir : reunifier les branches sur la seule taille du texte recupere.
 */
describe('messageEmpreinteBrain — nommer la cause du silence', () => {
  it('dit INJOIGNABLE quand le Brain n’a pas pu être interrogé', () => {
    const { text, detail } = messageEmpreinteBrain('unavailable', 0)
    expect(text).toMatch(/INJOIGNABLE/u)
    expect(text).not.toMatch(/^Aucune empreinte/u)
    expect(detail).toBe('think : Brain injoignable')
  })

  it('NOMME la cause quand elle est connue, au lieu d’énumérer trois hypothèses', () => {
    // Defaut conv-586 (2026-09-16) : quatre echecs distincts rendaient le meme texte « serveur
    // arrete, jeton absent ou reseau ». Entree qui DOIT rougir : ignorer le motif recu.
    const refus = messageEmpreinteBrain('unavailable', 0, 'query-refused')
    expect(refus.text).toMatch(/INJOIGNABLE/u)
    expect(refus.text).toMatch(/query-secure/u)
    expect(refus.text).not.toMatch(/jeton absent ou réseau/u)
    expect(refus.detail).toBe('think : Brain injoignable (query-refused)')

    const reseau = messageEmpreinteBrain('unavailable', 0, 'network')
    expect(reseau.text).toMatch(/aucune réponse du serveur/u)
    expect(reseau.text).not.toBe(refus.text)
  })

  it('garde « aucune empreinte » pour une base qui a REPONDU sans rien connaître', () => {
    // L'autre bord : le vrai vide existe, et il ne doit pas devenir une fausse alerte de panne.
    const { text, detail } = messageEmpreinteBrain('empty', 0)
    expect(text).toMatch(/^Aucune empreinte/u)
    expect(text).toMatch(/a bien répondu/u)
    expect(detail).toBe('think : aucune empreinte')
  })

  it('distingue une réponse illisible d’une absence de réponse', () => {
    const { text } = messageEmpreinteBrain('invalid', 0)
    expect(text).toMatch(/ILLISIBLE/u)
    expect(text).not.toMatch(/INJOIGNABLE/u)
  })

  it('annonce la taille réellement injectée quand une empreinte existe', () => {
    // Une empreinte chargee prime sur tout statut : c'est la seule preuve qui compte.
    const { text, detail } = messageEmpreinteBrain('found', 4_242)
    expect(text).toContain('4242')
    expect(detail).toBe('think : empreinte chargée')
  })

  it('ne prétend pas à une panne quand le statut est absent (journal ancien)', () => {
    const { text } = messageEmpreinteBrain(undefined, 0)
    expect(text).toMatch(/^Aucune empreinte/u)
  })
})
