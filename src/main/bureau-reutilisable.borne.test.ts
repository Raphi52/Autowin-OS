import { describe, expect, it } from 'vitest'
import { cleDeBureau, LONGUEUR_MAX_CLE_BUREAU } from './bureau-reutilisable'

/**
 * Ce que ces tests attrapent et qu'un test de RÉUTILISATION ne peut PAS attraper.
 *
 * `cleDeBureau` nomme un DOSSIER : `<racine>/agent__<clé>`. Sa longueur n'est donc pas cosmétique,
 * c'est un budget de chemin Windows. Mesuré le 2026-08-26 sur le dépôt réel :
 * `agent__command-edit-conv-1412-src-renderer-src-components-updatebanner-tsx` portait le chemin du
 * bureau à 147 caractères AVANT même le fichier édité ; en y ajoutant le fichier (~44) puis le cache
 * que la vérification écrit dans `node_modules/.vite/vitest/<hash>/results.json` (~65), on atteint
 * ~256 pour une limite de 260. D'où des `merge-failed : Filename too long` qui REFUSAIENT des
 * éditions saines et garaient le travail dans une `refs/autowin/rescue/…` que l'interface n'affiche
 * nulle part — 12 refs accumulées depuis le 16/08, jamais consultées.
 *
 * Le second défaut est plus sournois que la longueur : l'empreinte gardait les 60 DERNIERS
 * caractères du chemin, donc deux fichiers DIFFÉRENTS dont les queues coïncident recevaient la MÊME
 * clé, donc le MÊME bureau. Deux tâches distinctes écrivant au même endroit, c'est du travail
 * écrasé — la réutilisation reste souhaitable, la confusion jamais.
 */
describe('cleDeBureau — la clé nomme un dossier, sa longueur est un budget de chemin', () => {
  const profond =
    'src/renderer/src/components/administration/parametrage/sections/avancees/panneau-de-configuration-des-widgets-de-accueil.tsx'

  it('reste bornée même sur un chemin très profond', () => {
    const cle = cleDeBureau('edit', 'conv-1412', profond)

    expect(cle).toBeDefined()
    expect(cle!.length).toBeLessThanOrEqual(LONGUEUR_MAX_CLE_BUREAU)
  })

  it('borne aussi quand la conversation porte un identifiant à rallonge', () => {
    const cle = cleDeBureau('edit', 'conversation-de-reprise-automatique-au-demarrage-1412', profond)

    expect(cle!.length).toBeLessThanOrEqual(LONGUEUR_MAX_CLE_BUREAU)
  })

  it('ne fait PAS collisionner deux fichiers dont les queues de chemin coïncident', () => {
    // Même nom de fichier, même dossier terminal, arborescences distinctes : la troncature par la
    // queue les confondait, et deux tâches sans rapport se partageaient un bureau.
    const a =
      'src/renderer/src/components/administration/widgets/accueil/panneau-de-configuration.tsx'
    const b = 'src/main/services/administration/widgets/accueil/panneau-de-configuration.tsx'

    expect(cleDeBureau('edit', 'conv-1', a)).not.toBe(cleDeBureau('edit', 'conv-1', b))
  })

  it('reste STABLE : un bureau par tâche est tout le levier anti-résidus', () => {
    expect(cleDeBureau('edit', 'conv-1412', profond)).toBe(cleDeBureau('edit', 'conv-1412', profond))
    // La normalisation séparateurs + casse est conservée : le même fichier écrit de deux façons par
    // deux appelants ne doit pas fabriquer deux bureaux.
    // Antislash construit, jamais echappe dans un litteral : ecrit a la main, il devient un
    // caractere de controle et le test verifie alors autre chose que ce qu'il annonce.
    const versionWindows = ['src', 'main', 'foo.ts'].join(String.fromCharCode(92))
    expect(cleDeBureau('edit', 'conv-1', 'SRC/Main/Foo.TS')).toBe(
      cleDeBureau('edit', 'conv-1', versionWindows)
    )
  })

  it('garde le nom du fichier LISIBLE dans la clé', () => {
    // Un dossier de bureau qu'aucun humain ne sait rattacher à sa tâche est un résidu de plus.
    expect(cleDeBureau('edit', 'conv-1412', profond)).toContain('panneau-de-configuration')
  })

  it('deux commandes distinctes sur la même cible ne partagent pas de bureau', () => {
    expect(cleDeBureau('edit', 'conv-1', profond)).not.toBe(
      cleDeBureau('graphify', 'conv-1', profond)
    )
  })

  it('sans cible, aucune identité stable : l’appelant garde son identifiant aléatoire', () => {
    expect(cleDeBureau('edit', 'conv-1', undefined)).toBeUndefined()
    expect(cleDeBureau('edit', 'conv-1', '   ')).toBeUndefined()
  })
})
