// POST /api/request — Richiedi: verifica Turnstile, ricalcola il prezzo, crea l'ordine WooCommerce
// (SPEC §11, §12.7). SEGNAPOSTO: risponde 501. I segreti arrivano dalle variabili di Cloudflare
// (nomi in .dev.vars.example), mai dal repo.
export async function onRequestPost(): Promise<Response> {
  return Response.json({ error: 'not_implemented' }, { status: 501 });
}
