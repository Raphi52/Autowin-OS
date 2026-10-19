import { describe, expect, it } from 'vitest'
import {
  blocDesJuges,
  blocDesJugesEnDirect,
  objectionsDuVerdict,
  passagesJuges
} from './juges-bloc'
import type { StepDeRun } from './juges-votes'
import trace from './juges-bloc.conv253.fixture.json'

/**
 * BLOC DES JUGES (conv-328, /draft « un bloc pour afficher les judges dans le chat », choix
 * « 1 · Nacre » sur la mise en page « Corrigé dans l'objection »).
 *
 * La trace est la VRAIE trace du run jugé de conv-253 (relance-construction-lecteur-video-fil) :
 * 4 verdicts du même juge, un par passage de réparation. Seuls les textes des phases non jugées
 * sont remplacés, et le chemin du dossier personnel est anonymisé.
 */
const steps = trace as StepDeRun[]

describe('passagesJuges — un verdict par passage de réparation', () => {
  it('range les 4 verdicts de conv-253 dans 4 passages, pas 4 juges', () => {
    const passages = passagesJuges(steps)
    expect(passages.map((p) => p.reparation)).toEqual([1, 2, 4, 5])
    expect(passages.every((p) => p.steps.length === 1)).toBe(true)
  })

  it('un panel de juges dans le même passage reste un seul passage', () => {
    const panel = passagesJuges([
      { step: 'judge', model: 'a', text: 'VALIDE' },
      { step: 'judge', model: 'b', text: 'DEFAUT: x' }
    ])
    expect(panel).toHaveLength(1)
    expect(panel[0].steps).toHaveLength(2)
  })
})

describe('blocDesJuges — le dernier passage, suivi par le précédent', () => {
  const bloc = blocDesJuges(steps)!

  it('montre le dernier passage : un juge, score 80, DÉFAUT', () => {
    expect(bloc.reparation).toBe(5)
    expect(bloc.passagePrecedent).toBe(true)
    expect(bloc.votes).toHaveLength(1)
    expect(bloc.votes[0]).toMatchObject({ libelle: 'claude-opus-5-5', vote: 'defaut', score: 80 })
  })

  it('les 3 objections MINEUR, sans les constats OK', () => {
    expect(bloc.objections.map((o) => o.gravite)).toEqual(['MINEUR', 'MINEUR', 'MINEUR'])
    expect(bloc.objections.some((o) => /consigne adressée au juge/.test(o.texte))).toBe(false)
  })

  it('le suivi vient des mots du juge : en partie, reprise, nouvelle', () => {
    expect(bloc.objections.map((o) => o.suivi)).toEqual(['partie', 'reprise', 'nouvelle'])
  })

  it('ce qui est réglé est accroché à son objection, cité tel quel', () => {
    const [premiere, deuxieme] = bloc.objections
    expect(premiere.corrige).toEqual([
      'un texte, un PDF ou un son seul renommés en `.mp4` sont refusés avec un message',
      'un fichier absent est refusé aussi'
    ])
    expect(premiere.texte).not.toContain('Ce qui est réglé')
    expect(premiere.texte).toContain('Ce qui passe encore')
    expect(deuxieme.corrige).toEqual([])
  })

  it("l'adresse = les fichiers cités par le juge, lignes et fonction comprises", () => {
    const [premiere, deuxieme, troisieme] = bloc.objections
    expect(premiere.adresses).toEqual([
      { chemin: 'ArtifactVideoPlayer.tsx', affiche: 'ArtifactVideoPlayer.tsx' },
      {
        chemin: 'src/main/video-ffprobe.ts',
        affiche: 'src/main/video-ffprobe.ts',
        lieu: 'lireSortieFfprobe',
        lignes: 'l.60-81'
      }
    ])
    expect(deuxieme.adresses).toEqual([
      {
        chemin: 'src/main/video-ffprobe.ts',
        affiche: 'src/main/video-ffprobe.ts',
        lignes: 'l.11-12'
      }
    ])
    // Un chemin absolu s'affiche depuis src/ ; le chemin complet reste dans `chemin`.
    expect(troisieme.adresses.map((a) => a.affiche)).toEqual([
      'causal-trace/conv-253.jsonl',
      'commands.ts',
      'src/main/orchestrator.ts'
    ])
    expect(troisieme.adresses[2]).toMatchObject({
      chemin: 'D:/Autowin/src/main/orchestrator.ts',
      lignes: 'l.5680'
    })
  })

  it('les sous-puces restent dans leur objection', () => {
    expect(bloc.objections[2].texte).toContain('• à 16:59:39 Z')
    expect(bloc.objections[2].texte).toContain("La réparation 5 n'a pas encore été refusée")
  })
})

