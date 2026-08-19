import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { portableAppDataBase } from './app-data'

/**
 * LA COMMANDE DE LOGIN ÉCRIVAIT DANS UN STORE QUE L'APP NE LIT PAS.
 *
 * Mesuré le 2026-08-19 : `npm run codex:login` a écrit des jetons frais à 12:27 dans
 * `%APPDATA%\autowin-os\auth.json`, tandis que l'app lisait
 * `<dépôt>\.autowin-data\autowin-os\auth.json`, inchangé depuis le 12 août. Le login annonçait
 * « ✓ Authentifié », l'app répondait `401 token_expired`, et rien ne reliait les deux : une demi-heure
 * de diagnostic pour un chemin.
 *
 * Cause : `appDataBase()` retombe sur `process.env.APPDATA` quand personne n'a appelé
 * `configureAutowinAppDataBase`. En production c'est `index.ts:486` qui le fait, avec la base
 * PORTABLE — décision du 2026-08-07 (« l'app écrit dans SON dossier, plus dans %APPDATA% », car
 * supprimer le dossier du projet laissait 1,8 Go derrière lui). Le script, lui, tourne sous `tsx`,
 * hors Electron : personne ne configurait sa base, donc il visait l'ancien emplacement.
 *
 * Un secret écrit au mauvais endroit ne se voit pas : le fichier existe, il est frais, il est juste
 * inutile. D'où ces gardes sur le CÂBLAGE, pas seulement sur l'intention.
 */
describe('codex:login — écrit là où l’app lit', () => {
  const script = (): string =>
    readFileSync(join(__dirname, '..', '..', 'scripts', 'codex-login.mjs'), 'utf8')

  it('la base portable d’un dépôt non packagé est bien `.autowin-data`', () => {
    expect(portableAppDataBase('C:/depot', 'C:/exe', false)).toBe(join('C:/depot', '.autowin-data'))
  })

  it('le script CONFIGURE la base avant d’enregistrer les jetons', () => {
    const source = script()
    expect(source).toContain('configureAutowinAppDataBase')
    expect(source).toContain('portableAppDataBase')
    const configuration = source.indexOf('configureAutowinAppDataBase(')
    const enregistrement = source.indexOf('saveTokens(')
    expect(configuration).toBeGreaterThan(-1)
    expect(configuration).toBeLessThan(enregistrement)
  })

  it('il affiche le chemin réellement utilisé, pour qu’une erreur de store se VOIE', () => {
    expect(script()).toContain('defaultAuthPath()')
  })
})
