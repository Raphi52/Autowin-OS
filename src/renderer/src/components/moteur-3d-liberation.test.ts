import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { libererMoteur3d } from './moteur-3d-liberation'

/**
 * LA MÉMOIRE GRAPHIQUE D'UN MOTEUR 3D FERMÉ. `dispose()` de three.js vide ses caches mais garde le
 * contexte WebGL : son tampon d'image (plein écran, anticrénelé pour le décor) reste dans le
 * processus GPU jusqu'au passage du ramasse-miettes. Ce qui doit faire échouer ce fichier : une
 * libération qui oublie la perte forcée du contexte, qui la fait AVANT `dispose()` (three.js
 * écoute encore l'événement et journalise « Context Lost »), ou un nouveau moteur 3D de
 * l'interface qui ne passe pas par `libererMoteur3d`.
 */

describe('libererMoteur3d', () => {
  it('vide le moteur PUIS lui fait lâcher son contexte graphique', () => {
    const appels: string[] = []
    libererMoteur3d({
      dispose: () => appels.push('dispose'),
      forceContextLoss: () => appels.push('forceContextLoss')
    })
    expect(appels).toEqual(['dispose', 'forceContextLoss'])
  })

  it('accepte un moteur absent (scène jamais montée)', () => {
    expect(() => libererMoteur3d(undefined)).not.toThrow()
  })
})

describe('chaque moteur 3D de l’interface', () => {
  it('passe par libererMoteur3d', () => {
    const racine = join(__dirname, '..')
    const sources: string[] = []
    const parcourir = (dossier: string): void => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name)
        if (entree.isDirectory()) parcourir(chemin)
        else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name))
          sources.push(chemin)
      }
    }
    parcourir(racine)
    const moteurs = sources.filter((chemin) =>
      /new\s+(THREE\.)?WebGLRenderer\s*\(/.test(readFileSync(chemin, 'utf8'))
    )
    // Les deux moteurs connus doivent être trouvés : un filtre qui ne trouve plus rien passerait
    // en vert sans rien contrôler.
    expect(moteurs.length).toBeGreaterThanOrEqual(2)
    const oublis = moteurs.filter(
      (chemin) => !readFileSync(chemin, 'utf8').includes('libererMoteur3d(')
    )
    expect(oublis).toEqual([])
  })
})
