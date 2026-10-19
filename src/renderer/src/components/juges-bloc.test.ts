import { describe, expect, it } from 'vitest'
import { blocDesJuges, objectionsDuVerdict, passagesJuges } from './juges-bloc'
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
