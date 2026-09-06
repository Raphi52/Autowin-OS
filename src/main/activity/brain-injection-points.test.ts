import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { BRAIN_INJECTION_POINTS } from './brain-injection-points'

/**
 * INVARIANT D'EXHAUSTIVITÉ — l'Observatory affiche « toutes les injections et tous les appels au
 * Brain ». Cette promesse ne vaut que si un appel NON DÉCLARÉ casse quelque chose. Ce test relit les
 * sources : tout site qui parle au Brain doit exister dans le registre, et tout point qui prétend
 * émettre une trace doit contenir son émission. Sans lui, « exhaustif » ne serait qu'un mot.
 */
const RACINE = resolve(__dirname, '..', '..', '..')
const SRC = join(RACINE, 'src')
const IGNORES = new Set([
  'src/main/activity/brain-injection-points.ts',
  'src/main/activity/brain-injection-points.test.ts'
])

/** Motifs d'un APPEL réel au Brain (pas une déclaration, pas un import, pas un type). */
const MOTIFS: { nom: string; regex: RegExp }[] = [
  { nom: 'retrieveBrainContext(...)', regex: /(?<!function\s)\bretrieveBrainContext\s*\)?\s*\(/ },
  { nom: 'retrieveBrain(...)', regex: /\bretrieveBrain\s*\(/ },
  { nom: 'rememberFact(...)', regex: /(?<!function\s)\brememberFact\s*\(/ },
  { nom: 'HTTP Brain', regex: /\$\{origin\}\/(query-secure|query|ingest|challenge)/ },
  { nom: 'IPC os:searchBrain', regex: /['"]os:searchBrain['"]/ }
]

function fichiersSource(racine: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree)
    if (statSync(chemin).isDirectory()) {
      if (entree === 'node_modules' || entree === 'out' || entree === 'dist') continue
      out.push(...fichiersSource(chemin))
      continue
    }
    if (!/\.tsx?$/.test(entree)) continue
    if (/\.test\.tsx?$/.test(entree)) continue
    out.push(chemin)
  }
  return out
}

function estCommentaire(ligne: string): boolean {
  const t = ligne.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')
}

interface SiteScanne {
  file: string
  ligne: number
  texte: string
  motif: string
}

function scannerAppelsBrain(): SiteScanne[] {
  const trouves: SiteScanne[] = []
  for (const chemin of fichiersSource(SRC)) {
    const relatif = relative(RACINE, chemin).split(sep).join('/')
    if (IGNORES.has(relatif)) continue
    const lignes = readFileSync(chemin, 'utf8').split(/\r?\n/)
    lignes.forEach((texte, index) => {
      if (estCommentaire(texte)) return
      for (const motif of MOTIFS) {
        if (motif.regex.test(texte)) {
          trouves.push({ file: relatif, ligne: index + 1, texte: texte.trim(), motif: motif.nom })
          return
        }
      }
    })
  }
  return trouves
}

describe('registre des points d’appel Brain', () => {
  it('déclare des identifiants uniques', () => {
    const ids = BRAIN_INJECTION_POINTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('chaque site déclaré existe encore, à la lettre, dans le code', () => {
    const manquants: string[] = []
    for (const point of BRAIN_INJECTION_POINTS) {
      for (const site of point.sites) {
        const source = readFileSync(join(RACINE, site.file), 'utf8')
        if (!source.includes(site.anchor)) manquants.push(`${point.id} → ${site.file} :: ${site.anchor}`)
      }
    }
    expect(manquants, 'ancres de registre périmées (le code a bougé sans le registre)').toEqual([])
  })

  it('aucun appel Brain du code n’échappe au registre', () => {
    const nonDeclares = scannerAppelsBrain().filter(
      (site) =>
        !BRAIN_INJECTION_POINTS.some((point) =>
          point.sites.some((s) => s.file === site.file && site.texte.includes(s.anchor))
        )
    )
    expect(
      nonDeclares.map((s) => `${s.file}:${s.ligne} [${s.motif}] ${s.texte}`),
      'point d’appel Brain NON DÉCLARÉ : ajoute-le à BRAIN_INJECTION_POINTS et trace-le'
    ).toEqual([])
  })

  it('tout point annoncé tracé porte réellement son émission de trace', () => {
    const sansTrace: string[] = []
    for (const point of BRAIN_INJECTION_POINTS) {
      if (point.emission !== 'spool') continue
      if (!point.trace) {
        sansTrace.push(`${point.id} : emission=spool sans site de trace`)
        continue
      }
      const source = readFileSync(join(RACINE, point.trace.file), 'utf8')
      if (!source.includes(point.trace.anchor)) {
        sansTrace.push(`${point.id} → ${point.trace.file} :: ${point.trace.anchor}`)
      }
    }
    expect(sansTrace, 'point déclaré tracé mais dont la trace est absente du code').toEqual([])
  })

  /**
   * UN TROU SE DOCUMENTE OU N'EXISTE PAS.
   *
   * `emission: 'non-trace'` dit qu'un appel Brain REEL n'ecrit aucune trace. C'est une information,
   * pas une dispense : sans `manque`, ce serait exactement le silence que ce registre existe pour
   * empecher. L'assertion oblige donc a NOMMER ce qui manque, et interdit de poser un site de trace
   * sur un point qui declare ne pas en avoir.
   */
  it('tout trou declare dit ce qui manque, et ne pretend pas avoir de trace', () => {
    const mal: string[] = []
    for (const point of BRAIN_INJECTION_POINTS) {
      if (point.emission !== 'non-trace') continue
      if (!point.manque?.trim()) mal.push(`${point.id} : emission=non-trace sans manque`)
      if (point.trace) mal.push(`${point.id} : declare non-trace ET porte un site de trace`)
    }
    expect(mal, 'trou declare mal documente').toEqual([])
  })
})
