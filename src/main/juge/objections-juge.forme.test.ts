import { describe, expect, it } from 'vitest'
import { lireVerdictJuge } from '../orchestration/orchestrator-contrats'
import {
  CONTRAT_OBJECTIONS,
  defautsDeLaRelectureSeule,
  dodDuVerdict,
  objectionsDuJuge,
  objectionsNotees,
  verdictAvecObjectionsPortees
} from './objections-juge'

// fix-ok: esbuild refusait une apostrophe droite dans une chaîne à guillemets simples (erreur
// « Expected ";" » à la transformation du test) : ces remarques sont en guillemets doubles.

/*
 * Textes réels du juge, run build-fais-accepter-plusieurs-kaizen-mw7icgfg (2026-11-08), chemins
 * raccourcis. Le bandeau d'un fichier de test et un titre de test bloquaient la livraison au même
 * titre qu'une conversation nommée ignorée sans un mot : seul ce dernier doit bloquer.
 */
const REMARQUE_BANDEAU =
  "- MINEUR: `src/main/kaizen/autowin-kaizen-context.plusieurs-conversations.test.ts` lignes 19 à 20 : le bandeau raconte l'ancien comportement (« ne construisait que le dossier de la première »). Même défaut que l'objection 4 : ne garder que le pourquoi."
const REMARQUE_TITRE =
  "- MINEUR: même fichier, ligne 257 : le titre « quand le dossier joint est celui de la conversation courante » garde l'hypothèse que l'objection 3 a retirée. Le titre doit dire que le repli est nommé, sans désigner la conversation courante."
const REMARQUE_NUMEROS =
  "- MINEUR: `/kaizen 1263 1264 le bouton` ne lit que conv-1263 ; 1264 disparaît de la tâche sans un mot (lignes 1009 à 1014 du fichier de contexte). Le producteur le signale lui-même. Réparation : écrire dans la tâche les numéros nus ignorés et comment les lire (« conv-1264 »). Ne pas trancher à la place de l'utilisateur."

const DEFAUT_CONV_1716 = `DEFAUT: trois écarts corrigeables dans cette passe (deux formulations du test gardent l'ancienne version, et un numéro nu est ignoré sans un mot).

SCORE: 80

OBJECTIONS:
${REMARQUE_BANDEAU}
${REMARQUE_TITRE}
${REMARQUE_NUMEROS}`

describe('rejeu des remarques réelles du juge (run build-fais-accepter-plusieurs-kaizen-mw7icgfg)', () => {
  it('le bandeau et le titre ne bloquent plus, la conversation ignorée bloque toujours', () => {
    const bloquantes = objectionsDuJuge(DEFAUT_CONV_1716)
    expect(bloquantes).toHaveLength(1)
    expect(bloquantes[0]).toMatch(/1264 disparaît/)
  })

  it('la DoD ne nomme que la conversation ignorée, jamais le bandeau ni le titre', () => {
    const cases = dodDuVerdict(false, DEFAUT_CONV_1716)
    expect(cases).toHaveLength(1)
    expect(cases[0].checked).toBe(false)
    expect(cases[0].label).toMatch(/1264 disparaît/)
    expect(cases.some((c) => /bandeau|titre/.test(c.label ?? ''))).toBe(false)
  })

  it('un VALIDE dont les seules remarques sont le bandeau et le titre reste vert', () => {
    const valide = `VALIDE\nSCORE: 86\nOBJECTIONS:\n${REMARQUE_BANDEAU}\n${REMARQUE_TITRE}`
    expect(verdictAvecObjectionsPortees(valide)).toBe(valide)
    // Le lecteur de verdict réel, celui qui décide du vert : il doit lire ce VALIDE comme approuvé.
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(valide))).toBe(true)
  })
})

/*
 * Mesure sur les 10 remarques distinctes de ce run (toutes les versions du juge) : chaque
 * ligne dit si elle bloque. Une remarque de forme (commentaire, bandeau, titre, accord) bloque
 * seulement si elle porte aussi un effet de comportement ou de test.
 */
