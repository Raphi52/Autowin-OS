import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  lireEtatInstance,
  orphelinsAarreter,
  prendreVerrou,
  reserverLancement
} from './avec-instance-headless.mjs'

/*
 * DEUX TRAVAUX LANCES AU MEME INSTANT NE DOIVENT PAS SE GENER.
 * Defaut constate le 2026-09-13 : sans --instance-id, tous les lancements prenaient
 * `preuve-headless` (meme bureau cache, meme profil, et le Stop prealable du second FERMAIT
 * l'application du premier), et deux lancements simultanes pouvaient voir le meme port libre.
 * Ce test lance DEUX VRAIS PROCESSUS en meme temps : un test dans un seul processus ne voit
 * ni les pid differents ni la course entre processus.
 */
const module = pathToFileURL(join(__dirname, 'avec-instance-headless.mjs')).href

function lancerTravail(racineInstances) {
  const code = `
    const m = await import(${JSON.stringify(module)})
    const { instanceId, portDemande } = m.decouperArguments(['--', 'node', 'x.mjs'])
    const r = m.reserverLancement({ racineInstances: ${JSON.stringify(racineInstances)}, instanceId, portDemande, occupes: new Set() })
    console.log(JSON.stringify({ instanceId, port: r.port, refus: r.refus }))
    setTimeout(() => {}, 1500)
  `
  return new Promise((resoudre, rejeter) => {
    const fils = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true })
    let sortie = ''
    fils.stdout.on('data', (d) => (sortie += d))
    fils.stderr.on('data', (d) => (sortie += d))
    fils.on('error', rejeter)
    fils.on('exit', () => {
      try {
        resoudre(JSON.parse(sortie.trim().split(/\r?\n/).pop()))
      } catch {
        rejeter(new Error(`sortie illisible : ${sortie}`))
      }
    })
  })
}

