// fix-ok: ce fichier a grossi a chaque cause trouvee dans le modele (ordre des seuils, acte RSM
// inconnu, reglage corrompu) — chaque ajout est le test rouge AVANT le correctif, pas une
// retouche a l'aveugle.
import { describe, expect, it } from 'vitest'
import {
  CLE_SEUILS_PERF,
  couleurPerf,
  ecrireSeuilsPerf,
  indicateurDuTypeSource,
  indicateursDuGroupe,
  lireSeuilsPerf,
  majSeuil,
  parseSeuilsPerf,
  PERF_SEUILS_PAR_DEFAUT,
  seuilsParDefaut,
  totauxDe,
  totauxParUtilisateur,
  totauxUtilisateur,
  type PerfMesure
} from './performance-greffe-model'

function memoire(initial: Record<string, string> = {}): {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
} {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (cle) => data.get(cle) ?? null,
    setItem: (cle, valeur) => {
      data.set(cle, valeur)
    }
  }
}

const MESURES: PerfMesure[] = [
  { utilisateur: 'Zoe', type: 'formalite-validee', valeur: 12 },
  { utilisateur: 'Alice', type: 'formalite-validee', valeur: 8 },
  { utilisateur: 'Alice', type: 'dca', valeur: 3 },
  { utilisateur: 'Alice', type: 'das', valeur: 2 },
  { utilisateur: 'Alice', type: 'inscription', valeur: 4 },
  { utilisateur: 'Alice', type: 'modification', valeur: 5 },
  { utilisateur: 'Alice', type: 'renouvellement', valeur: 6 },
  { utilisateur: 'Alice', type: 'radiation', valeur: 1 },
  // Un type d'acte que personne n'a prevu : il ne doit atterrir dans AUCUNE ligne.
  { utilisateur: 'Alice', type: 'depot-inconnu', valeur: 999 }
]

describe('les indicateurs demandes', () => {
  it('porte les trois lignes RCS et les deux lignes RSM', () => {
    expect(indicateursDuGroupe('rcs').map((i) => i.id)).toEqual([
      'rcs-formalites-validees',
      'rcs-dca',
      'rcs-das'
    ])
    expect(indicateursDuGroupe('rsm').map((i) => i.id)).toEqual(['rsm-imr', 'rsm-radiations'])
  })

  it('compte inscriptions, modifications et renouvellements sur UNE seule ligne', () => {
    expect(indicateurDuTypeSource('inscription')).toBe('rsm-imr')
    expect(indicateurDuTypeSource('Modification')).toBe('rsm-imr')
    expect(indicateurDuTypeSource(' renouvellement ')).toBe('rsm-imr')
    expect(totauxUtilisateur(MESURES, 'Alice')['rsm-imr']).toBe(15)
  })

  it('ignore un type d acte inconnu au lieu de le ranger au hasard', () => {
    expect(indicateurDuTypeSource('depot-inconnu')).toBeNull()
    const totaux = totauxUtilisateur(MESURES, 'Alice')
    expect(Object.values(totaux).reduce((a, b) => a + b, 0)).toBe(8 + 3 + 2 + 15 + 1)
  })
})

describe('mode utilisateur et mode greffier', () => {
  it('le mode utilisateur ne montre que la personne demandee', () => {
    expect(totauxUtilisateur(MESURES, 'Zoe')['rcs-formalites-validees']).toBe(12)
    expect(totauxUtilisateur(MESURES, 'Zoe')['rcs-dca']).toBe(0)
  })

  it('le mode greffier somme tout le monde', () => {
    expect(totauxDe(MESURES)['rcs-formalites-validees']).toBe(20)
  })

  it('detaille par personne dans un ordre stable', () => {
    expect(totauxParUtilisateur(MESURES).map((ligne) => ligne.utilisateur)).toEqual([
      'Alice',
      'Zoe'
    ])
  })
})

describe('code couleur parametrable', () => {
  const seuils = { vert: 100, jaune: 70, orange: 40 }

  it('atteindre pile son objectif donne le vert', () => {
    expect(couleurPerf(100, seuils)).toBe('vert')
    expect(couleurPerf(99, seuils)).toBe('jaune')
    expect(couleurPerf(70, seuils)).toBe('jaune')
    expect(couleurPerf(69, seuils)).toBe('orange')
    expect(couleurPerf(40, seuils)).toBe('orange')
    expect(couleurPerf(39, seuils)).toBe('rouge')
    expect(couleurPerf(0, seuils)).toBe('rouge')
  })

  it('un petit greffe qui baisse ses seuils repasse au vert avec les MEMES chiffres', () => {
    expect(couleurPerf(25, seuils)).toBe('rouge')
    expect(couleurPerf(25, { vert: 20, jaune: 14, orange: 8 })).toBe('vert')
  })

  it('range trois planchers saisis dans le desordre au lieu de rendre une couleur inatteignable', () => {
    expect(couleurPerf(75, { vert: 70, jaune: 100, orange: 40 })).toBe('jaune')
  })
})

describe('persistance des seuils', () => {
  it('rend les defauts tant que personne n a rien regle', () => {
    expect(lireSeuilsPerf(memoire())).toEqual(PERF_SEUILS_PAR_DEFAUT)
  })

  it('relit a l identique un reglage enregistre', () => {
    const storage = memoire()
    const regles = majSeuil(seuilsParDefaut(), 'rcs-formalites-validees', 'vert', 30)
    ecrireSeuilsPerf(storage, regles)
    expect(storage.getItem(CLE_SEUILS_PERF)).not.toBeNull()
    expect(lireSeuilsPerf(storage)).toEqual(regles)
    expect(lireSeuilsPerf(storage)['rcs-formalites-validees'].vert).toBe(30)
    // Le champ tape GARDE sa valeur : les deux autres planchers cedent sous lui.
    expect(regles['rcs-formalites-validees'].jaune).toBe(30)
    expect(regles['rcs-formalites-validees'].orange).toBe(30)
  })

  it('ne touche qu a l indicateur regle', () => {
    const regles = majSeuil(seuilsParDefaut(), 'rsm-radiations', 'orange', 3)
    expect(regles['rsm-radiations'].orange).toBe(3)
    expect(regles['rcs-dca']).toEqual(PERF_SEUILS_PAR_DEFAUT['rcs-dca'])
  })

  it('retombe sur le defaut devant un reglage corrompu, illisible ou partiel', () => {
    expect(parseSeuilsPerf('nimporte quoi')).toEqual(PERF_SEUILS_PAR_DEFAUT)
    expect(parseSeuilsPerf(null)).toEqual(PERF_SEUILS_PAR_DEFAUT)
    expect(lireSeuilsPerf(memoire({ [CLE_SEUILS_PERF]: '{oups' }))).toEqual(PERF_SEUILS_PAR_DEFAUT)
    const partiel = parseSeuilsPerf({ 'rcs-dca': { vert: 5 } })
    expect(partiel['rcs-dca'].vert).toBe(20)
    expect(partiel['rcs-dca'].jaune).toBe(10)
    expect(partiel['rcs-dca'].orange).toBe(5)
    expect(partiel['rcs-das']).toEqual(PERF_SEUILS_PAR_DEFAUT['rcs-das'])
  })

  it('refuse un seuil negatif sans faire disparaitre le reglage', () => {
    expect(majSeuil(seuilsParDefaut(), 'rcs-das', 'orange', -4)['rcs-das'].orange).toBe(0)
  })
})
