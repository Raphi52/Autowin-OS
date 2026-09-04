import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * UN APPEL QUI N'A JAMAIS DEMARRE LAISSAIT SES TEMPORAIRES DERRIERE LUI.
 *
 * Tout le nettoyage de fin d'appel vivait dans le gestionnaire `close`. Or Node n'emet PAS `close`
 * quand le processus ne peut pas etre lance du tout (binaire introuvable, droits) : `error` est
 * alors la SEULE sortie. Les dossiers du system prompt et des reglages, crees AVANT le spawn,
 * restaient donc orphelins.
 *
 * MESURE du 2026-09-04 dans le dossier temporaire de l'installation : 39 `autowin-os-system-*` et
 * 39 `autowin-os-settings-*` abandonnes, apparies UN POUR UN — la signature exacte d'un couple perdu
 * par appel avorte — le plus recent date du jour meme.
 *
 * CE QUE CETTE GARDE EST, ET CE QU'ELLE N'EST PAS : elle lit le TEXTE du gestionnaire `error`, elle
 * n'execute pas un lancement rate. Monter un vrai spawn en echec demanderait un binaire absent et
 * une horloge ; le contrat qui compte tient en une question — « ce point de sortie appelle-t-il le
 * nettoyage ? » — et c'est exactement ce qui avait ete oublie. Une garde textuelle assumee vaut
 * mieux qu'aucune garde sur une fuite mesuree.
 */
describe('claude — un lancement rate ne laisse pas de temporaires derriere lui', () => {
  const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')

  const handlerError = (): string => {
    const debut = source.indexOf("child.on('error'")
    expect(debut).toBeGreaterThan(-1)
    const fin = source.indexOf("child.once('close'", debut)
    expect(fin).toBeGreaterThan(debut)
    return source.slice(debut, fin)
  }

  it('la sortie sur erreur nettoie les temporaires de l’appel', () => {
    expect(handlerError()).toContain('nettoyerTemporairesDeLAppel')
  })

  it('elle nettoie AUSSI la config MCP et les pieces jointes — le jeton ne survit pas a l’appel', () => {
    const bloc = handlerError()
    expect(bloc).toContain('mcpConfigDir?.nettoyer()')
    expect(bloc).toContain('materialized?.cleanup()')
  })

  it('elle n’ATTEND pas ce nettoyage : ce point de sortie doit rendre la main tout de suite', () => {
    const bloc = handlerError()
    // `await` ici retarderait `wake()` — c'est le gel de 1,6 s deja mesure le 2026-08-31.
    expect(bloc).not.toContain('await nettoyerTemporairesDeLAppel')
    expect(bloc).toContain('.catch(() => undefined)')
  })
})
