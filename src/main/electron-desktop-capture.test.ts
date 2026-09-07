import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { physicalDisplayLayout, selectDisplayEntries } from './electron-desktop-capture'

/**
 * GARDE : quand la capture d'ECRAN echoue, le repli sur la fenetre active doit DIRE pourquoi.
 *
 * Pourquoi ce cas existe. Mesure du 2026-09-07 (conv-49) : `desktop_observe` a rendu trois fois
 * « Capture de la fenetre active noire ou protegee » alors que la situation reelle etait « l'ecran
 * demande n'avait aucun pixel visible, l'application venait de redemarrer ». Le repli etait MUET :
 * il perdait l'etape fautive en route, donc le diagnostic est parti lire le code de la capture de
 * fenetre — qui n'avait aucun rapport. Plusieurs appels brules, et la sortie de secours (capturer
 * TOUS les ecrans, qui fonctionnait) n'etait nommee nulle part.
 *
 * Le comportement ne peut pas etre exerce ici : ces chemins appellent `desktopCapturer`, donc
 * Electron. On verrouille donc la FORME du code, comme le depot le fait pour ses feuilles de style.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : remettre un `captureForegroundWindow()` sans argument a
 * l'un des deux points de repli, ou retirer la mention de la sortie de secours du message final.
 */
describe('le repli sur la fenetre active nomme son motif', () => {
  const source = readFileSync('src/main/electron-desktop-capture.ts', 'utf8')

  it('ne replie JAMAIS en silence', () => {
    // Un appel nu ne peut subsister QUE dans la signature de la fonction elle-meme.
    const appelsNus = [...source.matchAll(/captureForegroundWindow\(\)/g)]
    expect(appelsNus).toEqual([])
  })

  it('passe un motif aux DEUX points de repli', () => {
    const avecMotif = [...source.matchAll(/captureForegroundWindow\(\s*[^)\s]/g)]
    expect(avecMotif.length).toBeGreaterThanOrEqual(2)
  })

  it('indique la sortie de secours dans le message final', () => {
    // « capturer tous les ecrans » est ce qui a REELLEMENT debloque le cas mesure : le message
    // doit l'offrir, sinon l'appelant relance a l'identique -- ce que la constitution interdit.
    expect(source).toMatch(/noire ou protegee\$\{cause\}/)
    expect(source).toContain('en omettant le parametre display')
  })
})

describe('physicalDisplayLayout', () => {
  it('convertit les bounds DIP en pixels physiques avec un ecran a 150 %', () => {
    expect(
      physicalDisplayLayout(
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
          scaleFactor: 1.5
        },
        { x: 0, y: 0 }
      )
    ).toEqual({ id: 1, left: 0, top: 0, width: 1920, height: 1080 })
  })

  it('conserve une origine physique negative dans une configuration mixte', () => {
    expect(
      physicalDisplayLayout(
        {
          id: 2,
          bounds: { x: -1280, y: -160, width: 1280, height: 1024 },
          scaleFactor: 1.25
        },
        { x: -1600, y: -200 }
      )
    ).toEqual({ id: 2, left: -1600, top: -200, width: 1600, height: 1280 })
  })
})

describe('selectDisplayEntries', () => {
  const entry = (sourceIndex: number, left: number, top = 0) => ({
    sourceIndex,
    layout: { id: sourceIndex + 1, left, top, width: 1920, height: 1080 }
  })
  // Ordre Windows volontairement melange : le rang 1-base suit la geometrie, pas getAllDisplays().
  const entries = [entry(0, 0), entry(1, -1920), entry(2, 1920)]

  it('sans display, garde tous les moniteurs ordonnes de gauche a droite', () => {
    expect(selectDisplayEntries(entries).map((e) => e.sourceIndex)).toEqual([1, 0, 2])
  })

  it('display=1 retient l ecran le plus a gauche, pas le premier de getAllDisplays', () => {
    expect(selectDisplayEntries(entries, 1)).toEqual([entries[1]])
  })

  it('display=3 retient le dernier ecran et conserve son index source', () => {
    expect(selectDisplayEntries(entries, 3)).toEqual([entries[2]])
  })

  it('ordonne du haut vers le bas a gauche egale', () => {
    const stacked = [entry(0, 0, 1080), entry(1, 0, 0)]
    expect(selectDisplayEntries(stacked, 1)).toEqual([stacked[1]])
  })

  it('refuse un rang hors bornes ou non entier', () => {
    expect(() => selectDisplayEntries(entries, 0)).toThrow('inexistant')
    expect(() => selectDisplayEntries(entries, 4)).toThrow('3 moniteur(s)')
    expect(() => selectDisplayEntries(entries, 1.5)).toThrow('inexistant')
  })

  it('ne mute pas le tableau fourni', () => {
    const input = [...entries]
    selectDisplayEntries(input)
    expect(input.map((e) => e.sourceIndex)).toEqual([0, 1, 2])
  })
})
