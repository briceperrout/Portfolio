// =====================================================================
//  LEXIQUE — les mots du site expliqués simplement. Chaque mot repéré
//  dans un texte devient un lien : vers la fiche du compte quand il y en
//  a une, sinon vers la fiche « Lexique ». Survoler le mot affiche sa
//  définition.
//  motifs : formes cherchées telles quelles (majuscules comprises) ;
//  une forme en minuscule est aussi cherchée avec une majuscule initiale.
// =====================================================================

import { echapper, echapperRegex } from "./utilitaires.js";

export const LEXIQUE = [
  // Comptes et placements (lien vers leur fiche)
  { mot: "Livret A", motifs: ["Livret A", "livret A"], fiche: "livret-a", def: "Livret d'épargne sans risque ni impôt, disponible à tout moment. 1,7 % par an, plafond 22 950 €." },
  { mot: "LDDS", motifs: ["LDDS"], fiche: "ldds", def: "Livret de développement durable et solidaire : mêmes règles et même taux que le Livret A, plafond 12 000 €." },
  { mot: "LEP", motifs: ["LEP"], fiche: "lep", def: "Livret d'épargne populaire : 2,5 % sans impôt, plafond 10 000 €, réservé aux revenus modestes." },
  { mot: "Livret Jeune", motifs: ["Livret Jeune", "livret jeune"], fiche: "livret-jeune", def: "Livret des 12-25 ans : sans risque ni impôt, plafond 1 600 €, taux jamais inférieur à celui du Livret A (souvent 2 à 4 %)." },
  { mot: "Livret bancaire fiscalisé", motifs: ["livret bancaire fiscalisé", "livret bancaire", "super livret"], fiche: "livret-bancaire", def: "Livret proposé librement par une banque (« super livret ») : sans risque, mais intérêts imposés à 31,4 %." },
  { mot: "PEL", motifs: ["PEL"], fiche: "pel", def: "Plan d'épargne logement : taux garanti pour un projet immobilier, mais un retrait le ferme." },
  { mot: "PEA", motifs: ["PEA"], fiche: "pea", def: "Plan d'épargne en actions : compte pour investir en bourse, sans impôt sur le revenu après 5 ans. Plafond 150 000 € de versements." },
  { mot: "Compte-titres (CTO)", motifs: ["compte-titres", "CTO"], fiche: "cto", def: "Compte de bourse sans plafond ni avantage fiscal : gains imposés à 31,4 %." },
  { mot: "Assurance-vie", motifs: ["assurance-vie"], fiche: "assurance-vie", def: "Contrat d'épargne qui mélange fonds en euros (sans risque) et unités de compte (bourse). Fiscalité allégée après 8 ans." },
  { mot: "PER", motifs: ["PER"], fiche: "per", def: "Plan d'épargne retraite : les versements baissent l'impôt aujourd'hui, l'argent est bloqué jusqu'à la retraite (sauf achat de la résidence principale)." },
  { mot: "SCPI", motifs: ["SCPI"], fiche: "scpi", def: "Société civile de placement immobilier : des parts d'immeubles loués (bureaux, commerces…) qui versent des loyers." },
  { mot: "Bitcoin", motifs: ["bitcoin"], fiche: "bitcoin", def: "Monnaie numérique très volatile : sa valeur peut doubler ou être divisée par deux en un an." },
  { mot: "Plateforme crypto", motifs: ["plateforme crypto", "Plateforme crypto"], fiche: "bitcoin", def: "Site ou appli agréé(e) pour acheter du bitcoin. Pratique pour acheter, mais on n'y laisse qu'une petite somme." },
  { mot: "Cold wallet", motifs: ["cold wallet", "portefeuille matériel"], fiche: "bitcoin", def: "Petit appareil (type clé USB) qui garde tes bitcoins hors ligne, à l'abri d'une faillite ou d'un piratage de la plateforme." },
  { mot: "Or physique", motifs: ["or physique"], fiche: "or", def: "Pièces ou lingots d'or que l'on possède réellement." },
  { mot: "Crédit immobilier", motifs: ["crédit immobilier", "taux de crédit"], fiche: "credit-immobilier", def: "Prêt pour acheter un logement. Taux moyen en octobre 2026 : 3,49 % (hors assurance)." },
  { mot: "Indivision", motifs: ["indivision"], def: "Situation où plusieurs personnes possèdent ensemble un même bien (souvent après un héritage), chacune pour une part." },
  { mot: "Garantie des dépôts", motifs: ["garantie des dépôts", "FGDR"], fiche: "risques", def: "Si une banque fait faillite, le FGDR rembourse jusqu'à 100 000 € par personne et par banque (Livret A, LDDS et LEP en plus)." },
  { mot: "FGAP", motifs: ["FGAP"], fiche: "risques", def: "Fonds de garantie des assurances de personnes : si un assureur fait faillite, jusqu'à 70 000 € par personne et par assureur sont garantis." },
  { mot: "Décumulation", motifs: ["Décumulation", "décumulation"], def: "La phase où l'on retire petit à petit son épargne pour se verser un revenu. L'ordre des comptes retirés change l'impôt payé." },
  { mot: "Retraite par capitalisation", motifs: ["retraite par capitalisation"], def: "Se constituer soi-même un capital pendant sa vie active, puis se verser un revenu en le vendant petit à petit à la retraite." },
  { mot: "Abondement", motifs: ["abondement"], fiche: "epargne-salariale", def: "Argent que ton employeur ajoute à tes versements sur un PEE ou un PER d'entreprise (par exemple 1 € ajouté pour 1 € versé). Sans impôt sur le revenu, seulement 9,7 % de CSG et CRDS." },
  { mot: "Épargne salariale", motifs: ["épargne salariale"], fiche: "epargne-salariale", def: "Les plans d'épargne proposés par l'employeur (PEE, PER d'entreprise), souvent avec de l'argent offert (abondement)." },
  { mot: "PEE", motifs: ["PEE", "plan d'épargne entreprise"], fiche: "epargne-salariale", def: "Plan d'épargne entreprise : placement proposé par l'employeur, bloqué 5 ans (sauf cas de déblocage), souvent avec abondement. Gains sans impôt sur le revenu." },
  { mot: "PER d'entreprise", motifs: ["PER d'entreprise", "PERECOL", "PERECO", "PERCO"], fiche: "epargne-salariale", def: "PER collectif proposé par l'employeur (ex-PERCO) : bloqué jusqu'à la retraite (sauf achat de la résidence principale), abondement jusqu'à 7 689,60 € par an, versements volontaires déductibles." },
  { mot: "Intéressement", motifs: ["intéressement"], fiche: "epargne-salariale", def: "Prime liée aux résultats de l'entreprise. Placée sur un PEE ou un PER d'entreprise, elle échappe à l'impôt sur le revenu (15 jours pour choisir)." },
  { mot: "Participation", motifs: ["participation"], fiche: "epargne-salariale", def: "Part des bénéfices redistribuée aux salariés, obligatoire dans les entreprises d'au moins 50 salariés. Placée sur un plan d'épargne salariale, elle échappe à l'impôt sur le revenu." },
  { mot: "FCPE", motifs: ["FCPE"], fiche: "epargne-salariale", def: "Fonds commun de placement d'entreprise : les fonds proposés dans un PEE ou un PER d'entreprise (actions, obligations, monétaire…)." },
  { mot: "Frais", motifs: ["frais de gestion", "frais sur versement", "frais d'entrée", "frais courants", "frais de souscription", "frais de garde", "frais de courtage", "frais d'arbitrage"], fiche: "frais", def: "Ce que prélèvent la banque, l'assureur ou le fonds. 1 % de frais en plus par an coûte environ 17 % du capital sur 30 ans : à vérifier avant toute ouverture." },
  { mot: "DCA", motifs: ["DCA"], def: "Investir un petit montant fixe à intervalles réguliers (chaque mois), plutôt que tout d'un coup : on lisse le prix d'achat." },
  { mot: "Résidence principale", motifs: ["résidence principale"], fiche: "residence", def: "Le logement où l'on habite la plupart de l'année." },

  // Mots de la bourse
  { mot: "ETF", motifs: ["ETF"], def: "Fonds coté en bourse qui copie un indice (par exemple les 500 plus grandes entreprises américaines). Un seul achat = des centaines d'entreprises, avec des frais très bas." },
  { mot: "S&P 500", motifs: ["S&P 500"], def: "Indice des 500 plus grandes entreprises américaines (Apple, Microsoft, Nvidia…)." },
  { mot: "STOXX Europe 600", motifs: ["STOXX Europe 600"], def: "Indice de 600 grandes et moyennes entreprises de 17 pays européens." },
  { mot: "Capitalisant", motifs: ["capitalisante", "capitalisant", "capitalisants"], def: "Se dit d'un ETF qui réinvestit lui-même les dividendes au lieu de les verser : pas d'impôt à payer chaque année." },
  { mot: "Fonds en euros", motifs: ["fonds en euros", "fonds euros"], def: "Partie sans risque d'une assurance-vie : le capital est garanti, le rendement est modeste (autour de 2,5 à 3,5 % par an)." },
  { mot: "Unités de compte (UC)", motifs: ["unités de compte"], def: "Partie investie en bourse (ou en immobilier) d'une assurance-vie : rendement plus élevé, mais la valeur peut baisser." },
  { mot: "Obligations", motifs: ["obligations"], def: "Prêts accordés à des États ou à des entreprises, qui versent des intérêts. Moins risqués que les actions." },
  { mot: "Volatilité", motifs: ["volatilité", "volatile"], def: "Ampleur des hausses et des baisses d'un placement. Plus elle est forte, plus la valeur peut varier d'une année à l'autre." },

  // Impôts
  { mot: "Flat tax", motifs: ["flat tax"], def: "Impôt forfaitaire de 31,4 % sur les gains des placements (12,8 % d'impôt + 18,6 % de prélèvements sociaux)." },
  { mot: "Prélèvements sociaux", motifs: ["prélèvements sociaux"], def: "Contributions sociales prélevées sur les gains des placements (18,6 % en 2026), même quand l'impôt sur le revenu est exonéré." },
  { mot: "TMI", motifs: ["TMI", "tranche marginale d'imposition", "tranche d'imposition"], def: "Tranche marginale d'imposition : le taux d'impôt payé sur la dernière part de tes revenus (0, 11, 30, 41 ou 45 %). Elle figure sur l'avis d'impôt." },
  { mot: "Taux marginal effectif", motifs: ["taux marginal effectif"], def: "Ce que coûte réellement le dernier euro de revenu, décote et quotient familial compris. Il peut dépasser ta tranche (zone de décote) ou être nul alors que ta tranche est à 11 %." },
  { mot: "Revenu fiscal de référence", motifs: ["revenu fiscal de référence"], def: "Montant inscrit sur l'avis d'impôt, proche des revenus annuels moins 10 %. Il sert à savoir si l'on a droit au LEP." },
  { mot: "Net après impôt", motifs: ["net après impôt", "net avant impôt", "net à payer", "salaire brut", "prélèvement à la source"], fiche: "net-impot", def: "Brut − cotisations sociales = net avant impôt (en gras sur la fiche de paie) ; net avant impôt − prélèvement à la source = net après impôt, ce qui arrive sur ton compte. Le site demande le net après impôt." },
  { mot: "Taux moyen d'imposition", motifs: ["taux moyen"], fiche: "net-impot", def: "Part de tes revenus réellement payée en impôt (c'est le taux du prélèvement à la source). Toujours plus bas que la tranche marginale (TMI)." },
  { mot: "Avis d'impôt", motifs: ["avis d'impôt"], def: "Document envoyé chaque été par les impôts (dans l'espace impots.gouv.fr) : revenu fiscal de référence, tranche, plafond PER…" },

  // Mots du plan
  { mot: "Épargne de sécurité", motifs: ["épargne de sécurité"], def: "Argent gardé sans risque et disponible tout de suite pour les imprévus (panne, perte d'emploi…), en général quelques mois de dépenses." },
  { mot: "Apport", motifs: ["apport"], def: "Argent personnel mis dans l'achat d'un logement, en plus du prêt. Les banques en demandent en général au moins 10 % du prix plus les frais." },
  { mot: "Rééquilibrage", motifs: ["rééquilibrage", "rééquilibrer"], def: "Remettre chaque compte au montant prévu par le plan, surtout en orientant l'épargne du mois vers les comptes en retard." },
  { mot: "Arbitrage", motifs: ["arbitrage", "arbitrer"], def: "Déplacer de l'argent d'un support à un autre à l'intérieur d'une assurance-vie, sans impôt." },
  { mot: "Plafond de versements", motifs: ["plafond de versements"], def: "Montant maximum que l'on peut verser sur un compte (les gains, eux, peuvent le dépasser)." },
  { mot: "TNS", motifs: ["TNS"], fiche: "independants", def: "Travailleur non salarié : indépendant ou gérant majoritaire de société. Cotisations sociales plus basses qu'un salarié (environ 45 % du net), mais protection moindre." },
  { mot: "IS", motifs: ["IS"], def: "Impôt sur les sociétés : payé par la société sur son bénéfice, 15 % jusqu'à 42 500 € puis 25 %. Les dividendes versés ensuite sont encore taxés." },
  { mot: "Madelin", motifs: ["Madelin", "154 bis"], fiche: "independants", def: "Régime (article 154 bis du CGI) qui permet à un indépendant de déduire de son revenu ses versements sur un PER ou une retraite complémentaire, dans une limite de plafond." },
  { mot: "Micro-entreprise", motifs: ["micro-entreprise", "micro-entrepreneur"], fiche: "independants", def: "Régime simplifié d'indépendant : cotisations en pourcentage du chiffre d'affaires, impôt calculé après un abattement forfaitaire (34 %, 50 % ou 71 % selon l'activité)." },
  { mot: "PTZ", motifs: ["PTZ", "prêt à taux zéro"], fiche: "ptz", def: "Prêt à taux zéro : prêt sans intérêts ni frais de dossier pour un premier achat, sous conditions de revenus, de zone et de type de logement." },
  { mot: "Point mort", motifs: ["point mort"], fiche: "acheter-louer", def: "Nombre d'années au bout desquelles acheter sa résidence principale devient plus rentable que louer et placer la différence." },
  { mot: "Relevé", motifs: ["relevé"], def: "Dans l'onglet Suivi : le montant de chaque compte à une date donnée, recopié depuis ta banque, pour comparer au plan." },
];


