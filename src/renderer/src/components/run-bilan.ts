/**
 * Modèle de la carte « bilan de run » — un résumé COMPACT et partageable d'un run terminé.
 *
 * Pourquoi : rien n'exportait de résumé de run. `RunProgress` montre la timeline VIVANTE, pas un
 * état final qu'on puisse coller ailleurs. Fonction PURE (aucun DOM, aucun canvas) → testable.
 *
 * Règle de conception : une ligne dont la donnée MANQUE n'est pas rendue. La durée et le sujet ne
 * vivent pas dans `OrchStep` ; les inventer donnerait une carte fausse et jolie.
 */
import type { OrchStep } from './chat-view-model'

export type RunBilanLigne = { label: string; valeur: string }

export type RunBilan = {
  titre: string
  verdict: 'vert' | 'rouge' | 'en cours'
  lignes: RunBilanLigne[]
}

export type RunBilanEntree = {
  sujet?: string
  steps: OrchStep[]
  dureeMs?: number
  /** Vrai tant que le run tourne : le verdict reste « en cours », jamais conclu d'avance. */
  enCours?: boolean
}

export function formatDuree(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

export function buildRunBilan(entree: RunBilanEntree): RunBilan {
  const { steps, sujet, dureeMs, enCours } = entree
  const echecs = steps.filter((s) => s.status === 'failed').length
  const faites = steps.filter((s) => s.status === 'completed').length
  const cout = steps.reduce((t, s) => t + (s.costUsd ?? 0), 0)

  const lignes: RunBilanLigne[] = []
  lignes.push({
    label: 'Étapes',
    valeur: `${faites} faites${echecs > 0 ? ` · ${echecs} en échec` : ''}`
  })
  if (typeof dureeMs === 'number') lignes.push({ label: 'Durée', valeur: formatDuree(dureeMs) })
  if (cout > 0) lignes.push({ label: 'Coût', valeur: `${cout.toFixed(2)} $` })

  return {
    titre: sujet && sujet.trim().length > 0 ? sujet.trim() : 'Run sans sujet',
    verdict: enCours ? 'en cours' : echecs > 0 ? 'rouge' : 'vert',
    lignes
  }
}

const COULEUR_VERDICT: Record<RunBilan['verdict'], string> = {
  vert: '#63c08a',
  rouge: '#e2705f',
  'en cours': '#e3ba55'
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Rend le bilan en SVG autonome — aucune police externe, aucune URL : c'est ce qui permet de le
 * peindre dans un canvas puis de le copier en image sans réseau.
 */
export function bilanEnSvg(bilan: RunBilan, largeur = 560): string {
  const hauteur = 96 + bilan.lignes.length * 30
  const lignes = bilan.lignes
    .map(
      (l, i) =>
        `<text x="28" y="${112 + i * 30}" fill="#a9b2c4" font-family="monospace" font-size="14">${echapper(l.label)}</text>` +
        `<text x="200" y="${112 + i * 30}" fill="#dde3ee" font-family="monospace" font-size="14" font-weight="bold">${echapper(l.valeur)}</text>`
    )
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}">` +
    `<rect width="${largeur}" height="${hauteur}" fill="#12151c"/>` +
    `<text x="28" y="40" fill="#e3ba55" font-family="monospace" font-size="11" letter-spacing="2">BILAN DE RUN</text>` +
    `<text x="28" y="68" fill="#dde3ee" font-family="sans-serif" font-size="17" font-weight="bold">${echapper(bilan.titre)}</text>` +
    `<text x="${largeur - 28}" y="40" fill="${COULEUR_VERDICT[bilan.verdict]}" font-family="monospace" font-size="13" text-anchor="end">${echapper(bilan.verdict)}</text>` +
    lignes +
    `</svg>`
  )
}

export type RunResume = {
  status: string
  regime?: string
  dodChecked: number
  dodTotal: number
  journalEvents: number
  defauts: number
}

/**
 * Adapte le RÉSUMÉ d'un RUN.md (seule source dont dispose l'inspecteur) vers le même bilan.
 * Le verdict suit les DÉFAUTS et le statut : un run « failed », ou porteur d'un défaut, n'est
 * jamais peint en vert.
 */
export function bilanDepuisResume(resume: RunResume, titre?: string): RunBilan {
  const lignes: RunBilanLigne[] = [
    { label: 'Définition of done', valeur: `${resume.dodChecked}/${resume.dodTotal} cochés` },
    { label: 'Journal', valeur: `${resume.journalEvents} évènements` },
    { label: 'Défauts', valeur: String(resume.defauts) }
  ]
  if (resume.regime) lignes.push({ label: 'Régime', valeur: resume.regime })
  // VOCABULAIRE REEL des RUN.md (WorkflowsPanel.tsx:42) : `green`, `red`, `open`,
  // `degraded-closed`. Chercher « fail » ou « error » ratait donc `red` et `degraded-closed` —
  // constate a l'ecran le 2026-09-13 : un run badge « red » s'affichait VERT sur la carte.
  // Seul `green` autorise le vert ; tout statut inconnu reste prudent et ne verdit pas.
  const enCours = /^(running|open)$/i.test(resume.status.trim())
  const vert = /^green$/i.test(resume.status.trim()) && resume.defauts === 0
  const rouge = !enCours && !vert
  return {
    titre: titre && titre.trim().length > 0 ? titre.trim() : 'Run sans sujet',
    verdict: enCours ? 'en cours' : rouge ? 'rouge' : 'vert',
    lignes
  }
}

