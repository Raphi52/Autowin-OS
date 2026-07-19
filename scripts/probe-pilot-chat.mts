/**
 * Probe live du CHAT TRANSPARENT (agent parle + pilote) — même chemin de code que l'app,
 * sans GUI : registry réel (claude CLI), bus réel, store réel. Vérifie :
 *  1. l'agent répond en conversationnel,
 *  2. une demande d'action → commande exécutée → état muté (conversation créée),
 *  3. la persistance (append au store, fil rechargeable).
 */
import { ProviderRegistry } from '../src/main/providers/registry'
import { ClaudeCliAdapter } from '../src/main/providers/claude'
import { RoleModelConfig } from '../src/main/roles'
import { ConversationStore } from '../src/main/store/conversations'
import { AppCommandBus } from '../src/main/commands'
import { AgentPilot } from '../src/main/agent-pilot'
import { AutowinOS } from '../src/main/os'

const registry = new ProviderRegistry()
registry.register(new ClaudeCliAdapter())
const os = new AutowinOS(registry)
const bus = new AppCommandBus(os, (e) => console.log('[broadcast]', JSON.stringify(e)))
const pilot = new AgentPilot(os.registry, os.roles, bus)

const before = os.conversations.list().length
console.log(`[probe] conversations avant: ${before}`)

const events: string[] = []
await pilot.chat(
  [
    {
      role: 'user',
      content:
        'Crée une conversation nommée "Probe persistance" en catégorie codex, puis dis-moi en une phrase ce que tu as fait.'
    }
  ],
  (e) => {
    events.push(e.kind)
    console.log(
      `[event] ${e.kind}${e.name ? ' ' + e.name : ''}${e.ok !== undefined ? ' ok=' + e.ok : ''}${
        e.text ? ' :: ' + e.text.slice(0, 140) : ''
      }`
    )
  }
)

const after = os.conversations.list()
console.log(`[probe] conversations après: ${after.length}`)
const created = after.find((c) => c.title.toLowerCase().includes('probe'))
console.log(
  `[probe] créée: ${created ? `${created.id} "${created.title}" cat=${created.category}` : 'NON'}`
)

// 3. persistance : append + relecture (le chemin que l'IPC os:pilotChat exécute)
if (created) {
  os.conversations.append(created.id, { role: 'user', content: 'message test' })
  os.conversations.append(created.id, { role: 'assistant', content: 'réponse test' })
  const reread = os.conversations.get(created.id)
  console.log(
    `[probe] fil persistant: ${reread?.messages.length === 2 ? 'OK (2 messages relus)' : 'ÉCHEC'}`
  )
}

const okConversational = events.includes('think') || events.includes('done')
const okAction = events.includes('command') && events.includes('result')
console.log(
  `[verdict] conversationnel=${okConversational} action=${okAction} mutation=${!!created}`
)
process.exit(okConversational && okAction && created ? 0 : 1)
