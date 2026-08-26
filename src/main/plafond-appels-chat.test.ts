import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATION_BUDGET,
  loadOrchestrationBudget,
  normalizeOrchestrationBudget
} from './orchestration-budget'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur conv-1397. Un tour de chat a été coupé sur « Budget d'appels
 * provider atteint (6) » APRÈS cinq éditions réussies, juste avant sa vérification : le travail est
 * resté à moitié posé et la demande de l'utilisateur perdue.
 *
 * Le `6` était écrit en dur dans `os.ts`, hérité de l'époque où un tour de chat valait UN appel
 * provider. Un tour agentique en consomme un PAR ÉTAPE : ce plafond comptait des coups, pas de la
 * dépense — et il tuait au milieu au lieu de refuser au départ.
 *
 * Le plafond est désormais un RÉGLAGE (`maxChatProviderCalls`), volontairement large.
 */

describe('plafond d’appels d’un tour de chat', () => {
  it('vaut 50 par défaut — assez large pour qu’un tour ne meure pas sur un compteur d’étapes', () => {
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).toBe(50)
  })

  it('reste très au-dessus du 6 qui coupait les tours', () => {
    // L'assertion qui porte le sens : c'est la valeur mesurée comme trop basse, pas un nombre rond.
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).toBeGreaterThan(6)
  })

  it('est distinct du plafond d’orchestration — un run et un tour ne se comptent pas pareil', () => {
    expect(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls).not.toBe(
      DEFAULT_ORCHESTRATION_BUDGET.maxProviderCalls
    )
  })

  it('se laisse régler par l’utilisateur', () => {
    expect(normalizeOrchestrationBudget({ maxChatProviderCalls: 120 }).maxChatProviderCalls).toBe(
      120
    )
  })

  it('refuse une valeur qui n’est pas un entier positif', () => {
    for (const invalide of [0, -3, 2.5, 'beaucoup', null]) {
      expect(normalizeOrchestrationBudget({ maxChatProviderCalls: invalide }).maxChatProviderCalls)
        .toBe(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls)
    }
  })

  it('un réglage DÉJÀ ÉCRIT, sans la nouvelle clé, garde ses trois plafonds', () => {
    // Le bord qui compte le plus : exiger la clé ferait rejeter le fichier entier — et un rejet
    // LÈVE (voir le test suivant), donc le réglage déjà écrit sur les machines deviendrait
    // illisible. Une clé absente prend le défaut ; c'est ce qui rend la migration invisible.
    const dossier = mkdtempSync(join(tmpdir(), 'budget-'))
    const chemin = join(dossier, 'orchestration-budget.json')
    writeFileSync(
      chemin,
      JSON.stringify({ maxUsd: 7, maxProviderCalls: 33, maxTotalTokens: 9_000_000 }),
      'utf8'
    )

    const lu = loadOrchestrationBudget(chemin)

    expect(lu.maxUsd).toBe(7)
    expect(lu.maxProviderCalls).toBe(33)
    expect(lu.maxTotalTokens).toBe(9_000_000)
    expect(lu.maxChatProviderCalls).toBe(DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls)
  })

  it('une clé PRÉSENTE mais invalide reste un rejet, comme les autres', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'budget-'))
    const chemin = join(dossier, 'orchestration-budget.json')
    writeFileSync(
      chemin,
      JSON.stringify({
        maxUsd: null,
        maxProviderCalls: 24,
        maxChatProviderCalls: -1,
        maxTotalTokens: 9_000_000
      }),
      'utf8'
    )

    // Un reglage rejete LEVE, il ne retombe pas en silence sur les defauts : c'est la bonne
    // conduite (un fichier abime ne doit pas effacer discretement les garde-fous), et c'est ce qui
    // rend la lecture optionnelle de la nouvelle cle INDISPENSABLE — l'exiger aurait fait planter
    // la lecture du reglage deja present sur les machines, pas seulement le reinitialiser.
    expect(() => loadOrchestrationBudget(chemin)).toThrow(/corrompu ou invalide/)
  })
})

describe('le tour de chat consomme bien ce réglage, pas une constante', () => {
  it('`os.ts` ne rabote plus le plafond du chat à une valeur câblée', () => {
    // Contrat sur le source : la garantie vit dans une methode qui exige tout l'OS pour tourner.
    // C'est la forme EXACTE qui a cause le defaut — la reintroduire recouperait les tours.
    const source = new TextDecoder().decode(readFileSync(join(__dirname, 'os.ts')))
    expect(source).not.toMatch(/Math\.min\(settings\.maxProviderCalls,\s*6\)/)
    expect(source).toMatch(/settings\.maxChatProviderCalls/)
  })
})
