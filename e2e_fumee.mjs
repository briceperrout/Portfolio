// Test de fumée navigateur (Playwright). Lancement :
//   BASE_URL=http://localhost:8090 node e2e_fumee.mjs
// Variables : PLAYWRIGHT_MODULE (chemin du module), E2E_CHANNEL (ex. "chrome"), BASE_URL.
// Le nom ne commence pas par « test_ » : « node --test test_*.mjs » n'en dépend pas.

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE_URL || "http://localhost:8090").replace(/\/$/, "");
const NIVEAUX = ["debutant", "intermediaire", "avance"];
const echecs = [];
let verifications = 0;

const estApi = (url) => { try { return new URL(url).pathname.startsWith("/api/"); } catch { return false; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function verifier(cond, contexte, message) {
  verifications++;
  if (!cond) echecs.push(`[${contexte}] ${message}`);
}

async function nouvellePage(browser, niveau, contexte, viewport) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  await ctx.addInitScript((n) => { try { localStorage.setItem("niveau", JSON.stringify(n)); } catch {} }, niveau);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => echecs.push(`[${contexte}] erreur de page : ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (estApi(url) || /\/api\//.test(m.text())) return;
    if (/Failed to load resource/.test(m.text()) && !url) return; // sans URL : déjà couvert par les événements réseau
    echecs.push(`[${contexte}] console.error : ${m.text()}`);
  });
  page.on("response", (r) => { if (r.status() >= 400 && !estApi(r.url())) echecs.push(`[${contexte}] HTTP ${r.status()} ${r.url()}`); });
  page.on("requestfailed", (rq) => { if (!estApi(rq.url())) echecs.push(`[${contexte}] requête échouée ${rq.url()} (${rq.failure()?.errorText})`); });
  return { ctx, page };
}

async function onglets(page) {
  const ids = await page.$$eval('a[id^="lien-"]', (els) => els.filter((e) => e.offsetParent !== null).map((e) => ({ id: e.id, href: e.getAttribute("href") })));
  return ids;
}
// Vue associée à un lien : « lien-xxx » → « #vue-xxx » (convention de rendreVue)
const vueDe = (id) => `#vue-${id.slice(5)}`;

async function parcourir(page, niveau, ctx, mobile) {
  const liste = await onglets(page);
  verifier(liste.length >= 4, ctx, `au moins 4 onglets visibles (trouvés : ${liste.length})`);
  for (const { id } of liste) {
    await page.click(`#${id}`);
    await pause(400);
    const vue = vueDe(id);
    const visible = await page.isVisible(vue);
    verifier(visible, ctx, `${id} : la section ${vue} est visible`);
    if (visible && !mobile) {
      const n = (await page.innerText(vue)).trim().length;
      verifier(n > 200, ctx, `${id} : ${vue} contient du texte (${n} caractères, 200 attendus)`);
    }
    if (mobile) {
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      verifier(sw <= cw + 1, ctx, `${id} : pas de défilement horizontal (scrollWidth ${sw} > clientWidth ${cw})`);
    }
  }
}

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined });
try {
  for (const niveau of NIVEAUX) {
    const c = `niveau ${niveau}`;
    const { ctx, page } = await nouvellePage(browser, niveau, c);
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForSelector('a[id^="lien-"]', { state: "visible" });
    await pause(500);
    await parcourir(page, niveau, c, false);

    // Fiche pédagogique
    await page.goto(`${BASE}/#fiche-pea`, { waitUntil: "load" });
    await pause(500);
    const fiche = await page.isVisible("#vue-fiches") ? (await page.innerText("#vue-fiches")) : "";
    verifier(/PEA/.test(fiche) && fiche.length > 200, c, "#fiche-pea : la fiche s'affiche");

    // Mode discrétion
    await page.click("#lien-reequilibrage");
    await pause(400);
    await page.keyboard.press("Alt+H");
    await pause(500);
    const texte = await page.innerText("#vue-reequilibrage");
    const fuite = texte.match(/\d[\d\s  ]*\s?€/);
    verifier(!fuite, c, `discrétion : montant visible dans Rééquilibrage (« ${fuite?.[0]?.trim()} »)`);
    await page.keyboard.press("Alt+H");
    await pause(300);

    // Immobilier (niveau avancé)
    if (niveau === "avance") {
      await page.click("#lien-profil");
      await pause(400);
      const coche = page.locator("#p-rp");
      if (await coche.count() && !(await coche.isChecked())) await coche.check({ force: true }).catch(() => {});
      let dvf75 = null;
      const attente75 = page.waitForResponse((r) => /\/dvf\/75\.json$/.test(r.url()), { timeout: 15000 }).then((r) => { dvf75 = r.status(); }).catch(() => {});
      await page.locator("#projetRP-dep").scrollIntoViewIfNeeded();
      await page.selectOption("#projetRP-dep", "75");
      await page.fill("#projetRP-surface", "50");
      await attente75;
      await pause(800);
      const est = (await page.innerText("#est-projetRP")).trim();
      verifier(dvf75 === 200, c, `dvf/75.json a répondu ${dvf75}`);
      verifier(/\d/.test(est) && /€/.test(est), c, `estimation chiffrée pour 75 / 50 m² (obtenu : « ${est.slice(0, 120)} »)`);
      await page.selectOption("#projetRP-dep", "67");
      await pause(1200);
      const est67 = (await page.innerText("#est-projetRP")).trim();
      verifier(/Pas de prix DVF pour ce département/.test(est67), c, `département 67 : message attendu (obtenu : « ${est67.slice(0, 120)} »)`);
    }
    await ctx.close();
  }

  // Mobile
  {
    const c = "mobile 375x812 (débutant)";
    const { ctx, page } = await nouvellePage(browser, "debutant", c, { width: 375, height: 812 });
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForSelector('a[id^="lien-"]', { state: "attached" });
    await pause(500);
    await parcourir(page, "debutant", c, true);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\nTest de fumée : ${verifications} vérifications, ${echecs.length} échec(s).`);
if (echecs.length) {
  const uniques = [...new Set(echecs)];
  console.log(uniques.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log("OK");
