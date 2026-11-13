import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compterArchives,
  copierDonnees,
  empreinteResultats,
  enMo,
  formater,
  resumerRecherche,
  resumerReleves,
  trouverSource
} from './banc-memoire-conversations.mjs'

const dossiers = []
const neuf = () => {
  const d = mkdtempSync(join(tmpdir(), 'test-banc-memoire-'))
  dossiers.push(d)
  return d
}
afterEach(() => {
  while (dossiers.length) rmSync(dossiers.pop(), { recursive: true, force: true })
})

/**
 * Ce qui doit faire échouer ce fichier : une copie qui oublie le journal ou les archives (la
 * mesure serait faussée), une copie qui écrit chez l'original, un compte d'archives qui inclurait
 * les pierres tombales, un delta calculé dans le mauvais sens.
 */
describe('banc mémoire des conversations', () => {
  it('résume les relevés en Mo avec le coût du chargement', () => {
    const r = resumerReleves(
      { heapUsed: 5 * 1024 * 1024, rss: 50 * 1024 * 1024 },
      { heapUsed: 105 * 1024 * 1024, rss: 250 * 1024 * 1024 },
      { actifs: 3, archives: 7 }
    )
    expect(r).toEqual({
      avant: { heapUsedMo: 5, rssMo: 50 },
      apres: { heapUsedMo: 105, rssMo: 250 },
      deltaHeapMo: 100,
      deltaRssMo: 200,
      filsActifs: 3,
      filsArchives: 7
    })
    expect(enMo(1.55 * 1024 * 1024)).toBe(1.6)
    expect(formater(r)).toContain('Fils actifs : 3 · fils archivés (fichiers) : 7')
    expect(formater(r)).not.toContain('Recherche')
  })

  /**
   * L'empreinte prouve « mêmes résultats » entre deux versions du code : elle doit ignorer l'ordre
   * d'un filtre (recherche de la liste) mais pas celui d'un classement (recherche classée).
   */
  it("l'empreinte ignore l'ordre d'un filtre, pas celui d'un classement", () => {
    const a = [['conv-2', 'conv-1'], []]
    const b = [['conv-1', 'conv-2'], []]
    expect(empreinteResultats(a, { trier: true })).toBe(empreinteResultats(b, { trier: true }))
    expect(empreinteResultats(a, { trier: false })).not.toBe(
      empreinteResultats(b, { trier: false })
    )
    expect(empreinteResultats([['conv-1'], []], { trier: true })).not.toBe(
      empreinteResultats(b, { trier: true })
    )
  })

  it('résume une recherche par ses pires valeurs et l’affiche', () => {
    const lignes = [
      { terme: 'a', totalMs: 40.4, pauseMs: 9.6, ids: ['conv-1'] },
      { terme: 'b', totalMs: 120.6, pauseMs: 14.2, ids: [] }
    ]
    const litterale = resumerRecherche(lignes, { trier: true })
    expect(litterale).toMatchObject({ pauseMaxMs: 14, totalMaxMs: 121, trouves: [1, 0] })
    const r = resumerReleves(
      { heapUsed: 0, rss: 0 },
      { heapUsed: 0, rss: 0 },
      { actifs: 1, archives: 0 }
    )
    r.recherche = {
      litterale,
      classee: resumerRecherche(lignes, { trier: false }),
      premiereClassee: { totalMs: 812.3, pauseMs: 31.7 },
      coutIndexHeapMo: 42.5,
      coutIndexRssMo: -3
    }
    const texte = formater(r)
    expect(texte).toContain('Recherche de la liste : pause max 14 ms · durée max 121 ms')
    expect(texte).toContain(
      'Première classée (construit les index) : pause max 32 ms · durée 812 ms'
    )
    expect(texte).toContain('Coût des index de recherche : heapUsed +42.5 Mo · rss -3 Mo')
    expect(texte).toContain(`empreinte ${litterale.empreinte}`)
  })

  it('copie snapshot, journal et archives sans toucher à la source', () => {
    const source = neuf()
    mkdirSync(join(source, 'conversations.json.archive'))
    writeFileSync(join(source, 'conversations.json'), '[]')
    writeFileSync(join(source, 'conversations.json.journal.jsonl'), 'j\n')
    writeFileSync(join(source, 'conversations.json.archive', 'conv-1.json'), '{"a":1}')
    const destination = neuf()
    const cible = copierDonnees(source, destination)
    expect(cible).toBe(join(destination, 'conversations.json'))
    expect(readFileSync(`${cible}.journal.jsonl`, 'utf8')).toBe('j\n')
    expect(compterArchives(`${cible}.archive`)).toBe(1)
    expect(readdirSync(source).sort()).toEqual([
      'conversations.json',
      'conversations.json.archive',
      'conversations.json.journal.jsonl'
    ])
  })

  it('copie sans journal ni archives quand il n’y en a pas', () => {
    const source = neuf()
    writeFileSync(join(source, 'conversations.json'), '[]')
    const destination = neuf()
    copierDonnees(source, destination)
    expect(readdirSync(destination)).toEqual(['conversations.json'])
  })

  it('compte les archives et ignore les pierres tombales', () => {
    const d = neuf()
    writeFileSync(join(d, 'conv-1.json'), '{}')
    writeFileSync(join(d, 'conv-2.json'), '{}')
    writeFileSync(join(d, 'conv-3.supprime'), '')
    expect(compterArchives(d)).toBe(2)
    expect(compterArchives(join(d, 'absent'))).toBe(0)
  })

  it('--source l’emporte sur le dossier du dépôt', () => {
    const d = neuf()
    expect(trouverSource(['--source', d])).toBe(d)
  })
})

/**
 * Bout en bout : le vrai banc (compilation esbuild du vrai store, processus enfant --expose-gc) sur
 * une petite fixture. Casse si la compilation, le chargement du store, l'attente des archives ou
 * le comptage cessent de marcher — le cas du lot 3 qui changerait l'API sans mettre le banc à jour.
 */
describe('banc mémoire — de bout en bout', () => {
  const fil = (id, ts) => ({
    schemaVersion: 3,
    id,
    title: id,
    provider: 'claude',
    createdAt: ts,
    updatedAt: ts,
    messages: [{ messageId: `message-${id}-1`, role: 'user', content: id, ts }]
  })

  it('mesure une fixture et rend du JSON, sans toucher à la source', () => {
    const source = neuf()
    mkdirSync(join(source, 'conversations.json.archive'))
    writeFileSync(join(source, 'conversations.json'), JSON.stringify([fil('conv-1', Date.now())]))
    writeFileSync(
      join(source, 'conversations.json.archive', 'conv-2.json'),
      JSON.stringify(fil('conv-2', Date.now() - 30 * 24 * 3600 * 1000))
    )
    const avant = readdirSync(source).sort()
    const r = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./banc-memoire-conversations.mjs', import.meta.url)),
        '--source',
        source,
        '--json'
      ],
      { encoding: 'utf8', timeout: 120000 }
    )
    expect(r.status, r.stderr).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.filsActifs).toBe(1)
    expect(res.filsArchives).toBe(1)
    expect(res.avant.heapUsedMo).toBeGreaterThan(0)
    expect(res.apres.rssMo).toBeGreaterThan(0)
    expect(readdirSync(source).sort()).toEqual(avant)
  }, 130000)

  it('échoue proprement (code 1) quand les données sont introuvables', () => {
    const r = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./banc-memoire-conversations.mjs', import.meta.url)),
        '--source',
        neuf()
      ],
      { encoding: 'utf8' }
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Données introuvables')
  })
})
