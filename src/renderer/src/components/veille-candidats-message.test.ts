import { describe, expect, it } from 'vitest'
import {
  candidatsDepuisScoutTable,
  extraireCandidatsAffiches,
  redigerPromptFrameSelection,
  texteSansChargeJson
} from './veille-candidats-message'
import { parseScoutTable } from './scout-table'

/** Le panneau cases + « Enchaîner (frame) » sous un message de scout (demande du 14/08). */
const MESSAGE = [
  'Synthèse : j’ai lu cost.jsonl et le code.',
  '```json',
  '[{"type":"ajout","titre":"File de reprise groupée","url":"src/renderer/src/components/chat-home-suggestions.ts:59","dateSource":"2026-08-13","citation":"items: blocked.map((r) => ({ label: `Débloque","langue":"fr","pertinence":94},',
  ' {"type":"ajout","titre":"Cockpit des coûts","url":"src/main/index.ts:170","dateSource":"2026-08-13","citation":"appendPromptCall,","langue":"fr","pertinence":89}]',
  '```'
].join('\n')

describe('extraireCandidatsAffiches', () => {
  it('détecte la charge utile JSON du scout et rend titre/ancrage/pertinence', () => {
    const candidats = extraireCandidatsAffiches(MESSAGE)
    expect(candidats).toHaveLength(2)
    expect(candidats![0]).toMatchObject({
      titre: 'File de reprise groupée',
      url: 'src/renderer/src/components/chat-home-suggestions.ts:59',
      pertinence: 94
    })
  })

  it('ne détecte RIEN sur un message ordinaire, un JSON cassé ou une autre forme', () => {
    expect(extraireCandidatsAffiches('Un message normal sans candidats.')).toBeUndefined()
    expect(extraireCandidatsAffiches('liste [1, 2, 3] de nombres')).toBeUndefined()
    expect(extraireCandidatsAffiches('```json\n[{"titre":"sans url"}]\n```')).toBeUndefined()
    expect(extraireCandidatsAffiches('json cassé [ {"titre": ...')).toBeUndefined()
  })

  it('ignore les crochets de la synthèse Markdown et lit uniquement la fence JSON finale', () => {
    const message = [
      'Fichiers lus : [chat-view-model.ts](src/renderer/src/components/chat-view-model.ts).',
      '```json',
      '[{"type":"ajout","titre":"Panneau fiable","url":"src/main/index.ts:1","pertinence":91}]',
      '```'
    ].join('\n')

    expect(extraireCandidatsAffiches(message)).toEqual([
      {
        type: 'ajout',
        titre: 'Panneau fiable',
        url: 'src/main/index.ts:1',
        pertinence: 91
      }
    ])
    expect(texteSansChargeJson(message)).toBe(
      'Fichiers lus : [chat-view-model.ts](src/renderer/src/components/chat-view-model.ts).'
    )
  })

  it('ne recycle pas une ancienne fence valide quand la fence JSON finale est cassée', () => {
    const message = [
      'Exemple humain :',
      '```json',
      '[{"titre":"Exemple","url":"docs/exemple.md:1"}]',
      '```',
      'Charge machine finale :',
      '```json',
      '[{"titre":"Cassé","url":',
      '```'
    ].join('\n')

    expect(extraireCandidatsAffiches(message)).toBeUndefined()
    expect(texteSansChargeJson(message)).toBe(message)
  })

  it('ne recycle pas une ancienne fence valide pendant le streaming d’une fence finale non refermée', () => {
    const message = [
      'Exemple humain :',
      '```json',
      '[{"titre":"Exemple","url":"docs/exemple.md:1"}]',
      '```',
      'Charge machine en cours :',
      '```json',
      '[{"titre":"Incomplet"'
    ].join('\n')

    expect(extraireCandidatsAffiches(message)).toBeUndefined()
    expect(texteSansChargeJson(message)).toBe(message)
  })

  it('ne confond pas une citation contenant ```json avec une ligne de fence Markdown', () => {
    const charge = JSON.stringify([
      {
        titre: 'Parseur Markdown',
        url: 'src/parser.ts:1',
        citation: 'const marker = ```json'
      }
    ])
    const message = ['Synthèse.', '```json', charge, '```'].join('\n')

    expect(extraireCandidatsAffiches(message)?.[0].titre).toBe('Parseur Markdown')
    expect(texteSansChargeJson(message)).toBe('Synthèse.')
  })
})

