import { describe, expect, it } from 'vitest'
import { codexExecSpec } from './codex'

/**
 * LA RECHERCHE WEB EST-ELLE ALLUMEE SUR LA BRANCHE CODEX ?
 *
 * La consigne injectee dans chaque phase promet WebFetch/WebSearch « sur toutes les branches ».
 * Cote Codex, rien ne l'activait : la branche devinait la ou une branche Claude allait lire.
 *
 * `--search` a ete essaye sur le binaire installe (codex-cli 0.151.0) et REFUSE par ce
 * sous-programme (« unexpected argument '--search' found ») : c'est une option de `codex`, pas de
 * `codex exec`. D'ou la cle de configuration.
 *
 * ENTREE QUI DOIT LE FAIRE ECHOUER : retirer l'option, ou revenir a `--search`.
 */
describe('argv Codex', () => {
  it('active la recherche web par la clé de configuration, jamais par --search', () => {
    const spec = codexExecSpec(
      String.raw`C:\repo`,
      'm',
      'read-only',
      undefined,
      String.raw`C:\AppData`,
      () => true
    )
    const paires = spec.args.map((a, i) => `${spec.args[i - 1] ?? ''} ${a}`)
    expect(paires).toContain('-c tools.web_search=true')
    expect(spec.args).not.toContain('--search')
  })
})
