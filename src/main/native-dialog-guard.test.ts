import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Contrat de SOURCE sur `index.ts` — meme idiome que `runtime-topology.test.ts`, qui lit deja ce
 * fichier en texte parce qu'il n'est pas montable en test unitaire.
 *
 * Ce qu'on protege, constate le 2026-08-10 : une session pilotant l'application a declenche
 * « ranger la conversation dans un dossier » sans fournir de chemin. Un selecteur natif a surgi sur
 * le bureau de l'utilisateur, sans fenetre parente — donc modal a toute l'APPLICATION — et le
 * handler est reste bloque a attendre une reponse que personne n'allait donner.
 *
 * Le garde qui existait ne couvrait que `headlessTestInstance`, c'est-a-dire les instances de TEST.
 * Une instance normale pilotee par un agent est precisement le cas ou personne n'est devant l'ecran.
 */
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('dialogues natifs — jamais bloquants quand personne ne regarde', () => {
  it('n’ouvre AUCUN dialogue natif hors des deux helpers gardés', () => {
    // Chaque appel direct rouvrirait le trou. Les seuls tolérés sont ceux des helpers, qui ont
    // déjà vérifié qu'une fenêtre visible existe.
    const appels = [...source.matchAll(/dialog\.show(?:Open|Save)Dialog\(/g)]

    expect(appels).toHaveLength(2)
  })

  it('les deux helpers passent une fenêtre PARENTE, jamais un dialogue sans parent', () => {
    // `showOpenDialog({...})` sans parent est modal à l'application entière : il vole le focus.
    expect(source).toContain('dialog.showOpenDialog(visible, { properties: [kind] })')
    expect(source).toContain('dialog.showSaveDialog(visible, { defaultPath })')
    expect(source).not.toMatch(/dialog\.show(?:Open|Save)Dialog\(\{/)
  })

  it('les deux helpers REFUSENT quand aucune fenêtre n’est visible', () => {
    const helpers = source.match(/async function pick(?:Path|SavePath)\([\s\S]*?\n\}/g)

    expect(helpers).toHaveLength(2)
    for (const helper of helpers ?? []) {
      expect(helper).toContain('isVisible()')
      expect(helper).toMatch(/if \(!visible\) \{[\s\S]*?return null/)
    }
  })

  it('le refus est TRACÉ : un dialogue qui ne s’ouvre pas doit s’expliquer', () => {
    // Sinon l'appelant reçoit `null` sans savoir si l'utilisateur a annulé ou si rien ne s'est ouvert.
    expect(source).toMatch(/console\.warn\(\s*[`'"]\[dialog\]/)
  })
})
