/**
 * SIMULATION d'un nœud `think` sur de VRAIES tâches — ouvre-t-il les BONNES notes du Brain ?
 *
 * Pourquoi : le 2026-09-27, la recherche Brain est passée d'un extrait coupé (~20 000 caractères
 * d'un seul fichier) à une LISTE de candidates que le nœud ouvre lui-même. Le point de départ mesuré
 * dans l'historique était : aucun `brain_read`, jamais. Attendre des runs réels pour savoir si le
 * nouveau chemin sert laisse la question ouverte des jours ; cette sonde la tranche en minutes, sans
 * lancer de run.
 *
 * Ce qui est RÉEL (rien n'est maquetté sur le chemin mesuré) :
 *  - la liste de candidates en tête : `retrieveBrainContext(tâche, { mode: 'candidates' })` puis
 *    `consigneCandidatesBrain`, exactement comme `orchestrator.ts` l'injecte à chaque run ;
 *  - la consigne du nœud : `GARDE_TACHE` + `skills/think/SKILL.md` + `promptOutilsNoeudSkill` ;
 *  - le serveur d'outils du nœud (`demarrerServeurOutilsNoeudSkill`) branché sur le VRAI Brain ;
 *  - les outils intégrés d'un nœud en lecture seule (`Read,Grep,Glob,Bash`, `providers/claude.ts`) ;
 *  - la ligne de trace : `libelleAppelObserve`, celle que l'app écrit dans `activity/<conv>.jsonl`.
 *
 * Ce qui DIFFÈRE d'un run, et pourquoi : `remember` est REFUSÉ (une simulation n'écrit rien au
 * Brain) ; l'effort est `high` et non `xhigh` pour borner le coût ; plafond de 2 $ par tâche.
 *
 * DEUX CANAUX DE LECTURE, et la sonde compte les deux. Le premier essai (2026-09-27) a montré un
 * nœud qui n'appelait AUCUN outil Brain et citait pourtant les notes : il les lisait directement sur
 * le disque avec `Read`/`Grep`, comme `consigneCandidatesBrain` l'y autorise. Ces lectures-là ne
 * passent pas par la trace MCP ; on les relève dans le flux `stream-json` du CLI.
 *
 * L'ORACLE est externe au modèle : pour trois tâches, la note qui répond est connue d'avance
 * (`attendue`). On mesure son RANG dans la liste, si elle a été ouverte (par l'un ou l'autre canal),
 * et si la sortie de `think` en reprend un élément distinctif (`indice`).
 *
 * PAYANTE et manuelle : npx tsx scripts/probe-think-brain.mts [numéro de tâche, 1 à 5]
 */
import { spawn } from 'node:child_process'
import { resolveClaudeBin } from '../src/main/providers/claude'
import { demarrerServeurOutilsNoeudSkill, libelleAppelObserve } from '../src/main/skill-node-mcp'
import type { AppelMcpObserve } from '../src/main/skill-node-mcp'
import { OUTILS_NOEUD_SKILL, promptOutilsNoeudSkill } from '../src/main/skill-node-tools'
import type { LanceurCommandeSkill, SpecCommandeSkill } from '../src/main/skill-node-tools'
import { skillInstruction } from '../src/main/skill-pipeline'
import { GARDE_TACHE } from '../src/main/phase-briefs'
import { consigneCandidatesBrain } from '../src/main/orchestrator'
import { CATALOG } from '../src/main/commands'
import { brainServiceToken, retrieveBrainContext } from '../src/main/brain-retrieval'
import { buildBrainOutcome, decideBrainQuery } from '../src/main/brain-query-command'
import { runBrainGraph, runBrainRead } from '../src/main/brain-graph-command'

interface Tache {
  tache: string
  /** Fragment du chemin de la note qui répond, quand on la connaît d'avance. */
  attendue?: string
  /** Élément distinctif de cette note : s'il ressort dans la sortie, la note a servi. */
  indice?: RegExp
}

