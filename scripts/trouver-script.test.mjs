import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  chercher,
  descriptionDuScript,
  estSonTest,
  executer,
  listerScripts,
  parFamille,
  usageDuScript
} from './trouver-script.mjs'

const DEPOT = fileURLToPath(new URL('..', import.meta.url))

describe('descriptionDuScript — la première ligne parlante de l en-tête', () => {
  it.each([
    [
      'a.mjs',
      '/**\n * CAPTURER une vue de l app.\n *\n * Détails.\n */\nconst x = 1\n',
      'CAPTURER une vue de l app.'
    ],
    [
      'a.mjs',
      "import { x } from 'y'\nimport {\n  a,\n  b\n} from 'z'\n\n// Lit les conversations sur le disque.\nx()\n",
      'Lit les conversations sur le disque.'
    ],
    [
      'a.mjs',
      '#!/usr/bin/env node\n/* fix-ok: marqueur de garde\n * Mesure le coût d un fil. */\n',
      'Mesure le coût d un fil.'
    ],
    [
      'a.ps1',
      '﻿# Ouvre un bureau caché Windows.\nparam([string]$Id)\n',
      'Ouvre un bureau caché Windows.'
    ],
    [
      'a.ps1',
      '<#\n.SYNOPSIS\n  Envoie un message Outlook neuf.\n#>\nparam()\n',
      'Envoie un message Outlook neuf.'
    ],
    [
      'a.py',
      '#!/usr/bin/env python\n# -*- coding: utf-8 -*-\n"""Fabrique un formulaire PDF à remplir."""\nimport os\n',
      'Fabrique un formulaire PDF à remplir.'
    ],
    [
      'a.py',
      'from pathlib import Path\n"""\nMesure les pixels allumés d une zone.\n"""\n',
      'Mesure les pixels allumés d une zone.'
    ],
    [
      'a.cs',
      'using System;\nusing System.Threading;\n// AGIR dans un bureau caché par messages.\npublic class A {}\n',
      'AGIR dans un bureau caché par messages.'
    ],
    [
      'a.vbs',
      "' Amorce sans console du dev Autowin.\nSet s = 1\n",
      'Amorce sans console du dev Autowin.'
    ]
  ])('%s : %j', (nom, texte, attendu) => {
    expect(descriptionDuScript(nom, texte)).toBe(attendu)
  })

  it('une phrase coupée en fin de ligne se prolonge, jusqu à sa fin ou à une liste, un usage', () => {
    expect(
      descriptionDuScript(
        'a.mjs',
        '/**\n * Prépare un brouillon qu Outlook ouvre, prêt à\n * envoyer.\n * Suite.\n */\n'
      )
    ).toBe('Prépare un brouillon qu Outlook ouvre, prêt à envoyer.')
    expect(
      descriptionDuScript(
        'a.mjs',
        '/**\n * Contrôle du paquet de l application :\n * - pas de données\n */\n'
      )
    ).toBe('Contrôle du paquet de l application :')
    expect(
      descriptionDuScript(
        'a.ps1',
        '# Ouvre un bureau caché Windows\n# Usage : powershell -File a.ps1\n'
      )
    ).toBe('Ouvre un bureau caché Windows')
  })

  it('un script qui commence par du code n a PAS de description, même s il en écrit une plus bas', () => {
    expect(
      descriptionDuScript('a.mjs', 'const port = 9223\n// Le port de debogage de l instance.\n')
    ).toBe('')
    expect(
      descriptionDuScript(
        'a.ps1',
        'param(\n  [string]$Root\n)\n# Contrôle du paquet de l application.\n'
      )
    ).toBe('')
  })

  it('une ligne trop courte ou un marqueur d outillage ne compte pas pour une description', () => {
    expect(
      descriptionDuScript(
        'a.mjs',
        '// eslint-disable-next-line no-console\n// @ts-check\n// Court.\nx()\n'
      )
    ).toBe('')
  })
})

describe('usageDuScript', () => {
  it('lit la commande sur la ligne Usage, ou sur la ligne qui la suit', () => {
    expect(
      usageDuScript('a.mjs', '/**\n * Fait X.\n * Usage : node scripts/a.mjs --json\n */\n')
    ).toBe('node scripts/a.mjs --json')
    expect(
      usageDuScript(
        'a.mjs',
        '/**\n * Fait X.\n * Usage, depuis le dépôt :\n *   node scripts/a.mjs <id>\n */\n'
      )
    ).toBe('node scripts/a.mjs <id>')
    expect(usageDuScript('a.mjs', '/**\n * Fait X.\n * Usage : rare, voir plus bas.\n */\n')).toBe(
      ''
    )
  })
})

describe('estSonTest', () => {
  it('reconnaît les tests à côté, y compris les tests par aspect', () => {
    expect(estSonTest('ui-capture', 'ui-capture.cadrage.test.mjs')).toBe(true)
    expect(estSonTest('hdesk-act', 'hdesk-act.sansclic.test.ps1')).toBe(true)
    expect(estSonTest('logo_anneau', 'logo_anneau_test.py')).toBe(true)
    expect(estSonTest('hdesk-act', 'hdesk-act-avertissements.ps1')).toBe(false)
    expect(estSonTest('ui-capture', 'ui-capture-clic-page.mjs')).toBe(false)
  })
})

