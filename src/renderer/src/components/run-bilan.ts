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
  const enCours = /running|en cours/i.test(resume.status)
  const rouge = resume.defauts > 0 || /fail|abandon|error/i.test(resume.status)
  return {
    titre: titre && titre.trim().length > 0 ? titre.trim() : 'Run sans sujet',
    verdict: enCours ? 'en cours' : rouge ? 'rouge' : 'vert',
    lignes
  }
}
