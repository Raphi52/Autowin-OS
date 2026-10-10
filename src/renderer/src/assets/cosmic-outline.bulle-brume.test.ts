import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Lueur « Brume » autour de la bulle des messages envoyes (draft conv-199, 2026-10-10).
 * L'utilisateur a refuse les reflets DANS le fond de la bulle (« nan essaye plutot avec des shadows
 * autour »), puis a voulu une lueur dont « la couleur suive le dégradé », plus legere, sans bord
 * lumineux : « go Brume ». Maquette retenue : artifacts/draft-bulle-relief/tour4.html (piste 5).
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST : une lueur peinte d'une seule couleur (box-shadow,
 * fond en dur) au lieu de la copie du degrade, une lueur sans flou ou plus forte que la maquette,
 * ou le retrait de `isolation` sur la ligne du message, qui ferait tomber la lueur sous le fond du fil.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const SOMBRES = ":root:not([data-base='clair']):not([data-theme^='malvoyant-']) .cosmic-outline"

function decls(selecteur: string): Record<string, string> {
  const valeurs: Record<string, string> = {}
  postcss.parse(lire('./cosmic-outline.css')).walkRules((regle) => {
    if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
    regle.walkDecls((d) => {
      valeurs[d.prop] = d.value
    })
  })
  return valeurs
}

describe('Bulle envoyee : lueur Brume qui suit le degrade', () => {
  it('pose derriere la bulle une copie floutee de son propre degrade', () => {
    const lueur = decls(`${SOMBRES} .msg.user .msg-body.msg-bulle::before`)
    expect(lueur.content).toBe("''")
    expect(lueur.background).toBe('inherit')
    expect(lueur['border-radius']).toBe('inherit')
    expect(lueur.position).toBe('absolute')
    expect(lueur['z-index']).toBe('-1')
    expect(lueur['pointer-events']).toBe('none')
  })

  it('garde la force de la maquette : halo diffus de 22 px a 45 %, sans cœur lumineux', () => {
    const lueur = decls(`${SOMBRES} .msg.user .msg-body.msg-bulle::before`)
    expect(lueur.filter).toBe('blur(22px)')
    expect(lueur.opacity).toBe('0.45')
    expect(lueur['box-shadow']).toBeUndefined()
  })

  it('ancre la lueur sur la bulle et la garde au-dessus du fond du fil', () => {
    expect(decls(`${SOMBRES} .msg.user .msg-body.msg-bulle`).position).toBe('relative')
    expect(decls(`${SOMBRES} .msg.user`).isolation).toBe('isolate')
  })
})
