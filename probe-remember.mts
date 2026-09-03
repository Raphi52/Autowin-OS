import { rememberFact } from './src/main/brain-remember'
import { brainServiceToken } from './src/main/brain-retrieval'
const res = await rememberFact(
  {
    title: 'Canal Brain : origine configuree et nonce emis par le serveur',
    fact: "Le client Autowin lisait et ecrivait sur 127.0.0.1:8765 en dur alors que l'origine configuree (AMITEL_BRAIN_ORIGIN) pointait 8766. Corrige le 2026-09-02 : les deux chemins passent par amitelBrainOrigin().",
    type: 'lesson',
    scope: 'autowin-os',
    source: 'git:src/main/brain-retrieval.ts@9a822f09',
    confidence: 'high',
    tags: ['brain', 'configuration']
  },
  { token: brainServiceToken(), authorAgent: 'autowin-os', model: 'sonnet', timeoutMs: 15000 }
)
console.log(JSON.stringify(res, null, 1))
