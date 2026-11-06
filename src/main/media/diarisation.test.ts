import { describe, expect, it } from 'vitest'
import {
  MEGAOCTETS_DIARISATION,
  etatDiarisation,
  installerDiarisation,
  jetonHuggingFace,
  type Lanceur
} from './diarisation'

/**
 * Un faux lanceur : il RÉPOND selon la commande demandée et NOTE ce qui a été lancé.
 * `importe` bascule pour simuler l'effet d'une installation réussie.
 */
function lanceur(options: {
  pythonPresent?: boolean
  importeAvant?: boolean
  importeApres?: boolean
  codePip?: number
  sortiePip?: string
}): { lancer: Lanceur; appels: string[][] } {
  const appels: string[][] = []
  let pipFait = false
  const lancer: Lanceur = async (commande, args) => {
    appels.push([commande, ...args])
    if (args[0] === '--version') {
      return options.pythonPresent === false ? { code: -1, sortie: '' } : { code: 0, sortie: 'Python 3.12' }
    }
    if (args.includes('pip')) {
      pipFait = true
      return { code: options.codePip ?? 0, sortie: options.sortiePip ?? '' }
    }
    const importe = pipFait ? (options.importeApres ?? true) : (options.importeAvant ?? false)
    return importe ? { code: 0, sortie: '' } : { code: 1, sortie: 'ModuleNotFoundError' }
  }
  return { lancer, appels }
}

describe('jeton Hugging Face', () => {
  it('accepte les DEUX noms courants : n en lire qu un afficherait « manquant » a tort', () => {
    expect(jetonHuggingFace({ HF_TOKEN: 'hf_a' })).toBe('hf_a')
    expect(jetonHuggingFace({ HUGGINGFACE_TOKEN: 'hf_b' })).toBe('hf_b')
    expect(jetonHuggingFace({ HUGGING_FACE_HUB_TOKEN: 'hf_c' })).toBe('hf_c')
  })

  it('une valeur VIDE ou blanche ne compte pas pour un jeton', () => {
    expect(jetonHuggingFace({ HF_TOKEN: '   ' })).toBeNull()
    expect(jetonHuggingFace({})).toBeNull()
  })
})

describe('etat de la separation des voix', () => {
  it('sans Python : rien n est installable, et l etat le DIT au lieu de rester muet', async () => {
    const { lancer } = lanceur({ pythonPresent: false })
    const etat = await etatDiarisation(lancer, 'python', {})
    expect(etat.pythonPresent).toBe(false)
    expect(etat.installe).toBe(false)
    expect(etat.erreur).toMatch(/Python/)
  })

  it('tranche sur l IMPORT, pas sur la presence d un dossier', async () => {
    const { lancer, appels } = lanceur({ importeAvant: true })
    const etat = await etatDiarisation(lancer, 'python', { HF_TOKEN: 'hf_x' })
    expect(etat.installe).toBe(true)
    expect(etat.jetonPresent).toBe(true)
    expect(etat.megaoctets).toBe(MEGAOCTETS_DIARISATION)
    expect(appels.some((a) => a.join(' ').includes('import pyannote.audio'))).toBe(true)
  })

  it('installe SANS jeton : la brique est la, mais l etat ne promet pas qu elle marchera', async () => {
    const { lancer } = lanceur({ importeAvant: true })
    const etat = await etatDiarisation(lancer, 'python', {})
    expect(etat.installe).toBe(true)
    expect(etat.jetonPresent).toBe(false)
  })
})

describe('installation de la separation des voix', () => {
  it('n installe PAS Python quand il manque : elle renonce et rend le motif', async () => {
    const { lancer, appels } = lanceur({ pythonPresent: false })
    const etat = await installerDiarisation(lancer, 'python', {})
    expect(etat.pythonPresent).toBe(false)
    expect(appels.some((a) => a.includes('pip'))).toBe(false)
  })

  it('ne retelecharge RIEN quand la brique repond deja', async () => {
    const { lancer, appels } = lanceur({ importeAvant: true })
    await installerDiarisation(lancer, 'python', {})
    expect(appels.some((a) => a.includes('pip'))).toBe(false)
  })

  it('pose le paquet puis RELIT l etat reel', async () => {
    const { lancer, appels } = lanceur({ importeAvant: false, importeApres: true })
    const etat = await installerDiarisation(lancer, 'python', {})
    expect(appels.some((a) => a.join(' ').includes('pyannote.audio'))).toBe(true)
    expect(etat.installe).toBe(true)
    expect(etat.erreur).toBeNull()
  })

  it('un pip qui rend 0 mais laisse un paquet NON importable reste un echec, avec sa sortie brute', async () => {
    const { lancer } = lanceur({
      importeAvant: false,
      importeApres: false,
      codePip: 0,
      sortiePip: 'ERROR: Could not find a version that satisfies torch'
    })
    const etat = await installerDiarisation(lancer, 'python', {})
    expect(etat.installe).toBe(false)
    expect(etat.erreur).toMatch(/torch/)
  })
})
