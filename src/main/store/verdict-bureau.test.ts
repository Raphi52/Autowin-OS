import { describe, expect, it } from 'vitest'
import { LIBELLE_VERDICT, verdictDeBureau } from './verdict-bureau'

/**
 * UN BUREAU CONSERVE DOIT PORTER UN VERDICT LISIBLE.
 *
 * DEFAUT DU CADRAGE, mesure le 2026-08-25 : la liste des travaux non publies donnait un nom, une
 * date et des fichiers — mais aucun VERDICT. Pour savoir si un bureau valait quelque chose, il
 * fallait ouvrir son patch un par un. C'est exactement ce que j'ai fait a la main ce jour-la sur
 * seize bureaux, et c'est ce tri manuel que ce module rend automatique.
 *
 * LE VERDICT EST DERIVE D'UNE PREUVE, jamais d'un drapeau qu'on ecrit a cote. Un etat stocke se
 * desynchronise du reel ; un etat DERIVE ne peut pas mentir plus longtemps que la preuve qui le
 * porte. Les trois cas viennent de deux faits deja calcules par `apercuTravauxNonPublies` : ce que
 * le bureau ajoute a la base, et s'il a seulement enregistre quelque chose.
 */
describe('verdictDeBureau — le tri manuel, rendu automatique', () => {
  it('des fichiers que la base n’a pas : À REPRENDRE', () => {
    expect(
      verdictDeBureau({ fichiers: ['src/a.ts'], aUnCommit: true })
    ).toBe('a-reprendre')
  })

  it('un seul fichier suffit à valoir une reprise', () => {
    // Le cas reel du 2026-08-25 : un test de 105 lignes, absent du depot, dans un bureau qui
    // paraissait sans interet. Un verdict trop prompt a « jeter » l'aurait perdu.
    expect(verdictDeBureau({ fichiers: ['ChatView.pastilles.test.ts'], aUnCommit: true })).toBe(
      'a-reprendre'
    )
  })

  it('rien à ajouter à la base, mais un commit existe : TRIÉ', () => {
    expect(verdictDeBureau({ fichiers: [], aUnCommit: true })).toBe('trie')
  })

  it('aucun commit, rien d’enregistré : SANS VALEUR', () => {
    expect(verdictDeBureau({ fichiers: [], aUnCommit: false })).toBe('sans-valeur')
  })

  it('aucun commit MAIS des fichiers : À REPRENDRE — le travail prime sur l’absence de commit', () => {
    // L'entree qui ferait echouer une regle ecrite dans le mauvais ordre : tester `aUnCommit`
    // AVANT les fichiers classerait « sans valeur » un bureau qui porte du travail.
    expect(verdictDeBureau({ fichiers: ['src/precieux.ts'], aUnCommit: false })).toBe('a-reprendre')
  })

  it('chaque verdict porte un libellé lisible, aucun ne reste brut', () => {
    for (const verdict of ['a-reprendre', 'trie', 'sans-valeur'] as const) {
      expect(LIBELLE_VERDICT[verdict]).toBeTruthy()
    }
  })
})

describe('verdictDeBureau — une lecture ratée n’est PAS un constat de vide', () => {
  it('lecture échouée : verdict INCONNU, jamais « trié »', () => {
    // DEFAUT DE MON PROPRE MODULE, trouve le 2026-08-26 par un audit concurrent sur le module
    // voisin. `apercuTravauxNonPublies` enveloppe son `git diff` dans un catch muet qui laisse
    // `fichiers = []`. Un index verrouille par une session concurrente suffit donc a faire lire
    // « rien a ajouter » — et, avec un commit existant, a afficher TRIE sur un bureau qui porte
    // peut-etre du travail. Un verdict rassurant faux invite a purger : c'est la pire des sorties.
    expect(verdictDeBureau({ fichiers: [], aUnCommit: true, lectureEchouee: true })).toBe('inconnu')
  })

  it('lecture échouée sans commit non plus : INCONNU, pas « sans valeur »', () => {
    expect(verdictDeBureau({ fichiers: [], aUnCommit: false, lectureEchouee: true })).toBe('inconnu')
  })

  it('lecture échouée MAIS des fichiers lus : À REPRENDRE — ce qu’on a vu prime', () => {
    // Ce qui a ete effectivement lu reste une constatation : ne pas le degrader en « inconnu ».
    expect(
      verdictDeBureau({ fichiers: ['src/a.ts'], aUnCommit: true, lectureEchouee: true })
    ).toBe('a-reprendre')
  })

  it('« inconnu » porte lui aussi un libellé lisible', () => {
    expect(LIBELLE_VERDICT.inconnu).toBeTruthy()
  })
})
