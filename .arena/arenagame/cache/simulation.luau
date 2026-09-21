-- SIMULATION CACHEE : 200 parties aleatoires (graines 1-200), deux joueurs qui jouent au hasard.
-- Une partie est « saine » si : aucune erreur, elle se TERMINE avant 400 s, l'elixir reste dans
-- [0, 10], les pv des tours ne remontent jamais et restent >= 0, les couronnes restent dans [0, 3].
-- Imprime « PARTIE ok|ko <graine> [motif] » puis « SIMU <saines>/<total> ».

local Partie = require("./shared/Partie")

local N = 200
local saines = 0

-- Hasard du SIMULATEUR (independant de la graine du jeu).
local function lcg(s: number)
	local etat = s
	return function(): number
		etat = (etat * 1103515245 + 12345) % 2147483648
		return etat / 2147483648
	end
end

local function une(graine: number): (boolean, string?)
	local r = lcg(graine * 7919)
	local p = Partie.nouvelle(graine)
	local pvAvant = {}
	local t = 0
	while t < 400 do
		for j = 1, 2 do
			if r() < 0.25 then
				local y = j == 1 and (1 + r() * 13) or (18 + r() * 13)
				p:jouer(j, 1 + math.floor(r() * 4), r() * 18, y)
			end
		end
		p:avancer(0.1)
		t += 0.1
		local e = p:etat()
		for j = 1, 2 do
			local J = e.joueurs[j]
			if J.elixir < -1e-6 or J.elixir > 10 + 1e-6 then
				return false, "elixir hors bornes : " .. J.elixir
			end
			if J.couronnes < 0 or J.couronnes > 3 then
				return false, "couronnes hors bornes"
			end
			for _, nom in { "roi", "gauche", "droite" } do
				local cle = j .. nom
				local pv = J.tours[nom].pv
				if pv < 0 then
					return false, "pv de tour negatifs"
				end
				if pvAvant[cle] and pv > pvAvant[cle] + 1e-6 then
					return false, "une tour regagne des pv"
				end
				pvAvant[cle] = pv
			end
		end
		if e.phase == "terminee" then
			return true
		end
	end
	return false, "partie non terminee a 400 s"
end

for g = 1, N do
	local ok, res, motif = pcall(une, g)
	if ok and res then
		saines += 1
		print("PARTIE ok " .. g)
	else
		print("PARTIE ko " .. g .. " : " .. tostring(ok and motif or res):gsub("\n", " "))
	end
end

print(string.format("SIMU %d/%d", saines, N))
