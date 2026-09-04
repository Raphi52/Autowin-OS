import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCachedImportedModels } from './models'
import { codexExecutionEvidenceFromItem } from './providers/codex'
import { flattenChatParts, flattenChatPartsForModel } from '../shared/chat-turn'

/**
 * LE RETRAIT DES MOTEURS NE DOIT PAS RENDRE L'HISTORIQUE ILLISIBLE.
 *
 * Deux exigences OPPOSÉES tiennent ensemble ici, et c'est tout l'intérêt du banc :
 *  - plus aucun moteur retiré n'est PROPOSÉ (catalogue au démarrage = cache disque relu) ;
 *  - tout ce qui a DÉJÀ été produit par ces moteurs reste RELU tel quel (preuves d'exécution
 *    enregistrées, parts de conversation, et le cache disque lui-même, jamais réécrit).
 *
 * Sans ce banc, les deux régressions symétriques passaient inaperçues : un moteur mort qui
 * réapparaît dans Agent Studio au prochain démarrage (via le cache écrit AVANT le retrait), ou
 * une purge du cache qui efface l'historique de l'utilisateur.
 */
const codexCacheEntry = {
  id: 'codex/gpt-5.6-sol',
  provider: 'codex',
  model: 'gpt-5.6-sol',
  label: 'GPT-5.6-Sol',
  reasoningEfforts: ['medium', 'high'],
  defaultReasoningEffort: 'high'
}

function cacheAvecCodex(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'autowin-catalog-')), 'model-catalog.json')
  writeFileSync(
    path,
    JSON.stringify({ version: 1, discoveredAt: Date.now(), codex: [codexCacheEntry] }),
    'utf8'
  )
  return path
}

describe('moteurs retirés — le catalogue les oublie, l’historique les relit', () => {
  it('le catalogue relu au démarrage ne propose plus un moteur retiré', () => {
    const models = loadCachedImportedModels(cacheAvecCodex())

    // Le défaut d'origine : ce cache a été écrit AVANT le retrait, et le démarrage le relit tel
    // quel — Codex réapparaissait donc dans Agent Studio et un rôle pouvait y être routé.
    expect(models.some((model) => model.provider === 'codex')).toBe(false)
    expect(models.some((model) => model.provider === 'kimi')).toBe(false)
    expect(models.some((model) => model.provider === 'gemini')).toBe(false)
  })

  it('le cache disque n’est PAS purgé : les données anciennes restent lisibles', () => {
    const path = cacheAvecCodex()

    loadCachedImportedModels(path)

    const apres = JSON.parse(readFileSync(path, 'utf8')) as { codex?: unknown[] }
    expect(apres.codex).toHaveLength(1)
  })

  it('une preuve d’exécution enregistrée par Codex se relit encore', () => {
    const evidence = codexExecutionEvidenceFromItem({
      type: 'command_execution',
      command: 'npm run typecheck',
      exit_code: 0,
      status: 'completed',
      aggregated_output: 'exit=0'
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ type: 'command_execution', ok: true })
    expect(evidence[0].summary).toContain('npm run typecheck')
  })

  it('une conversation enregistrée avec un moteur retiré se réaffiche et se renvoie au modèle', () => {
    const parts = [
      {
        kind: 'action' as const,
        actionId: 'a1',
        name: 'verify',
        ok: true,
        data: { exitCode: 0, provider: 'codex' }
      }
    ]

    expect(flattenChatParts(parts)).toBe('[a exécuté verify]')
    expect(flattenChatPartsForModel(parts)).toContain('exitCode')
  })
})
