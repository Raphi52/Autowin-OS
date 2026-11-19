import { describe, expect, it } from 'vitest'
import { construireEml, enTeteEncode } from './brouillon-eml.mjs'

/**
 * Le script écrit un brouillon .eml qu'Outlook doit ouvrir en message MODIFIABLE, accents et pièces intacts.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : un brouillon sans `X-Unsent: 1` (Outlook l'ouvrirait en
 * message reçu), un objet accentué abîmé, un mot encodé de plus de 75 caractères, une pièce jointe dont
 * les octets changent, une adresse ou un nom de pièce qui injecterait un en-tête.
 */

const decoderMots = (v) =>
  v
    .replace(/\r\n /g, '')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'))

/** Lecture minimale du MIME produit : en-têtes de tête + parties (en-têtes, corps décodé). */
function lire(eml) {
  const [tete, ...reste] = eml.split('\r\n\r\n')
  const entetes = tete.replace(/\r\n /g, ' ')
  const frontiere = /boundary="([^"]+)"/.exec(entetes)?.[1]
  const corps = reste.join('\r\n\r\n')
  const blocs = frontiere
    ? corps.split(`--${frontiere}`).slice(1, -1)
    : [
        `\r\n${tete
          .split('\r\n')
          .filter((l) => l.startsWith('Content-'))
          .join('\r\n')}\r\n\r\n${corps}`
      ]
  const parties = blocs.map((b) => {
    const [t, ...c] = b.replace(/^\r\n/, '').split('\r\n\r\n')
    return { entetes: t, octets: Buffer.from(c.join('').replace(/\r\n/g, ''), 'base64') }
  })
  return { entetes: tete, parties }
}

describe('brouillon-eml', () => {
  const objet = 'Rapture — listes de référence de Grenoble à valider avant envoi à Pierre-Édouard'
  const corps = 'Bonjour Julien,\nÉtats PC : 75.\n\nRaphaël'
  const json = Buffer.from(JSON.stringify({ libelle: 'clôture pour extinction du passif' }), 'utf8')

  it('ouvre en brouillon modifiable, objet accentué intact', () => {
    const { entetes } = lire(construireEml({ objet, corps }))
    expect(entetes).toMatch(/^X-Unsent: 1$/m)
    const sujet = /^Subject: (.*(?:\r\n .*)*)/m.exec(entetes)[1]
    expect(decoderMots(sujet)).toBe(objet)
  })

  it('garde chaque mot encodé sous 75 caractères, sans couper un accent', () => {
    const encode = enTeteEncode('é'.repeat(200))
    for (const mot of encode.split('\r\n ')) expect(mot.length).toBeLessThanOrEqual(75)
    expect(decoderMots(encode)).toBe('é'.repeat(200))
    expect(enTeteEncode('Objet ASCII')).toBe('Objet ASCII')
  })

  it('transporte le corps en CRLF et la pièce jointe octet pour octet', () => {
    const eml = construireEml({
      objet,
      corps,
      pieces: [{ nom: 'referentiels-rapture-3801.json', contenu: json }]
    })
    const { entetes, parties } = lire(eml)
    expect(entetes).toMatch(/multipart\/mixed/)
    expect(parties).toHaveLength(2)
    expect(parties[0].octets.toString('utf8')).toBe(corps.replace(/\n/g, '\r\n'))
    expect(parties[1].entetes).toMatch(/application\/json; name="referentiels-rapture-3801\.json"/)
    expect(parties[1].entetes).toMatch(/Content-Disposition: attachment/)
    expect(parties[1].octets.equals(json)).toBe(true)
  })

  it('sans pièce jointe, un seul corps texte', () => {
    const eml = construireEml({ objet, corps })
    expect(eml).not.toMatch(/multipart/)
    expect(lire(eml).parties[0].octets.toString('utf8')).toBe(corps.replace(/\n/g, '\r\n'))
  })

  it('n’écrit les destinataires que s’ils sont fournis', () => {
    expect(construireEml({ objet, corps })).not.toMatch(/^To:/m)
    expect(
      construireEml({ objet, corps, a: ['julien@exemple.fr', 'sebastien@exemple.fr'] })
    ).toMatch(/^To: julien@exemple\.fr, sebastien@exemple\.fr$/m)
  })

  it('refuse ce qui injecterait un en-tête ou un message vide', () => {
    expect(() => construireEml({ objet, corps, a: ['x@y.fr\r\nBcc: z@w.fr'] })).toThrow(
      /adresse invalide/
    )
    expect(() =>
      construireEml({ objet, corps, pieces: [{ nom: 'a"b.json', contenu: json }] })
    ).toThrow(/pièce jointe/)
    expect(() => construireEml({ objet: '  ', corps })).toThrow(/objet vide/)
    expect(() => construireEml({ objet, corps: '\n' })).toThrow(/corps vide/)
    expect(construireEml({ objet: 'A\r\nBcc: z@w.fr', corps })).not.toMatch(/^Bcc:/m)
  })
})
