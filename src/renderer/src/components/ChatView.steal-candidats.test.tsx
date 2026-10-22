// @vitest-environment happy-dom
/**
 * LE RAPPORT `steal` REND DES CANDIDATS, COMME `scout` (demande du 2026-10-22, conv-1083).
 *
 * Contrat entre deux fichiers qui ne se connaissent pas : l'en-tête que `skills/steal/SKILL.md`
 * impose au modèle, et le lecteur qui transforme un tableau en panneau à cocher
 * (`src/shared/scout-table.ts`). Si l'un change sans l'autre, ce test rougit au lieu de laisser
 * le rapport retomber en tableau mort.
 *
 * Il garde aussi le défaut trouvé en chemin : le panneau remplaçait le message ENTIER, donc le
 * rapport (paysage, matrice, pièces citées) disparaissait de l'écran dès qu'il portait ses candidats.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const SKILL_STEAL = readFileSync(join(process.cwd(), 'skills', 'steal', 'SKILL.md'), 'utf8')
const ENTETE_CANDIDATS = '| # | Score | Type | Quoi | Pourquoi | Comment |'

/** Un rapport au gabarit de la skill : les autres tableaux d'abord, les candidats ensuite. */
const RAPPORT_STEAL = [
  '## 4. Matrice',
  '| Capacité | Champion | Mécanisme | Preuve | Chez nous |',
  '|---|---|---|---|---|',
  '| Paralléliser sans conflit | Claude Code | verrou de fichier par tâche | 🟡 [P2] | ◐ [A2] |',
  '',
  '## 6. Le meilleur de chaque',
  ENTETE_CANDIDATS,
  '|---|---|---|---|---|---|',
  '| 1 | 82 | 🆕 nouveauté | Mode advisor sur les phases de production | coût ◐→✅ [P3] 🟡 | appels du build, effort petit |',
  '| 2 | 78 | 🆕 nouveauté | Réservation des fichiers entre fils | conflits vécus ◐→✅ [P2] 🟡 | registre lu par `src/main/commands.ts:4545`, effort moyen |',
  '',
  '## 7. Écartés',
  '- Barrière de l’OS sur les commandes : indisponible sous Windows natif.',
  '',
  'CIBLE: Réservation des fichiers entre fils — POURQUOI: la seule protection est une règle écrite'
].join('\n')

let h: Harness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await h?.unmount()
  h = null
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const promptsEnvoyes = (pilotChat: ReturnType<typeof vi.fn>): string =>
  pilotChat.mock.calls
    .flatMap((appel) =>
      Array.isArray(appel[0]) ? (appel[0] as { role: string; content?: string }[]) : []
    )
    .filter((message) => message.role === 'user')
    .map((message) => message.content ?? '')
    .join(String.fromCharCode(10))

describe('steal — le rapport rend des candidats à cocher, comme scout', () => {
  it('la skill impose l en-tête que le panneau sait lire', () => {
    expect(SKILL_STEAL).toContain(ENTETE_CANDIDATS)
  })

  it('le rapport reste lisible, la prise de CIBLE est cochée et part dans le travail complet', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const messages = [
      { role: 'user', content: '/steal workflows agentiques' },
      { role: 'assistant', done: true, parts: [{ kind: 'text', text: RAPPORT_STEAL }] }
    ]
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    const ecran = h.container

    // Le panneau : une case par prise.
    expect(ecran.querySelector('[data-testid="candidats-pick"]')).not.toBeNull()
    const lignes = [...ecran.querySelectorAll('[data-testid="cpick-ligne"]')]
    expect(lignes).toHaveLength(2)

    // Le rapport autour du tableau est toujours à l'écran, avant comme après.
    const texte = ecran.textContent ?? ''
    expect(texte).toContain('verrou de fichier par tâche')
    expect(texte).toContain('Barrière de l’OS sur les commandes')
    expect(texte).toContain('CIBLE: Réservation des fichiers entre fils')

    // `CIBLE:` coche la seule prise qu'elle nomme.
    const coches = lignes.map(
      (ligne) => (ligne.querySelector('input[type="checkbox"]') as HTMLInputElement).checked
    )
    expect(coches).toEqual([false, true])

    // Une prise est un ajout : elle se cadre avant de s'écrire, jamais en correction directe.
    for (const voie of ecran.querySelectorAll('[data-testid="cpick-voie-piste"]')) {
      expect(voie.getAttribute('aria-label')).toMatch(/^À cadrer/u)
    }

    await h.click('[data-testid="cpick-lancer"]')
    const envoye = promptsEnvoyes(pilotChat)
    expect(envoye).toContain('Réservation des fichiers entre fils')
    expect(envoye).not.toContain('Mode advisor sur les phases de production')
    expect(envoye).not.toContain('Correction DIRECTE')
  })
})
