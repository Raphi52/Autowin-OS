import { describe, expect, it } from 'vitest'
import { parseOrderedPilotTokens, reparerAccoladeFinaleManquante } from './agent-pilot'

/**
 * `<cmd>` À UNE ACCOLADE PRÈS — conv-159, tour `b60bf535-44e5-47e8-b43a-e3260ddc74ef` (2026-10-10).
 *
 * Les deux blocs ci-dessous sont COPIÉS du journal des tours (deltas `0:1` et `1:0`) et du journal
 * brut `run-stdout/a18bb1fb-9dfa-434e-a294-47f7c4bbfae1.stdout.jsonl` : deux `{` ouvertes, une seule
 * `}`. Rejetés en « JSON illisible », relancés une fois, re-émis à l'identique (le modèle a cru à un
 * problème d'accents), et le tour s'est clos sur « renvoie ton message pour relancer ».
 */
const BLOC_ITERATION_0 =
  '{"name":"brain_query","args":{"question":"préférences visuelles de l\'utilisateur, goût design, ' +
  'anti-motifs (feedback_portail_design_lineaire), fond d\'écran, thème Nébuleuse de verre bleu rose"}'
const BLOC_ITERATION_1 =
  '{"name":"brain_query","args":{"question":"preferences visuelles utilisateur design lineaire anti-motifs fond ecran"}'

describe('une seule accolade fermante manquante et une seule lecture possible → commande exécutée', () => {
  it('le bloc exact de l’itération 0 devient la commande brain_query attendue', () => {
    const tokens = parseOrderedPilotTokens(`Je lis ton goût. <cmd>${BLOC_ITERATION_0}</cmd>\n\nSuite.`)
    const commandes = tokens.filter((t) => t.kind === 'command')
    expect(tokens.filter((t) => t.kind === 'invalid')).toHaveLength(0)
    expect(commandes).toHaveLength(1)
    const commande = commandes[0]
    if (commande.kind !== 'command') throw new Error('commande attendue')
    expect(commande.name).toBe('brain_query')
    expect(commande.args).toEqual({
      question:
        "préférences visuelles de l'utilisateur, goût design, anti-motifs " +
        "(feedback_portail_design_lineaire), fond d'écran, thème Nébuleuse de verre bleu rose"
    })
    // La réparation reste LISIBLE après coup : elle n'est pas silencieuse.
    expect(commande.reparation).toMatch(/accolade/)
  })

  it('le bloc exact de l’itération 1 (réécrit en ASCII) est réparé pareil', () => {
    const [token] = parseOrderedPilotTokens(`<cmd>${BLOC_ITERATION_1}</cmd>`)
    expect(token.kind).toBe('command')
    if (token.kind === 'command') expect(token.name).toBe('brain_query')
  })

  it('une commande déjà valide n’est pas marquée réparée', () => {
    expect(parseOrderedPilotTokens('<cmd>{"name":"navigate","args":{"tab":"chat"}}</cmd>')).toEqual([
      { kind: 'command', name: 'navigate', args: { tab: 'chat' } }
    ])
  })
})

describe('aucune intention devinée quand la réparation n’est pas univoque', () => {
  it('accolade oubliée au milieu d’args imbriqués : deux lectures → reste illisible', () => {
    // Voulu : {"a":{"b":1},"c":2}. Écrit : il manque la `}` après 1. Ajouter à la fin donnerait
    // {"a":{"b":1,"c":2}} — une autre commande. Deux places possibles = on ne choisit pas.
    const bloc = '{"name":"x","args":{"a":{"b":1,"c":2}}'
    expect(reparerAccoladeFinaleManquante(bloc)).toBeUndefined()
    expect(parseOrderedPilotTokens(`<cmd>${bloc}</cmd>`)[0].kind).toBe('invalid')
  })

  it('deux accolades manquantes → reste illisible', () => {
    expect(reparerAccoladeFinaleManquante('{"name":"x","args":{"a":{"b":1')).toBeUndefined()
  })

  it('chaîne non refermée → reste illisible', () => {
    expect(reparerAccoladeFinaleManquante('{"name":"x","args":{"q":"abc}')).toBeUndefined()
  })

  it('crochet manquant → reste illisible (seule la `}` finale est réparée)', () => {
    expect(reparerAccoladeFinaleManquante('{"name":"x","args":{"l":[1,2}')).toBeUndefined()
  })

  it('réparation sans « name » exploitable → reste illisible', () => {
    expect(reparerAccoladeFinaleManquante('{"nom":"x","args":{"a":1}')).toBeUndefined()
  })

  it('une accolade dans une chaîne ne compte pas', () => {
    const repare = reparerAccoladeFinaleManquante('{"name":"x","args":{"q":"a } b { c"}')
    expect(repare && JSON.parse(repare)).toEqual({ name: 'x', args: { q: 'a } b { c' } })
  })
})
