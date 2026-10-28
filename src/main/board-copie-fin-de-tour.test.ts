/**
 * LA COPIE DU BOARD À CHAQUE FIN DE TOUR (conv-1210, 2026-10-28) : « fais que la copie du Board vers
 * la GED se mette à jour même quand le Board n'est pas affiché, par exemple à chaque fin de tour ».
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une fin de tour qui ne recopie rien, un calcul lancé sans
 * dossier choisi, un calcul par tour dans une rafale, un post-it glissé à la main recopié à l'étage
 * de ses preuves après un redémarrage.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CarteDesBesoins, DemandeDeLaCarte, StatutDemande } from '../shared/carte-des-besoins'
import type { EtatManuelDuBoard } from '../shared/board-dossier'
import { creerDossierDuBoard } from './board-dossier'
import {
  creerCopieDeFinDeTour,
  FICHIER_DES_ETATS_MANUELS,
  lireEtatsManuelsGardes
} from './board-copie-fin-de-tour'

const H = 3_600_000
const comptes = (): Record<StatutDemande, number> => ({
  prouve: 0,
  refuse: 0,
  'en-cours': 0,
  'sans-preuve': 0
})

function carte(...ids: string[]): CarteDesBesoins {
  const demandes: DemandeDeLaCarte[] = ids.map((id, i) => ({
    conversationId: id,
    conversationTitre: `Fil ${id}`,
    rang: 0,
    titre: 'demande',
    statut: 'en-cours',
    constat: 'tour en cours',
    debut: (i + 1) * H
  }))
  return {
    projets: [
      {
        cle: 'D:\\Projet',
        libelle: 'Projet',
        nature: 'dossier',
        conversations: ids.length,
        demandes,
        runsBloques: [],
        comptes: comptes()
      }
    ],
    comptes: comptes(),
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: ids.length,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: 1,
    dureeMs: 1
  }
}

const temporaires: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'autowin-board-tour-'))
  temporaires.push(d)
  return d
}
afterEach(() => {
  for (const d of temporaires.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Un dossier du Board factice : il note ce qu'on lui confie. */
function dossierFactice(dossier: string | null): {
  etat: () => { dossier: string | null; cible: null; enCours: boolean }
  enregistrer: (c: CarteDesBesoins, m: Readonly<Record<string, EtatManuelDuBoard>>) => void
  confies: { carte: CarteDesBesoins; manuels: Readonly<Record<string, EtatManuelDuBoard>> }[]
} {
  const confies: {
    carte: CarteDesBesoins
    manuels: Readonly<Record<string, EtatManuelDuBoard>>
  }[] = []
  return {
    etat: () => ({ dossier, cible: null, enCours: false }),
    enregistrer: (c, m) => confies.push({ carte: c, manuels: m }),
    confies
  }
}

describe('creerCopieDeFinDeTour — le Board part vers le dossier sans que la vue soit ouverte', () => {
  it('une fin de tour calcule la carte et la confie à l’écriture', async () => {
    const dossier = dossierFactice('D:\\Board')
    const copie = creerCopieDeFinDeTour({
      racine: temp(),
      dossierDuBoard: dossier,
      calculer: async () => carte('conv-1'),
      delaiMs: 0
    })
    copie.recopier()
    await copie.attendre()
    expect(dossier.confies.map((c) => c.carte.demandes)).toEqual([1])
  })

  it('sans dossier choisi, ne calcule rien', async () => {
    let calculs = 0
    const copie = creerCopieDeFinDeTour({
      racine: temp(),
      dossierDuBoard: dossierFactice(null),
      calculer: async () => {
        calculs += 1
        return carte('conv-1')
      },
      delaiMs: 0
    })
    copie.recopier()
    await copie.attendre()
    expect(calculs).toBe(0)
  })

  it('une rafale de fins de tour ne coûte qu’un calcul, plus un pour la fin de la rafale', async () => {
    let t = 0
    const planifies: (() => void)[] = []
    let calculs = 0
    const dossier = dossierFactice('D:\\Board')
    const copie = creerCopieDeFinDeTour({
      racine: temp(),
      dossierDuBoard: dossier,
      calculer: async () => {
        calculs += 1
        return carte(`conv-${calculs}`)
      },
      maintenant: () => t,
      delaiMs: 30_000,
      planifier: (fn) => {
        planifies.push(fn)
        return { annuler: () => undefined }
      }
    })
    copie.recopier()
    await copie.attendre()
    for (let i = 0; i < 5; i += 1) copie.recopier()
    await copie.attendre()
    expect(calculs).toBe(1)
    expect(planifies).toHaveLength(1)
    t = 30_000
    planifies[0]()
    await copie.attendre()
    expect(calculs).toBe(2)
    expect(dossier.confies.at(-1)?.carte.projets[0].demandes[0].conversationId).toBe('conv-2')
  })

  it('un calcul en échec ne lève pas : la fin du tour n’en souffre pas', async () => {
    const dossier = dossierFactice('D:\\Board')
    const copie = creerCopieDeFinDeTour({
      racine: temp(),
      dossierDuBoard: dossier,
      calculer: async () => {
        throw new Error('calcul cassé')
      },
      delaiMs: 0
    })
    expect(() => copie.recopier()).not.toThrow()
    await copie.attendre()
    expect(dossier.confies).toEqual([])
  })

  it('garde les états posés à la main, ne réécrit pas un état inchangé, ignore un fichier abîmé', async () => {
    const racine = temp()
    const copie = creerCopieDeFinDeTour({
      racine,
      dossierDuBoard: dossierFactice('D:\\Board'),
      calculer: async () => carte()
    })
    copie.retenirManuels({ 'conv-1': { etage: 'a-faire', a: 5 * H } })
    await copie.attendre()
    expect(lireEtatsManuelsGardes(racine)).toEqual({ 'conv-1': { etage: 'a-faire', a: 5 * H } })
    expect(existsSync(join(racine, FICHIER_DES_ETATS_MANUELS))).toBe(true)
    expect(lireEtatsManuelsGardes(temp())).toEqual({})
  })
})

describe('bout en bout avec le vrai dossier du Board', () => {
  it('après un redémarrage, sans ouvrir le Board, la fin de tour garde l’étage posé à la main', async () => {
    const racine = temp()
    const partage = temp()
    const ecrivain = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    await ecrivain.choisir(partage)
    // Avant le redémarrage : la vue a transmis un post-it glissé à la main en « À faire ».
    const avant = creerCopieDeFinDeTour({
      racine,
      dossierDuBoard: ecrivain,
      calculer: async () => carte('conv-1')
    })
    avant.retenirManuels({ 'conv-1': { etage: 'a-faire', a: 5 * H } })
    await avant.attendre()

    // Après : un nouveau processus, la vue jamais ouverte. Seule la fin d'un tour recopie.
    const apresEcrivain = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    const apres = creerCopieDeFinDeTour({
      racine,
      dossierDuBoard: apresEcrivain,
      calculer: async () => carte('conv-1', 'conv-2'),
      delaiMs: 0
    })
    apres.recopier()
    await apres.attendre()
    await apresEcrivain.attendre()
    const json = JSON.parse(readFileSync(join(partage, 'moi', 'board.json'), 'utf8')) as {
      postIts: { conversationId: string; etage: string }[]
    }
    expect(Object.fromEntries(json.postIts.map((p) => [p.conversationId, p.etage]))).toEqual({
      'conv-1': 'a-faire',
      'conv-2': 'en-cours'
    })
  })
})
