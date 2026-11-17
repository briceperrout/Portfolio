// Séries annuelles historiques d'un épargnant français (1970–2025) : rendements et inflation en %, nominaux en FRF jusqu'en 1998 puis en EUR
// (FRF converti à 6,55957 F/€). Année du 31/12/N-1 au 31/12/N. 2026 est exclue : année incomplète.
// Données pures, sans logique ni DOM. Consommées par backtesterHistorique() (projection.js) et par le bloc « Rejouer l'histoire réelle » (app.js).
// Chaque entrée de `annees` : { annee, bourse, or, bitcoin (null avant 2011), scpi, prudent, securite, inflation }.
// Sources (références) :
//  - Taux de change BRI : https://stats.bis.org/api/v1/data/WS_XRU/A.FR.EUR.E?format=csv
//  - MSCI World Net : https://curvo.eu/backtest/en/market-index/msci-world?currency=usd ; API MSCI index 990100 (NETR, EUR) ; https://en.wikipedia.org/wiki/MSCI_World
//  - Or LBMA : https://sdbullion.com/gold-prices-1969 … /gold-prices-2025
//  - Bitcoin : https://curvo.eu/backtest/fingerprinted-data/bitcoin.ee731256.json ; https://www.statmuse.com/money/ask/bitcoin-price-year-2010
//  - SCPI : IEIF 1988–2013 (https://www.leblogpatrimoine.com/immobilier/scpi/scpi-les-chiffres-du-marche-a-connaitre-avant-dinvestir.html) ; ASPIM/IEIF 2014–2025
//    (https://place-des-epargnants.fr/observatoire/rendement-scpi/ ; https://www.aspim.fr/content/uploads/2025/11/CP-Bilan-2024.pdf) ; Friggit/IGEDD
//    (https://www.igedd.developpement-durable.gouv.fr/house-prices-in-france-property-a1117.html)
//  - Fonds euros : https://www.toutsurmesfinances.com/placements/assurance-vie-historique-des-taux-de-rendements-des-fonds-en-euros-depuis-2000.html ;
//    https://www.ramify.fr/assurance-vie/rendement ; https://www.moneyvox.fr/assurance-vie/actualites/108096/le-taux-moyen-reste-a-2-63-en-2025-comme-en-2024-selon-acpr
//  - Livret A : https://eco3min.fr/taux-livret-a-historique-dataset/ ; https://fr.wikipedia.org/wiki/Livret_A
//  - Inflation : https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/FRA.M.N.CPI.IX._T.N._Z (IPC INSEE, idbank 001759970)
export const HISTORIQUE = {
  debut: 1970, fin: 2025,
  sources: {
    bourse: "MSCI World Net Return (dividendes nets réinvestis) : USD converti en FRF/EUR aux taux de fin d'année BRI jusqu'en 2000 ; MSCI World Net EUR depuis 2001.",
    or: "Once d'or, dernier fixing LBMA en USD de l'année, converti en FRF/EUR aux taux de fin d'année BRI.",
    bitcoin: "Bitcoin en EUR, valeurs de fin d'année (série mensuelle Curvo) ; point de départ fin 2010 : 0,30 USD (Mt.Gox). Série inexistante avant 2011.",
    scpi: "SCPI d'immobilier d'entreprise : distribution + variation du prix de part. IEIF 1988–2013, ASPIM/IEIF 2014–2025, reconstitution Friggit avant 1988, recalée sur le réel mesuré depuis 1988.",
    prudent: "Fonds euros, net de frais de gestion et brut de prélèvements sociaux : France Assureurs puis ACPR depuis 2000 ; 1994–1999 agrégé Ramify ; avant 1994 estimé (TME).",
    securite: "Livret A, taux moyen annuel pondéré par la durée des paliers de taux (Banque de France).",
    inflation: "IPC INSEE, ensemble des ménages, glissement décembre/décembre (indice mensuel repris par l'OCDE).",
  },
  // Plages de données non mesurées (années estimées ou reconstituées), utilisées par le backtest pour compter les années estimées d'une période.
  estimations: {
    scpi: { de: 1970, a: 1987, libelle: "de SCPI reconstituées" },
    prudent: { de: 1970, a: 1993, libelle: "de fonds euros estimés" },
  },
  fiabilite: {
    scpi: "1970–1987 reconstituées puis recalées sur le rendement réel moyen mesuré depuis 1988 ; 2021–2022 variation de part estimée",
    prudent: "1970–1993 estimées à partir des emprunts d'État ; 1994–1999 source agrégée",
    bitcoin: "2011–2013 marché très peu liquide, 2011 estimé",
    bourse: "1970–1987 série Net rétropolée par MSCI",
  },
  // SCPI 1970–1987 : reconstitution (Friggit + distribution estimée 7 %) jugée optimiste, recalée par un coefficient unique.
  // Méthode : réel = (1+scpi)/(1+inflation)−1 ; μ_r = moyenne géométrique réelle 1970–1987 = 6,71 %/an ; μ_c = idem 1988–2025 (mesurée) = 4,11 %/an.
  // Chaque scpi 1970–1987 = (1+r)·(1+μ_c)/(1+μ_r)−1, soit un coefficient de 0,9756, arrondi à 0,1. 1988–2025 inchangées.
  annees: [
    { annee: 1970, bourse: -3.8, or: 5.4, bitcoin: null, scpi: 10.0, prudent: 7.0, securite: 4.1, inflation: 4.9 },
    { annee: 1971, bourse: 11.8, or: 10.3, bitcoin: null, scpi: 10.0, prudent: 7.4, securite: 4.2, inflation: 6.0 },
    { annee: 1972, bourse: 20.2, or: 46.0, bitcoin: null, scpi: 11.1, prudent: 7.7, securite: 4.2, inflation: 6.9 },
    { annee: 1973, bourse: -22.2, or: 58.8, bitcoin: null, scpi: 13.4, prudent: 8.0, securite: 4.2, inflation: 8.5 },
    { annee: 1974, bourse: -29.5, or: 57.2, bitcoin: null, scpi: 15.0, prudent: 8.6, securite: 6.3, inflation: 15.2 },
    { annee: 1975, bourse: 34.1, or: -24.1, bitcoin: null, scpi: 14.9, prudent: 8.9, securite: 7.5, inflation: 9.6 },
    { annee: 1976, bourse: 25.6, or: 6.2, bitcoin: null, scpi: 17.1, prudent: 9.3, securite: 6.5, inflation: 9.9 },
    { annee: 1977, bourse: -4.8, or: 16.0, bitcoin: null, scpi: 16.0, prudent: 8.8, securite: 6.5, inflation: 9.0 },
    { annee: 1978, bourse: 3.6, or: 21.8, bitcoin: null, scpi: 14.2, prudent: 9.6, securite: 6.5, inflation: 9.7 },
    { annee: 1979, bourse: 6.9, or: 123.4, bitcoin: null, scpi: 16.0, prudent: 9.9, securite: 6.5, inflation: 11.8 },
    { annee: 1980, bourse: 41.5, or: 26.7, bitcoin: null, scpi: 19.6, prudent: 10.8, securite: 7.3, inflation: 13.7 },
    { annee: 1981, bourse: 20.0, or: -14.5, bitcoin: null, scpi: 15.6, prudent: 12.0, securite: 7.7, inflation: 13.9 },
    { annee: 1982, bourse: 29.4, or: 32.1, bitcoin: null, scpi: 11.2, prudent: 13.1, securite: 8.5, inflation: 9.7 },
    { annee: 1983, bourse: 50.9, or: 5.4, bitcoin: null, scpi: 11.5, prudent: 13.9, securite: 8.1, inflation: 9.3 },
    { annee: 1984, bourse: 20.9, or: -6.7, bitcoin: null, scpi: 9.8, prudent: 12.0, securite: 7.1, inflation: 6.7 },
    { annee: 1985, bourse: 10.2, or: -16.9, bitcoin: null, scpi: 9.2, prudent: 11.1, securite: 6.2, inflation: 4.7 },
    { annee: 1986, bourse: 20.7, or: 1.7, bitcoin: null, scpi: 9.2, prudent: 10.5, securite: 5.1, inflation: 2.1 },
    { annee: 1987, bourse: -3.1, or: 3.8, bitcoin: null, scpi: 10.8, prudent: 9.3, securite: 4.5, inflation: 3.1 },
    { annee: 1988, bourse: 39.3, or: -4.8, bitcoin: null, scpi: 12.4, prudent: 9.1, securite: 4.5, inflation: 3.1 },
    { annee: 1989, bourse: 11.4, or: -6.6, bitcoin: null, scpi: 12.7, prudent: 8.6, securite: 4.5, inflation: 3.6 },
    { annee: 1990, bourse: -26.8, or: -14.0, bitcoin: null, scpi: 12.5, prudent: 8.2, securite: 4.5, inflation: 3.1 },
    { annee: 1991, bourse: 20.3, or: -8.1, bitcoin: null, scpi: 10.6, prudent: 8.2, securite: 4.5, inflation: 3.0 },
    { annee: 1992, bourse: 0.6, or: 0.0, bitcoin: null, scpi: 6.9, prudent: 8.3, securite: 4.5, inflation: 1.9 },
    { annee: 1993, bourse: 31.2, or: 25.6, bitcoin: null, scpi: 4.5, prudent: 8.2, securite: 4.5, inflation: 2.1 },
    { annee: 1994, bourse: -4.7, or: -11.2, bitcoin: null, scpi: -9.9, prudent: 6.9, securite: 4.5, inflation: 1.6 },
    { annee: 1995, bourse: 10.6, or: -7.3, bitcoin: null, scpi: -9.0, prudent: 5.9, securite: 4.5, inflation: 2.1 },
    { annee: 1996, bourse: 21.3, or: 2.1, bitcoin: null, scpi: -8.9, prudent: 5.8, securite: 3.7, inflation: 1.7 },
    { annee: 1997, bourse: 32.4, or: -10.5, bitcoin: null, scpi: -10.2, prudent: 5.7, securite: 3.5, inflation: 1.1 },
    { annee: 1998, bourse: 16.7, or: -6.7, bitcoin: null, scpi: 2.8, prudent: 5.6, securite: 3.2, inflation: 0.2 },
    { annee: 1999, bourse: 45.1, or: 17.3, bitcoin: null, scpi: 20.6, prudent: 5.2, securite: 2.7, inflation: 1.3 },
    { annee: 2000, bourse: -6.3, or: 1.4, bitcoin: null, scpi: 11.4, prudent: 5.3, securite: 2.6, inflation: 1.6 },
    { annee: 2001, bourse: -12.3, or: 7.1, bitcoin: null, scpi: 12.0, prudent: 5.3, securite: 3.0, inflation: 1.4 },
    { annee: 2002, bourse: -32.0, or: 4.2, bitcoin: null, scpi: 12.9, prudent: 4.8, securite: 3.0, inflation: 2.3 },
    { annee: 2003, bourse: 10.7, or: 1.1, bitcoin: null, scpi: 12.5, prudent: 4.5, securite: 2.7, inflation: 2.2 },
    { annee: 2004, bourse: 6.5, or: -2.7, bitcoin: null, scpi: 10.3, prudent: 4.4, securite: 2.2, inflation: 2.1 },
    { annee: 2005, bourse: 26.2, or: 35.2, bitcoin: null, scpi: 12.4, prudent: 4.2, securite: 2.1, inflation: 1.6 },
    { annee: 2006, bourse: 7.4, or: 11.0, bitcoin: null, scpi: 13.3, prudent: 4.1, securite: 2.4, inflation: 1.5 },
    { annee: 2007, bourse: -1.7, or: 17.7, bitcoin: null, scpi: 13.0, prudent: 4.1, securite: 2.9, inflation: 2.6 },
    { annee: 2008, bourse: -37.6, or: 9.4, bitcoin: null, scpi: 0.5, prudent: 4.0, securite: 3.7, inflation: 1.0 },
    { annee: 2009, bourse: 25.9, or: 23.3, bitcoin: null, scpi: 11.5, prudent: 3.6, securite: 1.9, inflation: 0.9 },
    { annee: 2010, bourse: 19.5, or: 37.7, bitcoin: null, scpi: 8.1, prudent: 3.4, securite: 1.5, inflation: 1.8 },
    { annee: 2011, bourse: -2.4, or: 15.3, bitcoin: 1476.6, scpi: 8.2, prudent: 3.0, securite: 2.1, inflation: 2.5 },
    { annee: 2012, bourse: 14.0, or: 3.6, bitcoin: 183.5, scpi: 5.0, prudent: 2.9, securite: 2.2, inflation: 1.3 },
    { annee: 2013, bourse: 21.2, or: -30.9, bitcoin: 5189.4, scpi: 5.8, prudent: 2.8, securite: 1.6, inflation: 0.7 },
    { annee: 2014, bourse: 19.5, or: 13.4, bitcoin: -50.2, scpi: 5.6, prudent: 2.5, securite: 1.1, inflation: 0.1 },
    { annee: 2015, bourse: 10.4, or: -1.2, bitcoin: 49.7, scpi: 6.4, prudent: 2.3, securite: 0.9, inflation: 0.2 },
    { annee: 2016, bourse: 10.7, or: 12.7, bitcoin: 131.6, scpi: 6.9, prudent: 1.9, securite: 0.8, inflation: 0.6 },
    { annee: 2017, bourse: 7.5, or: -1.7, bitcoin: 1162.5, scpi: 6.2, prudent: 1.8, securite: 0.8, inflation: 1.2 },
    { annee: 2018, bourse: -4.1, or: 3.5, bitcoin: -72.1, scpi: 5.2, prudent: 1.8, securite: 0.8, inflation: 1.6 },
    { annee: 2019, bourse: 30.0, or: 21.1, bitcoin: 97.8, scpi: 5.7, prudent: 1.5, securite: 0.8, inflation: 1.5 },
    { annee: 2020, bourse: 6.3, or: 13.7, bitcoin: 270.3, scpi: 5.3, prudent: 1.3, securite: 0.5, inflation: 0.0 },
    { annee: 2021, bourse: 31.1, or: 4.3, bitcoin: 72.7, scpi: 5.9, prudent: 1.3, securite: 0.5, inflation: 2.8 },
    { annee: 2022, bourse: -12.8, or: 5.7, bitcoin: -62.0, scpi: 5.2, prudent: 1.9, securite: 1.4, inflation: 5.9 },
    { annee: 2023, bourse: 19.6, or: 9.8, bitcoin: 146.8, scpi: -0.4, prudent: 2.6, securite: 2.9, inflation: 3.7 },
    { annee: 2024, bourse: 26.6, or: 34.6, bitcoin: 135.0, scpi: 0.2, prudent: 2.6, securite: 3.0, inflation: 1.3 },
    { annee: 2025, bourse: 6.8, or: 45.9, bitcoin: -17.2, scpi: 1.5, prudent: 2.6, securite: 2.2, inflation: 0.8 },
  ],
};
