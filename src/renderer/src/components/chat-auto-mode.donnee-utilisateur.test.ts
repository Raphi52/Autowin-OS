import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, suiteAttendUneDonneeUtilisateur } from './chat-auto-mode'

const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const base = { actif: true, occupe: false, dernierTourTraite: null, dernierPromptEnvoye: null, brouillonPresent: false }

/*
 * conv-751, tour 4a4374c0-3f0c-4c42-82f0-ff6b03b76a27 : la suite proposée parlait À LA PLACE de
 * l'utilisateur. Le mode auto l'a envoyée (saisie ts 1789993655768) sans aucun identifiant ; le tour
 * 308ae1cf-9416-461f-a1ed-14775607df62 a refusé d'inventer, n'a proposé aucune suite, et la chaîne
 * s'est tue sans message.
 */
const SUITE_VECUE =
  'Voici les identifiants Robux de BrainRotRoyale (3 produits + pass VIP + pass de saison) : reporte-les dans Economie.lua puis vérifie les achats en test'

describe('suite qui attend une donnée que seul l’utilisateur possède (conv-751)', () => {
  it('reconnaît la suite vécue', () => {
    expect(suiteAttendUneDonneeUtilisateur(SUITE_VECUE)).toBe(true)
    expect(suiteAttendUneDonneeUtilisateur('Voici mes clés API : branche-les')).toBe(true)
    expect(suiteAttendUneDonneeUtilisateur('Je te donne le mot de passe, configure la base')).toBe(true)
  })
  it('laisse passer une suite d’action ordinaire', () => {
    expect(suiteAttendUneDonneeUtilisateur('Range les .bak de src/server dans archives/')).toBe(false)
    expect(suiteAttendUneDonneeUtilisateur('Vérifie les identifiants déjà présents dans Economie.lua')).toBe(false)
  })
  it('ne l’envoie pas : met en pause AVEC un message visible', () => {
    const fil = [humain('go'), agent(`✅ Fait\n- rangé\nAUTOWIN_PROMPT_V1: ${SUITE_VECUE}`)]
    const d = deciderRelanceAuto({ ...base, fil })
    expect(d).toMatchObject({ action: 'arreter', raison: 'suite-attend-utilisateur' })
    if (d.action === 'arreter') expect(d.message).toMatch(/toi seul/)
  })
})

describe('suite à trou (conv-798, saisie ts 1790170650709)', () => {
  it('bloque une valeur « : <adresse> » non remplie', () => {
    expect(
      suiteAttendUneDonneeUtilisateur(
        "Lance webtest record sur l'adresse de ma webapp que je te donne : <adresse>"
      )
    ).toBe(true)
  })
  it('laisse passer une spécification qui cite <url> en milieu de phrase', () => {
    expect(
      suiteAttendUneDonneeUtilisateur(
        'Ajoute à D:\\WebTesting une commande webtest record <url> qui ouvre un navigateur'
      )
    ).toBe(false)
  })
})

describe('suite qui affirme un geste que seul l’utilisateur a pu faire (conv-854)', () => {
  it('bloque « J’ai saisi X et accepté » (saisie ts 1790331255647)', () => {
    expect(
      suiteAttendUneDonneeUtilisateur(
        "J'ai saisi CE67N36QT et accepté, vérifie que le fichier de connexion Teams existe"
      )
    ).toBe(true)
    expect(
      suiteAttendUneDonneeUtilisateur(
        "J'ai validé le code Microsoft, vérifie que le watchdog lit bien mes messages Teams"
      )
    ).toBe(true)
  })
  it('laisse passer une suite d’action ordinaire', () => {
    expect(suiteAttendUneDonneeUtilisateur('Vérifie que le fichier de connexion Teams existe')).toBe(false)
  })
})