describe('objectionsDuVerdict — cas limites', () => {
  it('sans passage précédent, une objection sans mot de suivi n’a pas d’état', () => {
    const [o] = objectionsDuVerdict('DEFAUT: x\nOBJECTIONS:\n- MINEUR: le test manque', false)
    expect(o.suivi).toBeUndefined()
  })

  it('un fichier média cité n’est pas une adresse à corriger', () => {
    const [o] = objectionsDuVerdict(
      'OBJECTIONS:\n- MAJEUR: `img.png.mp4` passe encore, voir `src/a.ts:3`',
      false
    )
    expect(o.adresses.map((a) => a.affiche)).toEqual(['src/a.ts'])
  })

  it('« OBJECTIONS: aucune » ne rend rien', () => {
    expect(objectionsDuVerdict('VALIDE\nOBJECTIONS: aucune', false)).toEqual([])
  })

  it('une puce nue compte comme bloquante, sauf à côté d’un MAJEUR (règle du contrôle final)', () => {
    expect(objectionsDuVerdict('OBJECTIONS:\n- la preuve manque', false)).toHaveLength(1)
    expect(
      objectionsDuVerdict('OBJECTIONS:\n- MAJEUR: la preuve manque\n- 54 sur 54 passent', false)
    ).toHaveLength(1)
  })

  it('la section s’arrête à la section suivante', () => {
    const o = objectionsDuVerdict('OBJECTIONS:\n- MINEUR: a\nPREUVES:\n- b', false)
    expect(o.map((x) => x.texte)).toEqual(['a'])
  })
})

/**
 * EN DIRECT (conv-1021) : la même trace de conv-253, coupée là où le run en était. Le dernier
 * verdict (index 27, réparation 5) est en train de s'écrire ; celui d'avant (index 21, réparation 4)
 * est rendu.
 */
describe('blocDesJugesEnDirect — le bloc pendant que ça juge', () => {
  const avantDernierJuge = steps.slice(0, 27)
  const verdictFinal = steps[27].text ?? ''
  const debutObjections = verdictFinal.indexOf('OBJECTIONS:')
  const finPremiere = verdictFinal.indexOf('\n- MINEUR', debutObjections + 'OBJECTIONS:'.length + 2)
  const juge = { step: 'judge', model: 'claude-opus-5-5' }

  it('le juge écrit : ses objections apparaissent au fil du texte reçu', () => {
    const avant = blocDesJugesEnDirect({
      steps: avantDernierJuge,
      enCours: true,
      phase: juge,
      texte: verdictFinal.slice(0, debutObjections)
    })
    expect(avant.enCours).toMatchObject({
      libelle: 'claude-opus-5-5',
      lisible: true,
      reparation: 5
    })
    expect(avant.enCours?.objections).toEqual([])
    const une = blocDesJugesEnDirect({
      steps: avantDernierJuge,
      enCours: true,
      phase: juge,
      texte: verdictFinal.slice(0, finPremiere)
    })
    expect(une.enCours?.objections.map((o) => [o.gravite, o.suivi])).toEqual([['MINEUR', 'partie']])
    const toutes = blocDesJugesEnDirect({
      steps: avantDernierJuge,
      enCours: true,
      phase: juge,
      texte: verdictFinal
    })
    expect(toutes.enCours?.objections.map((o) => o.suivi)).toEqual([
      'partie',
      'reprise',
      'nouvelle'
    ])
    // Le verdict d'avant reste là : c'est lui qui donne le suivi des objections.
    expect(toutes.bloc?.reparation).toBe(4)
  })

  it('plusieurs juges en parallèle : leur texte mêlé n’est pas lu', () => {
    const etat = blocDesJugesEnDirect({
      steps: avantDernierJuge,
      enCours: true,
      phase: { ...juge, execution: { groupId: 'judge:fanout' } },
      texte: verdictFinal
    })
    expect(etat.enCours).toMatchObject({ lisible: false, objections: [] })
  })

  it('une réparation tourne après le verdict : le bloc montre ce verdict et dit laquelle', () => {
    const etat = blocDesJugesEnDirect({
      steps: steps.slice(0, 26),
      enCours: true,
      phase: { step: 'exec', model: 'claude-opus-5-5' }
    })
    expect(etat.enCours).toBeUndefined()
    expect(etat.bloc?.reparation).toBe(4)
    expect(etat.reparationEnCours).toBe(5)
  })

  it('le run arrêté : plus rien n’est en cours, seul le dernier verdict compte', () => {
    const etat = blocDesJugesEnDirect({
      steps: steps.slice(0, 26),
      enCours: false,
      phase: juge,
      texte: verdictFinal
    })
    expect(etat).toEqual({ bloc: blocDesJuges(steps.slice(0, 26)) })
  })

  it('avant le premier verdict : rien à montrer tant qu’aucun juge n’écrit', () => {
    expect(
      blocDesJugesEnDirect({ steps: steps.slice(0, 4), enCours: true, phase: { step: 'exec' } })
    ).toEqual({ bloc: null })
  })
})