describe('travaux paralleles sur instance headless', () => {
  it('deux lancements simultanes sans option ont chacun leur instance et leur port', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-parallele-'))
    try {
      const [a, b] = await Promise.all([lancerTravail(racine), lancerTravail(racine)])
      expect(a.refus).toBeUndefined()
      expect(b.refus).toBeUndefined()
      expect(a.instanceId).not.toBe(b.instanceId)
      expect(a.port).not.toBe(b.port)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  }, 20000)

  it('refuse une instance du meme nom encore vivante au lieu de l arreter', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-verrou-'))
    try {
      const premier = reserverLancement({
        racineInstances: racine,
        instanceId: 'x',
        portDemande: 9500,
        occupes: new Set(),
        pid: 111,
        vivant: () => true
      })
      const second = reserverLancement({
        racineInstances: racine,
        instanceId: 'x',
        portDemande: 9500,
        occupes: new Set(),
        pid: 222,
        vivant: () => true
      })
      expect(premier.port).toBe(9500)
      expect(second.refus).toBe('instance-occupee')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('reprend le verrou d un lanceur mort', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-mort-'))
    try {
      const fichier = join(racine, 'v.lock')
      mkdirSync(racine, { recursive: true })
      writeFileSync(fichier, '999999')
      expect(prendreVerrou(fichier, 5, () => false)).toBe(true)
      expect(prendreVerrou(fichier, 6, () => true)).toBe(false)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('saute un port deja reserve par un autre lanceur vivant', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-port-'))
    try {
      const a = reserverLancement({
        racineInstances: racine,
        instanceId: 'a',
        portDemande: 9600,
        occupes: new Set(),
        pid: 1,
        vivant: () => true
      })
      const b = reserverLancement({
        racineInstances: racine,
        instanceId: 'b',
        portDemande: 9600,
        occupes: new Set(),
        pid: 2,
        vivant: () => true
      })
      expect([a.port, b.port]).toEqual([9600, 9601])
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  /*
   * LANCEUR TUE BRUTALEMENT : son application cachee restait vivante pour toujours (reproduit le
   * 2026-09-13 : lanceur arrete de force, app pid 8720 encore vivante, relance du meme nom en code 4).
   * Est orpheline une instance dont la trace lanceur.pid porte un lanceur MORT alors que l'app vit ; elle
   * s'arrete avec le port de SA fiche. Sans verrou (lancement direct par le .ps1), on n'y touche pas.
   */
  it('designe les applications orphelines d un lanceur mort, avec le port de leur fiche', () => {
    const fiches = [
      { instanceId: 'orpheline', fichier: 'o/instance.json', pid: 10, port: 9245 },
      { instanceId: 'lanceur-vivant', fichier: 'l/instance.json', pid: 11, port: 9246 },
      { instanceId: 'sans-verrou', fichier: 's/instance.json', pid: 12, port: 9247 },
      { instanceId: 'app-morte', fichier: 'm/instance.json', pid: 13, port: 9248 }
    ]
    const verrous = { orpheline: 900, 'lanceur-vivant': 901, 'app-morte': 902 }
    const vivants = new Set([10, 11, 12, 901])
    expect(
      orphelinsAarreter({
        fiches,
        lireLanceur: (id) => verrous[id],
        vivant: (pid) => vivants.has(pid)
      })
    ).toEqual([{ instanceId: 'orpheline', port: 9245 }])
  })

  /*
   * PowerShell 5 ecrit instance.json AVEC un BOM : JSON.parse echouait, le pid devenait NaN, et TOUTE
   * instance passait pour morte — orphelines jamais vues, et fiche d'une instance VIVANTE effacee par
   * le ramassage d'un travail parallele (constate le 2026-09-13 sur Audit/headless-instances/juge-port).
   */
  it('lit une fiche d instance ecrite avec un BOM', () => {
    expect(lireEtatInstance('﻿{ "pid": 8720, "port": 9245 }')).toEqual({ pid: 8720, port: 9245 })
    expect(lireEtatInstance('{ "pid": 1, "port": 2 }')).toEqual({ pid: 1, port: 2 })
  })
})

/*
 * PURGE DES DOSSIERS preuve-<pid> : chaque lancement sans identifiant laisse ~3 Mo de profil
 * (166 Mo cumules le 2026-09-13). On ne purge QUE ce qui est sur : nom preuve-<pid>, plus de 24 h,
 * lanceur (le pid du nom) ET application mortes, et AUCUNE capture — tout ce qui n'est pas le profil
 * (user-data, appdata) ni les fiches internes compte pour une capture et protege le dossier.
 */
describe('purge des dossiers d instance', () => {
  const H = 3600 * 1000
  const base = {
    ageMs: 25 * H,
    entrees: ['user-data', 'appdata', 'instance.json', 'lanceur.pid'],
    pidApp: 50
  }
  const vivant = (pid) => pid === 777 || pid === 51

  it('ne purge que les preuve-<pid> vieux, morts et sans capture', async () => {
    const { dossiersApurger } = await import('./avec-instance-headless.mjs')
    const dossiers = [
      { ...base, nom: 'preuve-100' },
      { ...base, nom: 'preuve-101', ageMs: 23 * H },
      { ...base, nom: 'preuve-777' },
      { ...base, nom: 'preuve-102', pidApp: 51 },
      { ...base, nom: 'preuve-103', entrees: [...base.entrees, 'proof'] },
      { ...base, nom: 'preuve-104', entrees: ['user-data', 'capture.png'] },
      { ...base, nom: 'preuve-headless' },
      { ...base, nom: 'chat-html' },
      { ...base, nom: 'preuve-105', pidApp: Number.NaN, entrees: ['user-data'] }
    ]
    expect(dossiersApurger({ dossiers, vivant })).toEqual(['preuve-100', 'preuve-105'])
  })

  it('efface reellement un dossier purgeable et garde les autres', async () => {
    const { purgerDossiersInstance } = await import('./avec-instance-headless.mjs')
    const { existsSync, utimesSync } = await import('node:fs')
    const racine = mkdtempSync(join(tmpdir(), 'aw-purge-'))
    try {
      const vieux = (Date.now() - 30 * H) / 1000
      for (const [nom, extra] of [
        ['preuve-100', null],
        ['preuve-103', 'proof'],
        ['preuve-777', null]
      ]) {
        mkdirSync(join(racine, nom, 'user-data'), { recursive: true })
        if (extra) mkdirSync(join(racine, nom, extra))
        utimesSync(join(racine, nom), vieux, vieux)
      }
      const purges = purgerDossiersInstance(racine, { vivant })
      expect(purges).toEqual(['preuve-100'])
      expect(existsSync(join(racine, 'preuve-100'))).toBe(false)
      expect(existsSync(join(racine, 'preuve-103'))).toBe(true)
      expect(existsSync(join(racine, 'preuve-777'))).toBe(true)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
