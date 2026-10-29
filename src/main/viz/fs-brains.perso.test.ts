import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brainReglageFile } from '../brain-reglage'
import { estRacineBrainPerso } from '../brain-perso-racine'
import {
  SHARED_BRAIN_ROOT,
  brainPersoGraphRefs,
  loadBrainGraphAsync,
  racinesBrainVue,
  readNodeFile,
  searchVaultBrainNotesAsync
} from './fs-brains'

/**
 * LE BRAIN PERSO DANS LA VUE KNOWLEDGE (conv-1233, 2026-10-28, demande utilisateur : « affiche le
 * Brain perso dans la vue Knowledge, à côté du Brain d'équipe, avec ses notes marquées perso »).
 *
 * La vue lit le graphe par un processus à part, borné aux racines autorisées. Le Brain perso réglé
 * doit s'y ajouter — et rien d'autre : un dossier quelconque reste refusé.
 */
const dossiers: string[] = []
const temp = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}

let perso: string

/** Pose le réglage du Brain perso dans un APPDATA d'essai, lu par `racineBrainPerso()`. */
const reglerBrainPerso = (chemin: string | undefined): void => {
  const appdata = temp('fs-brains-perso-appdata-')
  vi.stubEnv('APPDATA', appdata)
  const fichier = brainReglageFile({ APPDATA: appdata }, 'perso')
  if (!fichier) throw new Error('chemin du réglage introuvable')
  mkdirSync(dirname(fichier), { recursive: true })
  if (chemin) writeFileSync(fichier, JSON.stringify({ chemin }), 'utf8')
}

const ecrireNote = (racine: string, relatif: string, titre: string, corps: string): string => {
  const fichier = join(racine, relatif)
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(
    fichier,
    `---\ntitle: ${titre}\ntype: domain\ntags: [theme/velo]\n---\n\n# ${titre}\n\n${corps}\n`,
    'utf8'
  )
  return fichier
}

beforeEach(() => {
  perso = temp('fs-brains-perso-')
  ecrireNote(
    perso,
    'knowledge/domain/velo-du-dimanche.md',
    'Vélo du dimanche',
    'Gonfler les pneus à 6,5 bars devant et 7 bars derrière.'
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('vue Knowledge — Brain perso à côté du Brain d’équipe', () => {
  it('sans Brain perso réglé : la vue ne connaît que le Brain d’équipe', () => {
    reglerBrainPerso(undefined)
    expect(racinesBrainVue()).toEqual([SHARED_BRAIN_ROOT])
    expect(brainPersoGraphRefs()).toEqual([])
  })

  it('avec un Brain perso réglé : il s’ajoute à la liste, marqué perso', () => {
    reglerBrainPerso(perso)
    expect(racinesBrainVue()).toEqual([SHARED_BRAIN_ROOT, perso])
    expect(brainPersoGraphRefs(undefined, false)).toEqual([
      {
        id: 'brain-perso',
        label: 'Brain perso',
        path: perso,
        sizeMb: 0,
        kind: 'vault',
        perso: true,
        themes: []
      }
    ])
  })

  it('un Brain perso réglé mais dont le dossier n’existe pas encore n’apparaît pas', () => {
    reglerBrainPerso(join(perso, 'pas-encore-cree'))
    expect(brainPersoGraphRefs()).toEqual([])
  })

  it('la vue lit le graphe, cherche et ouvre une note du Brain perso', async () => {
    reglerBrainPerso(perso)
    const graphe = await loadBrainGraphAsync(perso, 300)
    expect(graphe.nodes.map((n) => n.label)).toContain('Vélo du dimanche')

    const trouves = await searchVaultBrainNotesAsync(perso, 'pneus dimanche')
    expect(trouves.map((r) => r.label)).toEqual(['Vélo du dimanche'])

    const note = readNodeFile(join(perso, 'knowledge/domain/velo-du-dimanche.md'), perso)
    expect(note.content).toContain('6,5 bars')
  })

  it('un autre dossier reste refusé, même avec un Brain perso réglé', async () => {
    reglerBrainPerso(perso)
    const etranger = temp('fs-brains-etranger-')
    ecrireNote(etranger, 'knowledge/domain/secret.md', 'Secret', 'pneus dimanche')
    await expect(searchVaultBrainNotesAsync(etranger, 'pneus dimanche')).rejects.toThrow(
      'hors périmètre'
    )
    await expect(loadBrainGraphAsync(etranger, 300)).rejects.toThrow('hors périmètre')
  })

  it('une racine imposée par l’appelant reste la seule autorisée', async () => {
    reglerBrainPerso(perso)
    const autre = temp('fs-brains-autre-')
    await expect(
      searchVaultBrainNotesAsync(perso, 'pneus dimanche', { allowedRoot: autre })
    ).rejects.toThrow('hors périmètre')
  })

  it('reconnaît la racine perso quelle que soit l’écriture du chemin', () => {
    reglerBrainPerso(perso)
    expect(estRacineBrainPerso(perso)).toBe(true)
    expect(estRacineBrainPerso(`${perso.replace(/\\/g, '/').toUpperCase()}/`)).toBe(true)
    expect(estRacineBrainPerso(SHARED_BRAIN_ROOT)).toBe(false)
    expect(estRacineBrainPerso('')).toBe(false)
  })
})
