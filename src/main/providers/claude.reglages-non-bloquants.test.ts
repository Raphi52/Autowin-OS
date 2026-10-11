import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * LES REGLAGES D'UN APPEL CLAUDE S'ECRIVENT SANS FIGER LA FENETRE.
 *
 * A chaque appel, `send` cree un dossier temporaire `autowin-os-settings-*` et y ecrit le script de
 * garde `garde-git-destructeur.mjs` puis `settings.json`. Ecrits en synchrone, ils tenaient la
 * boucle d'evenements du processus principal pendant toute l'attente du disque :
 *  - `gels.jsonl` 2026-10-02 09:01 : 1 831 ms en `writeFileSync …/garde-git-destructeur.mjs` ;
 *  - `gels.jsonl` 2026-10-11 14:12 : 99 121 ms, meme ligne, pendant qu'un `pip install torch`
 *    saturait les disques — la fenetre est restee figee plus d'une minute et demie.
 *
 * CE QUE CETTE GARDE EST : elle lit le TEXTE du bloc de reglages, comme
 * `claude.nettoyage-sur-echec-de-lancement.test.ts`. Executer `send` demanderait un CLI, un spawn et
 * une horloge ; le contrat qui compte tient en une question — « ce bloc fait-il une E/S synchrone ? ».
 */
describe('claude — les reglages de l’appel ne figent pas la boucle', () => {
  const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')
  const debut = source.indexOf('let settingsDir: string | undefined')
  const fin = source.indexOf('let systemPromptDir', debut)
  const bloc = source.slice(debut, fin)

  it('le bloc de reglages est bien trouve', () => {
    expect(debut).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    expect(bloc).toContain('garde-git-destructeur.mjs')
  })

  it('aucun appel disque synchrone dans le bloc', () => {
    // Commentaires retires : le texte explicatif cite l'ancien `writeFileSync`.
    const code = bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\b\w+Sync\(/)
  })

  it('le dossier, le script de garde et settings.json sont ATTENDUS en asynchrone', () => {
    expect(bloc).toContain('await mkdtempAsync(')
    expect(bloc).toContain('await writeFileAsync(hookGarde')
    expect(bloc).toMatch(/await writeFileAsync\(\s*settingsFile/)
  })
})
