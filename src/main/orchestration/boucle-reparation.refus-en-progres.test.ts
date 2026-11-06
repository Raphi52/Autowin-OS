import { describe, expect, it } from 'vitest'
import { deciderDuPassage, type EtatDeBoucleDeReparation } from './boucle-reparation'
import { refusEnProgres } from '../gates/stopgate'
import { noteDuJuge } from '../juge/memoire-juge'
import { PREFIXE_TEST_MODIFIE } from '../juge/objections-juge'

/**
 * 06/11/2026 : un cadrage en mode jusqu'au vert, coupé par « le même refus est revenu 3 fois de
 * suite » alors qu'il progressait : notes du juge 66, puis 68, puis 80 ; objections bloquantes 4,
 * puis 5, puis 2 ; aucune objection commune d'un passage au suivant. `memeRefus` replie le texte
 * des objections (le juge les reformulait autrefois à chaque passage), donc un refus qui progresse
 * et un refus figé y ont la même forme. La note du juge les départage.
 *
 * Les trois refus ci-dessous sont les refus RÉELS de ce run (trace du run, entrées 3, 8 et 12),
 * chemins neutralisés. La boucle est jouée comme l'orchestrateur la mène : `deciderDuPassage`
 * après chaque refus, l'état reporté d'un passage au suivant.
 */
const REFUS_REELS: readonly string[][] = [
  [
    "Promis mais pas fait : « Objection du juge : ÉTENDUE — la consigne de cadrage, dans `<chemin>`, demande de trancher quand un choix d'approche est ouvert : au moins 3 options notées, puis une ligne « Décision ». Ici, trois choix restent ouverts, et le résultat le dit lui-même dans « Reste à faire » : les fils … », « Objection du juge : le résultat se contredit sur ce qui attend ton avis. Il dit « Question : aucune ». Pourtant, il écrit aussi que le travail invisible à l'écran avant la porte est « un risque à ce que tu valides ». La même consigne (`<chemin>`) dit : si une décision ne peut pas se pren… », « Objection du juge : la phrase « Garder le lien laisse le critère 5 non tenu » ignore une protection qui existe déjà. `<chemin>` refuse une commande npm qui modifie `node_modules` pendant que l'app tourne. Son en-tête dit qu'il suit le lien : « jonction suivie : les copies agent relient… », « Objection du juge : le chiffre « déjà 8 copies » est faux d'une unité. Les 8 lignes de `git worktree list` comptent aussi `<chemin>` lui-même, c'est-à-dire main. Il y avait donc 7 copies au moment de la mesure. Au moment où j'ai relancé la commande, il y a 10 lignes, donc 9 copies. Le chiffre bouge vite : mieux vau… »."
  ],
  [
    "Promis mais pas fait : « Objection du juge : le cadrage ne cite pas le mécanisme le plus proche de la demande, qui existe déjà. Avec « Essaie 3 façons », chaque façon de traiter une demande du chat travaille déjà dans sa propre copie, prise sur une photo du dossier partagé. « Garder » la fait ensuite entrer dans main par fusion à trois voies, … », « Objection du juge : le refus « base-dirty » est décrit trop largement. Le résultat dit que la porte refuse dès que `<chemin>` contient du travail non commité. Le code ne refuse que si un fichier changé par la copie est **aussi** non commité dans `<chemin>` : `<chemin> », « Objection du juge : la Décision 2 repose sur un point laissé non vérifié, alors qu'il se vérifie tout de suite. La documentation du CLI Grok installée sur le poste décrit des contrôles déclenchés avant chaque outil, appelés « hooks » (`<chemin>` et `:445… », « Objection du juge : les critères 1 et 4 contredisent la Décision 1. Avec la Décision 1 B, les anciens fils continuent d'écrire et de committer directement dans `<chemin>`. Aujourd'hui, `git status` y affiche déjà 14 lignes. Le critère 1 (« reste vide ») et le critère 4 (« tous les nouveaux commits viennent de la po… », « Objection du juge : la longueur maximale de chemin n'est pas la même dans deux sections. Le cas limite parle de 260 caractères, la section Contraintes de 216. Le code refuse dès 216, soit 215 caractères au plus (`<chemin>`). »."
  ],
  [
    "Promis mais pas fait : « Objection du juge : objection 3 corrigée seulement en partie, côté Grok. Le cadrage dit : « avec Grok, chaque copie doit être déclarée de confiance, sinon le contrôle est ignoré ». C'est vrai pour un contrôle rangé dans le projet, pas pour un contrôle rangé au niveau de l'utilisateur. Or l'app lance Grok sans fenêtre, … », « Objection du juge : la seule ligne « NON VÉRIFIÉ » du tableau Confiance se vérifie en une commande, comme l'objection 3 du passage précédent. Le chat lance Codex par `exec` (`<chemin>`). J'ai lancé `codex exec --help` : l'option apparaît aux lignes 65-67 (« --dangerously-bypass-hook-… »."
  ]
]

