import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSES_PAGES_HTML } from '../shared/classes-pages-html'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { construirePromptScoutInterne } from './veille/scout-interne'

/**
 * LE PROMPT NOMME LES CLASSES DE L'APP, PLUS DES COULEURS EN DUR (conv-1074, 2026-10-22).
 *
 * Trois prompts recopiaient la meme recette (texte `#dde3ee`, or `#d4a94f`-`#e3ba55`, libelles
 * `#a9b2c4`) : le chat, le chat en lecture seule (`agent-pilot.ts`) et le scout interne. Ces teintes
 * de nuit etaient ensuite ecrasees en theme clair. Entree qui ferait echouer une mauvaise
 * correction : laisser UNE des trois copies sur l'ancienne recette.
 */
const RECETTE_EN_DUR = ['#dde3ee', '#d4a94f', '#e3ba55', '#a9b2c4']

describe('prompts des pages html-render : des classes, pas des couleurs', () => {
  it('le prompt du chat nomme chaque classe et plus aucune couleur de la recette', () => {
    const prompt = buildChatPilotagePrompt([])
    for (const { classe } of CLASSES_PAGES_HTML) expect(prompt).toContain(classe)
    for (const couleur of RECETTE_EN_DUR) expect(prompt).not.toContain(couleur)
  })

  it('le scout interne aussi', () => {
    const prompt = construirePromptScoutInterne({ racineDepot: 'D:/x', racineDonnees: 'D:/y' })
    expect(prompt).toContain('aw-chip')
    for (const couleur of RECETTE_EN_DUR) expect(prompt).not.toContain(couleur)
  })

  // Le prompt du chat en LECTURE SEULE est ecrit en ligne dans `agent-pilot.ts` : seule la source
  // le montre sans monter tout un tour.
  it('le chat en lecture seule aussi (source d’agent-pilot.ts)', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    expect(source).toContain('CONSIGNE_CLASSES_PAGES_HTML')
    for (const couleur of RECETTE_EN_DUR) expect(source).not.toContain(couleur)
  })

  it('le prompt dit pourquoi ne pas écrire prefers-color-scheme : il suit Windows, pas le thème', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/prefers-color-scheme[^.]*(Windows|système)/)
  })
})

/**
 * Les blocs de donnees (conv-1074) n'existent pour le modele que si son prompt les nomme. Entree qui
 * ferait echouer une mauvaise correction : un prompt qui parle de `aw-tableau` sans son JSON.
 */
describe('prompt du chat : les blocs de données', () => {
  it('nomme les trois formes et leurs champs', () => {
    const prompt = buildChatPilotagePrompt([])
    for (const forme of ['```aw-tableau', '```aw-comparaison', '```aw-etapes'])
      expect(prompt).toContain(forme)
    for (const champ of ['"colonnes"', '"lignes"', '"options"', '"etapes"', '"statut"'])
      expect(prompt).toContain(champ)
  })
})
