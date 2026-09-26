import { describe, expect, it } from 'vitest'
import { appelantApplicatif } from './gel-detector'

/**
 * L'ORIGINE D'UN BLOCAGE DOIT NOMMER UN FICHIER QUI EXISTE DANS LE DEPOT.
 *
 * Mesure du 2026-09-12 : sur 60 blocages non attribues, 46 portaient bien un `appelant` — mais en
 * coordonnees de BUILD : `main/index.js:8955:118 < chunks/worktree-manager-C3-Z8-U7.js:494:39`.
 * Aucune de ces lignes n'existe dans le depot, donc chaque diagnostic repartait en fouille : c'est
 * exactement ce que la capture de l'appelant devait supprimer.
 *
 * Deux moities repondent. Les cartes de sources (`sourcemap` sur la cible `main` + Node qui les
 * applique) ramenent la pile en coordonnees SOURCE ; ce contrat-ci verrouille la seconde moitie :
 * une fois la pile en `.ts`, le chemin rendu doit etre celui du DEPOT, pas deux segments tronques.
 */
describe('appelantApplicatif — un chemin ouvrable dans le depot', () => {
  it('rend le chemin depuis la racine du depot quand la frame est un fichier source', () => {
    const pile = [
      'Error: gel',
      '    at travauxNonPublies (D:/AutoWinOS/src/main/store/worktree-manager.ts:494:39)'
    ].join('\n')
    expect(appelantApplicatif(pile)).toBe('src/main/store/worktree-manager.ts:494:39')
  })

  it('garde la coordonnee compilee, tronquee, quand aucune carte n a traduit la frame', () => {
    const pile = [
      'Error: gel',
      '    at n (D:/AutoWinOS/out/main/chunks/worktree-manager-C3-Z8-U7.js:494:39)'
    ].join('\n')
    // Rien d'invente : faute de carte, on rend ce qu'on a — mais on ne pretend pas que c'est une source.
    expect(appelantApplicatif(pile)).toBe('chunks/worktree-manager-C3-Z8-U7.js:494:39')
  })

  it('ne remonte pas a la racine pour le `src` d une dependance : troncature inchangee', () => {
    const pile = ['Error: gel', '    at f (/app/node_modules/paquet/src/index.js:12:3)'].join('\n')
    expect(appelantApplicatif(pile)).toBe('src/index.js:12:3')
  })
})

/**
 * LA PREMIERE MOITIE — sans cartes de sources emises au build, la pile reste en coordonnees
 * compilees et le contrat ci-dessus ne peut jamais s'appliquer en production.
 */
describe('le build du process principal emet des cartes de sources', () => {
  it('active sourcemap pour la cible main, et Node les applique au demarrage', async () => {
    const { readFileSync } = await import('node:fs')
    const config = readFileSync('electron.vite.config.ts', 'utf8')
    const cibleMain = config.slice(config.indexOf('main:'), config.indexOf('preload:'))
    expect(cibleMain).toContain('sourcemap: true')

    const gelMain = readFileSync('src/main/gel-main.ts', 'utf8')
    expect(gelMain).toContain('setSourceMapsEnabled')
  })
})