// Toutes les formes cherchées, des plus longues aux plus courtes
const FORMES = new Map();
for (const e of LEXIQUE) for (const m of e.motifs) {
  const variantes = [m];
  if (/^[a-zà-ÿ]/.test(m)) variantes.push(m[0].toUpperCase() + m.slice(1));
  for (const v of variantes) {
    // Le texte reçu est tantôt échappé (' → &#39;), tantôt un gabarit HTML littéral (apostrophe brute ; aucune apostrophe typographique dans les textes)
    for (const f of new Set([echapper(v), v])) FORMES.set(f, e);
  }
}
const MOTIF = new RegExp(`(?<![\\p{L}\\p{N}-])(${[...FORMES.keys()].sort((a, b) => b.length - a.length).map(echapperRegex).join("|")})(?![\\p{L}\\p{N}-])`, "gu");

// Transforme les mots du lexique d'un texte DÉJÀ ÉCHAPPÉ en liens. Un mot
// n'est lié qu'une fois par texte ; « exclure » évite de lier une fiche vers
// elle-même.
export function lierTermes(html, { exclure } = {}) {
  const deja = new Set();
  return html.replace(MOTIF, (m) => {
    const e = FORMES.get(m);
    const cible = e?.fiche ?? "lexique";
    if (!e || deja.has(e) || cible === exclure) return m;
    deja.add(e);
    return `<a class="terme" href="#fiche-${cible}" data-bulle="${echapper(`${e.mot} : ${e.def}`)}">${m}</a>`;
  });
}
