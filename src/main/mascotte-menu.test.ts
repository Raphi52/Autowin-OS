import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { ecrireLangueReglee } from './langue-reglage'
import { entreesDuMenuMascotte } from './mascotte-menu'

/**
 * Le clic droit de la mascotte (conv-1196, ligne 12 du scout). Racine de données à soi, comme
 * `textes-coeur.test.ts` : la langue réglée vit sur le disque, et celle du poste ne doit rien décider.
 */
let racine: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'mascotte-menu-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

const TITRES: Record<string, string> = {
  'conv-1': 'Corriger le test',
  'conv-2': 'Refaire la page',
  'conv-3': 'Migrer la base'
}
const titreDuFil = (id: string): string | undefined => TITRES[id]

describe('menu du clic droit de la mascotte (conv-1196)', () => {
  it('liste TOUS les fils qui attendent, pas seulement celui du clic gauche : échecs, puis prêts, le plus récent en haut', () => {
    const menu = entreesDuMenuMascotte({
      filsEnAttente: ['conv-1', 'conv-2'],
      filsEnEchec: ['conv-3'],
      titreDuFil
    })
    expect(menu).toEqual([
      { type: 'fil', conversationId: 'conv-3', libelle: 'Migrer la base — le tour a échoué' },
      { type: 'fil', conversationId: 'conv-2', libelle: 'Refaire la page — réponse prête' },
      { type: 'fil', conversationId: 'conv-1', libelle: 'Corriger le test — réponse prête' },
      { type: 'separateur' },
      { type: 'autowin', libelle: 'Ouvrir Autowin' }
    ])
  })

  it('aucun fil : une ligne qui le dit (pas un menu vide), et toujours « Ouvrir Autowin »', () => {
    expect(entreesDuMenuMascotte({ filsEnAttente: [], filsEnEchec: [], titreDuFil })).toEqual([
      { type: 'info', libelle: 'Aucun fil ne t’attend' },
      { type: 'separateur' },
      { type: 'autowin', libelle: 'Ouvrir Autowin' }
    ])
  })

  it('suit la langue réglée', () => {
    ecrireLangueReglee('en')
    const menu = entreesDuMenuMascotte({ filsEnAttente: ['conv-1'], filsEnEchec: [], titreDuFil })
    expect(menu.map((e) => ('libelle' in e ? e.libelle : '—'))).toEqual([
      'Corriger le test — answer ready',
      '—',
      'Open Autowin'
    ])
  })

  it('titre absent : l’identifiant ; titre long : coupé ; « & » doublé pour s’afficher dans un menu Windows', () => {
    const long = 'R&D '.repeat(30)
    const menu = entreesDuMenuMascotte({
      filsEnAttente: ['conv-9', 'conv-long'],
      filsEnEchec: [],
      titreDuFil: (id) => (id === 'conv-long' ? long : null)
    })
    const [premier, second] = menu
    expect(second).toEqual({
      type: 'fil',
      conversationId: 'conv-9',
      libelle: 'conv-9 — réponse prête'
    })
    if (premier.type !== 'fil') throw new Error('attendu : un fil')
    const titre = premier.libelle.replace(' — réponse prête', '')
    expect(titre.endsWith('…')).toBe(true)
    expect(titre.replace(/&&/gu, '&').length).toBeLessThanOrEqual(60)
    expect(titre).not.toMatch(/(^|[^&])&([^&]|$)/u)
  })
})
