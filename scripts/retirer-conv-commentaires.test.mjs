import { describe, expect, it } from 'vitest'
import { codeInchange, nettoyerCommentaire, nettoyerTexte } from './retirer-conv-commentaires.mjs'

/*
 * Cas tirés du code de src/ le 2026-11-06 : chaque renvoi retiré doit laisser une phrase lisible,
 * et rien hors des commentaires ne doit bouger.
 */
describe('nettoyerCommentaire', () => {
  const cas = [
    ['/** TITRE (conv-1582, lot 2 du plan de conv-1576). */', '/** TITRE (lot 2 du plan). */'],
    [' * Mesure sur conv-1369 : un run de 28 min', ' * Mesure : un run de 28 min'],
    [
      '/* Défaut vécu sur conv-1146 (run-ec2036c0932d-1) : 7 refus */',
      '/* Défaut vécu (run-ec2036c0932d-1) : 7 refus */'
    ],
    [
      "// Depuis conv-1148 (13/08), le refus n'existe plus",
      "// Depuis le 13/08, le refus n'existe plus"
    ],
    [
      "// Depuis conv-1171, le plan part dès que l'agent le dépose",
      "// Le plan part dès que l'agent le dépose"
    ],
    [
      '// conv-1441 : depuis conv-1418, chaque demande reçoit sa fiche',
      '// Chaque demande reçoit sa fiche'
    ],
    ['// un geste reel (kaizen conv-854).', '// un geste reel.'],
    ['/* ASCENSEUR (draft conv-1114, 2026-10-23). */', '/* ASCENSEUR (2026-10-23). */'],
    [
      '/* (`prompt.ts`, kaizen conv-526 puis conv-540) et a echoue */',
      '/* (`prompt.ts`) et a echoue */'
    ],
    ['// fix-ok: conv-258 — mesure sur x.jsonl', '// fix-ok: mesure sur x.jsonl'],
    ["// n'existe que dans conv-253 (saisie ts 17)", "// n'existe que dans un fil (saisie ts 17)"],
    [
      '// quand conv-891 a écrasé le travail de conv-889. Le fichier',
      '// quand un fil a écrasé le travail. Le fichier'
    ],
    [
      '//   CINQ du village (a1a91e43, conv-1429 a conv-1436) :',
      '//   CINQ du village (a1a91e43) :'
    ],
    [
      '/**\n * conv-12 (2026-10-12) : la bulle coule\n */',
      '/**\n * 2026-10-12 : la bulle coule\n */'
    ],
    [
      '// un onglet hors de la fenêtre\n//     (conv-5). LECTURE SEULE',
      '// un onglet hors de la fenêtre.\n//     LECTURE SEULE'
    ],
    [
      '// (rouge a 299, signale par\n//   conv-1544). UN canal',
      '// (rouge a 299, signale).\n//   UN canal'
    ],
    [
      '// vide (mesuré le 14/08,\n// conv-1164→1166). Le premier',
      '// vide (mesuré le 14/08).\n// Le premier'
    ],
    [
      " * revert? » — sur conv-198\n * et conv-191, l'agent a refait",
      " * revert? »\n * L'agent a refait"
    ],
    [' * Mesuré sur 43 tours de conv-879, 903, 904 et 906 : 32 %', ' * Mesuré sur 43 tours : 32 %'],
    [
      ' * Mesuré sur le corpus réel : conv-349 et conv-356 produisaient SEIZE cibles.',
      ' * Mesuré sur le corpus réel : des fils produisaient SEIZE cibles.'
    ],
    [
      ' * réel : conv-351, conv-357 et conv-1300 en portaient, et conv-1300 y voyait',
      ' * réel : des fils en portaient, et un fil y voyait'
    ],
    [
      ' * rien. Mesuré sur le store live : conv-1063,\n *    conv-1065 et conv-76 portaient ainsi',
      ' * rien. Mesuré sur le store live : des fils\n * portaient ainsi'
    ],
    [' * CONTRAT — la pièce qui manquait à conv-1302.', ' * CONTRAT — la pièce qui manquait.'],
    ['// fix-ok: conv-1241 tour 6e6212f1 — la file', '// fix-ok: tour 6e6212f1 — la file'],
    [
      '// le petit modèle a lu\n// conv-767 comme nette',
      '// le petit modèle a lu\n// un fil comme nette'
    ],
    ['// Fin du lot.\n// conv-12 a écrit la fiche', '// Fin du lot.\n// Un fil a écrit la fiche'],
    ['// conv-1234', ''],
    ['/**\n * conv-12\n */', ''],
    ['/**\n * Titre\n *\n * (conv-12)\n */', '/**\n * Titre\n *\n */']
  ]
  it.each(cas)('%j', (avant, apres) => {
    expect(nettoyerCommentaire(avant)).toBe(apres)
  })

  it('garde une mention CITÉE : code, guillemets, chemin, nom de fichier', () => {
    for (const c of [
      '// dans `/kaizen conv-61 …`. Sans elle',
      '// aucun `tool-call` dans conv-65.jsonl.',
      '// le dossier runs\\conv-1 contenait',
      '// la saisie « corrige conv-12 » est lue',
      '// le fichier scout-conv-339-sortie.md'
    ]) {
      expect(nettoyerCommentaire(c)).toBe(c)
    }
  })
})

describe('nettoyerTexte', () => {
  it('ne touche ni aux chaînes ni au code, et retire la ligne vidée', () => {
    const avant = [
      "const id = 'conv-12' // conv-99",
      '// conv-1234',
      'it("garde (conv-5)", () => {})',
      'const x = 1'
    ].join('\n')
    const { texte } = nettoyerTexte('a.ts', avant)
    expect(texte).toBe(
      ["const id = 'conv-12'", 'it("garde (conv-5)", () => {})', 'const x = 1'].join('\n')
    )
    expect(codeInchange('a.ts', avant, texte)).toBe(true)
  })

  it('ne prend pas un texte JSX pour un commentaire', () => {
    const avant = 'const A = () => <p>// conv-12 visible</p> /* (conv-3) */'
    const { texte } = nettoyerTexte('a.tsx', avant)
    expect(texte).toBe('const A = () => <p>// conv-12 visible</p>')
  })

  it('retire un commentaire JSX vidé avec ses accolades', () => {
    const avant = 'const A = () => (\n  <div>\n    {/* conv-12 */}\n    <b />\n  </div>\n)'
    const { texte } = nettoyerTexte('a.tsx', avant)
    expect(texte).toBe('const A = () => (\n  <div>\n    <b />\n  </div>\n)')
  })

  it('CSS : seuls les commentaires changent', () => {
    const avant = ".a { content: 'conv-1'; } /* LE BLOC (conv-7, 2026-10-10). */"
    const { texte } = nettoyerTexte('a.css', avant)
    expect(texte).toBe(".a { content: 'conv-1'; } /* LE BLOC (2026-10-10). */")
    expect(codeInchange('a.css', avant, texte)).toBe(true)
  })

  it('refuse un résultat dont le code change', () => {
    expect(codeInchange('a.ts', 'const a = 1', 'const a = 2')).toBe(false)
  })
})
