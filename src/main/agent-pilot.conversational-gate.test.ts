import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contrat du GATE CONVERSATIONNEL de `chat()`.
 *
 * Mesure du 2026-07-28 sur 1h d'usage reel : 114 spawns CLI pour 26,65 $, dont des appels de juge a
 * 1,5 $ pour 89 tokens de verdict. La cause n'etait pas la mecanique de routage mais le PROMPT :
 * trois consignes poussaient vers `orchestrate` et ecrasaient la seule ligne autorisant une reponse
 * directe. Ces assertions empechent la regression silencieuse de ce reglage (un prompt se reecrit
 * sans qu'aucun test ne tombe).
 */
const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
const chatPrompt = source.slice(source.indexOf('async chat('))

describe('chat() — gate conversationnel', () => {
  it('fait de la reponse DIRECTE le comportement par defaut', () => {
    expect(chatPrompt).toContain('RÈGLE PREMIÈRE — RÉPONDS TOI-MÊME')
    expect(chatPrompt).toContain('AUCUNE commande')
    expect(chatPrompt).toMatch(/En doute entre répondre et orchestrer\s*:\s*RÉPONDS/)
  })

  it('reserve le pipeline aux MODIFICATIONS et aux verifications outillees', () => {
    expect(chatPrompt).toContain('MODIFIER le workspace')
    expect(chatPrompt).toContain('vérification')
  })

  it('place la regle AVANT la consigne qui pousse vers orchestrate', () => {
    const gate = chatPrompt.indexOf('RÈGLE PREMIÈRE')
    const push = chatPrompt.indexOf('Ne dis jamais que tu ne peux pas')
    expect(gate).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(push) // la recence et l'ordre comptent dans un system prompt
  })

  it('neutralise « en doute -> substantiel » pour la DECISION d’orchestrer', () => {
    expect(chatPrompt).toContain('ne vaut que pour du travail DÉJÀ')
  })

  it('borne la « demande ouverte » : conversationnelle -> reponse, code -> orchestrate', () => {
    expect(chatPrompt).toContain('Si elle est CONVERSATIONNELLE')
    expect(chatPrompt).toContain('SANS aucune commande')
    expect(chatPrompt).toContain('porte sur le CODE ou le WORKSPACE')
  })

  it('n’exige jamais de renvoyer la question a l’utilisateur (divergence preservee)', () => {
    expect(chatPrompt).toContain('ne renvoie JAMAIS la question')
    expect(chatPrompt).toContain('options concrètes et scorées')
  })

  it('laisse run() INTACT : un objectif d’action garde son pilotage direct', () => {
    const runPrompt = source.slice(source.indexOf('async run('), source.indexOf('async chat('))
    expect(runPrompt).toContain("Tu PILOTES l'application")
    expect(runPrompt).not.toContain('RÈGLE PREMIÈRE') // le gate ne s'applique qu'au chat
  })
})
