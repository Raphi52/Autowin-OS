import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOT_SPLASH_DOCUMENT, BOOT_SPLASH_MARKUP } from './boot-splash'

/**
 * L'écran d'attente doit tenir aux DEUX endroits, et rester identique entre les deux.
 *
 * Le défaut que ces tests empêchent de revenir a été constaté à l'usage : « ça disparaît après une
 * seconde ». L'écran du processus principal s'affichait bien, puis le serveur de développement servait
 * `index.html`, la navigation validait — remplaçant le document — et le `#root` vide rendait la
 * fenêtre blanche pour ~25 s. Un seul des deux écrans ne couvre donc rien.
 */

const html = readFileSync(join(__dirname, '../renderer/index.html'), 'utf8')

describe('écran d’attente — les deux copies', () => {
  it('`index.html` porte le MÊME balisage que le module', () => {
    // La duplication est inévitable : un fichier HTML statique ne peut pas importer un module TS.
    // Elle est donc surveillée — mais sur le CONTENU, pas sur le formatage.
    //
    // Prettier reformate le CSS de `index.html` selon ses propres idiomes : point-virgule ajouté avant
    // chaque `}`, et zéro de tête sur les décimales (`.45s` devient `0.45s`). Deux copies sémantiquement
    // identiques échouaient donc sur des différences que personne n'a écrites. On neutralise ces deux
    // idiomes, et RIEN d'autre : une vraie divergence de couleur, de sélecteur ou de balise casse
    // toujours le test.
    // Le zéro de tête est retiré PARTOUT, pas seulement après `:` ou `,` : prettier écrit aussi
    // `animation:boot-in0.45s`, où le zéro suit une lettre. Une première version du motif ne couvrait
    // que les deux premiers cas et le test échouait encore sur du formatage.
    const nu = (t: string): string =>
      t
        .replace(/\s+/g, '')
        .replace(/;}/g, '}')
        .replace(/(?<!\d)0\./g, '.')
    expect(nu(html)).toContain(nu(BOOT_SPLASH_MARKUP))
  })

  it('vit DANS `#root`, pour que React l’efface tout seul', () => {
    const root = html.indexOf('<div id="root">')
    const boot = html.indexOf('id="autowin-boot"')
    expect(root).toBeGreaterThan(-1)
    expect(boot).toBeGreaterThan(root)
    // Placé à côté de `#root`, il resterait affiché PAR-DESSUS l'application.
    expect(html.indexOf('</div>', boot)).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('n’a besoin d’aucun script : le bundle est justement ce qu’on attend', () => {
    expect(BOOT_SPLASH_MARKUP).not.toContain('<script')
    expect(html.indexOf('id="autowin-boot"')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('le document autonome est complet et se suffit à lui-même', () => {
    expect(BOOT_SPLASH_DOCUMENT).toMatch(/^<!doctype html>/)
    // Avec les guillemets : `charset="utf-8"` ne contient PAS la sous-chaîne `charset=utf-8`.
    expect(BOOT_SPLASH_DOCUMENT).toContain('charset="utf-8"')
    expect(BOOT_SPLASH_DOCUMENT).toContain(BOOT_SPLASH_MARKUP)
  })
})

describe('écran d’attente — l’apparence demandée', () => {
  // La feuille de style de l'application est la SOURCE de l'atome : le splash la recopie à la main,
  // faute de pouvoir la charger si tôt. On confronte donc la copie à l'original plutôt qu'à des
  // constantes propres au splash, qui laissaient les deux dériver sans que rien ne le dise.
  const theme = readFileSync(join(__dirname, '../renderer/src/assets/theme.css'), 'utf8')
  const sansEspaces = (t: string): string => t.replace(/\s+/g, '')

  it('fond noir', () => {
    expect(BOOT_SPLASH_MARKUP).toContain('background:#000')
  })

  it('porte l’ATOME de l’application, pas un indicateur à lui', () => {
    // Un deuxième « ça bosse » propre au démarrage est exactement ce qu'on ne veut plus : l'écran
    // d'attente doit montrer le même objet que le reste de l'application.
    for (const classe of [
      'aw-atom__plane--3',
      'aw-atom__rot--3',
      'aw-atom__trail--3',
      'aw-atom__head--3',
      'aw-atom__star--hot'
    ]) {
      expect(BOOT_SPLASH_MARKUP).toContain(classe)
    }
    expect(BOOT_SPLASH_MARKUP).not.toContain('<svg')
  })

  it('reprend les couleurs et les tempos de `theme.css`', () => {
    // Les trois têtes d'orbite et l'étoile : si le thème change de teinte, la copie doit suivre.
    for (const couleur of ['#ff2d95', '#ff8a1f', '#ffd66b']) {
      expect(theme).toContain(couleur)
      expect(BOOT_SPLASH_MARKUP).toContain(couleur)
    }
    for (const tempo of ['2.7s', '3.3s', '3.9s', '1.6s']) {
      expect(sansEspaces(BOOT_SPLASH_MARKUP)).toContain(tempo)
    }
  })

  it('reste annoncé aux lecteurs d’écran et respecte la réduction d’animation', () => {
    expect(BOOT_SPLASH_MARKUP).toMatch(/role="status"/)
    expect(BOOT_SPLASH_MARKUP).toMatch(/aria-live="polite"/)
    expect(BOOT_SPLASH_MARKUP).toMatch(/prefers-reduced-motion/)
    // L'atome ralentit au lieu de s'arrêter : figé, il ne dirait plus que ça travaille.
    expect(BOOT_SPLASH_MARKUP).toMatch(/animation-duration:3s/)
  })
})
