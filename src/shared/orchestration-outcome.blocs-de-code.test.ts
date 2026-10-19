import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * UN TEXTE N'EST ANALYSE QU'UNE FOIS POUR TROUVER SES BLOCS DE CODE (heal conv-1013, 2026-10-16).
 *
 * Mesure : `gels.jsonl` porte 15 rendus de la vue chat au-dela de 1 s (jusqu'a 5,5 s) du 14 au
 * 16/10, sous l'etiquette `vue-chat-fil`. Profil de l'ouverture d'un fil (vrai ChatView, 882
 * conversations, fils reels conv-981/1002/961/916) : ~20 % du rendu part dans `fromMarkdown`
 * appele par `markdownCodeLineProtection` (via `splitFinalSummary`, deux fois par texte : le rendu
 * Markdown ET `clotureEnDernier`) et `markdownCodeContinuationPrefixes` (via
 * `groupAssistantActivity`). Ces trois lecteurs ne tirent de l'arbre que les blocs `code`, et
 * chacun reanalysait le meme texte a chaque rendu : 348 analyses pour rouvrir quatre fils deja vus.
 *
 * Contrat : les blocs de code d'un texte se calculent UNE fois, puis se relisent ; le resultat de
 * chaque fonction reste exactement le meme.
 */
const analyses: string[] = []
let echouerSur: string | undefined
vi.mock('mdast-util-from-markdown', async (original) => {
  const vrai = (await original()) as { fromMarkdown: (source: string) => unknown }
  return {
    ...vrai,
    fromMarkdown: (source: string) => {
      analyses.push(source)
      if (source === echouerSur) throw new Error('illisible')
      return vrai.fromMarkdown(source)
    }
  }
})

const { markdownCodeContinuationPrefixes, markdownCodeLineProtection } =
  await import('./orchestration-outcome')
const { splitFinalSummary } = await import('../renderer/src/components/markdown-cloture')

let numero = 0
/** Un texte NEUF a chaque test : la memoire est partagee par le module. */
const texteAvecCode = (): string =>
  [
    `Rapport ${(numero += 1)}`,
    '```md',
    '✅ Fait',
    '📍 Maintenant',
    '⏳ Reste à faire',
    '👉 Recommandé',
    '```',
    '',
    '✅ Fait',
    '1. une action',
    '📍 Maintenant',
    'x',
    '⏳ Reste à faire',
    'y',
    '👉 Recommandé',
    'z'
  ].join('\n')

beforeEach(() => {
  analyses.length = 0
  echouerSur = undefined
})

describe('blocs de code Markdown — une analyse par texte', () => {
  it('le meme texte, lu par les trois lecteurs et a chaque rendu, n est analyse qu UNE fois', () => {
    const texte = texteAvecCode()
    for (let rendu = 0; rendu < 3; rendu += 1) {
      markdownCodeLineProtection([texte])
      markdownCodeContinuationPrefixes([texte])
      splitFinalSummary(texte)
    }
    expect(analyses).toHaveLength(1)
  })

  it('rend les memes lignes protegees et la meme cloture qu avant', () => {
    const texte = texteAvecCode()
    const lignes = (s: Set<number>): number[] => [...s].sort((a, b) => a - b)
    expect(lignes(markdownCodeLineProtection([texte])[0])).toEqual([2, 3, 4, 5, 6, 7])
    // relu depuis la memoire : identique
    expect(lignes(markdownCodeLineProtection([texte])[0])).toEqual([2, 3, 4, 5, 6, 7])
    // la cloture recopiee DANS le bloc de code n'est pas la cloture ; celle d'apres l'est
    const decoupe = splitFinalSummary(texte)
    expect(decoupe?.summary.split('\n')[1]).toBe('1. une action')
    expect(decoupe?.before).toContain('```md')
  })

  it('un decoupage different du meme source garde ses propres frontieres', () => {
    const debut = `Avant ${(numero += 1)}\n\`\`\`html-render\n<div>`
    const fin = '</div>\n```\nApres'
    expect(markdownCodeContinuationPrefixes([debut, fin])).toEqual([undefined, '```html'])
    const protege = markdownCodeLineProtection([debut, fin])
    expect([...protege[0]].sort()).toEqual([2, 3])
    expect([...protege[1]].sort()).toEqual([1, 2])
    // un seul source joint ⇒ une seule analyse pour les deux lecteurs
    expect(analyses).toHaveLength(1)
  })

  it('une analyse qui echoue reste fermee : tout est protege, et elle n est pas rejouee', () => {
    const texte = `illisible ${(numero += 1)}\nligne 2`
    echouerSur = texte
    expect([...markdownCodeLineProtection([texte])[0]]).toEqual([1, 2])
    expect([...markdownCodeLineProtection([texte])[0]]).toEqual([1, 2])
    expect(markdownCodeContinuationPrefixes([texte])).toEqual([undefined])
    expect(analyses).toHaveLength(1)
  })
})
