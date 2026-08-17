import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `electron-vite dev` NE DOIT PAS porter `--watch` — il tuait le processus en cours de travail.
 *
 * Demande de l'utilisateur (`conv-1267`) : « pendant que je bosse le processus autowin OS se kill
 * tout seul, fix ça ». Le run avait TROUVÉ et PROUVÉ la cause : avec `--watch`, electron-vite
 * redémarre Electron dès que `main` ou `preload` change, ce qui tue l'orchestration en cours. Test
 * rouge→vert, contrôle négatif, typecheck 0.
 *
 * Ce correctif d'UNE LIGNE est resté bloqué par le gate — pour un motif comptable (« coût non exposé,
 * 2 appels non chiffrés »), pas pour un défaut du livrable — et n'a donc jamais été fusionné. Le
 * défaut a continué de nuire pendant deux jours, y compris pendant les mesures de cette session : une
 * douzaine de redémarrages déclenchés en éditant `main` ont tué deux runs de l'utilisateur
 * (`conv-1267`, messages 7 et 8 : « l'application a été fermée »).
 *
 * Le rechargement à chaud du RENDERER est conservé — c'est lui qui est utile et sans risque. Seul le
 * redémarrage du processus PRINCIPAL disparaît.
 */
describe('script dev : pas de redémarrage automatique du processus principal', () => {
  const manifest = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
  const scripts = JSON.parse(manifest).scripts as Record<string, string>

  it('le script `dev` n’active PAS --watch', () => {
    expect(scripts.dev).toBe('electron-vite dev')
    expect(scripts.dev).not.toContain('--watch')
  })

  it('aucun autre script de dev ne le réintroduit', () => {
    // Le defaut reviendrait par la porte d'a cote : un `dev:*` qui garde `--watch`.
    const fautifs = Object.entries(scripts).filter(
      ([nom, valeur]) => nom.startsWith('dev') && valeur.includes('--watch')
    )
    expect(fautifs).toEqual([])
  })
})
