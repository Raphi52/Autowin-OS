import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  construireRapport,
  executer,
  formaterContexte,
  formaterRapport,
  ligneDeListe,
  mesurerUsages,
  skillDuMessage,
  valeurDOption
} from './skill-doctor.mjs'
import { ligneDeSkill } from '../src/main/commands.ts'
import { nativeSkills } from '../src/main/native-registry.ts'

const NOMS = ['build', 'clean', 'draft', 'git', 'judge', 'look', 'graft']
const MAINTENANT = Date.parse('2026-10-31T12:00:00Z')
const IL_Y_A = (jours) => MAINTENANT - jours * 86_400_000
const ISO = (ms) => new Date(ms).toISOString()

const dossiers = []
afterEach(() => {
  while (dossiers.length) rmSync(dossiers.pop(), { recursive: true, force: true })
})

function donnees() {
  const data = mkdtempSync(join(tmpdir(), 'skill-doctor-'))
  dossiers.push(data)
  return data
}

function ecrire(data, relatif, contenu) {
  const fichier = join(data, relatif)
  mkdirSync(join(fichier, '..'), { recursive: true })
  writeFileSync(fichier, contenu)
  return fichier
}

const jsonl = (lignes) => lignes.map((l) => JSON.stringify(l)).join('\n')

const appelSkillCharger = (turnId, nom, ms) => ({
  type: 'tool-call',
  turnId,
  timestamp: ISO(ms),
  payloads: [{ kind: 'tool-call', name: 'skill_charger', content: JSON.stringify({ nom }) }]
})

const demande = (turnId, mots, ms) => ({
  type: 'message',
  turnId,
  timestamp: ISO(ms),
  payloads: [
    {
      kind: 'user-message',
      content: `UTILISATEUR: <message_utilisateur>${mots}</message_utilisateur>`
    }
  ]
})

describe('skillDuMessage — seul ce qui charge la procédure compte', () => {
  it.each([
    ['/build corrige ça', 'build'],
    ['draft des animations', 'draft'],
    ['/draf une maquette', 'draft'],
    ['/git pousse tout', 'git']
  ])('« %s » charge %s', (texte, attendu) => {
    expect(skillDuMessage(texte, NOMS)).toBe(attendu)
  })

  it.each([
    'fais un draft',
    'regarde /build quand tu peux',
    'git status me dit une erreur',
    'draft = 6',
    '/inconnue bonjour'
  ])('« %s » ne charge rien', (texte) => {
    expect(skillDuMessage(texte, NOMS)).toBeUndefined()
  })
})

