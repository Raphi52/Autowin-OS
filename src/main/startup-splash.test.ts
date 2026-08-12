import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * L'écran d'attente du démarrage et le découplage qui le rend utile.
 *
 * MESURÉ AU CHRONOMÈTRE, en développement, cache chaud : 30 à 44 secondes s'écoulaient sans AUCUNE
 * fenêtre, puis l'interface apparaissait vers 70-80 s. Pendant ce trou, on relance l'application
 * plusieurs fois en croyant qu'elle n'a pas démarré.
 *
 * La cause n'était pas le rendu : `readLegacyRendererStorage` ouvre une fenêtre CACHÉE et y charge le
 * renderer entier — juste pour relire quelques clés de `localStorage` — et la création de la fenêtre
 * principale attendait ce résultat. En développement, cela payait la compilation complète du bundle
 * avant que la moindre fenêtre existe.
 *
 * Ces tests lisent la SOURCE parce que le sujet est un ordonnancement au démarrage d'Electron :
 * l'exécuter demanderait un vrai lancement, et chaque propriété vérifiée ici est une façon dont le
 * trou noir de 44 secondes reviendrait sans bruit.
 */

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('démarrage — la fenêtre n’attend plus la migration', () => {
  it('la lecture historique n’est PAS attendue avant la création de la fenêtre', () => {
    // C'est LE correctif. Un `await` réintroduit ici et les 44 secondes d'écran vide reviennent.
    expect(source).toContain('const lectureHistorique: Promise<LectureHistorique>')
    expect(source).not.toMatch(/const legacyRead = await readLegacyRendererStorage/)
  })

  it('l’IPC reçoit une PROMESSE, attendue seulement quand le renderer demande', () => {
    expect(source).toMatch(/registerStorageMigrationIpc\(lectureHistorique\)/)
    expect(source).toMatch(
      /function registerStorageMigrationIpc\(\s*lecture: Promise<LectureHistorique>/
    )
    expect(source).toMatch(/const \{ values \} = await lecture/)
    expect(source).toMatch(/const \{ canWriteMarker \} = await lecture/)
  })

  it('un échec de migration ne bloque pas le démarrage', () => {
    // La promesse a une branche de rejet qui repart sur « rien à importer », et n'écrit pas le
    // marqueur — la prochaine ouverture réessaiera.
    expect(source).toMatch(/\(\) => \(\{ values: \{\}, canWriteMarker: false \}\)/)
  })
})

describe('écran d’attente', () => {
  it('est chargé par le processus principal, pas par le bundle', () => {
    // Un écran d'attente servi par le serveur de développement n'apparaîtrait qu'une fois l'attente
    // terminée : c'est exactement l'erreur d'une première version, constatée sur capture.
    expect(source).toContain('data:text/html;charset=utf-8')
    expect(source).toMatch(/const attente = /)
  })

  it('est PEINT AVANT que le vrai document soit demandé', () => {
    // Enchaîner deux `loadURL` sans attendre ANNULE le premier : l'écran ne s'affichait jamais. Cette
    // erreur a été commise puis corrigée ; ce test est là pour qu'elle ne revienne pas.
    expect(source).toMatch(
      /\.loadURL\(`data:text\/html[^`]*`\)\s*\n?\s*\.then\(chargerInterface, chargerInterface\)/
    )
  })

  it('charge l’interface même si l’écran d’attente échoue', () => {
    // Les deux arguments de `then` sont le même appel : une attente ratée ne doit jamais empêcher
    // l'application de démarrer.
    expect(source).toContain('.then(chargerInterface, chargerInterface)')
  })

  it('porte les couleurs de l’application : fond noir, roue jaune et violette', () => {
    const bloc = source.slice(
      source.indexOf('const attente = '),
      source.indexOf('chargerInterface)')
    )
    expect(bloc).toContain('background:#000')
    expect(bloc).toContain('#e9bd4e')
    expect(bloc).toContain('#9d79ed')
    expect(bloc).toMatch(/animation:t /)
  })

  it('reste annoncé aux lecteurs d’écran, et ralentit si l’on demande moins d’animation', () => {
    const bloc = source.slice(
      source.indexOf('const attente = '),
      source.indexOf('chargerInterface)')
    )
    expect(bloc).toMatch(/role="status"/)
    expect(bloc).toMatch(/aria-live="polite"/)
    expect(bloc).toMatch(/prefers-reduced-motion/)
  })
})
