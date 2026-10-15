import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION, STYLE_CLOTURE_CHAT } from './response-style'

/**
 * TERRAIN NE SE JOUE QUE SI L'UTILISATEUR LE DEMANDE (2026-10-15).
 *
 * La constitution l'a sorti de la chaîne par défaut (« Le pipeline » : scout → frame → build →
 * clean → judge) et sa skill dit « ne se joue que si on la NOMME ». Le juge externe du correctif
 * « terrain revient tout seul » a relevé trois textes qui le remettaient en jeu SANS demande :
 * l'infobulle du bouton de sélection scout, les exemples de prompt suivant (le mode auto envoie
 * cette ligne sans clic), et les consignes de phase qui laissaient le modèle le choisir seul.
 */
describe('terrain reste à la demande de l’utilisateur', () => {
  it('les exemples de prompt suivant ne proposent plus terrain', () => {
    expect(STYLE_CLOTURE_CHAT).not.toMatch(/terrain/iu)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toMatch(/terrain/iu)
  })

  it('la consigne de phase du chat réserve terrain à une demande de l’utilisateur', () => {
    const ligne = buildChatPilotagePrompt([])
      .split('\n')
      .find((l) => l.startsWith('- `terrain`'))
    expect(ligne, 'ligne terrain absente de la consigne PHASE').toBeDefined()
    expect(ligne).toMatch(/SEULEMENT si l'utilisateur le demande/u)
  })

  it('le paramètre phase d’orchestrate réserve terrain à une demande de l’utilisateur', () => {
    const phase = CATALOG.find((c) => c.name === 'orchestrate')?.args.phase
    expect(phase).toBeDefined()
    expect(phase).toMatch(/« terrain » \(seulement si l’utilisateur le demande\)/u)
  })

  it('l’infobulle du bouton de sélection scout décrit la chaîne sans terrain', () => {
    const source = readFileSync(
      new URL('../renderer/src/components/CandidatsPickPanel.tsx', import.meta.url),
      'utf8'
    )
    const titre = /data-testid="cpick-lancer"[\s\S]*?title="([^"]+)"/u.exec(source)?.[1]
    expect(titre, 'infobulle du bouton introuvable').toBeDefined()
    expect(titre).not.toMatch(/terrain/iu)
    expect(titre).toContain('cadrage → build → nettoyage → jugement')
  })
})