describe('mesurerUsages — les trois chemins de chargement', () => {
  it('compte les messages sur le snapshot, les archives et le journal, sans doublon', () => {
    const data = donnees()
    const message = (messageId, content, ts) => ({ messageId, role: 'user', content, ts })
    ecrire(
      data,
      'conversations.json',
      JSON.stringify([{ id: 'conv-1', messages: [message('m1', '/build a', IL_Y_A(40))] }])
    )
    ecrire(
      data,
      'conversations.json.archive/conv-2.json',
      JSON.stringify({ id: 'conv-2', messages: [message('m2', 'build b', IL_Y_A(30))] })
    )
    ecrire(
      data,
      'conversations.json.journal.jsonl',
      jsonl([
        // Le journal rejoue m1, déjà dans le snapshot : un seul usage.
        { op: 'append-messages', id: 'conv-1', messages: [message('m1', '/build a', IL_Y_A(40))] },
        { op: 'append-messages', id: 'conv-1', messages: [message('m3', '/build c', IL_Y_A(2))] }
      ])
    )
    const usages = mesurerUsages({ data, noms: NOMS, maintenant: MAINTENANT })
    expect(usages.get('build')).toMatchObject({ tapee: 3, dernier: IL_Y_A(2) })
  })

  it('reprend les saisies d un fil supprimé, sans doublon ni orientation', () => {
    const data = donnees()
    const saisie = (texte, ts, voie) => ({
      ts,
      conversationId: 'nouvelle-conversation',
      texte,
      voie
    })
    ecrire(
      data,
      'conversations.json',
      JSON.stringify([
        { id: 'conv-1', messages: [{ role: 'user', content: '/build a', ts: IL_Y_A(3) }] }
      ])
    )
    ecrire(
      data,
      'saisies-utilisateur.jsonl',
      jsonl([
        // Déjà dans conv-1, à quelques secondes près : un seul usage.
        saisie('/build a', IL_Y_A(3) + 2000, 'message'),
        // Même texte tapé deux semaines plus tôt, dans un fil supprimé : un usage de plus.
        saisie('/build a', IL_Y_A(17), 'message'),
        saisie('/graft x', IL_Y_A(60), 'message'),
        saisie('/look y', IL_Y_A(1), 'orientation'),
        saisie('pas une skill', IL_Y_A(1), 'message')
      ])
    )
    const usages = mesurerUsages({ data, noms: NOMS, maintenant: MAINTENANT })
    expect(usages.get('build').tapee).toBe(2)
    expect(usages.get('graft')).toMatchObject({ tapee: 1, dernier: IL_Y_A(60) })
    expect(usages.get('look').tapee).toBe(0)
  })

  it('compte un skill_charger, quelle que soit la forme du nom, et rien d autre', () => {
    const data = donnees()
    ecrire(
      data,
      'causal-trace/conv-1.jsonl',
      jsonl([
        appelSkillCharger('t1', '/look — Convertit ce qui est affiché', IL_Y_A(50)),
        appelSkillCharger('t2', 'inexistante', IL_Y_A(50)),
        // Une commande qui CITE skill_charger n'en est pas un appel.
        {
          type: 'tool-call',
          turnId: 't3',
          timestamp: ISO(IL_Y_A(1)),
          payloads: [{ name: 'Bash', content: '"skill_charger" look' }]
        }
      ])
    )
    const usages = mesurerUsages({ data, noms: NOMS, conversations: [{}], maintenant: MAINTENANT })
    expect(usages.get('look')).toMatchObject({ modele: 1, dernier: IL_Y_A(50) })
    expect([...usages.values()].reduce((n, u) => n + u.modele, 0)).toBe(1)
  })

  // Le rapport passait `arenagame` de « 4×, 36 jours » à « 5×, aujourd'hui » sur un seul appel refusé
  // parce que la skill était désactivée (/judge conv-1369).
  it('ne compte pas un skill_charger refusé, ni pour l usage ni pour les jetons', () => {
    const resultat = (turnId, ms, content) => ({
      type: 'tool-result',
      turnId,
      timestamp: ISO(ms),
      payloads: [{ kind: 'tool-result', name: 'skill_charger', content }]
    })
    const data = donnees()
    ecrire(
      data,
      'causal-trace/conv-1.jsonl',
      jsonl([
        appelSkillCharger('ancien', 'look', IL_Y_A(50)),
        resultat('ancien', IL_Y_A(50), '{ "skill": "look", "procedure": "..." }'),
        appelSkillCharger('refus', 'look', IL_Y_A(1)),
        resultat('refus', IL_Y_A(1), 'skill_charger : la skill « look » est désactivée'),
        // Une skill inconnue ne doit pas emporter un chargement réussi du même tour.
        appelSkillCharger('mixte', 'judge', IL_Y_A(1)),
        appelSkillCharger('mixte', 'inexistante', IL_Y_A(1)),
        resultat('mixte', IL_Y_A(1), 'skill_charger : aucune skill nommée « inexistante »')
      ])
    )
    ecrire(
      data,
      'activity/conv-1.jsonl',
      jsonl([
        { kind: 'chat-usage', turnId: 'refus', ts: ISO(IL_Y_A(1)), inputTokens: 700 },
        { kind: 'chat-usage', turnId: 'mixte', ts: ISO(IL_Y_A(1)), inputTokens: 40 }
      ])
    )
    const usages = mesurerUsages({ data, noms: NOMS, conversations: [{}], maintenant: MAINTENANT })
    expect(usages.get('look')).toMatchObject({ modele: 1, dernier: IL_Y_A(50), jetons7j: 0 })
    expect(usages.get('judge')).toMatchObject({ modele: 1, jetons7j: 40 })
  })

  it('compte les étapes de run : trace.json, ou RUN.md pour les anciens, une fois par run', () => {
    const data = donnees()
    ecrire(
      data,
      'runs/conv-1/r1-workspace/trace.json',
      JSON.stringify([
        { step: 'exec', execution: { phase: 'clean' }, tokens: 100 },
        { step: 'exec', execution: { phase: 'clean' }, tokens: 50 },
        // `salvage` est une étape, pas une skill du kit.
        { step: 'exec', execution: { phase: 'salvage' }, tokens: 999 },
        { step: 'gate' }
      ])
    )
    ecrire(
      data,
      'runs/conv-1/r2-workspace/RUN.md',
      '## Livrable des phases\n### phase clean\n### phase build\n'
    )
    const ancien = ecrire(data, 'runs/conv-1/r3-workspace/RUN.md', '### phase clean\n')
    utimesSync(ancien, new Date(IL_Y_A(20)), new Date(IL_Y_A(20)))

    const usages = mesurerUsages({
      data,
      noms: NOMS,
      conversations: [{}],
      maintenant: Date.now() + 1000
    })
    expect(usages.get('clean').etape).toBe(3)
    expect(usages.get('clean').jetons7j).toBe(150)
    expect(usages.get('build').etape).toBe(1)
  })

  it('attribue les jetons d un tour récent à ses skills, à parts égales, hors fenêtre exclue', () => {
    const data = donnees()
    ecrire(
      data,
      'causal-trace/conv-1.jsonl',
      jsonl([
        demande('recent', '/build x', IL_Y_A(1)),
        appelSkillCharger('recent', 'look', IL_Y_A(1)),
        demande('vieux', '/judge y', IL_Y_A(9))
      ])
    )
    ecrire(
      data,
      'activity/conv-1.jsonl',
      jsonl([
        {
          kind: 'chat-usage',
          turnId: 'recent',
          ts: ISO(IL_Y_A(1)),
          inputTokens: 700,
          outputTokens: 100
        },
        {
          kind: 'chat-recovered',
          turnId: 'recent',
          ts: ISO(IL_Y_A(1)),
          inputTokens: 150,
          outputTokens: 50
        },
        { kind: 'exec', turnId: 'recent', ts: ISO(IL_Y_A(1)), inputTokens: 9999 },
        {
          kind: 'chat-usage',
          turnId: 'vieux',
          ts: ISO(IL_Y_A(9)),
          inputTokens: 5000,
          outputTokens: 0
        }
      ])
    )
    const usages = mesurerUsages({ data, noms: NOMS, conversations: [{}], maintenant: MAINTENANT })
    expect(usages.get('build').jetons7j).toBe(500)
    expect(usages.get('look').jetons7j).toBe(500)
    expect(usages.get('judge').jetons7j).toBe(0)
  })
})

