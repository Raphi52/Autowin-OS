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
  it('est chargé par le processus principal depuis un FICHIER, jamais par une URL `data:`', () => {
    // MESURÉ : avec `data:text/html,…`, le document se chargeait mais son contenu était VIDE —
    // Chromium bloque les navigations de premier niveau vers `data:`. L'écran n'était donc jamais
    // visible pendant les 44 secondes qu'il devait couvrir.
    // On vise le CODE, pas la documentation : le commentaire qui explique l'ancienne approche cite
    // forcément `data:text/html`, et une garde qui l'interdit partout se déclencherait sur lui.
    expect(source).not.toMatch(/loadURL\([`'"]data:/)
    expect(source).toContain("join(app.getPath('temp'), 'autowin-boot.html')")
    expect(source).toContain('writeFileSync(cheminAttente, BOOT_SPLASH_DOCUMENT')
  })

  it('est PEINT AVANT que le vrai document soit demandé', () => {
    // Enchaîner deux chargements sans attendre ANNULE le premier : l'écran ne s'affichait jamais.
    // Cette erreur a été commise puis corrigée ; ce test est là pour qu'elle ne revienne pas.
    expect(source).toMatch(/loadFile\(cheminAttente\)\.then\(chargerInterface, chargerInterface\)/)
  })

  it('charge l’interface même si l’écran d’attente échoue', () => {
    // Les deux arguments de `then` sont le même appel, ET l'écriture du fichier est enveloppée : ni un
    // chargement raté ni un disque en lecture seule ne doivent empêcher l'application de démarrer.
    expect(source).toContain('.then(chargerInterface, chargerInterface)')
    expect(source).toMatch(/else chargerInterface\(\)/)
  })

  it('vient du module PARTAGÉ, pas d’une chaîne recopiée ici', () => {
    // L'apparence et l'accessibilité sont vérifiées dans `src/shared/boot-splash.test.ts`, au même
    // endroit que leur définition. Les dupliquer ici les ferait diverger en silence.
    expect(source).toContain("import { BOOT_SPLASH_DOCUMENT } from '../shared/boot-splash'")
  })
})
