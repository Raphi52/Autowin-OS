import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  preuveManquanteDuTour,
  relanceDePreuveManquante,
  type FaitsDePreuveDuTour
} from './chat-turn-messages'
import type { ExecutionEvidence } from '../providers/types'
import { libelleDuVerifySur } from '../commands/verify-command'

/**
 * LA GARDE DE PREUVE DE FIN DE TOUR. Elle lit des FAITS, jamais le texte de la réponse,
 * et ne bloque rien : elle dit seulement s'il faut une relance. Le dossier de ces essais est écrit
 * en deux formes parce que le tour parle Windows et que ses traces peuvent parler `/`.
 */
const DOSSIER = 'D:\\Projet'

const trace = (partielle: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  type: 'Bash',
  kind: 'inspection',
  status: 'completed',
  ok: true,
  summary: '',
  ...partielle
})

const ecriture = (path: string, partielle: Partial<ExecutionEvidence> = {}): ExecutionEvidence =>
  trace({ type: 'Edit', kind: 'mutation', path, paths: [path], ...partielle })

const test = (commande: string, codeDeSortie: number, at?: number): ExecutionEvidence =>
  trace({ kind: 'verification', testsLus: [{ commande, codeDeSortie, ...(at ? { at } : {}) }] })

const faits = (partiels: Partial<FaitsDePreuveDuTour>): FaitsDePreuveDuTour => ({
  dossier: DOSSIER,
  traces: [],
  verifications: [],
  orchestrationLancee: false,
  verifyRefuse: false,
  captureRegardee: false,
  tourEntierVu: true,
  ...partiels
})

const CODE = ecriture('D:\\Projet\\src\\a.ts')

