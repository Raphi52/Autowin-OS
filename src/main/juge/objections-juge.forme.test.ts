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

describe('« passes » au sens de nom (passes intermédiaires) n’est pas un effet', () => {
  it('une remarque de forme qui nomme des passes intermédiaires ne bloque pas', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- OK: forme — le commentaire de la ligne 40 décrit les passes intermédiaires du build, pas le résultat final.'
      )
    ).toEqual([])
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- MINEUR: le commentaire de la ligne 40 décrit les passes intermédiaires du build.'
      )
    ).toEqual([])
  })

  it('le verbe qui fait passer un test reste un effet : bloque', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- OK: forme — le commentaire dit que les tests passent sans erreur.'
      )
    ).toHaveLength(1)
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- OK: forme — le commentaire dit que le test passes sans erreur.'
      )
    ).toHaveLength(1)
  })
})

describe('« passes » au sens de nom n’est pas un effet ; le verbe « passe » en est un', () => {
  it('une remarque OK: forme qui cite « les passes intermédiaires » ne bloque pas', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- OK: forme — le commentaire cite les passes intermédiaires du juge.'
      )
    ).toEqual([])
  })

  it('une remarque MINEUR de forme qui nomme « trois passes » ne bloque pas', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n- MINEUR: le titre de la section mentionne trois passes.'
      )
    ).toEqual([])
  })

  it('le verbe (passe, passent) reste un effet, même après un nombre : bloque', () => {
    for (const texte of [
      '- OK: forme — le titre dit que le test passe avant la correction.',
      '- MINEUR: le titre dit que les tests passent avant la correction.',
      '- OK: forme — ça passe alors que le bandeau dit le contraire.',
      '- OK: forme — 54 sur 54 passent, mais le titre dit le contraire.',
      '- MINEUR: le titre dit que trois passent avant la correction.'
    ]) {
      expect(objectionsDuJuge(`VALIDE\nOBJECTIONS:\n${texte}`)).toHaveLength(1)
    }
  })

  it('rejeu de la remarque qui a fait refuser le lot « Affichage » : elle ne bloque plus', () => {
    // Chemin raccourci ; le reste de la remarque est celui du juge.
    const remarque =
      "- OK: forme — objection précédente corrigée. Le bilan final dit « conversation de test » partout, et le commentaire de `LookDecodeBlock.test.tsx` (l.5-8) est réécrit et lisible. Les passes intermédiaires gardent encore « vrai fil », et les noms `final2-look-decode-fil-reel-*.png` aussi : historique, à lire avec la mention « conversation de test »."
    expect(objectionsDuJuge(`VALIDE\nOBJECTIONS:\n${remarque}`)).toEqual([])
  })
})

/*
 * Verdict réel du juge, lot 2 du plan plan-717a0bcd (run build-traite-ensemble-3-candidats-issus-mwfcozv5,
 * 2026-11-13), puces OK raccourcies. Toutes les objections sont OK ; la demande du lot (« termine-la
 * par un résumé court ») a fait ajouter au juge un résumé sous un titre en gras. Ses puces nues
 * étaient lues comme des objections MAJEUR : VALIDE 86 refusé en « Promis mais pas fait ».
 * fix-ok: cause mesurée — `AUTRE_SECTION` (objections-juge.ts) ne reconnaît qu'un titre en
 * majuscules nu ; ce bloc rendait 3 objections avant le correctif (7 cas rouges sur 7).
 */
const VALIDE_LOT_2 = `VALIDE
SCORE: 86
OBJECTIONS:
- OK: Piste 1 vérifiée. J'ai relancé \`npx vitest run src/main/skills/skill-node-mcp.test.ts\` : 59/59, code 0.
- OK: \`npm run typecheck\` : code 0. Lint : 0 erreur.
- OK: hors run — Les commits ne sont pas encore poussés. L'app les fusionne après ce contrôle.

**Résumé pour le fil chef :**
- **Fait :** pistes 1 et 2, corrigées et commitées dans la copie de travail. Tests relancés : 59/59 et 948/948 (code 0). Typage : code 0.
- **Reste :** la piste 3, à relancer une fois le lot 1 sur main.
- **Publication :** fusion sur main par l'app après ce contrôle.`

const PUCES_DU_RESUME =
  '- **Fait :** pistes 1 et 2 corrigées, tests 59/59 (code 0).\n- Reste : la piste 3, à relancer.'