describe('construireRapport — mêmes règles que claude.exe', () => {
  const skill = (id, enabled = true) => ({
    id,
    description: 'Fait une chose.',
    enabled,
    source: 'kit'
  })
  const usage = (over) => new Map(over)

  it('range les jamais servies d abord, puis de la plus ancienne à la plus récente', () => {
    const { lignes } = construireRapport({
      skills: [skill('recente'), skill('jamais'), skill('ancienne')],
      usages: usage([
        ['recente', { tapee: 1, modele: 0, etape: 0, dernier: IL_Y_A(0), jetons7j: 0 }],
        ['ancienne', { tapee: 1, modele: 0, etape: 0, dernier: IL_Y_A(12), jetons7j: 0 }]
      ]),
      maintenant: MAINTENANT
    })
    expect(lignes.map((l) => l.nom)).toEqual(['jamais', 'ancienne', 'recente'])
    expect(lignes[1].joursDepuis).toBe(12)
  })

  it('ne signale pas une skill désactivée : hors de la liste, elle ne coûte rien', () => {
    const rapport = construireRapport({
      skills: [skill('active'), skill('coupee', false)],
      usages: new Map(),
      maintenant: MAINTENANT
    })
    expect(rapport.jamaisInvoquees.map((l) => l.nom)).toEqual(['active'])
    expect(rapport.lignes.find((l) => l.nom === 'coupee').contexte).toBeNull()
  })

  it('une skill jouée seulement par les runs n est pas « jamais invoquée »', () => {
    const rapport = construireRapport({
      skills: [skill('clean')],
      usages: usage([
        ['clean', { tapee: 0, modele: 0, etape: 8, dernier: IL_Y_A(1), jetons7j: 42 }]
      ]),
      maintenant: MAINTENANT
    })
    expect(rapport.jamaisInvoquees).toEqual([])
    expect(formaterRapport(rapport)).toContain('Toutes les skills chargées ont servi')
  })

  it('imprime les colonnes et le signalement', () => {
    const texte = formaterRapport(
      construireRapport({ skills: [skill('oubliee')], usages: new Map(), maintenant: MAINTENANT })
    )
    expect(texte).toMatch(/skill\s+source\s+contexte\s+jetons 7 j\s+usages\s+dernier usage/u)
    expect(texte).toMatch(/oubliee\s+kit\s+\S+( 20)?\s+-\s+0×\s+jamais/u)
    expect(texte).toContain('1 skill chargée mais jamais invoquée.')
    // L'interface n'a pas d'interrupteur pour les skills (CapabilitiesView.tsx) : le dire évite de
    // renvoyer l'utilisateur vers un bouton qui n'existe pas.
    expect(texte).toContain('registry/enablement.v1.json')
    expect(texte).toContain('Réglages › Skills est en lecture seule')
  })

  // /judge du 2026-10-31 (conv-1369) : après avoir coupé terrain et arenagame, le rapport écrivait
  // encore « 32 skills » pour une liste de 30.
  it('le total ne compte que la liste, et nomme les skills désactivées', () => {
    const rapport = construireRapport({
      skills: [skill('active'), skill('coupee', false), skill('autre', false)],
      usages: new Map(),
      maintenant: MAINTENANT
    })
    expect(formaterRapport(rapport)).toMatch(/à chaque tour, 1 skill \(2 désactivées\)\./u)
  })

  // Le chemin court `registry/…` n'existe pas à la racine du dépôt : il a été recopié tel quel dans
  // la demande suivante (conv-1369).
  it('donne le vrai chemin du registre, depuis la racine du dépôt', () => {
    const rapport = construireRapport({
      skills: [skill('oubliee')],
      usages: new Map(),
      maintenant: MAINTENANT
    })
    expect(formaterRapport(rapport)).toContain(
      '.autowin-data/autowin-os/registry/enablement.v1.json'
    )
    expect(formaterRapport(rapport, 'ailleurs/registry/enablement.v1.json')).toContain(
      'dans ailleurs/registry/enablement.v1.json'
    )
  })

  it('dit qu une étape de run ne lit pas le SKILL.md', () => {
    const texte = formaterRapport(
      construireRapport({ skills: [skill('x')], usages: new Map(), maintenant: MAINTENANT })
    )
    expect(texte).toContain('étape de run (sous son brief, SKILL.md non lu)')
    // La note héritée de claude.exe disait le contraire deux lignes plus haut (/judge conv-1369).
    expect(texte).not.toContain('que quand elle sert')
    expect(texte).toContain('lu que quand elle est tapée ou choisie par le modèle')
  })

  it('arrondit le contexte comme claude.exe', () => {
    expect(formaterContexte(null)).toBe('-')
    expect(formaterContexte(12)).toBe('< 20')
    expect(formaterContexte(287)).toBe('~290')
  })
})

