// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { lireReperes } from './ascenseur-du-fil'

/*
 * Le texte des aperçus de l'ascenseur à crans (conv-1114), lu dans le vrai balisage des bulles
 * (ChatMessageRow.tsx). Un message qui nomme une skill est une bulle comme les autres depuis
 * conv-1334 : son aperçu reste le texte tapé, préfixe compris.
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
    const fil = filAvec('<div class="msg-body msg-bulle">/draft une plus jolie popup</div>')
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
    const fil = filAvec('<div class="msg-body msg-bulle">/kaizen</div>')
    expect(lireReperes(fil)[0].texte).toBe('/kaizen')
  })
})
