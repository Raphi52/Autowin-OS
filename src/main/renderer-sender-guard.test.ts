import { describe, expect, it } from 'vitest'
import { diagnostiquerExpediteurRenderer } from './behaviour-access'

/**
 * UN GARDE QUI REFUSE DOIT DIRE CE QU'IL A VU.
 *
 * Vécu le 2026-08-12 : deux appels IPC ont échoué sur « Origine renderer non autorisée pour
 * WorktreeDiscardHeld » en mode dev. Impossible de reproduire ensuite : le garde passe aussi bien
 * en `electron-vite dev` qu'en `--watch`, l'origine mesurée étant `http://localhost:5173` dans les
 * deux cas. Deux hypothèses ont été formulées puis RÉFUTÉES par la mesure (« mort en dev », « c'est
 * --watch »).
 *
 * Ce qui reste établi, lui, est dans le code : `event.senderFrame?.url ?? ''`. Une frame détachée
 * — ce qui arrive pendant un rechargement — donne une URL VIDE, et le garde annonce alors une
 * origine « non autorisée » alors qu'il n'a observé AUCUNE origine. Le message envoie chercher un
 * problème de sécurité là où il y a un problème de cycle de vie.
 *
 * On ne relâche rien : les deux cas restent refusés. On cesse seulement de les confondre, pour que
 * la prochaine occurrence soit diagnosticable au lieu d'être un mystère.
 */
const options = { devRendererUrl: 'http://localhost:5173', rendererHtmlPath: 'C:/app/index.html' }

describe('diagnostic de l’expéditeur renderer', () => {
  it('accepte l’origine de dev déclarée', () => {
    expect(diagnostiquerExpediteurRenderer('http://localhost:5173/', options)).toEqual({
      trusted: true
    })
  })

  it('distingue une frame indisponible d’une origine refusée', () => {
    expect(diagnostiquerExpediteurRenderer(undefined, options)).toEqual({
      trusted: false,
      cause: 'frame-indisponible'
    })
    expect(diagnostiquerExpediteurRenderer('', options)).toEqual({
      trusted: false,
      cause: 'frame-indisponible'
    })
  })

  it('refuse toujours une origine étrangère, et le dit comme telle', () => {
    expect(diagnostiquerExpediteurRenderer('http://evil.example/', options)).toEqual({
      trusted: false,
      cause: 'origine-refusee',
      origine: 'http://evil.example'
    })
  })

  it('refuse une URL illisible sans prétendre connaître son origine', () => {
    expect(diagnostiquerExpediteurRenderer('pas-une-url', options)).toMatchObject({
      trusted: false,
      cause: 'origine-refusee'
    })
  })

  it('accepte le fichier packagé attendu, hors mode dev', () => {
    const packagé = { rendererHtmlPath: 'C:/app/index.html' }
    const attendu = 'file:///C:/app/index.html'
    expect(diagnostiquerExpediteurRenderer(attendu, packagé)).toEqual({ trusted: true })
    expect(diagnostiquerExpediteurRenderer('file:///C:/ailleurs/index.html', packagé)).toMatchObject(
      { trusted: false, cause: 'origine-refusee' }
    )
  })
})
