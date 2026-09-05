import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * UN DOSSIER TEMPORAIRE RIEN QU'A CE TEST.
 *
 * Les tests de nettoyage comptent les dossiers `autowin-os-*` restes derriere un appel avorte. Tant
 * qu'ils regardaient le temp du SYSTEME, ils comptaient aussi ceux des AUTRES fichiers de test —
 * vitest les execute en parallele, et chacun cree ses propres `autowin-os-settings-*`. L'assertion
 * « aucun nouveau temporaire » devenait alors fausse sans qu'aucun code de production soit en
 * cause : mesure du 2026-09-05, deux verifications rouges d'affilee accusant un changement
 * innocent (un simple ajout d'argument a la ligne de commande), vertes des la passe suivante.
 *
 * Un test qui accuse au hasard coute plus cher que le defaut qu'il surveille : on ne relache pas
 * l'assertion, on REDUIT ce qu'elle observe a ce que l'appel a lui-meme produit. `os.tmpdir()` relit
 * l'environnement a CHAQUE appel — et `providers/claude.ts` l'appelle au moment de creer chaque
 * dossier —, donc rediriger ces variables suffit a isoler, sans toucher au code de production.
 */
const VARIABLES_TEMP = ['TMPDIR', 'TEMP', 'TMP'] as const

export interface TempIsole {
  /** Racine temporaire propre a ce test. */
  readonly racine: string
  /** Les temporaires d'appel presents dans CETTE racine, jamais ceux du systeme. */
  lister(): string[]
  /** Restaure l'environnement et supprime la racine. A appeler meme si le test echoue. */
  demonter(): void
}

export function isolerTemp(prefixe = 'autowin-test-temp-'): TempIsole {
  const racine = mkdtempSync(join(tmpdir(), prefixe))
  const precedentes = VARIABLES_TEMP.map((nom) => [nom, process.env[nom]] as const)
  for (const nom of VARIABLES_TEMP) process.env[nom] = racine
  return {
    racine,
    lister: () =>
      readdirSync(racine).filter(
        (nom) => nom.startsWith('autowin-os-system-') || nom.startsWith('autowin-os-settings-')
      ),
    demonter: () => {
      for (const [nom, valeur] of precedentes) {
        if (valeur === undefined) delete process.env[nom]
        else process.env[nom] = valeur
      }
      rmSync(racine, { recursive: true, force: true })
    }
  }
}
