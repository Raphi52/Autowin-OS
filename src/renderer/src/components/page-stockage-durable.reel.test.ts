// @vitest-environment node
/*
 * CE QU'UNE PAGE SAUVEGARDE SURVIT VRAIMENT AU REDEMARRAGE (conv-1304, 2026-10-30). happy-dom n'a pas
 * d'IndexedDB, et un faux ne prouverait rien sur le point qui compte : le disque apres l'arret du
 * processus. Ce test fait donc tourner `page-stockage-durable.ts` dans l'Electron du depot, deux fois
 * de suite sur le meme profil, et lit le stockage dans le second processus.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = resolve(ICI, '../../../..')
const dossier = mkdtempSync(join(tmpdir(), 'page-stockage-'))
const electron = createRequire(import.meta.url)(join(RACINE, 'node_modules/electron')) as string

afterAll(() => rmSync(dossier, { recursive: true, force: true }))

const PROCESSUS = `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const [profil, page, code, sortie] = process.argv.slice(-4)
app.setPath('userData', profil)
const echouer = (erreur) => { process.stderr.write(String(erreur && erreur.stack || erreur)); app.exit(1) }
process.on('uncaughtException', echouer)
process.on('unhandledRejection', echouer)
app.whenReady().then(async () => {
  const fenetre = new BrowserWindow({ show: false })
  await fenetre.loadFile(page)
  await fenetre.webContents.executeJavaScript(readFileSync(code, 'utf8'))
  const resultat = await fenetre.webContents.executeJavaScript(process.env.SCRIPT)
  writeFileSync(sortie, JSON.stringify(resultat))
  app.exit(0)
})
`

async function jouer(script: string): Promise<unknown> {
  const code = join(dossier, 'module.js')
  await build({
    entryPoints: [join(ICI, 'page-stockage-durable.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'durable',
    outfile: code,
    logLevel: 'silent'
  })
  const page = join(dossier, 'page.html')
  const principal = join(dossier, 'principal.cjs')
  const sortie = join(dossier, 'sortie.json')
  writeFileSync(page, '<!doctype html><title>banc</title>')
  writeFileSync(principal, PROCESSUS)
  const env: NodeJS.ProcessEnv = { ...process.env, SCRIPT: script }
  delete env.ELECTRON_RUN_AS_NODE
  const resultat = spawnSync(electron, [principal, join(dossier, 'profil'), page, code, sortie], {
    encoding: 'utf8',
    env,
    timeout: 30_000
  })
  expect(resultat.status, resultat.stderr).toBe(0)
  const { readFileSync } = await import('node:fs')
  return JSON.parse(readFileSync(sortie, 'utf8'))
}

describe('sauvegardes des pages interactives, sur disque', () => {
  it('relit apres un vrai arret du processus, oublie une page videe, garde les autres', async () => {
    await jouer(`(async () => {
      await durable.ecrireStockageDurable('a', { n: '2' })
      await durable.ecrireStockageDurable('b', { x: '1' })
      await durable.ecrireStockageDurable('c', { y: '1' })
      await durable.ecrireStockageDurable('c', {})
      await new Promise((r) => setTimeout(r, 200))
      return true
    })()`)
    const relu = await jouer(`(async () => ({
      a: await durable.lireStockageDurable('a'),
      b: await durable.lireStockageDurable('b'),
      c: (await durable.lireStockageDurable('c')) ?? null
    }))()`)
    expect(relu).toEqual({ a: { n: '2' }, b: { x: '1' }, c: null })
  }, 60_000)

  it('oublie les pages les plus anciennes au-dela de la borne', async () => {
    const relu = await jouer(`(async () => {
      for (let i = 0; i <= durable.MAX_PAGES_DURABLES + 2; i += 1) {
        await durable.ecrireStockageDurable('p' + i, { i: String(i) })
        await new Promise((r) => setTimeout(r, 2))
      }
      await new Promise((r) => setTimeout(r, 200))
      return {
        ancienne: (await durable.lireStockageDurable('p0')) ?? null,
        recente: await durable.lireStockageDurable('p' + (durable.MAX_PAGES_DURABLES + 2))
      }
    })()`)
    expect(relu).toEqual({ ancienne: null, recente: { i: '202' } })
  }, 60_000)
})
