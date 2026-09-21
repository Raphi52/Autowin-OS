# Contrat de `src/shared/Partie.luau`

Ce contrat fixe UNIQUEMENT l'interface. Les règles du jeu sont celles de Clash Royale : à toi de
les connaître et de les appliquer.

## Contraintes techniques
- Le module et tout ce qu'il requiert n'utilisent **aucun service Roblox** (`game`, `workspace`,
  `task`, `Instance`…) : c'est de la logique pure, pilotée par `avancer(dt)`.
- Les `require` internes se font **par chemin relatif** (`require("./Cartes")`), pour que le module
  tourne aussi bien dans Roblox que hors de Studio.
- Aucun hasard hors de la graine : même graine + mêmes appels = même état.

## Géométrie
Arène de 18 (x de 0 à 18) sur 32 (y de 0 à 32). Le joueur 1 est en bas, le joueur 2 en haut.
Camp du joueur 1 : `y < 15`. Rivière : `15 <= y <= 17`. Camp du joueur 2 : `y > 17`.

| tour | joueur 1 | joueur 2 |
|---|---|---|
| `roi` | (9, 3) | (9, 29) |
| `gauche` | (3.5, 6.5) | (3.5, 25.5) |
| `droite` | (14.5, 6.5) | (14.5, 25.5) |

## Interface
```lua
Partie.CARTES : { [string]: { cout: number, type: "unite" | "sort" | "batiment", pv: number? } }
    -- catalogue ; `pv` obligatoire pour une unite (points de vie a la pose)

Partie.nouvelle(graine: number) -> partie

partie:jouer(joueur: number, indexMain: number, x: number, y: number) -> (boolean, string?)
    -- pose la carte `main[indexMain]` (1 a 4) du joueur (1 ou 2) en (x, y).
    -- rend false (+ motif) si le coup est illegal ; l'etat n'est alors PAS modifie.

partie:avancer(dt: number)      -- fait passer le temps de dt secondes

partie:etat() -> {
    temps: number,                                   -- secondes ecoulees
    phase: "normal" | "prolongation" | "terminee",
    vainqueur: number?,                              -- 1, 2, 0 (egalite) ; nil tant que non terminee
    joueurs: { [number]: {                           -- indices 1 et 2
        elixir: number,
        main: { string },                            -- 4 identifiants de CARTES
        prochaine: string,                           -- la carte qui entrera en main
        couronnes: number,
        tours: { roi: Tour, gauche: Tour, droite: Tour },
    } },
    unites: { { id: number, joueur: number, carte: string, pv: number, x: number, y: number } },
}
Tour = { pv: number, x: number, y: number }         -- pv = 0 : tour detruite
```
`etat()` rend une COPIE : la modifier ne change pas la partie.

## Cartes et modèles
- Chaque carte de `Partie.CARTES` porte `image: string` au format `rbxassetid://<nombre>`.
- Chaque carte de type `unite` a son modèle 3D dans `ReplicatedStorage.Modeles.<idCarte>` (une
  `Model`), présent dans le fichier construit par `rojo build` (pas seulement créé en jeu).

## Multijoueur
Le serveur fait autorité : le client n'appelle jamais `jouer` lui-même, il envoie une intention au
serveur (RemoteEvent), qui revalide le coup.

## Boutique — `src/shared/Boutique.luau` (logique pure, mêmes contraintes que `Partie`)
```lua
Boutique.CATALOGUE : { [idOffre]: { prix: number, monnaie: "or" | "gemmes", objet: string } }
Boutique.PRODUITS  : { [productId: number]: { gemmes: number } }   -- achats en Robux
Boutique.nouveauProfil() -> profil  -- { ["or"]: number, gemmes: number, inventaire: { [objet]: number } }
Boutique.acheter(profil, idOffre) -> (boolean, string?)             -- refus = profil inchangé
Boutique.traiterRecu(profil, recu: { PurchaseId: string, ProductId: number })
    -> "PurchaseGranted" | "NotProcessedYet"
Boutique.serialiser(profil) -> table   -- sauvegardable en DataStore
Boutique.charger(donnees: table?) -> profil
```
