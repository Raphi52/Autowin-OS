import { ipcMain } from 'electron'
import type { AppEvent } from '../commands/commands'
import { assertTrustedRendererSender } from './ipc-senders'
import { materializeChatArtifact } from '../store/chat-artifact-store'
import type { ContexteIpcChat } from '../index'

/**
 * LES CANAUX DES INSTANCES DE TEST ISOLÉES : capture de la page, aperçus d’artefacts, émission
 * d’événements, compteur de lectures. Chacun refuse de servir hors instance isolée.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : fixtures des instances de test isolées. */
export function registerFixturesDeTestIpc(ctx: ContexteIpcChat): void {
  const { broadcast, isolatedTestInstance, os } = ctx
  ipcMain.handle('app:test:capture-page', async (event) => {
    assertTrustedRendererSender(event, 'Capture UI de test')
    if (!isolatedTestInstance)
      throw new Error('Capture UI de test indisponible hors instance isolée')
    return (await event.sender.capturePage()).toPNG().toString('base64')
  })
  ipcMain.handle('app:test:seed-artifact-previews', (event, htmlOnly = false) => {
    assertTrustedRendererSender(event, 'Fixture artifact previews')
    if (!isolatedTestInstance) throw new Error('Fixture indisponible hors instance isolée')
    const conversation = os.conversations.create({
      title: htmlOnly ? 'HTML rendu · fixture' : 'Galerie · artefacts modèles',
      provider: 'codex'
    })
    const previewTurnId = `artifact-preview-${Date.now()}`
    os.conversations.beginTurn(
      conversation.id,
      { content: 'Génère des livrables visuels pour la galerie de validation.' },
      {
        turnId: previewTurnId,
        runtime: { provider: 'codex', model: 'gpt-artifact-fixture' }
      }
    )
    os.conversations.applyTurnEvent(conversation.id, previewTurnId, {
      kind: 'delta',
      streamId: 'html-render-fixture',
      text: `Voici la même réponse, mais pensée comme une surface plutôt qu'un mur de texte.

\`\`\`html-render
<!-- <head> hostile : la CSP doit rester active malgré ce faux tag -->
<!doctype html>
<html lang="fr">
<head>
  <meta http-equiv="refresh" content="0;url=http://127.0.0.1:9262/autowin-html-render-meta-refresh-canary">
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 22px; color: #f7f9fb; background: radial-gradient(circle at 12% 0%, #163f38, #080d12 50%); }
    .eyebrow { color: #6ee7c0; font: 700 11px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; }
    h1 { max-width: 620px; margin: 10px 0 18px; font-size: clamp(25px, 5vw, 43px); line-height: 1.03; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .card { min-width: 0; padding: 14px; border: 1px solid #ffffff18; border-radius: 13px; background: #ffffff0a; }
    .card strong { display: block; margin-bottom: 6px; color: #8ef0d2; font-size: 20px; }
    .card span { color: #a9b4c0; font-size: 12px; line-height: 1.45; }
    .security { display: flex; flex-wrap: wrap; gap: 7px; margin: 18px 0; }
    .pill { padding: 6px 9px; border: 1px solid #52d6ab55; border-radius: 999px; color: #9debd3; background: #13352c; font-size: 11px; }
    details { padding: 10px 12px; border: 1px solid #52d6ab55; border-radius: 10px; color: #b7c1cc; background: #0c1717; font-size: 12px; }
    summary { color: #75e8c5; font-weight: 800; cursor: pointer; }
    details p { margin: 10px 0 2px; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } body { padding: 16px; } }
  </style>
</head>
<body>
  <img src="http://127.0.0.1:9262/autowin-html-render-network-canary.png" alt="" hidden>
  <div class="eyebrow">Autowin · réponse vivante</div>
  <h1>Comprendre en un regard, explorer si besoin.</h1>
  <div class="grid">
    <div class="card"><strong>01</strong><span>Le texte normal reste simple et rapide.</span></div>
    <div class="card"><strong>02</strong><span>Le HTML compose cartes, rythme et hiérarchie.</span></div>
    <div class="card"><strong>03</strong><span>Les interactions restent enfermées ici.</span></div>
  </div>
  <div class="security">
    <span class="pill">DOM parent isolé</span><span class="pill">API Autowin absente</span><span class="pill">Réseau coupé</span>
  </div>
  <details id="native-interaction"><summary>Explorer le détail</summary><p>Interaction HTML native, toujours sans accès à Autowin.</p></details>
  <a id="network-navigation-canary" href="http://127.0.0.1:9262/autowin-html-render-link-canary">Lien réseau canari</a>
  <script>document.documentElement.dataset.forbiddenScript = 'executed';</script>
</body>
</html>
\`\`\`

Et le meme fil porte un DIAGRAMME, rendu par mermaid :

\`\`\`mermaid
flowchart LR
  A[Message] --> B{Fence fermee ?}
  B -- oui --> C[Diagramme rendu]
  B -- non --> D[Bloc de code]
\`\`\`

Un diagramme TRES HAUT doit rester sous le plafond de hauteur du fil (300 px) :

\`\`\`mermaid
flowchart TD
  H1[Etape 1] --> H2[Etape 2] --> H3[Etape 3] --> H4[Etape 4] --> H5[Etape 5]
  H5 --> H6[Etape 6] --> H7[Etape 7] --> H8[Etape 8] --> H9[Etape 9] --> H10[Etape 10]
  H10 --> H11[Etape 11] --> H12[Etape 12] --> H13[Etape 13] --> H14[Etape 14] --> H15[Etape 15]
\`\`\`

Un diagramme dont la syntaxe est fausse doit retomber sur sa source, sans casser le fil :

\`\`\`mermaid
flowchart LR
  A --> ((((  cette ligne n'est pas du mermaid
\`\`\`

Le fil reprend ensuite normalement.`
    })
    const fixtureArtifacts = [
      {
        id: 'fixture-image',
        name: 'architecture.svg',
        mimeType: 'image/svg+xml',
        kind: 'vector' as const,
        encoding: 'base64' as const,
        content: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="280"><defs><linearGradient id="g"><stop stop-color="#f2c94c"/><stop offset="1" stop-color="#5a83ff"/></linearGradient></defs><rect width="900" height="280" rx="28" fill="#0c0e14"/><circle cx="150" cy="140" r="72" fill="url(#g)"/><rect x="330" y="66" width="220" height="148" rx="22" fill="#171b25" stroke="#f2c94c"/><rect x="680" y="86" width="150" height="108" rx="18" fill="#171b25" stroke="#5a83ff"/><path d="M222 140h108m220 0h130" stroke="#d9dce6" stroke-width="5"/><text x="440" y="145" fill="white" font-family="sans-serif" font-size="25" text-anchor="middle">AUTOWIN OS</text></svg>'
        ).toString('base64'),
        size: 0,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      },
      {
        id: 'fixture-markdown',
        name: 'RUN.md',
        mimeType: 'text/markdown',
        kind: 'markdown' as const,
        encoding: 'utf8' as const,
        content:
          '## Livraison vérifiée\n\n- **Claude.exe** et **Codex** partagent le même contrat\n- Les fichiers restent liés au tour qui les a produits\n\n> Aperçu Markdown rendu dans le chat.',
        size: 180,
        createdAt: Date.now(),
        source: { provider: 'claude', model: 'opus-fixture' }
      },
      {
        id: 'fixture-diagram',
        name: 'pipeline.mmd',
        mimeType: 'text/x-mermaid',
        kind: 'diagram' as const,
        encoding: 'utf8' as const,
        content:
          'flowchart LR\n  A[Modèle] --> B[Artefact]\n  B --> C[Stockage durable]\n  C --> D[Aperçu sécurisé]',
        size: 96,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      },
      {
        id: 'fixture-table',
        name: 'mesures.csv',
        mimeType: 'text/csv',
        kind: 'table' as const,
        encoding: 'utf8' as const,
        content: 'provider,artefacts,statut\nClaude,12,visible\nCodex,15,visible',
        size: 64,
        createdAt: Date.now(),
        source: { provider: 'claude', model: 'opus-fixture' }
      },
      {
        id: 'fixture-model3d',
        name: 'triangle.obj',
        mimeType: 'model/obj',
        kind: 'model3d' as const,
        encoding: 'utf8' as const,
        content: 'o Triangle\nv -1 -0.8 0\nv 1 -0.8 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1',
        size: 76,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      }
    ]
    if (!htmlOnly) {
      for (const artifact of fixtureArtifacts) {
        const stored = materializeChatArtifact(artifact, conversation.id, previewTurnId)
        os.conversations.applyTurnEvent(conversation.id, previewTurnId, {
          kind: 'artifact',
          artifact: stored
        })
      }
    }
    os.conversations.applyTurnEvent(conversation.id, previewTurnId, { kind: 'done' })
    return { conversationId: conversation.id, turnId: previewTurnId }
  })
  ipcMain.handle('app:test:emit-event', (event, payload: unknown) => {
    assertTrustedRendererSender(event, 'Fixture UI')
    if (!isolatedTestInstance) throw new Error('Émission de test indisponible hors instance isolée')
    if (!payload || typeof payload !== 'object') throw new Error('Événement de test invalide')
    const appEvent = payload as Record<string, unknown>
    if (
      ![
        'orchestrate-start',
        'orchestrate-phase',
        'orchestrate-delta',
        'orchestrate-step',
        'orchestrate-end',
        'refresh'
      ].includes(String(appEvent.type))
    ) {
      throw new Error('Type d’événement de test interdit')
    }
    if (
      appEvent.type === 'refresh' &&
      appEvent.scope !== 'conversations' &&
      appEvent.scope !== 'chat'
    )
      throw new Error('Scope de refresh de test interdit')
    broadcast(appEvent as unknown as AppEvent)
    return true
  })
  ipcMain.handle('app:test:conversation-read-count', (event, reset?: unknown) => {
    assertTrustedRendererSender(event, 'Compteur conversation de test')
    if (!isolatedTestInstance) throw new Error('Compteur de test indisponible hors instance isolée')
    const count = ctx.isolatedConversationReadCount
    if (reset === true) ctx.isolatedConversationReadCount = 0
    return count
  })
}