const TACHES: Tache[] = [
  {
    tache:
      "Dans une OPE RIG, ajouter un champ de saisie d'une heure (HH:mm) lié à une colonne SQL de la table métier.",
    attendue: 'guide-choix-ult',
    indice: /Ult_Heure[\s\S]{0,300}(IUlt_String|DBString|char|varchar)/i
  },
  {
    tache:
      'Dans RIG, une mise à jour sur deux bases dans le même TransactionScope ne fait rien et aucune erreur ne remonte. Trouver la cause.',
    attendue: 'transactionscope-multi-connexion',
    indice: /MSDTC|DTC/i
  },
  {
    tache:
      'Sur une grille RIG, permettre le tri par colonne tout en gardant les colonnes redimensionnables.',
    attendue: 'grilles-rig-activer-le-tri',
    indice: /redimension/i
  },
  { tache: "Autowin OS : la page Watchdogs n'est pas responsive sur un écran étroit." },
  {
    tache:
      'Autowin OS : la recherche Brain remonte des notes hors sujet dans sa liste de candidates ; améliorer la pertinence.'
  }
]

const deps = { token: brainServiceToken(), corpus: null }

/** Le vrai Brain, par les mêmes fonctions que `commands.ts`. `remember` est refusé. */
const lanceur: LanceurCommandeSkill = {
  exec: async (nom, args) => {
    if (nom === 'brain_query') {
      const decision = decideBrainQuery(args.question)
      if (!decision.allowed) return { ok: false, error: decision.reason }
      const brain = await retrieveBrainContext(decision.query, { mode: 'candidates' })
      return {
        ok: true,
        data: buildBrainOutcome(decision.query, brain.context, brain.status, brain.unavailableReason)
      }
    }
    if (nom === 'brain_read') return { ok: true, data: await runBrainRead(args, deps) }
    if (nom === 'brain_graph') return { ok: true, data: await runBrainGraph(args, deps) }
    return { ok: false, error: `${nom} désactivé en simulation : rien n'est écrit au Brain` }
  },
  catalogue: () =>
    CATALOG.filter((c) => (OUTILS_NOEUD_SKILL as readonly string[]).includes(c.name)).map(
      (c): SpecCommandeSkill => ({ name: c.name, description: c.description, args: c.args })
    )
}

function lancerCli(args: string[]): Promise<{ code: number | null; sortie: string }> {
  return new Promise((resolve) => {
    // `shell: false` + binaire natif : mêmes raisons que `probe-skill-node-mcp.mts`.
    const enfant = spawn(resolveClaudeBin(), args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let sortie = ''
    enfant.stdout.on('data', (c) => (sortie += String(c)))
    enfant.stderr.on('data', (c) => (sortie += String(c)))
    enfant.stdin.end()
    const minuteur = setTimeout(() => enfant.kill(), 600_000)
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      resolve({ code, sortie })
    })
  })
}

/** Relève le texte final, le coût et les appels d'outils INTÉGRÉS dans le flux `stream-json`. */
function lireFlux(sortie: string): { texte: string; cout: number; integres: string[] } {
  let texte = ''
  let cout = Number.NaN
  const integres: string[] = []
  for (const ligne of sortie.split('\n')) {
    const brute = ligne.trim()
    if (!brute.startsWith('{')) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(brute) as Record<string, unknown>
    } catch {
      continue
    }
    if (ev.type === 'result') {
      texte = String(ev.result ?? '')
      cout = Number(ev.total_cost_usd)
    }
    const contenu = (ev.message as { content?: unknown } | undefined)?.content
    if (ev.type !== 'assistant' || !Array.isArray(contenu)) continue
    for (const bloc of contenu as Array<Record<string, unknown>>) {
      if (bloc.type !== 'tool_use' || String(bloc.name).startsWith('mcp__')) continue
      const entree = (bloc.input ?? {}) as Record<string, unknown>
      const cible = String(entree.file_path ?? entree.path ?? entree.pattern ?? entree.command ?? '')
      const motif = entree.pattern && (entree.path ?? entree.file_path) ? ` « ${String(entree.pattern)} »` : ''
      integres.push(`${String(bloc.name)} ${cible.split(/\s+/).join(' ').slice(0, 170)}${motif}`)
    }
  }
  return { texte, cout, integres }
}

