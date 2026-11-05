import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  compter,
  extraireCorrections,
  lireConversations,
  lireSaisies,
  motifDeCorrection,
  reponseCorrigee
} from './corrections-utilisateur.mjs'

const racine = mkdtempSync(join(tmpdir(), 'aos-corrections-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

describe('motifDeCorrection', () => {
  it.each([
    ['nan c’était pas en mode auto', 'non-initial'],
    ['Non je veux juste consulter', 'non-initial'],
    ['pas du tout, c’est l’inverse', 'pas-du-tout'],
    ['mais c’est faux ce que tu dis', 'c-est-faux'],
    ['c’est le vert de l’app ou un hexa que t’as inventé ?', 'tu-inventes'],
    ['pour le 2 j’ai pas mistral pourquoi tu m’en parles?', 'pourquoi-en-parler']
  ])('reconnaît « %s »', (texte, motif) => {
    expect(motifDeCorrection(texte)).toBe(motif)
  })

  // Jumeaux acceptés : même mot, autre côté de la borne.
  it.each([
    ['non invasif hdesk stp'],
    ['je ne sais pas, non pas maintenant'],
    ['bonjour, fais le test'],
    ['/salvage\nnon'],
    ['nan ' + 'x'.repeat(700)]
  ])('laisse passer « %s »', (texte) => {
    expect(motifDeCorrection(texte)).toBeNull()
  })
})

describe('reponseCorrigee', () => {
  const conv = {
    id: 'conv-1',
    messages: [
      { role: 'user', content: 'Fais X', ts: 1 },
      { role: 'assistant', content: 'J’ai fait X.', ts: 2 },
      { role: 'user', content: 'nan', ts: 3 },
      { role: 'assistant', content: 'D’accord.', ts: 4 },
      { role: 'user', content: 'nan', ts: 10 }
    ]
  }
  it('rend la réponse qui précède le bon message, même texte répété', () => {
    expect(reponseCorrigee(conv, 'nan', 3)).toBe('J’ai fait X.')
    expect(reponseCorrigee(conv, 'nan', 10)).toBe('D’accord.')
  })
  it('rend null si le message est introuvable', () => {
    expect(reponseCorrigee(conv, 'autre chose', 3)).toBeNull()
    expect(reponseCorrigee(undefined, 'nan', 3)).toBeNull()
  })
})

describe('sur un dossier de données', () => {
  const dossier = join(racine, 'autowin-os')
  mkdirSync(join(dossier, 'conversations.json.archive'), { recursive: true })
  const conv = (id, ts) => ({
    id,
    messages: [
      { role: 'user', content: 'Ouvre le diaporama', ts },
      { role: 'assistant', content: 'Je l’ai ouvert.', ts: ts + 1 },
      { role: 'user', content: 'nan pas ouvert', ts: ts + 2 }
    ]
  })
  writeFileSync(join(dossier, 'conversations.json'), JSON.stringify([conv('conv-1', 100)]))
  writeFileSync(
    join(dossier, 'conversations.json.archive', 'conv-2.json'),
    JSON.stringify(conv('conv-2', 200))
  )
  writeFileSync(
    join(dossier, 'saisies-utilisateur.jsonl'),
    [
      { conversationId: 'conv-1', ts: 102, texte: 'nan pas ouvert', voie: 'message' },
      { conversationId: 'conv-2', ts: 202, texte: 'nan pas ouvert', voie: 'message' },
      { conversationId: 'conv-1', ts: 300, texte: 'merci', voie: 'message' }
    ]
      .map((s) => JSON.stringify(s))
      .join('\n') + '\n{ligne coupée'
  )

  it('extrait chaque correction avec la réponse corrigée, archives comprises', () => {
    const saisies = lireSaisies(join(dossier, 'saisies-utilisateur.jsonl'))
    expect(saisies).toHaveLength(3) // la ligne coupée est ignorée
    const corrections = extraireCorrections(saisies, lireConversations(dossier))
    expect(corrections.map((c) => c.reponseAgent)).toEqual(['Je l’ai ouvert.', 'Je l’ai ouvert.'])
    expect(compter(saisies, corrections)).toEqual({
      saisies: 3,
      corrections: 2,
      avecReponseAgent: 2,
      parMotif: { 'non-initial': 2 }
    })
  })

  it('la commande sort le décompte avec le code 0 et ne modifie rien', () => {
    const script = fileURLToPath(new URL('./corrections-utilisateur.mjs', import.meta.url))
    const r = spawnSync(process.execPath, [script, '--racine', dossier], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout.trim().split('\n').pop())).toMatchObject({ corrections: 2 })
  })
})