describe('mesure du run : 5 remarques de forme sur 10 ne bloquent pas', () => {
  const remarques: Array<{ texte: string; bloque: boolean }> = [
    { texte: REMARQUE_BANDEAU, bloque: false },
    { texte: REMARQUE_TITRE, bloque: false },
    { texte: REMARQUE_NUMEROS, bloque: true },
    {
      texte:
        "- MINEUR: commentaire d'historique dans `src/main/kaizen/autowin-kaizen-context.plusieurs-conversations.test.ts`, ligne 226 : « Avant le correctif, seul le premier dossier était lu » raconte l'historique. Garder seulement le pourquoi.",
      bloque: false
    },
    {
      texte:
        "- MINEUR: deux commentaires gardent l'historique, contre la règle du dépôt (un commentaire dit le pourquoi). Le premier est à la ligne 39 de `src/main/commands/orchestration-tache.ts` (« vérifiée à l'exécution par un test temporaire … supprimé après »). Action : retirer la mention du test temporaire et de l'ancienne fonction, en gardant la cause.",
      bloque: false
    },
    {
      texte:
        '- MINEUR: pied du dossier « Audite ces 1 conversations » quand une seule conversation nommée existe sur deux demandées (`src/main/kaizen/autowin-kaizen-context.ts`, ligne 915). Accord à corriger.',
      bloque: false
    },
    {
      texte:
        "- MINEUR: la branche de `orchestration-tache.ts` (lignes 142 à 146) n'a aucun test permanent. Aucun test n'appelle `composerTacheDOrchestration`.",
      bloque: true
    },
    {
      texte:
        "- MINEUR: l'en-tête « N CONVERSATIONS NOMMÉES » compte les dossiers joints, pas les conversations demandées.",
      bloque: true
    },
    {
      texte:
        "- MINEUR: en-tête de repli (`src/main/kaizen/autowin-kaizen-context.ts`, ligne 893) dit « la conversation où /kaizen a été tapé ». C'est faux quand le repli vient d'une commande citée.",
      bloque: true
    },
    {
      texte:
        '- MAJEUR: `/kaizen 1263 2 bugs dans le rendu` rend `conv-1263` et `conv-2`. Le nombre nu « 2 » qui suit le premier numéro passe.',
      bloque: true
    }
  ]

  it('chaque remarque bloque ou non selon le contrat ; 5 sur 10 ne bloquent pas', () => {
    const verdicts = remarques.map(
      (r) => objectionsDuJuge(`VALIDE\nOBJECTIONS:\n${r.texte}`).length === 1
    )
    expect(verdicts).toEqual(remarques.map((r) => r.bloque))
    expect(verdicts.filter((b) => !b)).toHaveLength(5)
  })
})

describe('le contrat du juge dit où écrire une remarque de forme', () => {
  it('une remarque de forme seule s’écrit OK: forme, et la première ligne reste VALIDE', () => {
    expect(CONTRAT_OBJECTIONS).toMatch(/OK: forme —/u)
    expect(CONTRAT_OBJECTIONS).toMatch(/première ligne VALIDE/u)
    expect(CONTRAT_OBJECTIONS).toMatch(/jamais OK/u)
  })
})

describe('jumeaux : une remarque de forme qui porte un effet bloque toujours', () => {
  it('forme + effet de comportement ou de test : bloque', () => {
    for (const texte of [
      '- MINEUR: le titre du test rend conv-2 à la place de conv-1263.',
      "- MINEUR: le commentaire dit que la branche n'a aucun test permanent.",
      '- MINEUR: le bandeau dit que la branche ne lit que conv-1263.'
    ]) {
      expect(objectionsDuJuge(`VALIDE\nOBJECTIONS:\n${texte}`)).toHaveLength(1)
    }
  })

  it('forme mais MAJEUR, ou puce sans étiquette : bloque', () => {
    expect(
      objectionsDuJuge('VALIDE\nOBJECTIONS:\n- MAJEUR: le titre de la section est illisible.')
    ).toHaveLength(1)
    expect(
      objectionsDuJuge('VALIDE\nOBJECTIONS:\n- le commentaire de la ligne 40 est mal placé.')
    ).toHaveLength(1)
  })

  it('un refus DEFAUT dont toutes les remarques sont de forme reste un refus, et les nomme', () => {
    const refus =
      'DEFAUT: formulation à revoir\nOBJECTIONS:\n- MINEUR: le titre « x » est mal formulé.'
    const cases = dodDuVerdict(false, refus)
    expect(cases).toHaveLength(1)
    expect(cases[0].checked).toBe(false)
    expect(cases[0].label).toMatch(/titre/)
  })

  it('un OK: forme qui porte un effet bloque ; un OK: forme sans effet ne bloque pas', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- OK: forme — le titre rend conv-2 à la place de conv-1263.'
      )
    ).toHaveLength(1)
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- OK: forme — le titre est mal placé.')).toEqual(
      []
    )
  })

  it('un écart de périmètre (ÉTENDUE) avec un mot de forme bloque', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- MINEUR: ÉTENDUE — le titre de la section n’est pas fait.'
      )
    ).toHaveLength(1)
  })
})

describe('une remarque de forme reste notée : relecture seule et mémoire du juge', () => {
  it('la relecture seule garde le commentaire daté de travers dans le Journal', () => {
    const refus =
      'DEFAUT: relu\nOBJECTIONS:\n- MINEUR: le commentaire de la ligne 40 date du mauvais jour.'
    expect(defautsDeLaRelectureSeule('judge', 0, refus)).toEqual([
      'MINEUR: le commentaire de la ligne 40 date du mauvais jour.'
    ])
  })

  it('les notes gardent la remarque de forme ; les bloquantes restent seules à bloquer', () => {
    expect(objectionsNotees(DEFAUT_CONV_1716)).toHaveLength(3)
    expect(objectionsDuJuge(DEFAUT_CONV_1716)).toHaveLength(1)
  })
})