/**
 * BILAN DEPUIS LA CLÔTURE ÉCRITE DANS LA TRACE — le nœud « Clôture du run » du graphe.
 *
 * Demande du 2026-10-13 : cliquer ce nœud ouvrait la liste des fichiers modifiés par la
 * CONVERSATION, la même que l'onglet Files. Le nœud doit dire ce que le run a DONNÉ : verdict,
 * durée, coût. Même carte que l'inspecteur de RUN.md, même règle : une donnée qui manque n'est pas
 * rendue. Un run `open` n'a ni durée ni coût mesurés (la trace écrit `0 ms · 0 $` à son départ) :
 * les afficher présenterait une ABSENCE comme une mesure.
 */
export type ClotureObservee = {
  status: string
  totalDurationMs: number
  totalCostUsd: number
  integrationOutcome?: string
  usage?: { unpricedCalls?: number }
}

const CLOTURE_LIBELLE: Record<string, string> = {
  green: 'acceptée',
  red: 'refusée',
  'degraded-closed': 'close en mode dégradé',
  open: 'pas encore close'
}

const INTEGRATION_LIBELLE: Record<string, string> = {
  merged: 'fusionné dans la base',
  nothing: 'aucun changement à intégrer',
  conflict: 'conflit à l’intégration',
  blocked: 'intégration bloquée',
  kept: 'gardé dans sa copie de travail'
}

export function bilanDepuisCloture(
  cloture: ClotureObservee,
  options: { titre?: string; passagesDuJuge?: number } = {}
): RunBilan {
  const ouvert = cloture.status === 'open'
  const lignes: RunBilanLigne[] = [
    { label: 'Clôture', valeur: CLOTURE_LIBELLE[cloture.status] ?? cloture.status }
  ]
  if (!ouvert) {
    lignes.push({ label: 'Durée', valeur: formatDuree(cloture.totalDurationMs) })
    const sansPrix = cloture.usage?.unpricedCalls ?? 0
    lignes.push({
      label: 'Coût',
      valeur: `${cloture.totalCostUsd.toFixed(2)} $${sansPrix > 0 ? ` + ${sansPrix} appel(s) sans prix` : ''}`
    })
  }
  if (cloture.integrationOutcome) {
    lignes.push({
      label: 'Intégration',
      valeur: INTEGRATION_LIBELLE[cloture.integrationOutcome] ?? cloture.integrationOutcome
    })
  }
  if (options.passagesDuJuge && options.passagesDuJuge > 0) {
    lignes.push({ label: 'Passages du juge', valeur: String(options.passagesDuJuge) })
  }
  return {
    titre: options.titre?.trim() ? options.titre.trim() : 'Run sans sujet',
    // Même prudence que `bilanDepuisResume` : seul `green` verdit, tout le reste est rouge.
    verdict: ouvert ? 'en cours' : cloture.status === 'green' ? 'vert' : 'rouge',
    lignes
  }
}

export type PuceDuJuge = { gravite?: 'MAJEUR' | 'MINEUR' | 'OK'; texte: string }

export type VerdictDuJuge = {
  /** La ligne de verdict telle que le juge l'a écrite : « VALIDE » ou « DEFAUT: <raison> ». */
  conclusion: string
  valide: boolean
  score?: number
  puces: PuceDuJuge[]
}

/**
 * Lit le VERDICT FINAL d'un juge dans sa réponse brute, telle que la trace la garde.
 *
 * La réponse ne commence PAS par le verdict : le juge raconte d'abord ce qu'il vérifie (« Je
 * récupère… », « Tests verts… »), puis écrit `VALIDE` ou `DEFAUT: …`, `SCORE: n`, et ses puces
 * `OBJECTIONS:` étiquetées MAJEUR / MINEUR / OK (contrat de `objections-juge.ts`). On prend donc la
 * DERNIÈRE ligne de verdict, jamais la première ligne du texte (`lireContratEtendu` lit, lui, un
 * texte qui commence par le verdict). Pas de ligne de verdict = `undefined` : rien n'est inventé.
 */
export function lireVerdictDuJuge(texte: string): VerdictDuJuge | undefined {
  const lignes = texte.split(/\r?\n/)
  let indice = -1
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (/^\s*\**\s*(VALIDE|DEFAUT)\b/.test(lignes[i])) {
      indice = i
      break
    }
  }
  if (indice < 0) return undefined
  const conclusion = lignes[indice].replace(/\*\*/g, '').trim()
  const suite = lignes.slice(indice + 1).join('\n')
  const scoreBrut = /(?:^|\n)\s*SCORE:\s*(\d{1,3})/i.exec(suite)?.[1]
  const puces: PuceDuJuge[] = []
  const bloc = /(?:^|\n)\s*OBJECTIONS:\s*\n([\s\S]*)/i.exec(suite)?.[1] ?? ''
  for (const ligne of bloc.split(/\r?\n/)) {
    const puce = /^\s*[-*•]\s+(.+)$/.exec(ligne)?.[1]?.trim()
    if (!puce) continue
    const etiquette = /^\**\s*(MAJEUR|MINEUR|OK)\s*\**\s*:\s*\**\s*/i.exec(puce)
    puces.push(
      etiquette
        ? {
            gravite: etiquette[1].toUpperCase() as PuceDuJuge['gravite'],
            texte: puce.slice(etiquette[0].length).trim()
          }
        : { texte: puce }
    )
  }
  return {
    conclusion,
    valide: /^VALIDE\b/.test(conclusion),
    ...(scoreBrut !== undefined ? { score: Math.min(100, Number(scoreBrut)) } : {}),
    puces
  }
}
