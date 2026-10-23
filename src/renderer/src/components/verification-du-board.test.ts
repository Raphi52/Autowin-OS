import { describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import type { PostItDeLaRiviere } from './carte-riviere'
import {
  COMMANDE_DE_VERIFICATION,
  DUREE_MAX_DU_SUIVI_MS,
  GRACE_DU_SUIVI_MS,
  lancerLesVerifications,
  postitsAVerifier,
  resumeDuBilan,
  suivisRestants
} from './verification-du-board'

/**
 * VÉRIFIER DEPUIS LE BOARD (conv-1136, 2026-10-23). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : « Tout
 * vérifier » qui vise un post-it hors de la ligne « À vérifier » ou d'une personne non choisie ; un
 * refus qui arrête les envois suivants ou qui disparaît du bilan ; un suivi qui s'arrête avant que
 * le tour ait fini, ou qui ne s'arrête jamais.
 */

const postit = (
  conversationId: string,
  etage: PostItDeLaRiviere['etage'],
  cle = 'raph@x'
): PostItDeLaRiviere => ({
  conversationId,
  titre: conversationId,
  projet: 'P',
  demandeur: { cle, nom: cle, origine: 'journal' },
  etage,
  etatPreuve: etage === 'a-faire' ? 'sans-preuve' : etage,
  instant: 0,
  t: 0,
  demandes: [],
  rang: 0
})

describe('postitsAVerifier', () => {
  const postits = [
    postit('conv-1', 'sans-preuve'),
    postit('conv-2', 'prouve'),
    postit('conv-3', 'sans-preuve', 'alex@x'),
    postit('conv-4', 'refuse')
  ]

  it('ne garde que la ligne « À vérifier »', () => {
    expect(postitsAVerifier(postits, null).map((p) => p.conversationId)).toEqual([
      'conv-1',
      'conv-3'
    ])
  })

  it('suit le filtre de personne : les post-its estompés ne sont pas visés', () => {
    expect(postitsAVerifier(postits, 'alex@x').map((p) => p.conversationId)).toEqual(['conv-3'])
  })
})

describe('lancerLesVerifications', () => {
  it('envoie /check dans chaque fil, un par un, et garde chaque refus', async () => {
    const ordre: string[] = []
    const envoyer = vi.fn(async (id: string, message: string) => {
      ordre.push(`${id}:${message}`)
      if (id === 'conv-2') return { ok: false, error: 'fil introuvable' }
      if (id === 'conv-3') throw new Error('budget atteint')
      return { ok: true }
    })
    const bilan = await lancerLesVerifications(['conv-1', 'conv-2', 'conv-3', 'conv-4'], envoyer)
    expect(COMMANDE_DE_VERIFICATION).toBe('/check')
    expect(ordre).toEqual(['conv-1:/check', 'conv-2:/check', 'conv-3:/check', 'conv-4:/check'])
    expect(bilan.lances).toEqual(['conv-1', 'conv-4'])
    expect(bilan.echecs).toEqual([
      { conversationId: 'conv-2', raison: 'fil introuvable' },
      { conversationId: 'conv-3', raison: 'budget atteint' }
    ])
  })

  it('dit le bilan en une ligne, refus compris', () => {
    expect(resumeDuBilan({ lances: ['a'], echecs: [] })).toBe('/check lancé dans 1 fil')
    expect(
      resumeDuBilan({ lances: ['a', 'b'], echecs: [{ conversationId: 'c', raison: 'non' }] })
    ).toBe('/check lancé dans 2 fils · 1 refusé : non')
    expect(resumeDuBilan({ lances: [], echecs: [{ conversationId: 'c', raison: 'non' }] })).toBe(
      'aucun /check lancé · 1 refusé : non'
    )
  })
})

describe('suivisRestants', () => {
  const demande = (
    conversationId: string,
    statut: StatutDemande,
    rang: number
  ): DemandeDeLaCarte => ({
    conversationId,
    conversationTitre: conversationId,
    rang,
    titre: `demande ${rang}`,
    statut,
    constat: '',
    debut: rang
  })
  const carte = (demandes: DemandeDeLaCarte[]): CarteDesBesoins =>
    ({ projets: [{ demandes } as unknown as ProjetDeLaCarte] }) as unknown as CarteDesBesoins
  const T = 1_000_000_000

  it('garde un fil dont la dernière demande (le /check) tourne encore', () => {
    const c = carte([demande('conv-1', 'sans-preuve', 1), demande('conv-1', 'en-cours', 3)])
    expect(suivisRestants(c, { 'conv-1': T }, T + 5 * 60_000)).toEqual({ 'conv-1': T })
  })

  it('lâche un fil fini, passé le délai de grâce', () => {
    const c = carte([demande('conv-1', 'en-cours', 1), demande('conv-1', 'prouve', 3)])
    expect(suivisRestants(c, { 'conv-1': T }, T + GRACE_DU_SUIVI_MS + 1)).toEqual({})
  })

  it('garde un fil pas encore vu « en cours » pendant le délai de grâce', () => {
    const c = carte([demande('conv-1', 'sans-preuve', 1)])
    expect(suivisRestants(c, { 'conv-1': T }, T + 1_000)).toEqual({ 'conv-1': T })
  })

  it('lâche tout fil au bout de la durée maximale, même encore en cours', () => {
    const c = carte([demande('conv-1', 'en-cours', 1)])
    expect(suivisRestants(c, { 'conv-1': T }, T + DUREE_MAX_DU_SUIVI_MS + 1)).toEqual({})
  })
})
