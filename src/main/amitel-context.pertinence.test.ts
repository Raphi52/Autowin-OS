import { describe, expect, it } from 'vitest'
import { graphifyEvidence } from './amitel-context'

/**
 * DEFAUT VECU conv-1407 (2026-08-26), troisieme volet.
 *
 * A chaque tour, l orchestrateur recoit un bloc « CONNAISSANCE RECUPEREE ». Sur la demande « remake
 * les pastilles de couleurs », ce bloc contenait : `.all()` (roles.ts), `.constructor()`
 * (profile-store.ts), `.flashFrame()` (headless-instance.ts). Aucun rapport avec des pastilles.
 *
 * CAUSE : le score comptait les tokens presents en SOUS-CHAINE (`searchable.includes(token)`). Le
 * mot vide « les » — absent de la liste de stop-words — est une sous-chaine de « ro-LES-.ts ». Un
 * seul token suffisait a faire entrer un noeud.
 *
 * Le cout est double : la place occupee est celle qui manquait a l historique de la conversation
 * (le trou meme qui a fait fouiller le code), et un contexte de bruit apprend a l agent que ce bloc
 * ne sert a rien -- donc a l ignorer quand il sera enfin pertinent.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE FILTRE EST TROP DUR : une correspondance LEGITIME par
 * prefixe (« pastille » pour un noeud « pastilles ») doit continuer de passer. Resserrer jusqu a ne
 * plus rien trouver echangerait un bruit contre un silence.
 */

const graphe = JSON.stringify({
  nodes: [
    { id: 'n1', label: '.all()', source_file: 'src/main/roles.ts' },
    { id: 'n2', label: '.constructor()', source_file: 'src/main/profile-store.ts' },
    { id: 'n3', label: 'pastilleCouleur()', source_file: 'src/renderer/src/pastilles.ts' }
  ]
})

describe('la connaissance injectee doit etre PERTINENTE', () => {
  it('ne remonte pas roles.ts parce que « les » est une sous-chaine de « roles »', () => {
    const rendu = graphifyEvidence(graphe, 'remake les pastilles de couleurs')
    expect(rendu).not.toContain('roles.ts')
    expect(rendu).not.toContain('profile-store.ts')
  })

  it('remonte toujours ce qui correspond VRAIMENT, par prefixe', () => {
    const rendu = graphifyEvidence(graphe, 'remake les pastilles de couleurs')
    expect(rendu).toContain('pastilleCouleur()')
  })

  it('ne rend rien plutot que du bruit quand aucun noeud ne correspond', () => {
    expect(graphifyEvidence(graphe, 'kubernetes ingress')).toBe('')
  })
})
