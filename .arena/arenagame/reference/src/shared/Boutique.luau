--!strict
-- Boutique : logique pure (voir CONTRAT.md).
local Boutique = {}

Boutique.CATALOGUE = {
	coffre_bois = { prix = 500, monnaie = "or", objet = "coffre_bois" },
	coffre_or = { prix = 60, monnaie = "gemmes", objet = "coffre_or" },
	offre_du_jour = { prix = 1200, monnaie = "or", objet = "carte_valkyrie" },
	emote_rire = { prix = 250, monnaie = "gemmes", objet = "emote_rire" },
}
Boutique.PRODUITS = {
	[1001] = { gemmes = 80 },
	[1002] = { gemmes = 500 },
}

function Boutique.nouveauProfil(): any
	return { ["or"] = 1000, gemmes = 100, inventaire = {}, recus = {} }
end

function Boutique.acheter(p: any, id: string): (boolean, string?)
	local o = Boutique.CATALOGUE[id]
	if not o then
		return false, "offre inconnue"
	end
	if (p[o.monnaie] or 0) < o.prix then
		return false, "solde insuffisant"
	end
	p[o.monnaie] -= o.prix
	p.inventaire[o.objet] = (p.inventaire[o.objet] or 0) + 1
	return true
end

function Boutique.traiterRecu(p: any, recu: any): string
	p.recus = p.recus or {}
	if p.recus[recu.PurchaseId] then
		return "PurchaseGranted"
	end
	local pr = Boutique.PRODUITS[recu.ProductId]
	if not pr then
		return "NotProcessedYet"
	end
	p.gemmes += pr.gemmes
	p.recus[recu.PurchaseId] = true
	return "PurchaseGranted"
end

function Boutique.serialiser(p: any): any
	return {
		["or"] = p["or"],
		gemmes = p.gemmes,
		inventaire = table.clone(p.inventaire),
		recus = table.clone(p.recus or {}),
	}
end

function Boutique.charger(d: any): any
	local p = Boutique.nouveauProfil()
	if type(d) ~= "table" then
		return p
	end
	p["or"] = tonumber(d["or"]) or p["or"]
	p.gemmes = tonumber(d.gemmes) or p.gemmes
	for k, v in d.inventaire or {} do
		p.inventaire[k] = v
	end
	for k, v in d.recus or {} do
		p.recus[k] = v
	end
	return p
end

return Boutique
