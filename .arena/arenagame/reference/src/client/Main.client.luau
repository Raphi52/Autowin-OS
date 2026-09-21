-- Client : n'envoie que des intentions au serveur.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local intention = ReplicatedStorage:WaitForChild("Intention")

local function poser(index: number, x: number, y: number)
	intention:FireServer(index, x, y)
end

return poser
