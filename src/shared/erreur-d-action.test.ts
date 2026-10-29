import { describe, expect, it } from 'vitest'
import { ligneDErreurDAction, lireLigneDErreur, messageDErreur } from './erreur-d-action'
import { gesteDeLaLigne } from './gestes-agent'
import { ACTIONS_LINE_MAX } from './chat-turn'

/** Les trois formes RÉELLES relevées le 2026-10-19 dans les sessions du dépôt. */
const GLOB_DELAI =
  'Ripgrep search timed out after 20 seconds. The search may have matched files but did not complete in time. Try searching a more specific path or pattern.'
const BASH_CODE =
  'Exit code 1\nInvoke-Expression : Au caractère Ligne:1 : 381\r\n+ ... ss -Id 20056 ...\r\n\r\nArgument manquant dans la liste de paramètres.'
const REFUS =
  "<tool_use_error>Blocked: Start-Sleep 45 followed by: Select-String -Path D:\\x.log -Pattern 'ready'</tool_use_error>"

describe('messageDErreur — le texte rendu par l’outil, sur une ligne', () => {
  it('garde la phrase d’un Glob tombé en délai dépassé', () => {
    expect(messageDErreur(GLOB_DELAI)).toBe(GLOB_DELAI)
  })

  it('joint les lignes d’un Bash par « · » et saute les lignes vides', () => {
    expect(messageDErreur(BASH_CODE)).toBe(
      'Exit code 1 · Invoke-Expression : Au caractère Ligne:1 : 381 · + ... ss -Id 20056 ... · Argument manquant dans la liste de paramètres.'
    )
  })

  it('retire les balises <tool_use_error> d’un refus', () => {
    expect(messageDErreur(REFUS)).toBe(
      "Blocked: Start-Sleep 45 followed by: Select-String -Path D:\\x.log -Pattern 'ready'"
    )
  })

  it('rend vide quand l’outil n’a rien rendu', () => {
    expect(messageDErreur('  \n\r\n ')).toBe('')
  })
})

describe('ligneDErreurDAction — la ligne qui voyage dans le journal d’actions', () => {
  it('nomme l’outil puis le message', () => {
    expect(ligneDErreurDAction('Glob', GLOB_DELAI)).toBe(`Glob erreur - ${GLOB_DELAI}`)
  })

  // conv-1228 (2026-10-28) : la borne est celle d'une ligne du journal (`ACTIONS_LINE_MAX`), plus
  // 300 caractères — le message d'erreur était amputé avant la ligne qui disait pourquoi.
  it('tient dans une ligne du journal, coupée par « … »', () => {
    const ligne = ligneDErreurDAction('Bash', `Exit code 2\n${'x'.repeat(50_000)}`)!
    expect(ligne.length).toBeLessThanOrEqual(ACTIONS_LINE_MAX)
    expect(ligne.endsWith('…')).toBe(true)
    expect(ligne.startsWith('Bash erreur - Exit code 2 · xxx')).toBe(true)
  })

  it('n’écrit aucune ligne sans message', () => {
    expect(ligneDErreurDAction('Bash', '')).toBeUndefined()
  })

  it('se relit telle qu’écrite', () => {
    expect(lireLigneDErreur(ligneDErreurDAction('Glob', GLOB_DELAI)!)).toEqual({
      outil: 'Glob',
      message: GLOB_DELAI
    })
    expect(lireLigneDErreur('Glob échoué - 25 s')).toBeUndefined()
    expect(lireLigneDErreur('Bash · grep -n erreur - x')).toBeUndefined()
  })

  it('n’est PAS un geste fini : le décompte des gestes ne la compte pas deux fois', () => {
    expect(gesteDeLaLigne(ligneDErreurDAction('Glob', GLOB_DELAI))).toBeUndefined()
    // La ligne de fin, elle, reste lue comme avant.
    expect(gesteDeLaLigne('Glob échoué - 25 s')).toEqual({
      nom: 'Glob',
      ok: false,
      dureeMs: 25_000
    })
  })
})
