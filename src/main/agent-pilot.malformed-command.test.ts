import { describe, expect, it } from 'vitest'
import { parseOrderedPilotTokens } from './agent-pilot'

/**
 * COMMANDE MALFORMÉE — plus jamais de perte silencieuse.
 *
 * Défaut d'origine (`agent-pilot.ts`, parseur de tokens) : un bloc `<cmd>` inexploitable était
 * supprimé par un `catch {}` vide. Conséquence : le modèle croyait avoir agi, l'utilisateur recevait
 * une conclusion, et AUCUNE action n'avait eu lieu — un faux « c'est fait », le pire défaut possible
 * pour un agent. Il y avait DEUX trous : le JSON illisible, et le JSON valide sans `name`.
 */
describe('parseOrderedPilotTokens — un bloc inexploitable est SIGNALÉ, jamais avalé', () => {
  it('JSON illisible → token « invalid » avec sa raison et le bloc reçu', () => {
    const tokens = parseOrderedPilotTokens('avant <cmd>{ pas du json }</cmd> après')
    const invalid = tokens.filter((token) => token.kind === 'invalid')
    expect(invalid).toHaveLength(1)
    if (invalid[0].kind === 'invalid') {
      expect(invalid[0].reason).toContain('JSON illisible')
      expect(invalid[0].raw).toContain('pas du json')
    }
  })

  it('JSON VALIDE mais sans « name » → également signalé (second trou d’origine)', () => {
    const tokens = parseOrderedPilotTokens('<cmd>{"args":{"tab":"chat"}}</cmd>')
    const invalid = tokens.filter((token) => token.kind === 'invalid')
    expect(invalid).toHaveLength(1)
    if (invalid[0].kind === 'invalid') expect(invalid[0].reason).toContain('name')
  })

  it('n’INVENTE aucune commande à partir d’un bloc cassé', () => {
    const tokens = parseOrderedPilotTokens('<cmd>{"nam":"navigate"}</cmd>')
    expect(tokens.filter((token) => token.kind === 'command')).toHaveLength(0)
  })

  it('le texte AUTOUR du bloc cassé reste visible (rien n’est perdu pour l’utilisateur)', () => {
    const tokens = parseOrderedPilotTokens('Je navigue. <cmd>{cassé}</cmd> Voilà.')
    const texts = tokens.filter((t) => t.kind === 'text').map((t) => (t.kind === 'text' ? t.text : ''))
    expect(texts.join(' ')).toContain('Je navigue')
    expect(texts.join(' ')).toContain('Voilà')
  })

  it('une commande VALIDE reste inchangée (aucune régression)', () => {
    const tokens = parseOrderedPilotTokens('<cmd>{"name":"navigate","args":{"tab":"chat"}}</cmd>')
    expect(tokens).toEqual([{ kind: 'command', name: 'navigate', args: { tab: 'chat' } }])
  })

  it('args absents → objet vide, pas un invalide', () => {
    const tokens = parseOrderedPilotTokens('<cmd>{"name":"get_state"}</cmd>')
    expect(tokens).toEqual([{ kind: 'command', name: 'get_state', args: {} }])
  })

  it('mélange valide + cassé : la valide s’exécute, la cassée est signalée', () => {
    const tokens = parseOrderedPilotTokens(
      '<cmd>{"name":"get_state"}</cmd> puis <cmd>{oups}</cmd>'
    )
    expect(tokens.filter((t) => t.kind === 'command')).toHaveLength(1)
    expect(tokens.filter((t) => t.kind === 'invalid')).toHaveLength(1)
  })
})

/**
 * Contrat de CABLAGE : le signalement doit atteindre l'utilisateur ET le modèle. Sans ces deux
 * chemins, le token « invalid » ne servirait à rien et le faux « c'est fait » resterait possible.
 */
describe('câblage — l’échec est visible ET corrigible', () => {
  const source = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'agent-pilot.ts'), 'utf8')
  }

  it('le parseur ne contient plus de catch VIDE', () => {
    const code = source()
    const parser = code.slice(
      code.indexOf('export function parseOrderedPilotTokens'),
      code.indexOf('function waitForAnswer')
    )
    // Un catch qui ne fait rien = la perte silencieuse d'origine.
    expect(parser).not.toMatch(/catch\s*\{\s*\/\*[^*]*\*\/\s*\}/)
    expect(parser).toContain("kind: 'invalid'")
  })

  it('émet un résultat en ÉCHEC visible dans le fil', () => {
    const code = source()
    const branch = code.slice(code.indexOf("if (token.kind === 'invalid')"))
    expect(branch).toContain("ok: false")
    expect(branch).toContain('commande illisible')
  })

  it('réinjecte une demande de correction au modèle', () => {
    const code = source()
    const branch = code.slice(code.indexOf("if (token.kind === 'invalid')"))
    expect(branch).toContain('results.push(')
    expect(branch).toContain('AUCUNE action')
    // Et surtout : rien n'est execute pour un bloc casse.
    expect(branch.slice(0, branch.indexOf('continue'))).not.toContain('this.bus.exec(')
  })
})
