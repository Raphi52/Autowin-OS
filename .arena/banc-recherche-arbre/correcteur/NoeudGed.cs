namespace RigV3Desktop;
// Copie conforme de la signature de Metier/ArbreGed.cs (8d46898 + copie de travail du 2026-09-21).
public sealed record NoeudGed(string Libelle, string Icone, string Date, int Pages,
                              string Extension, string Origine, string Apercu,
                              NoeudGed[] Enfants, string DomaineRequis = "",
                              string Fichier = "")
{
    public bool APdf => Fichier.Length > 0;
    public bool EstPiece => Enfants.Length == 0 && Extension.Length > 0;
}
