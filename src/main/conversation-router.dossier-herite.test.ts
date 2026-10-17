import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ConversationRouteCoordinator } from './conversation-router'
import { ConversationStore } from './store/conversations'

/**
 * DEFAUT MESURE — conv-19 -> conv-23, 2026-09-27 13:10:21.853.
 *
 * conv-19 travaillait dans D:\Offre-Automatisation-IA. Le routeur a juge le message « new-topic »
 * et a cree conv-23 avec un titre et un fournisseur, RIEN d'autre : le premier tour (819 s, 3,26 $)
 * a tourne dans le dossier par defaut, D:\Autowin — le depot d'Autowin, outils d'ecriture compris —
 * avec le contexte d'Autowin au lieu de celui du projet. L'app ne l'a rattrape qu'APRES ce tour,
 * par un appel au modele et l'avis « 📂 Ta demande parle de… ».
 *
 * Un nouveau sujet ouvert DEPUIS un projet reste dans le dossier de ce projet tant que rien d'autre
 * n'est dit (un chemin cite dans le message garde sa bascule, `alignerDossierSurLaDemande`).
 */
const projet = mkdtempSync(join(tmpdir(), 'aos-routage-dossier-'))
afterAll(() => rmSync(projet, { recursive: true, force: true }))

const nouveauSujet = vi.fn().mockResolvedValue({
  route: 'new',
  confidence: 0.92,
  reason: 'new-topic',
  title: 'Démo qualification des demandes pour agences immobilières'
})

describe('fil neuf cree par le routeur', () => {
  it('reprend le dossier de travail du fil d origine', async () => {
    const store = new ConversationStore(() => 10)
    const source = store.create({ title: 'conv-19', provider: 'claude' })
    store.rangerDansDossier(source.id, projet)
    store.append(source.id, {
      role: 'user',
      content: 'Programmer un bilan automatique chaque soir'
    })

    const result = await new ConversationRouteCoordinator(store, {
      decide: nouveauSujet
    } as never).route(source.id, 'Crée une démo pour les agences immobilières sur le modèle…')

    expect(result.routed).toBe(true)
    expect(store.get(result.conversationId)?.projectPath).toBe(store.get(source.id)?.projectPath)
    expect(store.get(result.conversationId)?.projectPath).toBeTruthy()
  })

  it('un fil d origine sans dossier donne un fil neuf sans dossier, comme avant', async () => {
    const store = new ConversationStore(() => 10)
    const source = store.create({ title: 'libre', provider: 'claude' })
    store.append(source.id, { role: 'user', content: 'Parlons du graphe Git' })

    const result = await new ConversationRouteCoordinator(store, {
      decide: nouveauSujet
    } as never).route(source.id, 'Crée une démo pour les agences immobilières sur le modèle…')

    expect(store.get(result.conversationId)?.projectPath).toBeUndefined()
  })
})
