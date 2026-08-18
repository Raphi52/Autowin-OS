import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import {
  executionCostCoverageFields,
  formatExecutionCostCoverage,
  formatOrchestrationOutcome,
  isDeliveredOrchestrationOutcome,
  markdownCodeContinuationPrefixes,
  demoteUnvalidatedSuccessClaims,
  reconcileClosedOrchestrationText,
  reconcileClosedOrchestrationTextParts,
  runLabelFromPath
} from './orchestration-outcome'

describe('projection Markdown multi-fragments', () => {
  it('transporte la fence exacte vers chaque fragment qui reprend au milieu du code', () => {
    expect(
      markdownCodeContinuationPrefixes(['> ~~~~text', '> preuve', '> ~~~~\nClôture réelle.'])
    ).toEqual([undefined, '> ~~~~text', '> ~~~~text'])
  })

  it('n’invente aucun contexte pour du code indenté ou un fragment après la fermeture', () => {
    expect(
      markdownCodeContinuationPrefixes(['    preuve', '    suite', '', 'Clôture réelle.'])
    ).toEqual([undefined, undefined, undefined, undefined])
  })

  it('ne transporte jamais une fence html-render à travers une carte', () => {
    expect(
      markdownCodeContinuationPrefixes(['```html-render', '<section><b>LIVE</b></section>', '```'])
    ).toEqual([undefined, '```html', '```html'])
  })
})

/**
 * Le fil doit rapporter ce que l'orchestration a VRAIMENT produit.
 *
 * Défaut mesuré sur conv-76 (2026-07-29) : 18 appels de sous-agents, 10,05 $, et le fil disait
 * « Workflow Autowin exécuté. » — alors que statut, validité, blocage de gate, coût et chemin du RUN
 * étaient tous disponibles. Ces cas figent le contraire : jamais de succès prétendu, toujours les faits.
 */
