import { describe, expect, it } from 'vitest'
import {
  ALLOWED_SCRIPT_COMMANDS,
  TYPES_DE_VERIFICATION,
  decideVerifyScript
} from './verify-command'

/**
 * `verify` NE PROUVE PLUS QUE LES TESTS — il rejoue aussi `lint` et `typecheck`.
 *
 * Ce que ces cas verrouillent, et pourquoi : la capacite existait dans `package.json` mais n'etait
 * atteignable que par `run npm run typecheck`, donc PRESENTE et INDECOUVRABLE. En l'ouvrant, on
 * ouvre un point d'entree qui LANCE un processus : la propriete a garder est que le modele ne
 * transmette JAMAIS une commande, seulement un TYPE parmi trois valeurs fermees.
 *
 * Le geste a ete recupere le 2026-09-09 d'une copie de travail isolee jamais publiee
 * (`agent__run-7ea9ff7647f9-1`), ou il etait ECRIT mais NON TESTE. Ces cas sont la preuve qui
 * manquait.
 */
describe('verify — preuves autres que les tests', () => {
  const scriptsPresents = (): Record<string, unknown> => ({
    lint: 'eslint .',
    typecheck: 'tsc --noEmit'
  })

  it('rejoue le script npm DECLARE, et jamais la valeur du package.json', () => {
    const decision = decideVerifyScript('typecheck', '/depot', scriptsPresents)
    expect(decision.allowed).toBe(true)
    // La commande vient de la liste blanche interne, PAS de `tsc --noEmit` lu sur le disque : un
    // package.json hostile ne peut donc pas choisir ce qui s'execute.
    expect(decision).toMatchObject({ command: 'npm run typecheck', cwd: '/depot' })
  })

  it('refuse en le DISANT quand le projet ne declare pas le script — plutot qu inventer un vert', () => {
    const decision = decideVerifyScript('lint', '/depot', () => ({ test: 'vitest' }))
    expect(decision.allowed).toBe(false)
    expect(decision.allowed === false && decision.reason).toContain('aucun script')
  })

  it('refuse un script declare VIDE : une chaine blanche ne prouve rien', () => {
    const decision = decideVerifyScript('lint', '/depot', () => ({ lint: '   ' }))
    expect(decision.allowed).toBe(false)
  })

  it('refuse sans workspace resolu, au lieu de lancer dans un dossier devine', () => {
    expect(decideVerifyScript('lint', undefined, scriptsPresents).allowed).toBe(false)
    expect(decideVerifyScript('lint', '   ', scriptsPresents).allowed).toBe(false)
  })

  it('ne peut produire QUE des commandes de la liste blanche, qui reste minuscule', () => {
    for (const type of ['lint', 'typecheck'] as const) {
      const decision = decideVerifyScript(type, '/depot', scriptsPresents)
      expect(decision.allowed).toBe(true)
      expect(ALLOWED_SCRIPT_COMMANDS.has(decision.allowed === true ? decision.command : '')).toBe(
        true
      )
    }
    expect([...ALLOWED_SCRIPT_COMMANDS]).toEqual(['npm run lint', 'npm run typecheck'])
  })

  it('annonce ses trois types, pour que le refus du bus puisse les NOMMER', () => {
    expect(TYPES_DE_VERIFICATION).toEqual(['test', 'lint', 'typecheck'])
  })
})