describe('valeurDOption', () => {
  it('rend la valeur qui suit l option', () => {
    expect(valeurDOption(['--data', 'd:/x'], '--data', 'defaut')).toBe('d:/x')
    expect(valeurDOption([], '--data', 'defaut')).toBe('defaut')
  })

  it('n avale pas l option suivante comme valeur', () => {
    expect(valeurDOption(['--data', '--json'], '--data', 'defaut')).toBe('defaut')
  })
})

describe('executer', () => {
  it('refuse de rendre un rapport sans aucune conversation lue', () => {
    expect(executer(['--data', donnees()], () => {})).toBe(2)
  })

  it('rend le JSON sur un corpus minimal', () => {
    const data = donnees()
    ecrire(
      data,
      'conversations.json',
      JSON.stringify([
        { id: 'conv-1', messages: [{ role: 'user', content: '/graft x', ts: Date.now() }] }
      ])
    )
    let sortie = ''
    expect(executer(['--data', data, '--json'], (t) => (sortie = t))).toBe(0)
    const graft = JSON.parse(sortie).lignes.find((l) => l.nom === 'graft')
    expect(graft).toMatchObject({ usages: 1, detail: { tapee: 1 }, joursDepuis: 0 })
  })
})

describe('liste des skills — la copie du script suit l original', () => {
  it('ligneDeListe rend exactement ligneDeSkill sur tout le kit', () => {
    const skills = nativeSkills(donnees())
    expect(skills.length).toBeGreaterThan(15)
    for (const s of skills)
      expect(ligneDeListe(s.id, s.description)).toBe(ligneDeSkill(s.id, s.description))
  })

  it('et sur les cas limites', () => {
    const longue = `${'a'.repeat(200)} NE PAS utiliser pour : réparer (→ \`heal\`). Suite.`
    for (const d of [undefined, '', 'Skill (SKILL.md)', 'Courte.', longue]) {
      expect(ligneDeListe('x', d)).toBe(ligneDeSkill('x', d))
    }
  })
})