describe('formatOrchestrationOutcome — jamais un faux succès', () => {
  it('rend visible le destin Brain de la leçon sans dépendre du texte du modèle', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      learning: { state: 'published', detail: 'preuve causale confirmée' }
    })
    expect(text).toContain('Brain : leçon prouvée publiée — preuve causale confirmée')
  })

  it('retire les consignes de clôture périmées du worker après une livraison réussie', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result:
        'Tests ciblés 11/11 verts.\n📍 Maintenant — RUN open, non commité.\n⏳ Reste à faire — lancer judge et publier.'
    })

    expect(text).toContain('Tests ciblés 11/11 verts.')
    expect(text).not.toContain('RUN open')
    expect(text).not.toContain('lancer judge')
    expect(text).not.toContain('non commité')
  })

  it.each([
    'Next: commit final puis livraison.',
    'Étape suivante : push et livraison.',
    '⏳ **Reste à faire** — publication (commit/push).',
    '👉 **Recommandé** — autoriser la publication de ces 2 fichiers.',
    '⏳ **Reste à faire** — Gate/publication (commit).',
    '👉 **Recommandé** — Faire passer l’état post-clean au `judge` avant commit.',
    '`clean` puis `judge` sur l’état livré.',
    'Enchaîner `clean` sur ces 3 fichiers, puis passer l’état post-clean à `judge`.',
    'Le RUN reste `open` — je lance le `judge` pour la clôture.',
    '**📍 Maintenant** — État BUILD-VERIFIED, RUN toujours `open`. Le `judge` a été refusé.',
    '**👉 Recommandé** — Relance-moi pour que je lance le `judge` sur ce RUN.'
  ])('retire la formulation persistée réelle après publication : %s', (staleLine) => {
    const text = reconcileClosedOrchestrationText(`Preuve utile.\n${staleLine}`, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false
    })

    expect(text).toBe('Preuve utile.')
  })

  it.each([
    'Ancienne trace : `RUN reste open.`.',
    'Historique : [RUN reste open](#ancien).',
    'Log observé : /lancer judge/.',
    'Aucune occurrence de RUN open.',
    'Sans mention de RUN reste open.',
    'Il n’y a plus de RUN reste open.'
  ])('préserve une preuve historique ou négative autonome : %s', (evidence) => {
    expect(
      reconcileClosedOrchestrationText(evidence, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(evidence)
  })

  it('retire le bloc de statut provisoire même quand son contenu ne nomme pas le judge', () => {
    const text = reconcileClosedOrchestrationText(
      'Preuve utile.\n\n## 📍 Maintenant\nLe correctif est en état d’être audité.\n\n## ⏳ Reste à faire\n\n## 👉 Recommandé',
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve utile.')
  })

  it('retire les blocs emoji sans titre Markdown observés dans les fils réels', () => {
    const text = reconcileClosedOrchestrationText(
      'Preuve utile.\n\n📍 **Maintenant**\nDeux tests rouges préexistants.\n\n⏳ **Reste à faire**\nDécider de leur sort.\n\n👉 **Recommandé**\nOuvrir un run séparé.',
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve utile.')
  })

  it('ne confond pas une preuve géolocalisée avec un statut de cycle de vie', () => {
    const report =
      'Preuve avant.\n\n## 📍 Capture : settings.png\nLa capture est lisible.\n\nPreuve après.'

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it('borne un bloc provisoire à son paragraphe et conserve la preuve suivante', () => {
    const text = reconcileClosedOrchestrationText(
      'Preuve avant.\n\n📍 Maintenant\nÉtat provisoire.\n\nPreuve après : checksum abc123.',
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve avant.\n\nPreuve après : checksum abc123.')
  })

  it('retire la continuation d’un marqueur inline mais conserve le paragraphe factuel suivant', () => {
    const text = reconcileClosedOrchestrationText(
      "📍 Maintenant — BUILD-VERIFIED\nLe correctif est en état d'être audité.\n\nPreuve factuelle : checksum abc123.",
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve factuelle : checksum abc123.')
  })

  it('conserve les preuves qui citent une ancienne formule de cycle de vie', () => {
    const report =
      "Test vert : absence de « RUN open » confirmée — PASS.\nPreuve : la regex /lancer judge/ ne matche plus — PASS.\nTest vert : expect(text).not.toContain('RUN open') — PASS.\nPreuve : `lancer judge` ne matche plus — PASS.\nTest vert : **RUN open** est absent — PASS.\nTest vert : [RUN open](#assertion) est absent — PASS."

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each([
    'Preuve : **RUN reste open**.',
    'Preuve : **publication non exécutée**.',
    'Preuve : *RUN toujours open*.',
    'Preuve : [RUN reste open](#etat-actuel).'
  ])("n'assimile pas automatiquement le gras ou un lien à une citation : %s", (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('')
  })

  it.each([
    'Test vert : RUN open absent — PASS.',
    'Test vert : absence de RUN open confirmée — PASS.',
    'Preuve : aucune occurrence de RUN open — PASS.',
    'Test vert : RUN open a disparu — PASS.',
    "Test vert : RUN open n'apparaît plus — PASS."
  ])('conserve une preuve dont le signal lifecycle est localement nié : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each([
    'Test vert : **RUN reste open** est faux — PASS.',
    "Test vert : [RUN reste open](#etat) n'est plus vrai — PASS.",
    'Test vert : publication non exécutée = false — PASS.',
    "Preuve : la commande `lancer judge` est observée dans l'ancien log — PASS."
  ])('conserve une négation ou référence lifecycle factuelle : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each([
    "Preuve : `lancer judge` figure dans l'ancien log — PASS.",
    "Preuve : le littéral `lancer judge` est observé dans l'ancien log — PASS.",
    'Preuve : le texte [RUN reste open](#ancien) est observé dans le test — PASS.',
    'Preuve : la regex /lancer judge/ est observée dans la trace historique — PASS.',
    'Preuve : zéro occurrence de RUN open — PASS.',
    "Preuve : il n'y a plus de RUN open — PASS.",
    'Preuve : RUN open = 0 occurrence — PASS.'
  ])('conserve une référence passée ou une quantité lifecycle nulle : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each([
    'Preuve : la commande `lancer judge` est présente dans le plan restant.',
    'Preuve : publication en attente.',
    'Résultat : changements pas encore publiés.',
    'Preuve : RUN encore ouvert.',
    'Preuve : judge à lancer.',
    'Preuve : Gate toujours bloqué.',
    'Preuve : Publication à faire.'
  ])('retire un statut lifecycle encore actif : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('')
  })

  it.each([
    'Preuve : publication est en attente.',
    'Preuve : RUN est encore ouvert.',
    'Preuve : Gate est toujours bloqué.',
    'Résultat : les changements ne sont pas encore publiés.',
    'Preuve : modifications non commitées.',
    'Preuve : modifications non publiées.',
    'Preuve : gate/publication non exécutées.'
  ])('retire les accords et copules lifecycle réellement émis : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('')
  })

  it('ne prend pas les apostrophes grammaticales pour des délimiteurs de citation', () => {
    expect(
      reconcileClosedOrchestrationText(
        "Preuve : l'état actuel du RUN reste open jusqu'à l'action suivante.",
        {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        }
      )
    ).toBe('')
  })

  it.each([
    ['- Tests 12/12 verts — RUN reste open.', '- Tests 12/12 verts'],
    ['1. Tests 12/12 verts — RUN reste open.', '1. Tests 12/12 verts'],
    ['> Tests 12/12 verts — RUN reste open.', '> Tests 12/12 verts'],
    ['✅ Tests 12/12 verts — RUN reste open.', '✅ Tests 12/12 verts'],
    [
      "- [x] Test vert : expect(text).not.toContain('RUN open') — PASS.",
      "- [x] Test vert : expect(text).not.toContain('RUN open') — PASS."
    ],
    [
      "⚠️ Test vert : expect(text).not.toContain('RUN open') — PASS.",
      "⚠️ Test vert : expect(text).not.toContain('RUN open') — PASS."
    ],
    [
      "🧪 Test vert : expect(text).not.toContain('RUN open') — PASS.",
      "🧪 Test vert : expect(text).not.toContain('RUN open') — PASS."
    ],
    ['- **Tests 12/12 verts** — RUN reste open.', '- **Tests 12/12 verts**'],
    ['| Tests 12/12 verts | RUN reste open |', '| Tests 12/12 verts |'],
    ['• Tests 12/12 verts — RUN reste open.', '• Tests 12/12 verts']
  ])('conserve la preuve préfixée et retire son suffixe lifecycle : %s', (report, expected) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(expected)
  })

  it.each([
    [
      '| P0 | Critique | **Le même graphe de travail est rejoué.** `inventaire`, `audit_conv93`, puis `synthese` repartent. | **Mesuré :** deux cycles complets plus un troisième entamé ; le RUN reste `open`. **Estimation :** au moins 40–50 % des appels étaient évitables. | Dédupliquer par `{cible, angle, empreinte des traces}`. |',
      ['même graphe de travail', 'deux cycles complets', '40–50 %', 'Dédupliquer par']
    ],
    [
      '| P1 | Majeure | **`conv-105` part en build sur une hypothèse non mesurée.** [RUN conv-105](</tmp/RUN.md>) | Mesuré : 4 sous-agents, 2,84 M tokens d’entrée, 452 s, RUN toujours ouvert. | Premier incrément borné : mesurer le chargement. |',
      ['hypothèse non mesurée', 'RUN conv-105', '4 sous-agents', 'Premier incrément']
    ],
    [
      '| P0 | Critique | **Nouvelle dérive après synthèse.** [Trace causale](</tmp/trace.jsonl:76>) | **Mesuré :** 9 lancements observés ; plusieurs audits sont rejoués. Impact futur croissant puisque le RUN reste ouvert. | Clore après la synthèse judge. |',
      ['Nouvelle dérive', 'Trace causale', '9 lancements', 'Clore après']
    ],
    [
      '| P0 | Critique | **Phase demandée ignorée.** La demande `judge` passe par `scout`, puis `frame`. | Neuf sous-agents ; mêmes cibles auditées deux fois. RUN toujours ouvert. | Rendre la phase explicite contraignante. |',
      ['Phase demandée ignorée', 'Neuf sous-agents', 'Rendre la phase']
    ],
    [
      '| P0 | Critique | **La phase `judge` demandée n’est pas respectée.** Le RUN reste `standard/open`. [RUN](</tmp/RUN.md:1>) | **Mesuré :** 14 lancements : 5 `scout`, 5 `frame`, 4 `terrain`. | Rendre une phase explicite contraignante. |',
      ['phase `judge`', 'RUN](', '14 lancements', 'Rendre une phase']
    ],
    [
      '| P2 | Moyenne | **Rapport coût/valeur non piloté.** Plusieurs rapports convergent. | **Mesuré :** deux synthèses terminées, RUN toujours `open`, troisième phase engagée. | Arrêter après la première synthèse. |',
      ['Rapport coût/valeur', 'deux synthèses', 'troisième phase', 'Arrêter après']
    ]
  ])('préserve les cellules factuelles d’une ligne de tableau réelle', (report, survivors) => {
    const reconciled = reconcileClosedOrchestrationText(report, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false
    })

    expect(reconciled).toMatch(/^\|.*\|$/u)
    survivors.forEach((fact) => expect(reconciled).toContain(fact))
    expect(reconciled).not.toMatch(/RUN\s+(?:reste|toujours)\s+(?:`?open`?|ouvert)/iu)
  })

  it('retire toutes les contradictions lifecycle d’une cellule sans perdre ses preuves', () => {
    const reconciled = reconcileClosedOrchestrationText(
      '| Preuve | 12 tests verts ; RUN reste open. Publication non exécutée. |',
      {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      }
    )

    expect(reconciled).toContain('12 tests verts')
    expect(reconciled).not.toMatch(/RUN reste open|Publication non exécutée/iu)
  })

  it('filtre aussi un suffixe lifecycle dans un titre de preuve Markdown', () => {
    expect(
      reconcileClosedOrchestrationText(
        '### Preuve : tests 12/12 verts — RUN reste open ; lancer judge.',
        {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        }
      )
    ).toBe('### Preuve : tests 12/12 verts')

    expect(
      reconcileClosedOrchestrationText('### Résultat — publication non exécutée.', {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('')
  })

  it.each([
    ['Preuve : publication non exécutée.', ''],
    ['Test vert : RUN toujours open.', ''],
    ['Preuve : le RUN reste open selon le contrôle.', ''],
    ['Preuve : tests 12/12 verts. RUN reste open — lancer judge.', 'Preuve : tests 12/12 verts.'],
    [
      'Preuve : tests 12/12 verts. **RUN reste open — lancer judge.**',
      'Preuve : tests 12/12 verts.'
    ],
    [
      'Preuve : tests 12/12 verts — [lancer judge](https://example.test/judge).',
      'Preuve : tests 12/12 verts'
    ],
    [
      "Test vert : absence d'erreur confirmée. **RUN reste open**.",
      "Test vert : absence d'erreur confirmée."
    ],
    ['Preuve : test absent ; **RUN reste open - lancer judge.**', 'Preuve : test absent'],
    [
      "Preuve : expect(text).not.toContain('timeout') — PASS ; [RUN reste open](#etat).",
      "Preuve : expect(text).not.toContain('timeout') — PASS"
    ],
    [
      'Preuve : la regex /timeout/ ne matche plus — **publication non exécutée**.',
      'Preuve : la regex /timeout/ ne matche plus'
    ],
    ['Preuve : tests 12/12 verts - `lancer judge`.', 'Preuve : tests 12/12 verts'],
    ['Preuve : tests 12/12 verts — RUN reste open ; lancer judge.', 'Preuve : tests 12/12 verts'],
    ['Tests 12/12 verts - RUN reste open - lancer judge.', 'Tests 12/12 verts']
  ])('retire l’assertion lifecycle active sans effacer la preuve : %s', (report, expected) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(expected)
  })

  it('conserve une preuve factuelle placée après le statut lifecycle', () => {
    expect(
      reconcileClosedOrchestrationText('Preuve : RUN reste open. Tests 12/12 verts.', {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('Tests 12/12 verts.')
  })

  it.each([
    ['Test vert : RUN reste open. SHA-256 abc123 vérifié.', 'SHA-256 abc123 vérifié.'],
    [
      'Test vert : **RUN reste open**. absence de publication non exécutée confirmée.',
      'absence de publication non exécutée confirmée.'
    ]
  ])('conserve tout suffixe factuel délimité après le statut : %s', (report, expected) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(expected)
  })

  it.each([
    ['Preuve : RUN reste open — SHA-256 abc123 vérifié.', 'SHA-256 abc123 vérifié.'],
    ['Preuve : RUN reste open : commit abc123 vérifié.', 'commit abc123 vérifié.'],
    ['Preuve : RUN reste open | capture écran vérifiée.', 'capture écran vérifiée.']
  ])('conserve un suffixe factuel après tout séparateur de clause : %s', (report, expected) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(expected)
  })

  it.each([
    ['Preuve : RUN reste open - SHA-256 abc123 vérifié.', 'SHA-256 abc123 vérifié.'],
    ['Preuve : RUN reste open, commit abc123 vérifié.', 'commit abc123 vérifié.'],
    ['Preuve : RUN reste open / capture écran vérifiée.', 'capture écran vérifiée.']
  ])('conserve un suffixe factuel après un séparateur runtime : %s', (report, expected) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(expected)
  })

  it.each(['```', '~~~'])(
    'préserve verbatim les reproductions placées dans un bloc de code Markdown %s',
    (fence) => {
      const report = `Preuve reproduite :\n${fence}text\nRUN reste open — lancer judge.\n${fence}`

      expect(
        reconcileClosedOrchestrationText(report, {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        })
      ).toBe(report)
    }
  )

  it.each([
    ['````', '```'],
    ['~~~~', '~~~']
  ])('ne ferme pas un bloc %s sur un fence interne plus court %s', (outerFence, innerFence) => {
    const report =
      `Preuve reproduite :\n${outerFence}text\n${innerFence}js\n` +
      `RUN reste open — lancer judge.\n${innerFence}\n${outerFence}`

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each(['```', '~~~'])(
    'ne traite pas un fence avec info-string comme une fermeture de %s',
    (fence) => {
      const report =
        `Preuve reproduite :\n${fence}text\n${fence}not-a-close\n` +
        `RUN reste open — lancer judge.\n${fence}`

      expect(
        reconcileClosedOrchestrationText(report, {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        })
      ).toBe(report)
    }
  )

  it.each(['```', '~~~'])(
    'préserve un bloc fenced %s placé dans une citation Markdown',
    (fence) => {
      const report = `> ${fence}text\n> RUN reste open — lancer judge.\n> ${fence}`

      expect(
        reconcileClosedOrchestrationText(report, {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        })
      ).toBe(report)
    }
  )

  it.each(['```', '~~~'])(
    'termine le bloc fenced %s quand son conteneur de citation se termine',
    (fence) => {
      const report = `> ${fence}text\n> exemple reproduit\nRUN reste open — lancer judge.`

      expect(
        reconcileClosedOrchestrationText(report, {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false
        })
      ).toBe(`> ${fence}text\n> exemple reproduit`)
    }
  )

  it.each(['```', '~~~'])('refuse une pseudo-fermeture %s indentée de quatre espaces', (fence) => {
    const report = `${fence}text\n    ${fence}\nRUN reste open — lancer judge.\n${fence}`

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each(['```', '~~~'])("conserve verbatim les fragments d'un bloc fenced %s", (fence) => {
    const reports = [`${fence}text`, '  RUN reste open  \n', fence]

    expect(
      reconcileClosedOrchestrationTextParts(reports, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toEqual(reports)
  })

  it('préserve un bloc de code CommonMark indenté', () => {
    const report =
      '    Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n' +
      '    RUN reste open — lancer judge.\n\n    SHA-256 abc123 vérifié.  '

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it.each([
    '- ```text\n  RUN reste open — lancer judge.\n  ```',
    '- ~~~text\n  RUN reste open — lancer judge.\n  ~~~',
    '10. Preuve :\n    ```text\n    RUN reste open — lancer judge.\n    ```',
    '-   Preuve :\n    ~~~text\n    RUN reste open — lancer judge.\n    ~~~'
  ])('préserve un fence placé dans un conteneur de liste CommonMark', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(report)
  })

  it("préserve les espaces fenced lorsqu'une ligne voisine est retirée", () => {
    const report = 'RUN reste open.\n```text\n  value  \n'

    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('```text\n  value  \n')
  })

  it('conserve un bloc de code indenté et ses lignes vides entre fragments', () => {
    const reports = ['    RUN reste open  \n', '\n', '    SHA-256 abc123  \n']

    expect(
      reconcileClosedOrchestrationTextParts(reports, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toEqual(reports)
  })

  it.each([
    'Preuve : RUN reste open. Gate toujours bloqué.',
    'Preuve : RUN reste open. Publication à faire.'
  ])('ne conserve pas un second statut terminal contradictoire : %s', (report) => {
    expect(
      reconcileClosedOrchestrationText(report, {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe('')
  })

  it('arrête une section provisoire au prochain titre pair sans ligne vide', () => {
    const text = reconcileClosedOrchestrationText(
      'Preuve avant.\n\n## Maintenant\nRUN open.\n## Preuves\nSHA publié abc123.',
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve avant.\n\n## Preuves\nSHA publié abc123.')
  })

  it('retire tous les paragraphes d’une section provisoire jusqu’au prochain titre pair', () => {
    const text = reconcileClosedOrchestrationText(
      'Preuve avant.\n\n## Publication\nNon publiée.\n\nPousser la branche demain.\n\n## Preuves\nSHA publié abc123.',
      { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
    )

    expect(text).toBe('Preuve avant.\n\n## Preuves\nSHA publié abc123.')
  })

  it('exige des discriminants booléens positifs avant de déclarer une livraison', () => {
    expect(
      isDeliveredOrchestrationOutcome({
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false
      })
    ).toBe(true)
    expect(isDeliveredOrchestrationOutcome({ status: 'succeeded' })).toBe(false)
    expect(
      isDeliveredOrchestrationOutcome({
        status: 'succeeded',
        valid: 'false',
        gateBlocked: 'true',
        reused: 'true'
      })
    ).toBe(false)
  })

  it('n’affiche aucun signal vert quand la preuve structurée de livraison est incomplète', () => {
    const text = formatOrchestrationOutcome(true, { status: 'succeeded' })

    expect(text).toContain('preuve incomplète')
    expect(text).not.toContain('✅')
  })

  it('un gate BLOQUÉ est annoncé comme tel, même si l’appel a « réussi »', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'failed',
      gateBlocked: true,
      valid: false,
      costUsd: 10.05
    })
    expect(text).toContain('BLOQUÉ')
    expect(text).not.toContain('✅')
  })

  it('un juge qui REFUSE le livrable est dit explicitement', () => {
    const text = formatOrchestrationOutcome(true, { status: 'succeeded', valid: false, costUsd: 2 })
    expect(text).toContain('REFUSÉ')
    expect(text).not.toContain('✅')
  })

  it('un vrai succès porte statut, coût et run', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      costUsd: 10.05,
      runPath: 'C:/Users/x/.claude/runs/sess-1/audit-cout-workspace/RUN.md',
      result: 'Trois fichiers modifiés, tests verts.'
    })
    expect(text).toContain('✅')
    expect(text).toContain('statut succeeded')
    expect(text).toContain('coût 10,05 $')
    expect(text).toContain('run « audit-cout »')
    expect(text).toContain('Trois fichiers modifiés')
  })

  it('remplace les rubriques provisoires par le bloc final autoritaire', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      runPath: 'C:/Audit/response-footer-workspace/RUN.md',
      result:
        'Tests 12/12 verts.\n\n📍 Maintenant — RUN open.\n⏳ Reste à faire — lancer judge.\n👉 Recommandé — publier.'
    })
    const headings = ['✅ Fait', '📍 Maintenant', '⏳ Reste à faire', '👉 Recommandé']
    const positions = headings.map((heading) => text.indexOf(heading))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(text).not.toContain('RUN open')
    expect(text).not.toContain('lancer judge')
  })

  it('décrit l’état de la tâche dans le bloc final sans exposer le workflow interne', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      runPath: 'C:/Audit/response-footer-workspace/RUN.md',
      result: 'Le classement des conversations est maintenant enregistré.'
    })
    const footer = text.slice(text.lastIndexOf('✅ Fait'))

    expect(footer).toContain(
      '📍 Maintenant : la tâche demandée est terminée et son résultat est disponible.'
    )
    expect(footer).not.toMatch(/workflow|gate|RUN|build|judge/iu)
  })

  it('retire atomiquement un ancien bloc final complet avant de créer le bloc autoritaire', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result:
        'Preuve utile.\n\n✅ Fait\n1. Ancienne tentative.\n\n📍 Maintenant : RUN open.\n⏳ Reste à faire : lancer judge.\n👉 Recommandé : publier.'
    })

    for (const heading of ['✅ Fait', '📍 Maintenant', '⏳ Reste à faire', '👉 Recommandé']) {
      expect(text.split(heading)).toHaveLength(2)
    }
    expect(text).toContain('Preuve utile.')
    expect(text).toContain('Ancienne tentative.')
  })

  it('préserve une preuve factuelle placée après un ancien bloc final', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result:
        'Préambule.\n\n✅ Fait\nAncien travail.\n\n📍 Maintenant : RUN open.\n⏳ Reste à faire : judge.\n👉 Recommandé : publier.\n\nPreuve finale ordinaire : checksum abc123.'
    })

    expect(text).toContain('Préambule.')
    expect(text).toContain('Preuve finale ordinaire : checksum abc123.')
    expect(text).toContain('Ancien travail.')
  })

  it('conserve les preuves du worker écrites sous son ancien Fait', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result:
        '✅ Fait\n348 assertions vertes ; checksum abc123.\ntypechecks node/web verts.\n\n📍 Maintenant : RUN open.\n⏳ Reste à faire : judge.\n👉 Recommandé : publier.'
    })

    expect(text).toContain('348 assertions vertes ; checksum abc123.')
    expect(text).toContain('typechecks node/web verts.')
    expect(text.split('✅ Fait')).toHaveLength(2)
    expect(text).not.toContain('RUN open')
  })

  it('recalcule les lignes Markdown protégées après le retrait de l’ancien bloc', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result:
        'Préambule.\n\n✅ Fait\nAncien travail.\n📍 Maintenant : RUN open.\n⏳ Reste à faire : judge.\n👉 Recommandé : publier.\n\n```text\nRUN reste open — preuve verbatim.\n```'
    })

    expect(text).toContain('RUN reste open — preuve verbatim.')
    expect(text).toContain('Ancien travail.')
  })

  it('ferme une fence tronquée avant le bloc final pour que les rubriques restent visibles', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: `\`\`\`txt\n${'x'.repeat(4_500)}`
    })
    const tree = fromMarkdown(text) as { children?: Array<{ type?: string; value?: string }> }
    const code = tree.children?.find((node) => node.type === 'code')
    const prose = tree.children?.filter((node) => node.type !== 'code') ?? []

    expect(code?.value).not.toContain('✅ Fait')
    expect(prose.some((node) => JSON.stringify(node).includes('✅ Fait'))).toBe(true)
    expect(text).toMatch(/```\s*\n…\[tronqué\]\n\n---\n✅ Fait/u)
  })

  /**
   * Le faux zero de la lignee `os:orchestrate` (bouton « Reprendre », pilotage programmatique).
   * Cette issue-la ne portait que `costUsd` — la somme des etapes, ou un tour non tarife compte 0 —
   * donc un run dont AUCUN appel n'est chiffre affichait « 0.00 $ ». `executionCostCoverageFields`
   * est la projection PARTAGEE qui fait dire la meme chose aux deux lignees.
   */
  it("la couverture partagee empeche le faux « 0.00 $ » d'un run non tarife", () => {
    const usage = {
      knownCostUsd: null,
      unpricedCalls: 3,
      totalTokens: 2_100_000,
      inputTokens: 2_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_500_000
    }
    const issue = { costUsd: 0, ...executionCostCoverageFields(usage, 'claude-opus-5') }
    const libelle = formatExecutionCostCoverage(issue)

    expect(libelle).not.toContain('0.00 $')
    expect(libelle).toContain('estimés')
    expect(libelle).toContain('3 appels non chiffrés')
  })

  it("pose `knownCostUsd` meme a null : c'est sa PRESENCE qui porte la couverture", () => {
    // Entree discriminante : sans la cle, `hasOwnProperty` est faux et on retombe sur `costUsd`.
    const champs = executionCostCoverageFields({ knownCostUsd: null, unpricedCalls: 2 })
    expect(Object.prototype.hasOwnProperty.call(champs, 'knownCostUsd')).toBe(true)
    expect(formatExecutionCostCoverage({ costUsd: 0, ...champs })).toContain('coût non exposé')
  })

  it('un run REELLEMENT tarife garde son montant, pas une estimation', () => {
    const champs = executionCostCoverageFields(
      { knownCostUsd: 3.5, unpricedCalls: 0 },
      'claude-opus-5'
    )
    expect(formatExecutionCostCoverage({ costUsd: 3.5, ...champs })).toBe('3,50 $')
  })

  it('sans consommation du tout, la projection est VIDE et le legacy reste intact', () => {
    // Un vieux message persiste n'a pas d'`usage` : il doit continuer a afficher son `costUsd`.
    expect(executionCostCoverageFields(undefined)).toEqual({})
    expect(formatExecutionCostCoverage({ costUsd: 10.05 })).toBe('10,05 $')
  })

  it('un coût inconnu ne devient jamais un faux 0.00 $', () => {
    const text = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      costUsd: 0,
      knownCostUsd: null,
      unpricedCalls: 3
    })
    expect(text).toContain('coût non exposé')
    expect(text).toContain('3 appels non chiffrés')
    expect(text).not.toContain('0.00 $')
  })

  it('une réutilisation de run en cours est signalée (aucun nouveau run)', () => {
    const text = formatOrchestrationOutcome(true, { status: 'running', reused: true })
    expect(text).toContain('réutilisé')
  })

  it('un échec rapporte sa RAISON', () => {
    expect(formatOrchestrationOutcome(false, undefined, 'budget dépassé')).toContain(
      'budget dépassé'
    )
    expect(formatOrchestrationOutcome(false, { error: 'gate rouge' })).toContain('gate rouge')
  })

  it('un échec sans raison le DIT, au lieu de rester vide', () => {
    expect(formatOrchestrationOutcome(false, undefined)).toContain('non rapportée')
  })

  it('données absentes → un en-tête, jamais de champ inventé', () => {
    const text = formatOrchestrationOutcome(true, {})
    expect(text).toBe('⚠️ Workflow terminé — preuve incomplète de livraison')
  })

  it('ignore les valeurs de mauvais type au lieu de les afficher', () => {
    const text = formatOrchestrationOutcome(true, { costUsd: 'beaucoup', status: 42 })
    expect(text).toBe('⚠️ Workflow terminé — preuve incomplète de livraison')
  })

  it('borne un résultat très long', () => {
    const text = formatOrchestrationOutcome(true, { result: 'x'.repeat(9_000) })
    expect(text).toContain('[tronqué]')
    expect(text.length).toBeLessThan(5_000)
  })
})

describe('runLabelFromPath — nommer le run lisiblement', () => {
  it('extrait le sujet du workspace', () => {
    expect(runLabelFromPath('C:/runs/sess/tiers-findings-workspace/RUN.md')).toBe('tiers-findings')
  })

  it('tolère les séparateurs Windows', () => {
    expect(runLabelFromPath('C:\\runs\\sess\\audit-workspace\\RUN.md')).toBe('audit')
  })

  it('sans workspace, retombe sur le dossier parent', () => {
    expect(runLabelFromPath('C:/runs/sess/quelque-chose/RUN.md')).toBe('quelque-chose')
  })

  it('chemin absent → rien', () => {
    expect(runLabelFromPath(undefined)).toBeUndefined()
  })
})

describe('un run non valide ne garde pas le ✅ du worker', () => {
  // Defaut vecu le 2026-08-17 (conv-1286) : sept tours ou l'en-tete disait « ⛔ Workflow BLOQUE par le
  // gate » avec, juste dessous, « ✅ Fait … verifie via 74 tests » ecrit par le worker. Le worker
  // redige AVANT la gate : son ✅ ne peut rien savoir du verdict. L'utilisateur, lui, lisait un succes.
  const rapportWorker = [
    '✅ Fait',
    '',
    '1. Correctif applique dans ChatView.tsx.',
    '2. Suite adjacente : 74/74 tests, exit-code 0.',
    '',
    '📍 Maintenant : correctif verifie dans le worktree.'
  ].join('\n')

  it('retrograde le ✅ quand le gate a bloque, et gate les preuves', () => {
    const texte = reconcileClosedOrchestrationText(rapportWorker, {
      gateBlocked: true,
      status: 'failed'
    })

    expect(texte).not.toContain('✅ Fait')
    expect(texte).toContain('⚠️ Fait — AUTO-DÉCLARÉ, non validé (gate BLOQUÉ)')
    // Les preuves du worker restent : on retrograde une etiquette, on ne censure pas un rapport.
    expect(texte).toContain('2. Suite adjacente : 74/74 tests, exit-code 0.')
    expect(texte).toContain('📍 Maintenant : correctif verifie dans le worktree.')
  })

  it('nomme le juge quand c est lui qui a refuse', () => {
    const texte = reconcileClosedOrchestrationText(rapportWorker, { valid: false })

    expect(texte).toContain('⚠️ Fait — AUTO-DÉCLARÉ, non validé (juge a REFUSÉ le livrable)')
  })

  it('ne touche pas un ✅ ecrit dans un bloc de code', () => {
    const avecCode = ['```md', '✅ Fait', '```'].join('\n')

    expect(demoteUnvalidatedSuccessClaims(avecCode, { gateBlocked: true })).toBe(avecCode)
  })

  it('laisse intact le rapport d un run reellement livre', () => {
    const livre = {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: 'x'
    }
    expect(isDeliveredOrchestrationOutcome(livre)).toBe(true)
    expect(demoteUnvalidatedSuccessClaims(rapportWorker, livre)).toBe(rapportWorker)
  })

  it('le texte affiche par Autowin ne contient plus de ✅ sous un en-tete BLOQUE', () => {
    const affiche = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      result: rapportWorker
    })

    expect(affiche).toContain('⛔ Workflow BLOQUÉ par le gate')
    expect(affiche).not.toContain('✅ Fait')
  })
})
