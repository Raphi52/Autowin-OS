import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extraireDemandes, principal } from './skills-declenchement-corpus.mjs'

/*
 * Les entrées qui DOIVENT être écartées, et feraient rougir ce test si l'extraction les prenait :
 * une mention en milieu de phrase (« regarde /heal »), une commande sans texte (« /salvage »), un
 * message de l'assistant, une skill absente du disque, et le même texte répété par un bouton.
 */
const SKILLS = new Set(['heal', 'salvage', 'draft'])
const msg = (role, content, extra = {}) => ({ role, content, ...extra })

const CONVERSATIONS = [
  {
    id: 'conv-1',
    messages: [
      msg('user', "/heal j'ai eu un freeze en ouvrant la vue knowledge"),
      msg('assistant', '/heal est une skill de remédiation, voici comment elle marche'),
      msg('user', '/salvage'),
      msg('user', 'regarde /heal quand tu peux, il y a peut-être un gel')
    ]
  },
  {
    id: 'conv-2',
    messages: [
      msg('user', "  /HEAL   j'ai eu un freeze en ouvrant la vue knowledge  "),
      msg('user', '/design une page de réglages plus claire'),
      // Message à parties : `content` vide, le texte vit dans `parts` (conversations-disk.ts).
      msg('user', '', {
        parts: [{ kind: 'text', text: '/draft trois animations pour la bulle de réflexion' }]
      })
    ]
  }
]

describe('extraireDemandes — les invocations réelles, commande retirée', () => {
  const r = extraireDemandes(CONVERSATIONS, SKILLS)

  it('garde le texte SANS la commande, étiqueté par la skill, une fois par texte', () => {
    expect(r.demandes).toEqual([
      {
        skill: 'heal',
        demande: "j'ai eu un freeze en ouvrant la vue knowledge",
        occurrences: 2,
        conversations: ['conv-1', 'conv-2']
      },
      {
        skill: 'draft',
        demande: 'trois animations pour la bulle de réflexion',
        occurrences: 1,
        conversations: ['conv-2']
      }
    ])
  })

  it('compte à part : commande sans texte, skill inconnue ; ignore mentions et assistant', () => {
    expect(r.parSkill.heal).toEqual({ invocations: 2, exploitables: 1, sansTexte: 0 })
    expect(r.parSkill.salvage).toEqual({ invocations: 1, exploitables: 0, sansTexte: 1 })
    expect(r.inconnues).toEqual({ design: 1 })
  })
})

describe('principal — lit instantané + archives, écrit le jeu hors du dépôt', () => {
  it('rend le décompte, écrit un JSONL, et sort 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-skills-'))
    const fichier = join(dir, 'conversations.json')
    writeFileSync(fichier, JSON.stringify([CONVERSATIONS[0]]))
    mkdirSync(`${fichier}.archive`)
    writeFileSync(join(`${fichier}.archive`, 'conv-2.json'), JSON.stringify(CONVERSATIONS[1]))
    const racineSkills = join(dir, 'skills')
    for (const s of SKILLS) {
      mkdirSync(join(racineSkills, s), { recursive: true })
      writeFileSync(join(racineSkills, s, 'SKILL.md'), `---\nname: ${s}\n---\n`)
    }
    const sortie = join(dir, 'corpus.jsonl')
    const lignes = []
    const code = principal(
      ['--conversations', fichier, '--skills', racineSkills, '--sortie', sortie],
      (l) => lignes.push(l)
    )
    expect(code).toBe(0)
    const texte = lignes.join('\n')
    expect(texte).toContain('| `heal` | 2 | 1 | 0 |')
    expect(texte).toContain('| `salvage` | 1 | 0 | 1 |')
    const corpus = readFileSync(sortie, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(corpus.map((d) => d.skill)).toEqual(['heal', 'draft'])
  })

  it('conversations absentes -> 2', () => {
    expect(principal(['--conversations', join(tmpdir(), 'nulle-part.json')], () => {})).toBe(2)
  })
})