describe('un titre libre après les objections ferme la section : ses puces ne sont pas des reproches', () => {
  it('rejeu du lot 2 : un VALIDE aux objections toutes OK, suivi du résumé pour le chef, reste vert', () => {
    expect(objectionsDuJuge(VALIDE_LOT_2)).toEqual([])
    expect(verdictAvecObjectionsPortees(VALIDE_LOT_2)).toBe(VALIDE_LOT_2)
    // Le lecteur de verdict réel, celui qui décide du vert.
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(VALIDE_LOT_2))).toBe(true)
    // Rouge pour un autre motif, le contrôle ne recopie pas le résumé en promesses non tenues.
    expect(dodDuVerdict(false, VALIDE_LOT_2).some((c) => /Fait|Reste/.test(c.label ?? ''))).toBe(
      false
    )
  })

  it.each([
    ['titre en gras', '**Résumé pour le fil chef :**'],
    ['titre en gras sans deux-points', '**Cibles demandées**'],
    ['libellé en gras suivi de texte', '**Pour le chef :** ce lot est fait.'],
    ['titre markdown', '## Résumé pour le fil chef'],
    ['libellé suivi de « : »', 'Résumé pour le chef (lot 1) :'],
    [
      'libellé en majuscules avec parenthèses',
      'MATRICE (cible demandée → fichier modifié → preuve) :'
    ]
  ])('%s : les puces nues qui suivent ne bloquent pas', (_forme, titre) => {
    const verdict = `VALIDE\nSCORE: 86\nOBJECTIONS:\n- OK: tests 59/59, code 0.\n\n${titre}\n${PUCES_DU_RESUME}`
    expect(objectionsDuJuge(verdict)).toEqual([])
  })

  it('une nouvelle entête OBJECTIONS: rouvre la section entière après un titre libre', () => {
    expect(
      objectionsDuJuge(
        "VALIDE\nOBJECTIONS:\n- OK: tests.\n**Résumé :**\n- Fait : tout.\nOBJECTIONS:\n- le test de la reprise n'existe pas."
      )
    ).toEqual(["le test de la reprise n'existe pas."])
  })
})

/*
 * Jumeaux, mesurés sur les 1 265 verdicts distincts des runs du poste (2026-11-13) : 11 portent un
 * titre libre DANS la section, suivi de puces MAJEUR ou MINEUR (« **Objection 1 (cause par fil) :
 * non corrigée.** » puis trois MAJEUR). Fermer net la section les ferait passer en vert.
 */
describe('jumeaux : ce qui reste un reproche malgré un titre ou une ligne de texte', () => {
  it('une puce étiquetée MAJEUR ou MINEUR sous un titre libre bloque toujours', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n**Objection 1 (cause par fil) : non corrigée.**\n- MAJEUR: le journal ne lit que le premier fil.\n- OK: tests 12/12, code 0.'
      )
    ).toEqual(['le journal ne lit que le premier fil.'])
    expect(
      objectionsDuJuge(
        "VALIDE\nOBJECTIONS:\nObjections du juge précédent :\n- MINEUR: le test de la reprise n'existe pas encore."
      )
    ).toEqual(["le test de la reprise n'existe pas encore."])
  })

  it('une gravité mal étiquetée (« MINEUR — », « MINEUR (…) : ») sous un titre libre reste un reproche', () => {
    // Refus réel (run build-etudie-cause-refus-echec-operation-mw8v9i0o), puces raccourcies.
    const refus = `DEFAUT: deux écarts corrigeables.
OBJECTIONS:
Écarts à corriger dans ce run :
- MINEUR — ÉTENDUE — aucun rejeu ne reproduit le refus, alors que le lot demande de « rejouer la situation d'un des refus contre le correctif ».
Objections du juge précédent :
- MINEUR (objection 7, périmètre) : non corrigé, voir le quatrième point.`
    expect(objectionsDuJuge(refus)).toHaveLength(2)
  })

  it('une sous-puce d’un MAJEUR placé sous un titre libre hérite de sa gravité', () => {
    expect(
      objectionsDuJuge(
        'VALIDE\nOBJECTIONS:\n## Piste 1\n- MAJEUR: deux défauts restent :\n  - le test rouge manque.'
      )
    ).toEqual(['deux défauts restent :', 'le test rouge manque.'])
  })

  it('une ligne de texte qui n’est pas un titre ne ferme pas la section', () => {
    // Suite d'une puce, en retrait, même finie par « : ».
    expect(
      objectionsDuJuge(
        "VALIDE\nOBJECTIONS:\n- OK: tests 12/12.\n  Détail de la vérification :\n- le test de la reprise n'existe pas."
      )
    ).toHaveLength(1)
    // Phrase en début de ligne, sans « : » final.
    expect(
      objectionsDuJuge(
        "VALIDE\nOBJECTIONS:\n- OK: tests 12/12.\nJ'ai relu le reste : voir la ligne 40.\n- le test de la reprise n'existe pas."
      )
    ).toHaveLength(1)
  })

  it('une puce nue à libellé gras, sans titre avant elle, reste une objection', () => {
    expect(
      objectionsDuJuge(
        "VALIDE\nOBJECTIONS:\n- OK: tests 12/12.\n- **Reste :** le test de la reprise n'existe pas."
      )
    ).toHaveLength(1)
  })
})