async function simuler(numero: number, t: Tache): Promise<void> {
  const appels: AppelMcpObserve[] = []
  const serveur = await demarrerServeurOutilsNoeudSkill(lanceur, { observer: (a) => appels.push(a) })
  try {
    const brain = await retrieveBrainContext(t.tache, { mode: 'candidates' })
    const chemins = [...brain.context.matchAll(/^`([^`]+\.md)`/gm)].map((m) => m[1]!)
    const rang = t.attendue ? chemins.findIndex((c) => c.includes(t.attendue!)) + 1 : 0
    const systeme = `${GARDE_TACHE}\n\n${skillInstruction('think')}${promptOutilsNoeudSkill(lanceur.catalogue())}`
    const message = [brain.context, consigneCandidatesBrain(brain.navigation?.root), `TÂCHE: ${t.tache}`]
      .filter(Boolean)
      .join('\n\n')
    const debut = Date.now()
    const { code, sortie } = await lancerCli([
      '-p',
      message,
      '--system-prompt',
      systeme,
      '--model',
      'claude-opus-5-5',
      '--effort',
      'high',
      '--max-budget-usd',
      '2',
      '--setting-sources',
      '',
      '--disable-slash-commands',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      'Read,Grep,Glob,Bash',
      '--strict-mcp-config',
      '--mcp-config',
      serveur.configMcp(),
      '--allowedTools',
      ...serveur.nomsExposes(),
      'Read',
      'Grep',
      'Glob',
      'Bash'
    ])
    const { texte, cout, integres } = lireFlux(sortie)
    const lectures = appels.filter((a) => a.outil === 'brain_read')
    const accesNotes = integres.filter((u) => /knowledge[\\/]/i.test(u))
    const ouverteMcp = t.attendue ? lectures.some((a) => a.cible?.includes(t.attendue!)) : null
    const ouverteFichier = t.attendue ? accesNotes.some((u) => u.includes(t.attendue!)) : null
    const horsListe = lectures.filter((a) => a.cible && !chemins.includes(a.cible)).length
    const caracteres = lectures.reduce((s, a) => s + (a.caracteres ?? 0), 0)
    console.log(`\n=== TÂCHE ${numero} — ${t.tache}`)
    console.log(
      `candidates ${chemins.length} (liste ${brain.context.length} car.)` +
        (t.attendue ? ` · note attendue au rang ${rang || 'ABSENTE'}` : '')
    )
    for (const a of appels) console.log(`  ${libelleAppelObserve(a, 'think')}`)
    for (const u of integres) console.log(`  outil intégré ${u}`)
    console.log(
      `brain_query ${appels.filter((a) => a.outil === 'brain_query').length}` +
        ` · brain_read ${lectures.length} (${caracteres} car., hors liste ${horsListe})` +
        ` · accès fichier aux notes ${accesNotes.length}` +
        (t.attendue ? ` · note attendue ouverte : brain_read ${ouverteMcp}, fichier ${ouverteFichier}` : '') +
        (t.indice ? ` · indice repris ${t.indice.test(texte)}` : '')
    )
    console.log(
      `code ${code} · ${Math.round((Date.now() - debut) / 1000)} s · ` +
        `${Number.isFinite(cout) ? `${cout.toFixed(2)} $` : 'coût inconnu'} · sortie ${texte.length} car.`
    )
    if (!texte) console.log(`SORTIE BRUTE (fin) : ${sortie.slice(-600)}`)
    console.log(`--- début de la sortie de think ---\n${texte.slice(0, 900)}\n---`)
  } finally {
    await serveur.arreter()
  }
}

const choix = Number(process.argv[2])
const liste =
  Number.isInteger(choix) && choix >= 1 && choix <= TACHES.length ? [choix] : TACHES.map((_, i) => i + 1)
for (const n of liste) await simuler(n, TACHES[n - 1]!)
