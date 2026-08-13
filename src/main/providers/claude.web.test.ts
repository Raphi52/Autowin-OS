import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE WEB EST UNE CAPACITÉ DE BASE, sur tous les chemins d'agent.
 *
 * Décision explicite de l'utilisateur (2026-08-13) : « je veux que les agents soient florissants,
 * expansifs, grandissants, libres ». Avant ce changement, AUCUNE branche de `claude.ts` ne chargeait
 * d'outil web — vérifié ligne par ligne. Un agent d'Autowin ne pouvait donc pas lire une page, même
 * en le demandant : il devinait au lieu d'aller voir, ce qui est précisément le défaut à supprimer.
 *
 * Ces tests existent pour une raison précise : chaque branche passe une liste EXPLICITE d'outils, et le
 * commentaire d'origine du fichier dit « le prompt système n'est qu'une consigne ; cette liste est la
 * capacité réelle ». Retirer `WebFetch` d'une seule branche suffirait donc à rendre ce chemin muet, sans
 * qu'aucun autre test ne s'en aperçoive. C'est ce silence-là qu'on interdit.
 */

const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')

/** Les branches d'outils du spawn, chacune avec son ancre dans le fichier. */
const BRANCHES: Array<{ nom: string; ancre: string; fin: string }> = [
  { nom: 'exécuteur', ancre: 'if (execution) {', fin: '} else if (materialized) {' },
  { nom: 'artefact matérialisé', ancre: '} else if (materialized) {', fin: 'TOUR DE CHAT' },
  {
    nom: 'fond autonome (watchdog)',
    ancre: "toolProfile === 'watchdog-read-only'",
    fin: '} else {'
  },
  { nom: 'tour de chat', ancre: 'CHAT_READ_ONLY_SHELL', fin: 'MEMOIRE AUTO' }
]

describe('capacité web', () => {
  it('la liste des outils web est définie UNE fois, pas recopiée par branche', () => {
    // Une constante partagée : sinon une branche garde `WebFetch` et une autre l'oublie, et la
    // divergence ne se voit pas — c'est exactement la forme du défaut trouvé aujourd'hui sur le chemin
    // du worker git (une valeur juste ici, absente là).
    expect(source).toContain("const OUTILS_WEB = 'WebFetch,WebSearch'")
  })

  it.each(BRANCHES)('la branche « $nom » charge les outils web', ({ ancre, fin }) => {
    const debut = source.indexOf(ancre)
    expect(debut).toBeGreaterThan(-1)
    const bloc = source.slice(debut, source.indexOf(fin, debut))
    // `--tools` charge, `--allowedTools` autorise : les deux sont nécessaires, la doc du CLI les
    // distingue. Un seul des deux laisserait l'outil déclaré mais refusé, ou l'inverse.
    expect(bloc).toMatch(/OUTILS_WEB|WebFetch/)
  })

  it('AUCUNE branche ne coupe tous les outils', () => {
    // `--disallowedTools '*'` était utilisé quand aucun workspace n'était résolu : l'agent se retrouvait
    // sans AUCUN moyen de fonder une réponse. Sans disque à lire, il garde au moins le web.
    expect(source).not.toContain("'--disallowedTools', '*'")
  })

  it('le web n’ouvre NI écriture NI shell là où ils étaient fermés', () => {
    // La capacité ajoutée est la lecture du monde extérieur, pas un élargissement des effets de bord.
    // Le tour de chat garde son shell borné (`CHAT_READ_ONLY_SHELL`) et n'obtient ni Write ni Edit.
    const debutChat = source.indexOf('TOUR DE CHAT')
    const blocChat = source.slice(debutChat, source.indexOf('MEMOIRE AUTO', debutChat))
    expect(blocChat).toContain('CHAT_READ_ONLY_SHELL')
    expect(blocChat).not.toMatch(/'Write'|'Edit'|'MultiEdit'/)
  })

  it('l’intention est TRACÉE dans le code, pour qu’on ne la « corrige » pas', () => {
    // Sans cette trace, un futur lecteur verrait une capacité large et la refermerait en croyant
    // réparer un oubli. La décision est celle de l'utilisateur ; elle doit se lire sur place.
    expect(source).toMatch(/CAPACITÉ DE BASE/)
    expect(source).toMatch(/2026-08-13/)
  })
})