describe('redigerPromptFrameSelection', () => {
  it('compose le /frame avec ancrages, preuves, et la consigne jusqu’au commit publié', () => {
    const candidats = extraireCandidatsAffiches(MESSAGE)!
    const prompt = redigerPromptFrameSelection(candidats)
    expect(prompt).toMatch(/^\/frame Traite ENSEMBLE ces 2 candidats/)
    expect(prompt).toContain(
      '1. File de reprise groupée — ancrage src/renderer/src/components/chat-home-suggestions.ts:59'
    )
    expect(prompt).toContain('pertinence 94/100')
    expect(prompt).toContain('COMMIT PUBLIÉ')
  })

  it('au singulier, le prompt reste grammatical', () => {
    const prompt = redigerPromptFrameSelection([{ titre: 'X', url: 'src/a.ts:1' }])
    expect(prompt).toMatch(/^\/frame Traite ce candidat issu/)
    expect(prompt).not.toContain('candidats issus')
  })

  it('transmet au /frame le quoi, le pourquoi et le comment du candidat', () => {
    const prompt = redigerPromptFrameSelection([
      {
        titre: 'Cockpit',
        url: 'src/main/index.ts:1',
        type: 'ajout',
        what: 'Afficher les coûts.',
        why: 'Les coûts sont relus à la main.',
        how: 'Ajouter une vue dédiée.',
        dateSource: '2026-08-14',
        langue: 'fr'
      }
    ])

    expect(prompt).toContain('Type : ajout')
    expect(prompt).toContain('Quoi : Afficher les coûts.')
    expect(prompt).toContain('Pourquoi : Les coûts sont relus à la main.')
    expect(prompt).toContain('Comment : Ajouter une vue dédiée.')
    expect(prompt).toContain('Date source : 2026-08-14')
    expect(prompt).toContain('Langue : fr')
  })
})

describe('texteSansChargeJson', () => {
  it('retire le pavé JSON et sa fence, garde la synthèse', () => {
    const reste = texteSansChargeJson(MESSAGE)
    expect(reste).toContain('Synthèse : j’ai lu cost.jsonl')
    expect(reste).not.toContain('"titre"')
    expect(reste).not.toContain('```')
  })
  it('rend le texte intact quand il ne porte pas de charge', () => {
    expect(texteSansChargeJson('Rien à extraire ici.')).toBe('Rien à extraire ici.')
  })
})

/**
 * Defaut vecu le 2026-08-18 : le panneau de selection (cases + « Enchainer (frame) ») n'apparaissait
 * JAMAIS sur un scout de code. Deux causes en amont : le routeur essayait `parseScoutTable` d'abord
 * et sortait par `continue`, et ce module n'acceptait qu'une charge JSON avec `titre` ET `url` — la
 * forme de la veille web, pas celle d'un scout interne, qui rend un tableau markdown.
 */
describe('un tableau scout markdown alimente le panneau de selection', () => {
  const TABLEAU = [
    '| # | Impact | Effort | Type | Manquement | Pourquoi | 1er pas |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | 🟢 | 🟡 | 🔧 fix | Le journal accepte une ligne mal formee | Une ligne invalide entre comme fiable | Test rouge sur `src/main/activity/ledger.ts:63` |',
    '| 2 | 🟡 | 🟢 | 🆕 new | Proposer un rejeu cible | Aucun moyen de rejouer un tour seul | Partir de `src/main/runs/run-reattach.ts:495` |'
  ].join('\n')

  it('convertit chaque ligne en candidat selectionnable', () => {
    const rows = parseScoutTable(TABLEAU)
    expect(rows).not.toBeNull()
    const candidats = candidatsDepuisScoutTable(rows!)

    expect(candidats).toHaveLength(2)
    expect(candidats[0].titre).toContain('Le journal accepte une ligne mal formee')
    expect(candidats[0].type).toBe('fix')
    expect(candidats[0].why).toContain('entre comme fiable')
    expect(candidats[0].how).toContain('ledger.ts:63')
  })

  it("recupere l'ancrage `fichier:ligne` present dans une cellule", () => {
    const candidats = candidatsDepuisScoutTable(parseScoutTable(TABLEAU)!)
    expect(candidats[0].url).toBe('src/main/activity/ledger.ts:63')
    expect(candidats[1].url).toBe('src/main/runs/run-reattach.ts:495')
  })

  it("n'invente aucun ancrage quand aucune cellule n'en porte", () => {
    const sansAncrage = [
      '| # | Impact | Effort | Type | Manquement | Pourquoi | 1er pas |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 🟢 | 🟢 | 🔧 fix | Renommer une variable | Lisibilite | Le faire |'
    ].join('\n')
    const candidats = candidatsDepuisScoutTable(parseScoutTable(sansAncrage)!)
    expect(candidats[0].url).toBe(undefined)
  })

  it('le prompt de selection reste lisible sans ancrage', () => {
    const prompt = redigerPromptFrameSelection([{ titre: 'Renommer une variable', type: 'fix' }])
    expect(prompt).toContain('Renommer une variable')
    expect(prompt).not.toContain('ancrage undefined')
  })
})
