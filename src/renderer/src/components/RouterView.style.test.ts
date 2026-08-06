import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Toutes les feuilles de style sous une racine, en descendant. */
const fichiersCss = (racine: URL | string): string[] => {
  const base = typeof racine === 'string' ? racine : fileURLToPath(racine)
  return readdirSync(base, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(base, entree.name)
    if (entree.isDirectory()) return fichiersCss(chemin)
    return entree.name.endsWith('.css') ? [chemin] : []
  })
}

const css = (): string => readFileSync(new URL('./RouterView.css', import.meta.url), 'utf8')

const ruleBody = (selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css().match(new RegExp(`${escaped}\\s*{([^}]*)}`, 's'))?.[1]
}

/**
 * Garde né d'un défaut RÉEL, signalé par l'utilisateur le 2026-08-06 : les puces de comptes
 * s'affichaient « en noir sur noir ». Cause : un `<button>` ne recopie pas la couleur de son
 * parent — sans `color` explicite il retombe sur le noir de l'agent utilisateur, invisible sur
 * le thème sombre. Le reste du fichier le savait déjà (`.router-actions button { color: inherit }`) ;
 * mes règles ajoutées ne l'ont pas fait. Aucun test ne pouvait l'attraper : les tests de rendu
 * montent le DOM sans feuille de style, et une capture n'aurait montré qu'un rectangle sombre.
 */
describe('boutons de comptes — lisibles sur le thème sombre', () => {
  const interactifs = [
    '.router-account-chip',
    '.router-account-add',
    '.router-account-remove'
  ]

  it.each(interactifs)('%s déclare une couleur de texte', (selector) => {
    const body = ruleBody(selector)
    expect(body, `règle ${selector} introuvable`).toBeDefined()
    // Sans `color`, le bouton est noir quel que soit le thème — le défaut exact rapporté.
    expect(body).toMatch(/(^|;|\s)color\s*:/)
  })

  it.each(interactifs)('%s hérite de la police plutôt que celle de l’agent utilisateur', (selector) => {
    expect(ruleBody(selector)).toMatch(/font\s*:\s*inherit/)
  })

  it('le compte actif reste lisible malgré son état désactivé', () => {
    // Il est `disabled` (on ne rebascule pas sur soi-même) : sans règle dédiée il hériterait de
    // l'opacité « indisponible », qui dit l'inverse de « c'est celui-ci qui est en cours ».
    const body = ruleBody('.router-account-chip.is-active,\n.router-account-chip.is-active:disabled')
    expect(body).toBeDefined()
    expect(body).toMatch(/opacity\s*:\s*1/)
    expect(body).toMatch(/(^|;|\s)color\s*:/)
  })

  it('n’utilise que des variables de thème réellement définies dans le dépôt', () => {
    // Deux tokens avaient été écrits de mémoire dans une première version : ils n'existent pas,
    // et la valeur de repli s'appliquait en silence — un défaut qu'aucun outil ne signale.
    // On vérifie les var() RÉELLEMENT référencées, pas une liste noire de noms : une liste noire
    // se déclenchait sur les noms cités dans un commentaire, et surtout elle n'aurait rien dit
    // du PROCHAIN token inventé.
    const utilisees = [...css().matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1])
    expect(utilisees.length).toBeGreaterThan(0)

    // Lecture disque plutôt qu'`import.meta.glob` : le glob du bundler ne renvoyait aucun fichier
    // dans ce contexte de test, ce qui faisait passer les 15 tokens LÉGITIMES pour des inconnus —
    // un test qui échoue à tort est aussi inutile qu'un test qui passe à tort.
    const toutesLesDefinitions = fichiersCss(new URL('..', import.meta.url))
      .map((chemin) => readFileSync(chemin, 'utf8'))
      .join('\n')
    const definies = new Set(
      [...toutesLesDefinitions.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1])
    )

    const inconnues = [...new Set(utilisees)].filter((nom) => !definies.has(nom))
    expect(inconnues, `tokens jamais définis : ${inconnues.join(', ')}`).toEqual([])
  })
})
