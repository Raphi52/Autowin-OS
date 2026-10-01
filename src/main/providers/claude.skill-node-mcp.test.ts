import { describe, expect, it } from 'vitest'
import {
  ClaudeCliAdapter,
  MCP_SORTIE_NOEUD_SKILL_TOKENS,
  argumentsMcpNoeudSkill,
  envSortieMcpNoeudSkill
} from './claude'
import type { SendOptions } from './types'

/**
 * Ce que ces tests protegent : la FRONTIERE. Un noeud skill recoit ses outils, une phase du pipeline
 * n'en recoit AUCUN — alors que les deux passent par le meme `send()` avec un bloc `execution`.
 *
 * On teste `argumentsMcpNoeudSkill`, la fonction que `send` appelle reellement, et non une
 * reconstitution de l'argv : un test qui recopierait la construction des arguments verifierait son
 * propre miroir. La preuve que le drapeau MARCHE face au vrai CLI est hors-modele et vit dans
 * `scripts/probe-skill-node-mcp.mts` (temoin non devinable + controle negatif).
 */
const OUTILS = {
  mcpConfig: JSON.stringify({
    mcpServers: { autowin: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }
  }),
  allowedTools: ['mcp__autowin__brain_query', 'mcp__autowin__remember']
}

const execution: NonNullable<SendOptions['execution']> = {
  cwd: process.cwd(),
  sandbox: 'workspace-write'
}

describe('outils MCP d’un nœud skill', () => {
  it('un nœud skill reçoit --mcp-config ET l’autorisation d’usage', () => {
    const a = argumentsMcpNoeudSkill({ execution, skillNodeTools: OUTILS })
    expect(a.mcp).toEqual(['--mcp-config', OUTILS.mcpConfig])
    // Declare ET autorise : l'un sans l'autre laisse un outil annonce puis refuse a l'usage.
    expect(a.autorises).toEqual(['mcp__autowin__brain_query', 'mcp__autowin__remember'])
  })

  it('CONTRÔLE NÉGATIF — une phase du pipeline ne reçoit AUCUN serveur MCP', () => {
    const a = argumentsMcpNoeudSkill({ execution })
    expect(a.mcp).toEqual([])
    expect(a.autorises).toEqual([])
    // Et elle garde le drapeau qui la prive de tout serveur externe.
    expect(a.strict).toEqual(['--strict-mcp-config'])
  })

  it('sans héritage demandé, --strict-mcp-config reste posé même pour un nœud skill', () => {
    expect(argumentsMcpNoeudSkill({ execution, skillNodeTools: OUTILS }).strict).toEqual([
      '--strict-mcp-config'
    ])
  })

  it('héritage demandé : --strict-mcp-config est retiré, mais les outils restent déclarés', () => {
    const a = argumentsMcpNoeudSkill({
      execution,
      skillNodeTools: { ...OUTILS, inheritMachineMcp: true }
    })
    expect(a.strict).toEqual([])
    expect(a.mcp[0]).toBe('--mcp-config')
  })

  it("aucun état ne fuit d'un appel à l'autre", () => {
    argumentsMcpNoeudSkill({ execution, skillNodeTools: { ...OUTILS, inheritMachineMcp: true } })
    // L'appel SUIVANT, sans l'option, doit retrouver le drapeau.
    expect(argumentsMcpNoeudSkill({ execution }).strict).toEqual(['--strict-mcp-config'])
  })

  it('un tour de chat sans nœud skill reste sans serveur MCP', () => {
    const a = argumentsMcpNoeudSkill({})
    expect(a.mcp).toEqual([])
    expect(a.strict).toEqual(['--strict-mcp-config'])
  })

  it('la liste autorisée est COPIÉE : muter le retour ne contamine pas les options', () => {
    const opts: SendOptions = { execution, skillNodeTools: OUTILS }
    argumentsMcpNoeudSkill(opts).autorises.push('mcp__autowin__orchestrate')
    expect(opts.skillNodeTools!.allowedTools).toEqual([
      'mcp__autowin__brain_query',
      'mcp__autowin__remember'
    ])
  })
})

describe('observabilité du prompt', () => {
  const adaptateur = new ClaudeCliAdapter()
  const enveloppe = (opts: SendOptions): Record<string, unknown> =>
    adaptateur.describePrompt!([{ role: 'user', content: 'salut' }], opts).options

  it('n’annonce plus strictMcpConfig en dur quand le drapeau est retiré', () => {
    // Le champ valait `true` inconditionnellement : il aurait desormais AFFIRME le contraire de ce
    // qui est envoye.
    expect(
      enveloppe({ execution, skillNodeTools: { ...OUTILS, inheritMachineMcp: true } })
        .strictMcpConfig
    ).toBe(false)
    expect(enveloppe({ execution }).strictMcpConfig).toBe(true)
  })

  it('nomme les outils du nœud skill, et reste muet quand il n’y en a pas', () => {
    expect(enveloppe({ execution, skillNodeTools: OUTILS }).skillNodeTools).toEqual(
      OUTILS.allowedTools
    )
    expect(enveloppe({ execution })).not.toHaveProperty('skillNodeTools')
  })
})

describe('plafond de sortie MCP du CLI — levé pour un nœud skill', () => {
  /*
   * Claude Code coupe un résultat MCP à 25 000 tokens par défaut (MAX_MCP_OUTPUT_TOKENS,
   * https://code.claude.com/docs/en/mcp). Un brain_read d'une longue note arrivait amputé.
   */
  it('pose MAX_MCP_OUTPUT_TOKENS pour un nœud outillé, jamais pour une phase du pipeline', () => {
    expect(envSortieMcpNoeudSkill(true, {})).toEqual({
      MAX_MCP_OUTPUT_TOKENS: MCP_SORTIE_NOEUD_SKILL_TOKENS
    })
    expect(envSortieMcpNoeudSkill(false, {})).toEqual({})
  })

  it('laisse le dernier mot à une valeur déjà posée par l’utilisateur', () => {
    expect(envSortieMcpNoeudSkill(true, { MAX_MCP_OUTPUT_TOKENS: '50000' })).toEqual({})
  })

  it('dépasse la plus grosse note du Brain (809 430 octets)', () => {
    expect(Number(MCP_SORTIE_NOEUD_SKILL_TOKENS)).toBeGreaterThan(809_430)
  })
})
