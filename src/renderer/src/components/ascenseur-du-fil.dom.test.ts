// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { lireReperes } from './ascenseur-du-fil'

/*
 * Le texte des aperçus de l'ascenseur à crans (conv-1114), lu dans le vrai balisage des bulles
 * (ChatMessageRow.tsx). Mesuré dans l'app : un message qui lance une skill s'affichait
 * « draftune plus jolie popup… » — le nom de la skill et la suite étaient collés.
 */
function filAvec(...bulles: string[]): HTMLElement {
  const fil = document.createElement('div')
  fil.innerHTML = bulles
    .map(
      (corps) =>
        `<div class="msg user" data-origine="message-utilisateur">${corps}<div class="msg-turn-actions"><span class="msg-time">14:12</span></div></div>`
    )
    .join('')
  document.body.appendChild(fil)
  return fil
}

describe('lireReperes — le texte de tes messages', () => {
  it('message qui lance une skill : « /draft une plus jolie popup… », comme tu l’as écrit', () => {
    const fil = filAvec(
      '<div class="msg-body msg-bulle avec-skill"><div class="msg-skill-entete"><span class="msg-skill-nom">draft</span></div><div class="msg-skill-texte">une plus jolie popup</div></div>'
    )
    expect(lireReperes(fil)[0].texte).toBe('/draft une plus jolie popup')
  })

  it('message ordinaire : son texte, avec son heure et son numéro', () => {
    const fil = filAvec('<div class="msg-body msg-bulle">4 et 5 mais adapté</div>')
    expect(lireReperes(fil, 1)[0]).toMatchObject({
      texte: '4 et 5 mais adapté',
      heure: '14:12',
      numero: 2
    })
  })

  it('skill lancée sans texte : son nom seul', () => {
    const fil = filAvec(
      '<div class="msg-body msg-bulle avec-skill"><div class="msg-skill-entete"><span class="msg-skill-nom">kaizen</span></div></div>'
    )
    expect(lireReperes(fil)[0].texte).toBe('/kaizen')
  })
})