/** Joue la boucle jusqu'à l'arrêt, avec la note rendue par le juge à chaque passage. */
function jouerLaBoucle(
  refusDuPassage: (attempt: number) => readonly string[],
  noteDuPassage: (attempt: number) => number | undefined,
  options: { max?: number; jusquAuVert?: boolean } = {}
) {
  const max = options.max ?? 40
  let etat: EtatDeBoucleDeReparation = { motifsPrecedents: [], refusIdentiquesConsecutifs: 0 }
  for (let attempt = 0; attempt < max; attempt++) {
    const note = noteDuPassage(attempt)
    const passage = deciderDuPassage({
      attempt,
      reparationsAccordees: 2,
      plafondDur: 24,
      motifsCourants: refusDuPassage(attempt),
      etat,
      jusquAuVert: options.jusquAuVert ?? true,
      noteDuJuge: note
    })
    if (passage.arret) return { refusPayes: attempt + 1, arret: passage.arret }
    etat = passage.etatSuivant
  }
  return { refusPayes: max, arret: undefined }
}

describe('jusqu au vert : un refus dont la note du juge monte est un progrès', () => {
  it('les 3 refus réels (notes 66, 68, 80) ne coupent plus la réparation', () => {
    const notes = [66, 68, 80]
    const { refusPayes, arret } = jouerLaBoucle(
      (attempt) => REFUS_REELS[attempt],
      (attempt) => notes[attempt],
      { max: 3 }
    )
    expect(arret).toBeUndefined()
    expect(refusPayes).toBe(3)
  })

  it('jumeau : les mêmes refus avec une note qui oscille (70, 68, 70) s arrêtent au 3e', () => {
    const notes = [70, 68, 70]
    const { refusPayes, arret } = jouerLaBoucle(
      (attempt) => REFUS_REELS[attempt] ?? REFUS_REELS[2],
      (attempt) => notes[attempt] ?? 70
    )
    expect(refusPayes).toBe(3)
    expect(arret).toMatch(/même refus est revenu 3 fois de suite/)
  })

  it('jumeau : sans note du juge, le refus répété s arrête toujours au 3e', () => {
    const { refusPayes, arret } = jouerLaBoucle(
      (attempt) => REFUS_REELS[attempt] ?? REFUS_REELS[2],
      () => undefined
    )
    expect(refusPayes).toBe(3)
    expect(arret).toMatch(/même refus est revenu 3 fois de suite/)
  })

  it('après le dernier progrès, le compte repart : 66, 80, puis 80 et 80 s arrêtent au 4e', () => {
    const notes = [66, 80, 80, 80, 80]
    const { refusPayes, arret } = jouerLaBoucle(
      (attempt) => REFUS_REELS[attempt] ?? REFUS_REELS[2],
      (attempt) => notes[attempt] ?? 80
    )
    expect(refusPayes).toBe(4)
    expect(arret).toMatch(/même refus est revenu 3 fois de suite/)
  })

  it('une note égale à la meilleure n est pas un progrès', () => {
    expect(refusEnProgres({ motifsCourants: ['x'], note: 80, meilleureNote: 80 })).toBe(false)
    expect(refusEnProgres({ motifsCourants: ['x'], note: 81, meilleureNote: 80 })).toBe(true)
    expect(refusEnProgres({ motifsCourants: ['x'], note: 81 })).toBe(false)
  })

  it('un fichier de test jamais restauré reste un constat de code : la note n y change rien', () => {
    expect(
      refusEnProgres({
        motifsCourants: [`${PREFIXE_TEST_MODIFIE} : a.test.ts`],
        note: 90,
        meilleureNote: 60
      })
    ).toBe(false)
  })
})

describe('hors jusqu au vert : la note en hausse remet aussi le compte à zéro', () => {
  it('5 refus repliés identiques mais notés 60, 70, 80, 90, 95 ne sont pas un refus figé', () => {
    const notes = [60, 70, 80, 90, 95]
    const { arret } = jouerLaBoucle(
      () => REFUS_REELS[0],
      (attempt) => notes[attempt],
      { max: 5, jusquAuVert: false }
    )
    expect(arret).toBeUndefined()
  })

  it('jumeau : les mêmes refus sans note s arrêtent au 3e', () => {
    const { refusPayes, arret } = jouerLaBoucle(
      () => REFUS_REELS[0],
      () => undefined,
      {
        jusquAuVert: false
      }
    )
    expect(refusPayes).toBe(4)
    expect(arret).toMatch(/même refus est revenu 2 fois de suite/)
  })
})

describe('noteDuJuge — la ligne SCORE du verdict', () => {
  it('lit la note d un juge', () => {
    expect(noteDuJuge('DEFAUT: x\nSCORE: 66')).toBe(66)
    expect(noteDuJuge('VALIDE\n**SCORE:** 72\nOBJECTIONS:')).toBe(72)
  })

  it('plusieurs notes (panel, juge qui se corrige) : la plus basse compte', () => {
    expect(noteDuJuge('VALIDE\nSCORE: 90\n---\nDEFAUT: y\nSCORE: 40')).toBe(40)
  })

  it('pas de note lisible : rien', () => {
    expect(noteDuJuge('DEFAUT: sans note')).toBeUndefined()
    expect(noteDuJuge('SCORE: 150')).toBeUndefined()
    expect(noteDuJuge('le SCORE: 50 cité au milieu d une phrase')).toBeUndefined()
    expect(noteDuJuge('')).toBeUndefined()
  })
})
