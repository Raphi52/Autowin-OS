# Tâche : recherche classée dans l'arbre GED

Projet C# (.NET 9, `namespace RigV3Desktop`). Tu modifies UNIQUEMENT
`Metier/RechercheArbre.cs` (fourni ci-dessous, avec le type `NoeudGed` qu'il utilise).

Ajoute dans ce fichier, au niveau du namespace :

```csharp
public sealed record Resultat(NoeudGed[] Chemin, int Rang);
```

et dans la classe `RechercheArbre` :

```csharp
public static List<Resultat> Rechercher(NoeudGed racine, string terme, int max = 6)
```

`Chemin` = les NŒUDS de la racine (exclue) jusqu'au nœud trouvé inclus.

## Règles

1. **Forme normalisée** `N(s)` : accents retirés (é → E, Ç → C, y compris une lettre
   suivie d'un accent combinant), majuscules, puis on ne garde QUE les lettres et chiffres.
   Soit `T = N(terme)` et `L = N(libellé)`.
2. **Terme trop court** : si `T` fait moins de 2 caractères, ou si `max <= 0`, résultat vide.
3. **Occurrence valable** de `T` dans `L` : une occurrence est REFUSÉE si elle coupe un
   nombre, c'est-à-dire si le premier caractère de `T` est un chiffre ET que, dans le
   libellé D'ORIGINE, le caractère juste avant l'occurrence est un chiffre — ou
   symétriquement si le dernier caractère de `T` est un chiffre ET que le caractère
   d'origine juste après l'occurrence est un chiffre. (« 2024/0141 » ne trouve pas
   « Dépôt 2024/01410 », mais trouve « Dépôt 2024/0141 - 3 p. ».)
4. **Rang** d'un nœud (le meilleur qui s'applique) :
   - `0` : `L == T` ;
   - `1` : une occurrence valable commence au début d'un mot du libellé d'origine
     (début du libellé, ou précédée d'un caractère qui n'est ni lettre ni chiffre) ;
   - `2` : une occurrence valable ailleurs ;
   - `3` : faute de frappe — seulement si `T` fait au moins 5 caractères ET qu'AUCUN
     nœud de tout l'arbre n'a de rang 0 à 2 : il existe une sous-chaîne de `L`, dont les bornes sont valables (règle 3 appliquée à cette sous-chaîne, à la place de `T`), à distance d'édition exactement 1 de `T`
     (une lettre ajoutée, retirée ou changée).
   Un nœud sans rang n'est pas un résultat.
5. **Tri** : par rang croissant, puis profondeur croissante (longueur du chemin), puis
   ordre de parcours de l'arbre (préfixe : un nœud avant ses enfants, enfants dans
   l'ordre). Puis on garde les `max` premiers.
6. **Homonymes** : deux nœuds de même libellé (même identiques en tout) sont deux
   résultats distincts ; chaque chemin pointe vers les BONS objets.
7. **Performance** : moins de 150 ms sur un arbre de 50 000 nœuds (recherche avec faute de frappe comprise).
8. **Compatibilité** : `Normaliser`, `Correspond`, `Chemins` et `Suivre` gardent
   exactement leur comportement actuel.

Rends le fichier `Metier/RechercheArbre.cs` COMPLET dans un seul bloc ```csharp.
