import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Le pied de la barre de gauche porte un NUMÉRO DE BUILD qui incrémente à chaque commit — l'utilisateur
 * l'a demandé pour « s'y retrouver » entre les versions qu'il lance.
 *
 * Garde de SOURCE (pas de montage : `MainApp` tire tout le chat, coûteux à simuler pour un pied de
 * page). On verrouille les deux propriétés qui font que ça marche ET ne casse pas les tests :
 *   1. la config Vite GRAVE le numéro (nombre de commits) et le SHA au build ;
 *   2. `App.tsx` lit ces globals via un `typeof … === 'string'` — le SEUL accès qui ne jette pas un
 *      `ReferenceError` là où `define` ne s'applique pas (tests happy-dom), avec un repli lisible.
 */
describe('numéro de build en bas à gauche', () => {
  const lire = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('la config Vite grave le nombre de commits et le SHA', () => {
    const config = lire('../../../electron.vite.config.ts')
    expect(config).toMatch(/rev-list --count HEAD/)
    expect(config).toMatch(/__BUILD_NUMBER__:\s*JSON\.stringify/)
    expect(config).toMatch(/__BUILD_SHA__:\s*JSON\.stringify/)
  })

  it('App.tsx affiche le build et lit les globals SANS planter hors build', () => {
    const app = lire('./App.tsx')
    // Affichage : « build <n> · <sha> » à côté de la version.
    expect(app).toMatch(/build \$\{buildNumber\} · \$\{buildSha\}/)
    // Accès SÛR : `typeof` avant usage, sinon ReferenceError en test. + repli non vide.
    expect(app).toMatch(/typeof __BUILD_NUMBER__ === 'string'\s*\?\s*__BUILD_NUMBER__\s*:\s*'dev'/)
    expect(app).toMatch(/typeof __BUILD_SHA__ === 'string'\s*\?\s*__BUILD_SHA__\s*:\s*'local'/)
    // Anti-regression : jamais l'ancien libellé fige « · preview ».
    expect(app).not.toMatch(/version\} · preview/)
  })
})
