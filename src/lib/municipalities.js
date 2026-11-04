// Canonical event assignments and scanner email names for Cagayan.
export const MUNICIPALITIES = [
  ["Abulug", "abulug"], ["Alcala", "alcala"], ["Allacapan", "allacapan"],
  ["Amulung", "amulung"], ["Aparri", "aparri"], ["Baggao", "baggao"],
  ["Ballesteros", "ballesteros"], ["Buguey", "buguey"], ["Calayan", "calayan"],
  ["Camalaniugan", "camalaniugan"], ["Claveria", "claveria"], ["Enrile", "enrile"],
  ["Gattaran", "gattaran"], ["Gonzaga", "gonzaga"], ["Iguig", "iguig"],
  ["Lal-lo", "lallo"], ["Lasam", "lasam"], ["Pamplona", "pamplona"],
  ["Peñablanca", "penablanca"], ["Piat", "piat"], ["Rizal", "rizal"],
  ["Sanchez Mira", "sanchezmira"], ["Santa Ana", "santaana"],
  ["Santa Praxedes", "santapraxedes"], ["Santa Teresita", "santateresita"],
  ["Santo Niño", "santonino"], ["Solana", "solana"], ["Tuao", "tuao"],
  ["Tuguegarao City", "tuguegarao"],
].map(([name, slug]) => ({ name, email: `scanner@${slug}.peso` }));
