import { describe, expect, it } from 'vitest'
import { ciblesNommees } from './root-execution-contract'

/*
 * Defaut vecu (conv-470, tour 52fbe05f-0086-4806-8f07-c8762e8caa35, saisie ts=1789192601300
 * « /kaizen j'ai rien en preprompt ») : la demande ne nommait AUCUN fichier, mais le dossier de
 * preuve joint recopiait un message anterieur portant « Ancrage : src/main/model-quotas.ts:62 ».
 * Le gate a exige la mutation de ce fichier et a refuse un travail juste. Une donnee rapportee ne
 * commande pas : les cibles obligatoires se lisent dans la DEMANDE, jamais dans le dossier joint.
 */
describe('ciblesNommees ignore le dossier de preuve joint', () => {
  const dossier = [
    "/kaizen j'ai rien en preprompt",
    '',
    '=== DOSSIER DE PREUVE AUTOWIN OS ===',
    '{"messages":[{"content":"Ancrage : src/main/model-quotas.ts:62 (2026-09-11)"}]}',
    '=== FIN DU DOSSIER ==='
  ].join('\n')

  it("n'herite pas d'un ancrage recopie dans le dossier", () => {
    expect(ciblesNommees(dossier)).toEqual([])
  })

  it('garde la cible ancree par la demande elle-meme', () => {
    const task = `Repare src/main/commands.ts:42\n\n${dossier}`
    expect(ciblesNommees(task)).toEqual(['src/main/commands.ts'])
  })
})