describe('chercher — le plus proche d abord', () => {
  const s = (nom, description, entete = '') => ({
    chemin: `scripts/${nom}`,
    nom,
    description,
    entete,
    usage: '',
    teste: false
  })
  const catalogue = [
    s('ui-capture.mjs', 'Harnais de capture UI destiné aux phases BUILD/CLEAN.'),
    s('capture-zoom.ps1', 'AGRANDIR une zone d une capture (PNG) pour la lire de près.'),
    s('cout-du-fil.mjs', 'D où vient la dépense d UN fil, lue sur les données de l app.'),
    s(
      'hdesk-observe.ps1',
      'OBSERVER un bureau Windows isolé : rend une capture de tout le bureau.',
      'écran caché'
    )
  ]

  it('un mot du NOM passe devant le même mot dans la description', () => {
    expect(
      chercher(catalogue, 'capture')
        .map((r) => r.nom)
        .slice(0, 2)
    ).toEqual(['capture-zoom.ps1', 'ui-capture.mjs'])
  })

  it('le script qui répond à PLUS de mots passe devant', () => {
    expect(chercher(catalogue, 'zoom capture')[0].nom).toBe('capture-zoom.ps1')
  })

  it('les accents et les variantes ne cachent rien : « dépenses », « ecran », « capturer »', () => {
    expect(chercher(catalogue, 'depenses')[0].nom).toBe('cout-du-fil.mjs')
    expect(chercher(catalogue, 'Écran').map((r) => r.nom)).toEqual(['hdesk-observe.ps1'])
    expect(chercher(catalogue, 'capturer').length).toBe(3)
  })

  it('aucun mot utile : aucune réponse plutôt que tout le catalogue', () => {
    expect(chercher(catalogue, ' - ')).toEqual([])
    expect(chercher(catalogue, 'blender')).toEqual([])
  })
})

describe('parFamille', () => {
  it('range par préfixe, et regroupe les isolés dans « autres » en dernier', () => {
    const s = (nom) => ({ chemin: `scripts/${nom}`, nom })
    const familles = parFamille([
      s('hdesk-act.ps1'),
      s('hdesk-observe.ps1'),
      s('doctor.mjs'),
      s('cdp-port.mjs'),
      s('cdp-hooks.mjs')
    ])
    expect(familles.map(([f, m]) => `${f}:${m.length}`)).toEqual(['cdp:2', 'hdesk:2', 'autres:1'])
  })
})

describe('la commande, sur un dépôt fabriqué', () => {
  const depot = mkdtempSync(join(tmpdir(), 'trouver-script-'))
  afterAll(() => rmSync(depot, { recursive: true, force: true }))
  mkdirSync(join(depot, 'scripts'))
  mkdirSync(join(depot, 'skills', 'remake'), { recursive: true })
  writeFileSync(
    join(depot, 'scripts', 'cout-du-fil.mjs'),
    '// Mesure la dépense d un fil, par étape.\n// Usage : node scripts/cout-du-fil.mjs conv-1\n'
  )
  writeFileSync(join(depot, 'scripts', 'cout-du-fil.test.mjs'), '// test\n')
  writeFileSync(join(depot, 'scripts', 'muet.ps1'), 'param()\n')
  writeFileSync(
    join(depot, 'skills', 'remake', 'verifier-remake.ps1'),
    '# Vérifie un remake de bout en bout.\n'
  )

  it('liste scripts/ et les scripts des skills, sans les tests', () => {
    expect(listerScripts(depot).map((s) => s.chemin)).toEqual([
      'scripts/cout-du-fil.mjs',
      'scripts/muet.ps1',
      'skills/remake/verifier-remake.ps1'
    ])
  })

  it('une recherche rend le chemin, la description, l usage et le rappel de rangement', () => {
    const { code, sortie } = executer(['dépense', 'fil', '--depot', depot], DEPOT)
    expect(code).toBe(0)
    expect(sortie).toContain(
      'scripts/cout-du-fil.mjs · testé — Mesure la dépense d un fil, par étape.'
    )
    expect(sortie).toContain('    node scripts/cout-du-fil.mjs conv-1')
    expect(sortie).toContain('.autowin-tmp/<id du fil>/')
  })

  it('rien de proche : le dit, et dit où ranger un script neuf', () => {
    const { code, sortie } = executer(['blender', '--depot', depot], DEPOT)
    expect(code).toBe(0)
    expect(sortie).toMatch(/^Aucun script ne parle de « blender »/)
  })

  it('--sans-description nomme le script muet de scripts/ et sort en code 1', () => {
    expect(executer(['--sans-description', '--depot', depot], DEPOT)).toEqual({
      code: 1,
      sortie: "1 script(s) sans description en première ligne d'en-tête :\n  scripts/muet.ps1"
    })
  })

  it('refuse un --max qui n est pas un entier positif, et une option inconnue (code 2)', () => {
    expect(executer(['x', '--max', '0', '--depot', depot], DEPOT).code).toBe(2)
    expect(executer(['--inconnue'], DEPOT).code).toBe(2)
  })
})

/*
 * LA GARDE : chaque script de `scripts/` dit en première ligne d'en-tête ce qu'il fait. Sans elle, le
 * catalogue se viderait en silence : un script ajouté sans description reste introuvable par
 * `trouver-script.mjs`, et le prochain agent le réécrit. Le remède est dans le message.
 */
describe('garde — chaque script de scripts/ a sa description', () => {
  const scripts = listerScripts(DEPOT).filter((s) => s.chemin.startsWith('scripts/'))

  it('trouve bien des scripts à inspecter (pas d échantillon vide)', () => {
    expect(scripts.length).toBeGreaterThan(100)
  })

  it('aucun script sans description', () => {
    const sans = scripts.filter((s) => !s.description).map((s) => s.chemin)
    expect(
      sans,
      'Ajoute en tête de chacun (avant le code, après les import) un commentaire dont la première ligne dit ce ' +
        'qu il fait — c est elle que `node scripts/trouver-script.mjs <mots>` montre. Un script jetable, lui, ' +
        'n a rien à faire dans scripts/ : `.autowin-tmp/<id du fil>/`.'
    ).toEqual([])
  })
})
