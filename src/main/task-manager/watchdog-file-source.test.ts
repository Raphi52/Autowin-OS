import { mkdtemp, rm, writeFile, appendFile, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { beginAtEnd, compileMatcher, readNewLines } from './watchdog-file-source'
import { isSafeWatchdogRegex } from '../../shared/watchdog-regex'

/**
 * Sur de VRAIS fichiers : la valeur de cette piece est justement son comportement face au systeme de
 * fichiers (ajout, troncature, absence). Un faux `fs` prouverait surtout que le faux fait ce que je
 * crois.
 */
describe('watchdog-file-source — ne lire que ce qui vient d arriver', () => {
  let directory: string
  let logPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'watchdog-src-'))
    logPath = join(directory, 'app.log')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('ne rejoue PAS l historique : le premier regard se pose a la fin', async () => {
    // Le DoD : un log existant plein d'erreurs passees ne doit reveiller personne au demarrage.
    await writeFile(logPath, 'ERROR ancienne 1\nERROR ancienne 2\nERROR ancienne 3\n')

    const state = await beginAtEnd(logPath)
    const reading = await readNewLines(logPath, state)

    expect(reading.lines).toEqual([])
  })

  it('rend les lignes AJOUTEES apres le premier regard', async () => {
    await writeFile(logPath, 'ancienne\n')
    const state = await beginAtEnd(logPath)

    await appendFile(logPath, 'ERROR nouvelle\n')
    const reading = await readNewLines(logPath, state)

    expect(reading.lines).toEqual(['ERROR nouvelle'])
  })

  it('normalise la derniere ligne CRLF sans conserver son retour chariot', async () => {
    await writeFile(logPath, '')
    const state = await beginAtEnd(logPath)

    await appendFile(logPath, 'ERROR Windows\r\n')
    const reading = await readNewLines(logPath, state)

    expect(reading.lines).toEqual(['ERROR Windows'])
  })

  it('ne rend pas DEUX FOIS la meme ligne — c est la garantie du redemarrage', async () => {
    await writeFile(logPath, '')
    let state = await beginAtEnd(logPath)

    await appendFile(logPath, 'ERROR une\n')
    const first = await readNewLines(logPath, state)
    state = first.state
    const second = await readNewLines(logPath, state)

    expect(first.lines).toEqual(['ERROR une'])
    expect(second.lines).toEqual([])
  })

  it('la position SURVIT a un redemarrage : reprise depuis l etat persiste', async () => {
    await writeFile(logPath, 'vieille\n')
    const initial = await beginAtEnd(logPath)
    await appendFile(logPath, 'ERROR vue\n')
    const { state: persisted } = await readNewLines(logPath, initial)

    // Simule le redemarrage : on repart de l'etat sauvegarde, pas d'un etat neuf.
    const afterRestart = await readNewLines(logPath, { ...persisted })
    expect(afterRestart.lines).toEqual([])

    await appendFile(logPath, 'ERROR apres redemarrage\n')
    expect((await readNewLines(logPath, persisted)).lines).toEqual(['ERROR apres redemarrage'])
  })

  it('ne consomme pas une ligne encore INCOMPLETE (ecriture en cours)', async () => {
    await writeFile(logPath, '')
    const state = await beginAtEnd(logPath)

    await appendFile(logPath, 'ERROR partie')
    const partial = await readNewLines(logPath, state)
    expect(partial.lines).toEqual([])

    await appendFile(logPath, ' complete\n')
    expect((await readNewLines(logPath, partial.state)).lines).toEqual(['ERROR partie complete'])
  })

  it('gere la TRONCATURE (rotation de log) sans lire des octets qui ont change de sens', async () => {
    await writeFile(logPath, 'ligne longue une\nligne longue deux\n')
    let state = await beginAtEnd(logPath)

    await truncate(logPath, 0)
    await appendFile(logPath, 'ERROR apres rotation\n')
    const reading = await readNewLines(logPath, state)
    state = reading.state

    expect(reading.lines).toEqual(['ERROR apres rotation'])
  })

  it('detecte une reecriture de taille identique au lieu de la prendre pour aucun append', async () => {
    await writeFile(logPath, '1234567\n')
    const state = await beginAtEnd(logPath)

    await writeFile(logPath, 'ERROR x\n')
    const reading = await readNewLines(logPath, state)

    expect(reading.lines).toEqual(['ERROR x'])
  })

  it('detecte une rotation qui regrossit au-dela de l ancienne taille avant le poll', async () => {
    await writeFile(logPath, 'ancienne\n')
    const state = await beginAtEnd(logPath)

    await writeFile(logPath, 'ERROR rotation devenue plus longue\n')
    const reading = await readNewLines(logPath, state)

    expect(reading.lines).toEqual(['ERROR rotation devenue plus longue'])
  })

  it('SE PLAINT quand le fichier est absent, au lieu de mourir en silence', async () => {
    // L'angle mort nomme dans le cadrage : une regle muette laisse croire que tout va bien.
    const reading = await readNewLines(join(directory, 'jamais.log'), { position: 0, lastSize: 0 })

    expect(reading.error).toBeTruthy()
    expect(reading.lines).toEqual([])
  })

  it('borne la lecture d un fichier qui explose, au lieu de tout avaler', async () => {
    await writeFile(logPath, '')
    const state = await beginAtEnd(logPath)
    // 1,2 Mo d'un coup, au-dela du plafond de lecture de 1 Mo.
    await appendFile(logPath, `${'x'.repeat(1_200_000)}\nERROR la derniere\n`)

    const reading = await readNewLines(logPath, state)

    expect(reading.lines.at(-1)).toBe('ERROR la derniere')
    expect(reading.state.position).toBe(reading.state.lastSize)
  })
})

describe('compileMatcher — la condition de la regle', () => {
  it('refuse les quantificateurs imbriques connus pour bloquer le processus principal', () => {
    expect(isSafeWatchdogRegex('^(a+)+$')).toBe(false)
    const match = compileMatcher('^(a+)+$')
    expect(match(`${'a'.repeat(30)}!`)).toBe(false)
  })

  it('refuse aussi une repetition unique dont le long suffixe provoque du backtracking', () => {
    const pattern = `a*${'a'.repeat(490)}$`
    expect(isSafeWatchdogRegex(pattern)).toBe(false)
    const started = performance.now()
    expect(compileMatcher(pattern)(`${'a'.repeat(8191)}!`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('accepte une expression reguliere', () => {
    const match = compileMatcher('ERROR|FATAL')
    expect(match('un ERROR ici')).toBe(true)
    expect(match('tout va bien')).toBe(false)
  })

  it('ignore la casse par defaut, la respecte si demande', () => {
    expect(compileMatcher('error')('ERROR grave')).toBe(true)
    expect(compileMatcher('error', true)('ERROR grave')).toBe(false)
  })

  it("retombe sur une sous-chaine quand l'expression est invalide, au lieu de ne JAMAIS declencher", () => {
    // `[ERROR` ne compile pas. Ne rien declencher serait le pire des comportements : silencieux.
    const match = compileMatcher('[ERROR')
    expect(match('ligne [ERROR grave')).toBe(true)
    expect(match('ligne normale')).toBe(false)
  })
})
