import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * LE JOURNAL DU PROCESSUS PRINCIPAL PORTE TOUJOURS SON CONTEXTE.
 *
 * Le 2026-09-06, deux `console.log` de debogage (« PANEL EFFET », « DOIT ») ont ete PUBLIES avec un
 * travail recupere. La garde ajoutee le meme jour ne couvrait que l'interface, ou la regle est
 * simple : aucune trace, jamais. Ici elle serait FAUSSE — le processus principal a le devoir de
 * journaliser (demarrage, relance du Brain, purge des journaux, copies interrompues), et ces lignes
 * sont precisement ce qu'on lit quand quelque chose ne va pas.
 *
 * La regle juste n'est donc pas « pas de trace » mais « pas de trace ANONYME » : tout message porte
 * un contexte entre crochets — `[demarrage]`, `[brain-launch]`, `[worktrees]`… C'est exactement ce
 * qui manque a une trace de mise au point oubliee, et c'est verifiable sans juger de l'intention.
 *
 * Mesure a l'ecriture : les 20 traces du main respectent DEJA cette forme. Ce test ne nettoie donc
 * rien — il empeche la prochaine de passer.
 */
const racineMain = join(process.cwd(), 'src', 'main')

/**
 * RELAIS AUTORISES : le message n'est pas un litteral, il est construit — et deja prefixe — ailleurs.
 *
 * Liste NOMMEE et courte a dessein : ajouter un relais oblige a verifier a la main que sa source
 * prefixe bien. Fait pour ces trois-la, qui produisent `[pari]`, `[worktrees]` et `[brain-*]`.
 */
const RELAIS_AUTORISES = new Set(['resumerMesure(mesure)', 'line', 'message'])

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) {
      trouves.push(...fichiersSources(chemin))
      continue
    }
    if (!entree.name.endsWith('.ts') || /\.test\.ts$/.test(entree.name)) continue
    trouves.push(chemin)
  }
  return trouves
}

/** L'argument passe au log, sans la parenthese fermante de l'appel ni les separateurs de fin. */
function argumentRelaye(message: string): string {
  const sansEspaces = message.trimEnd()
  return sansEspaces.endsWith(')') ? sansEspaces.slice(0, -1) : sansEspaces
}

describe('journal du processus principal', () => {
  it('aucune trace anonyme : chaque console.log porte un contexte entre crochets', () => {
    const anonymes: string[] = []
    for (const chemin of fichiersSources(racineMain)) {
      const lignes = readFileSync(chemin, 'utf8').split('\n')
      lignes.forEach((ligne, index) => {
        if (!/(^|[^.\w])console\.log\(/.test(ligne)) return
        const apres = ligne.slice(ligne.indexOf('console.log(') + 'console.log('.length).trim()
        // Appel multi-ligne : le message est sur la ligne suivante, c'est elle qui compte.
        const message = apres === '' ? (lignes[index + 1]?.trim() ?? '') : apres
        const litteral = /^[`'"]/.test(message)
        if (litteral) {
          if (/^[`'"]\[/.test(message)) return
        } else if (RELAIS_AUTORISES.has(argumentRelaye(message))) {
          return
        }
        anonymes.push(`${relative(racineMain, chemin)}:${index + 1} → ${message.slice(0, 60)}`)
      })
    }

    expect(anonymes).toEqual([])
  })
})
