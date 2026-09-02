import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { creerLecteurSource } from './source-process-principal.test-helpers'

/**
 * UN REFACTOR QUI TOURNE EN PARALLÈLE NE DOIT PAS FAIRE ROUGIR LES CONTRATS DE SOURCE.
 *
 * Mesuré le 2026-09-02 : run de 15 min sur `src/main`, 8 contrats rouges dans 2 fichiers alors
 * qu'aucun câblage n'était cassé. Un autre chantier sortait des canaux d'`index.ts` PENDANT la
 * suite (écriture à 17:02, fin du run à 17:04). Les contrats relisaient le disque à chaque appel :
 * ils jugeaient une source amputée, en cours de déménagement. Rejoués au calme : tous verts.
 *
 * Ces tests écrivent VRAIMENT sur le disque entre deux lectures — c'est le seul moyen de prouver
 * que le gel tient. Ils opèrent sur une arborescence jetable, jamais sur le dépôt.
 */
const jetables: string[] = []

afterEach(() => {
  // Le nettoyage vit ICI et pas en fin de test : une assertion rouge saute la dernière ligne du
  // corps du test et laisserait un dossier temporaire derrière elle à chaque échec.
  while (jetables.length > 0) rmSync(jetables.pop() as string, { recursive: true, force: true })
})

/** Une fausse racine `src/main` : `index.ts` plus le module du tour de chat. */
function racineJetable(): string {
  const racine = mkdtempSync(join(tmpdir(), 'source-instantane-'))
  jetables.push(racine)
  mkdirSync(join(racine, 'chat'))
  mkdirSync(join(racine, 'ipc'))
  writeFileSync(join(racine, 'index.ts'), 'const VERSION = 1\n', 'utf8')
  writeFileSync(join(racine, 'chat', 'run-pilot-chat.ts'), 'const TOUR = 1\n', 'utf8')
  writeFileSync(join(racine, 'ipc', 'git.ts'), 'const CANAL = 1\n', 'utf8')
  return racine
}

describe('lecteur de sources — un instantané, pas une relecture', () => {
  it('une RÉÉCRITURE pendant le run ne change pas ce que le lecteur rend', () => {
    const racine = racineJetable()
    const lecteur = creerLecteurSource(racine)
    const avant = lecteur.sourceProcessPrincipal()
    expect(avant).toContain('const VERSION = 1')

    writeFileSync(join(racine, 'index.ts'), 'const VERSION = 2\n', 'utf8')
    writeFileSync(join(racine, 'chat', 'run-pilot-chat.ts'), 'const TOUR = 2\n', 'utf8')

    expect(lecteur.sourceProcessPrincipal()).toBe(avant)
    expect(lecteur.zoneDuTourDeChat()).toContain('const TOUR = 1')
  })

  it('une SUPPRESSION en plein run ne fait pas exploser la lecture — cas du fichier déménagé', () => {
    const racine = racineJetable()
    const lecteur = creerLecteurSource(racine)
    const avant = lecteur.sourceProcessPrincipal()

    rmSync(join(racine, 'chat', 'run-pilot-chat.ts'))
    rmSync(join(racine, 'ipc', 'git.ts'))

    expect(lecteur.sourceProcessPrincipal()).toBe(avant)
    expect(lecteur.zoneDuTourDeChat()).toContain('const TOUR = 1')
  })

  it('un fichier APPARU en plein run n’entre pas dans l’instantané', () => {
    const racine = racineJetable()
    const lecteur = creerLecteurSource(racine)
    const avant = lecteur.sourceProcessPrincipal()

    writeFileSync(join(racine, 'ipc', 'brain.ts'), 'const NOUVEAU = 1\n', 'utf8')

    expect(lecteur.sourceProcessPrincipal()).toBe(avant)
    expect(lecteur.sourceProcessPrincipal()).not.toContain('const NOUVEAU')
  })

  it('le gel ne dure QUE le run : un lecteur NEUF voit le code réel', () => {
    const racine = racineJetable()
    creerLecteurSource(racine).sourceProcessPrincipal()

    writeFileSync(join(racine, 'index.ts'), 'const VERSION = 2\n', 'utf8')
    writeFileSync(join(racine, 'ipc', 'brain.ts'), 'const NOUVEAU = 1\n', 'utf8')

    const neuf = creerLecteurSource(racine).sourceProcessPrincipal()
    expect(neuf).toContain('const VERSION = 2')
    expect(neuf).toContain('const NOUVEAU = 1')
    expect(neuf).not.toContain('const VERSION = 1')
  })

  it('le repli sur `index.ts` marche encore quand le module du tour n’existe pas', () => {
    const racine = mkdtempSync(join(tmpdir(), 'source-instantane-'))
    jetables.push(racine)
    writeFileSync(
      join(racine, 'index.ts'),
      "const runPilotChat = 1\nZONE\nipcMain.handle('os:pilotChat', () => {})\n",
      'utf8'
    )
    const lecteur = creerLecteurSource(racine)
    expect(lecteur.zoneDuTourDeChat()).toContain('ZONE')
    expect(lecteur.zoneDuTourDeChat()).not.toContain("ipcMain.handle('os:pilotChat'")
  })
})
