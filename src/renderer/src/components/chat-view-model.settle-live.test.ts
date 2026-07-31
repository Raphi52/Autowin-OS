import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { settleIfDone, type HydratedAssistantMessage } from './chat-view-model'

/**
 * INVARIANT : un tour declare `done` n'a plus AUCUNE action « en cours ».
 *
 * Il etait respecte a la RELECTURE DISQUE (`hydrateStoredAssistant` appelle `settleUnresolvedActions`)
 * mais PAS en session vivante. Les trois sites qui closent un tour en live — annule, echoue, termine —
 * posaient `done = true` en laissant les actions sans resultat, donc :
 *  - l'indicateur « N action en cours » restait colle indefiniment ;
 *  - le bouton « Reprendre » ne s'affichait PAS (il exige `interrupted`), et n'apparaissait qu'apres un
 *    REDEMARRAGE de l'app, quand la relecture disque reglait enfin les actions.
 *
 * Constate le 2026-07-30. Corrige dans `patchLast`, l'entonnoir UNIQUE de mutation du fil : imposer
 * l'invariant en UN point plutot qu'aux trois sites empeche un quatrieme site futur de l'oublier.
 */
const message = (parts: HydratedAssistantMessage['parts']): HydratedAssistantMessage => ({
  role: 'assistant',
  parts,
  status: 'interrupted',
  done: true
})

describe('un tour clos ne laisse rien « en cours »', () => {
  it('marque INTERROMPUE une action sans résultat quand le tour est done', () => {
    const settled = settleIfDone(
      message([
        { kind: 'action', name: 'scout', args: { task: 'auditer X' } },
        { kind: 'text', text: 'partiel' }
      ])
    )
    const action = settled.parts[0] as { interrupted?: boolean }
    expect(action.interrupted).toBe(true)
  })

  it('ne touche PAS une action déjà résolue — son verdict est un fait, pas un défaut', () => {
    const settled = settleIfDone(
      message([{ kind: 'action', name: 'verify', ok: true, args: { task: 'auditer X' } }])
    )
    const action = settled.parts[0] as { interrupted?: boolean; ok?: boolean }
    expect(action.ok).toBe(true)
    expect(action.interrupted).toBeUndefined()
  })

  it('ne touche RIEN tant que le tour n’est pas done : une action en vol reste en cours', () => {
    const live: HydratedAssistantMessage = {
      role: 'assistant',
      parts: [{ kind: 'action', name: 'scout', args: { task: 'auditer X' } }],
      status: 'streaming',
      done: false
    }
    const settled = settleIfDone(live)
    // Identite preservee : pas de re-render inutile, et surtout aucune action declaree interrompue
    // alors qu'elle tourne encore — ce serait proposer de « reprendre » un travail en cours.
    expect(settled).toBe(live)
    expect((settled.parts[0] as { interrupted?: boolean }).interrupted).toBeUndefined()
  })

  it('rend le MÊME objet si rien n’a changé (pas de re-render gratuit)', () => {
    const already = message([
      { kind: 'action', name: 'scout', ok: false, args: { task: 'auditer X' } }
    ])
    expect(settleIfDone(already)).toBe(already)
  })

  it('`patchLast` applique l’invariant — sinon la correction ne toucherait que les tests', () => {
    // Contrat de SOURCE : `patchLast` est une closure dans un composant de 2600 lignes, non importable.
    // On verifie donc que l'entonnoir de mutation appelle bien le regleur, sans quoi les tests ci-dessus
    // passeraient sur une fonction que l'application n'utilise jamais.
    const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
    const start = source.indexOf('function patchLast(')
    expect(start, 'patchLast introuvable').toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n  }', start))
    expect(body).toContain('settleIfDone(')
  })
})