describe('preuveManquanteDuTour — le tour a écrit du code sans preuve retenue', () => {
  it('cas (i) : du code écrit, aucun test joué', () => {
    expect(preuveManquanteDuTour(faits({ traces: [CODE] }))).toEqual({ cas: 'sans-preuve' })
  })

  it('cas (i) : un test au code illisible ne suffit pas, et il est nommé', () => {
    const illisible = trace({ testsNonComptes: ['npm test'] })
    expect(preuveManquanteDuTour(faits({ traces: [CODE, illisible] }))).toEqual({
      cas: 'sans-preuve',
      testNonCompte: 'npm test'
    })
  })

  it('cas (ii) : un test resté rouge, et il est nommé', () => {
    expect(
      preuveManquanteDuTour(faits({ traces: [CODE, test('npx vitest run a.test.ts', 1)] }))
    ).toEqual({ cas: 'rouge', commande: 'npx vitest run a.test.ts' })
  })

  it('cas (ii) : le rouge d’un `verify` compte comme celui du terminal', () => {
    expect(
      preuveManquanteDuTour(
        faits({ traces: [CODE], verifications: [{ commande: 'npm test', ok: false, at: 5 }] })
      )
    ).toEqual({ cas: 'rouge', commande: 'npm test' })
  })

  it('cas (ii) : un `verify` sur le fichier rouge, à son vrai libellé, fait taire la relance', () => {
    const rouge = trace({
      kind: 'verification',
      testsLus: [{ commande: 'npx vitest run src/a.test.ts', codeDeSortie: 1, at: 2 }]
    })
    expect(
      preuveManquanteDuTour(
        faits({
          traces: [CODE, rouge],
          verifications: [{ commande: 'npm run test:unit -- src/a.test.ts', ok: true, at: 5 }]
        })
      )
    ).toBeUndefined()
  })

  it('cas (ii) : un `verify` sur un autre fichier ne la fait pas taire', () => {
    const rouge = trace({
      kind: 'verification',
      testsLus: [{ commande: 'npx vitest run src/a.test.ts', codeDeSortie: 1, at: 2 }]
    })
    expect(
      preuveManquanteDuTour(
        faits({
          traces: [CODE, rouge],
          verifications: [{ commande: 'npm run test:unit -- src/b.test.ts', ok: true, at: 5 }]
        })
      )
    ).toEqual({ cas: 'rouge', commande: 'npx vitest run src/a.test.ts' })
  })

  it('cas (ii) : un vert lancé ailleurs ne couvre pas le rouge du dossier du tour', () => {
    // fix-ok: sans heure, ce vert se rangeait AVANT le rouge et ne pouvait rien couvrir, avec ou sans
    // son dossier : le test ne prouvait donc rien. Daté après le rouge, défaut remis : 2 tests rouges.
    const ailleurs = trace({
      kind: 'verification',
      testsLus: [
        { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd ../autre', at: 6 }
      ]
    })
    expect(
      preuveManquanteDuTour(
        faits({ traces: [CODE, test('npx vitest run src/a.test.ts', 1, 5), ailleurs] })
      )
    ).toEqual({ cas: 'rouge', commande: 'npx vitest run src/a.test.ts' })
  })

  it('cas (ii) : un rouge lancé ailleurs est nommé avec son dossier, donc rejouable tel quel', () => {
    const manque = preuveManquanteDuTour(
      faits({
        traces: [
          CODE,
          trace({
            kind: 'verification',
            testsLus: [
              { commande: 'npm test', codeDeSortie: 1, changementDeDossier: 'cd ../autre' }
            ]
          })
        ]
      })
    )
    expect(manque).toEqual({ cas: 'rouge', commande: 'cd ../autre && npm test' })
    expect(relanceDePreuveManquante(manque!, DOSSIER)).toContain('`cd ../autre && npm test`')
  })

  it('muette : un test seul après un `cd` reste une preuve retenue', () => {
    const jumeau = trace({
      kind: 'verification',
      testsLus: [{ commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd D:/Projet' }]
    })
    expect(preuveManquanteDuTour(faits({ traces: [CODE, jumeau] }))).toBeUndefined()
  })

  it('muette : une écriture de code suivie d’un vert', () => {
    expect(
      preuveManquanteDuTour(faits({ traces: [CODE, test('npx vitest run a.test.ts', 0)] }))
    ).toBeUndefined()
  })

  it('muette : un rouge couvert par un vert plus récent, la règle du Board', () => {
    expect(
      preuveManquanteDuTour(
        faits({
          traces: [CODE, test('npx vitest run a.test.ts', 1, 1), test('npx vitest run', 0, 2)]
        })
      )
    ).toBeUndefined()
  })

  it('jumeau : un vert antérieur au rouge ne couvre rien, même plus large', () => {
    expect(
      preuveManquanteDuTour(
        faits({
          traces: [CODE, test('npx vitest run', 0, 1), test('npx vitest run a.test.ts', 1, 2)]
        })
      )
    ).toEqual({ cas: 'rouge', commande: 'npx vitest run a.test.ts' })
  })

  it('l’ordre réel mêle `verify` et terminal : un vert du terminal rachète le rouge de verify', () => {
    expect(
      preuveManquanteDuTour(
        faits({
          traces: [CODE, test('npx vitest run', 0, 9)],
          verifications: [{ commande: 'npx vitest run a.test.ts', ok: false, at: 5 }]
        })
      )
    ).toBeUndefined()
  })

  it('muette : aucune écriture dans le tour, même avec un rouge', () => {
    expect(
      preuveManquanteDuTour(faits({ traces: [test('npx vitest run a.test.ts', 1)] }))
    ).toBeUndefined()
  })

  it('muette : aucune trace du tout', () => {
    expect(preuveManquanteDuTour(faits({}))).toBeUndefined()
  })

  it.each([
    ['une écriture ratée', ecriture('D:\\Projet\\src\\a.ts', { ok: false })],
    ['une écriture sans chemin', ecriture('', { paths: [] })],
    ['une note', ecriture('D:\\Projet\\docs\\note.md')],
    ['une feuille de style', ecriture('D:\\Projet\\src\\a.css')],
    ['un script jetable hors du dossier', ecriture('C:\\Users\\x\\AppData\\Local\\Temp\\a.ts')],
    ['un dossier voisin au nom proche', ecriture('D:\\Projet2\\src\\a.ts')],
    ['un chemin qui remonte', ecriture('..\\autre\\a.ts')],
    ['le dossier temporaire du fil', ecriture('D:\\Projet\\.autowin-tmp\\conv-1\\a.ts')],
    ['les données de l’app', ecriture('D:\\Projet\\.autowin-data\\a.ts')],
    [
      'un fichier écrit par Codex',
      trace({ type: 'file_change', kind: 'mutation', path: 'src/a.ts' })
    ],
    [
      'un outil d’écriture direct',
      trace({ type: 'edit_file', kind: 'mutation', path: 'src/a.ts' })
    ],
    ['une écriture par commande shell', trace({ kind: 'mutation', command: 'echo x > src/a.ts' })],
    [
      'le constat global du dossier',
      trace({ type: 'workspace_delta', kind: 'mutation', path: 'a.ts' })
    ]
  ])('muette : %s', (_cas, ecrit) => {
    expect(preuveManquanteDuTour(faits({ traces: [ecrit] }))).toBeUndefined()
  })

  it.each([
    ['chemin absolu', 'D:\\Projet\\src\\a.tsx'],
    ['barres obliques', 'D:/Projet/src/a.mts'],
    ['casse différente', 'd:\\PROJET\\SRC\\A.TS'],
    ['chemin relatif', 'src/a.py'],
    ['préfixe ./', './scripts/a.ps1']
  ])('jumeau accepté : %s', (_cas, chemin) => {
    expect(preuveManquanteDuTour(faits({ traces: [ecriture(chemin)] }))).toEqual({
      cas: 'sans-preuve'
    })
  })

  it('le dossier du tour vit lui-même sous .autowin-data : seul le chemin relatif compte', () => {
    const dossier = 'D:\\AutoWinOS\\.autowin-data\\worktrees\\copie'
    const ecrit = ecriture('D:\\AutoWinOS\\.autowin-data\\worktrees\\copie\\src\\a.ts')
    expect(preuveManquanteDuTour(faits({ dossier, traces: [ecrit] }))).toEqual({
      cas: 'sans-preuve'
    })
  })

  it('muette sans dossier de travail connu', () => {
    expect(preuveManquanteDuTour(faits({ dossier: '', traces: [CODE] }))).toBeUndefined()
  })

  it('muette : une orchestration lancée dans le tour', () => {
    expect(
      preuveManquanteDuTour(
        faits({ traces: [CODE, test('npm test', 1)], orchestrationLancee: true })
      )
    ).toBeUndefined()
  })

  it('muette : un `verify` refusé, rien n’a pu être vérifié', () => {
    expect(preuveManquanteDuTour(faits({ traces: [CODE], verifyRefuse: true }))).toBeUndefined()
  })

  it('une capture regardée tait le cas (i), pas le cas (ii)', () => {
    expect(preuveManquanteDuTour(faits({ traces: [CODE], captureRegardee: true }))).toBeUndefined()
    expect(
      preuveManquanteDuTour(faits({ traces: [CODE, test('npm test', 1)], captureRegardee: true }))
    ).toEqual({ cas: 'rouge', commande: 'npm test' })
  })

  it.each([
    ['ui-capture', 'node scripts/ui-capture.mjs --view chat'],
    ['aperçu html', 'node scripts/html-render-apercu.mjs a.html'],
    ['aperçu interactif', 'node scripts/html-interactif-apercu.mjs a.html'],
    ['scène 3D', 'node scripts/scene-3d-apercu.mjs a.glb']
  ])('une capture en ligne de commande tait le cas (i) : %s', (_cas, command) => {
    expect(preuveManquanteDuTour(faits({ traces: [CODE, trace({ command })] }))).toBeUndefined()
  })

  it('sans heure (trace relue après redémarrage) : l’ordre d’écriture décide', () => {
    const rouge = test('npx vitest run a.test.ts', 1)
    const vert = test('npx vitest run a.test.ts', 0)
    expect(preuveManquanteDuTour(faits({ traces: [CODE, rouge, vert] }))).toBeUndefined()
    expect(preuveManquanteDuTour(faits({ traces: [CODE, vert, rouge] }))).toEqual({
      cas: 'rouge',
      commande: 'npx vitest run a.test.ts'
    })
  })

  it('jumeau : une capture ratée n’a rien montré', () => {
    const ratee = trace({ ok: false, command: 'node scripts/ui-capture.mjs --view chat' })
    expect(preuveManquanteDuTour(faits({ traces: [CODE, ratee] }))).toEqual({ cas: 'sans-preuve' })
  })

  it('tour dont le début est perdu au redémarrage : pas de cas (i), le cas (ii) reste', () => {
    expect(preuveManquanteDuTour(faits({ traces: [CODE], tourEntierVu: false }))).toBeUndefined()
    expect(
      preuveManquanteDuTour(faits({ traces: [CODE, test('npm test', 1)], tourEntierVu: false }))
    ).toEqual({ cas: 'rouge', commande: 'npm test' })
  })

  it('une réponse qui se dit « Fait » ne change rien : le texte n’est pas une entrée', () => {
    // La garde ne reçoit pas le texte : ce test verrouille la signature.
    expect(Object.keys(faits({}))).not.toContain('reponse')
  })
})

describe('relanceDePreuveManquante — ce que lit l’agent', () => {
  /** Un vrai petit projet : la proposition de `verify` se décide sur le disque, comme `verify`. */
  const FICHIER_LONG = `src/${'a'.repeat(200)}/${'b'.repeat(120)}.test.ts`
  let projet = ''
  let sansScript = ''

  beforeAll(() => {
    projet = mkdtempSync(join(tmpdir(), 'relance-verify-'))
    writeFileSync(
      join(projet, 'package.json'),
      JSON.stringify({ scripts: { 'test:unit': 'vitest run' } }),
      'utf8'
    )
    const fichiers = [
      'a.test.ts',
      'src/a.test.ts',
      'src/b.spec.ts',
      'src/C.Test.ts',
      '.git/d.test.ts',
      'src/.git/e.test.ts',
      FICHIER_LONG
    ]
    for (const fichier of fichiers) {
      mkdirSync(dirname(join(projet, fichier)), { recursive: true })
      writeFileSync(join(projet, fichier), '// test', 'utf8')
    }
    sansScript = mkdtempSync(join(tmpdir(), 'relance-sans-script-'))
    mkdirSync(join(sansScript, 'src'), { recursive: true })
    writeFileSync(join(sansScript, 'src', 'a.test.ts'), '// test', 'utf8')
  })

  afterAll(() => {
    rmSync(projet, { recursive: true, force: true })
    rmSync(sansScript, { recursive: true, force: true })
  })

  it('nomme la commande rouge, propose verify, laisse une sortie honnête, redemande tout', () => {
    const texte = relanceDePreuveManquante(
      { cas: 'rouge', commande: 'npx vitest run a.test.ts' },
      projet
    )
    expect(texte).toContain('`npx vitest run a.test.ts`')
    expect(texte).toContain('`verify` avec ce fichier pour cible')
    // « une cible » tout court menait à une source : `vitest related`, que la règle ne sait pas lire.
    expect(texte).not.toContain('avec une cible')
    expect(texte).toContain('⚠️ Non résolu')
    expect(texte).toContain('non vérifié')
    expect(texte).toContain('REMPLACE')
  })

  /*
   * LA PROMESSE DE LA RELANCE, testée sur son vrai effet (contrôle final) : l'agent obéit,
   * `verify` passe au vert, et la relance a payé pour rien si le rouge reste. Proposer `verify`
   * équivaut donc à : le libellé que `verify` donnerait à ce fichier fait taire la garde.
   *
   * fix-ok: la relance décidait sur une copie des refus de `verify`, lue sur un chemin en minuscules.
   * Sonde contre le vrai contrôle : 3 écarts sur 28 formes, sous `.git` et sur `.Test.`, que `verify`
   * refuse ou joue en `vitest related`. L'oracle ci-dessous passe par le disque, comme `verify`.
   */
  it.each([
    ['src/a.test.ts', 'npx vitest run src/a.test.ts', true],
    ['./src/a.test.ts', 'npx vitest run ./src/a.test.ts', true],
    ['src\\a.test.ts', 'npx vitest run src\\a.test.ts', true],
    ['src/a.test.ts', 'npm run test:unit -- src/a.test.ts', true],
    ['src/b.spec.ts', 'npm test -- src/b.spec.ts', true],
    ['src/a.test.ts', 'cd sous && npx vitest run src/a.test.ts', false],
    ['src/a.test.ts', 'npx vitest run src/a.test.ts --changed', false],
    ['.git/d.test.ts', 'npx vitest run .git/d.test.ts', false],
    ['src/.git/e.test.ts', 'npx vitest run src/.git/e.test.ts', false],
    ['src/C.Test.ts', 'npx vitest run src/C.Test.ts', false],
    ['src/absent.test.ts', 'npx vitest run src/absent.test.ts', false],
    ['src//a.test.ts', 'npx vitest run src//a.test.ts', false],
    ['../autre/a.test.ts', 'npx vitest run ../autre/a.test.ts', false],
    ['src/../../a.test.ts', 'npx vitest run src/../../a.test.ts', false],
    ['src/a*.test.ts', 'npx vitest run src/a*.test.ts', false],
    ['/tmp/a.test.ts', 'npx vitest run /tmp/a.test.ts', false],
    ['D:/Projet/src/a.test.ts', 'npx vitest run D:/Projet/src/a.test.ts', false]
  ])(
    '`verify` sur %s après `%s` : proposé = %s, et ce vert lève le rouge ou non',
    (cible, commande, propose) => {
      const texte = relanceDePreuveManquante({ cas: 'rouge', commande }, projet)
      expect(texte.includes('`verify`')).toBe(propose)
      // Le rejeu tel quel reste proposé dans tous les cas : c'est lui qui lève un rouge illisible.
      expect(texte).toContain('Rejoue-le tel quel')

      const rouge = trace({
        kind: 'verification',
        testsLus: [{ commande, codeDeSortie: 1, at: 2 }]
      })
      const vert = libelleDuVerifySur(cible, projet)
      const leve = preuveManquanteDuTour(
        faits({
          traces: [CODE, rouge],
          verifications: vert ? [{ commande: vert, ok: true, at: 5 }] : []
        })
      )
      expect(leve === undefined).toBe(propose)
    }
  )

  it('`npm test` nu : aucun fichier à donner à `verify`', () => {
    const texte = relanceDePreuveManquante({ cas: 'rouge', commande: 'npm test' }, projet)
    expect(texte).not.toContain('`verify`')
  })

  it('`verify` n’est pas proposé dans un dossier sans script de test', () => {
    const commande = 'npx vitest run src/a.test.ts'
    expect(relanceDePreuveManquante({ cas: 'rouge', commande }, sansScript)).not.toContain(
      '`verify`'
    )
  })

  it('`verify` n’est pas proposé quand le dossier du tour est inconnu', () => {
    const commande = 'npx vitest run src/a.test.ts'
    expect(relanceDePreuveManquante({ cas: 'rouge', commande }, '')).not.toContain('`verify`')
  })

  it('une commande longue se juge entière, pas sur son extrait borné', () => {
    const commande = `npx vitest run ${FICHIER_LONG}`
    const texte = relanceDePreuveManquante({ cas: 'rouge', commande }, projet)
    expect(texte).toContain('`verify`')
    expect(texte).not.toContain('.test.ts`')
  })

  it('nomme le test au code illisible et dit comment le rendre lisible', () => {
    const texte = relanceDePreuveManquante(
      { cas: 'sans-preuve', testNonCompte: 'npm test' },
      projet
    )
    expect(texte).toContain('`npm test`')
    expect(texte).toContain('REMPLACE')
  })

  it('sans test nommé, le texte n’invente aucune commande', () => {
    const texte = relanceDePreuveManquante({ cas: 'sans-preuve' }, projet)
    expect(texte).toContain('verify')
    expect(texte).not.toContain('`undefined`')
  })

  it('une commande très longue reste bornée dans la relance', () => {
    const texte = relanceDePreuveManquante({ cas: 'rouge', commande: 'x'.repeat(4000) }, projet)
    expect(texte.length).toBeLessThan(1500)
  })
})
