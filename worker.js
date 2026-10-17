const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

async function telegram(env, method, data) {
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error("Telegram: " + r.status);
  return r.json();
}

async function bibleReference(input) {
  const match = input.trim().match(/^((?:[1-3]\s*)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s-]*?)\s+(\d{1,3}):(\d{1,3})$/);
  if (!match) return null;
  const [, book, chapter, verse] = match;
  const url = "https://api.midvash.com/v1/lsg/" +
    encodeURIComponent(book.trim()) + "/" + chapter + "/" + verse;
  const r = await fetch(url);
  if (!r.ok) return null;
  const json = await r.json();
  if (!json.data?.text) return null;
  return {
    reference: book.trim() + " " + chapter + ":" + verse,
    text: json.data.text,
    credit: json.meta?.copyright || "Louis Segond"
  };
}

async function answer(message, env) {
  if (message === "/start") {
    return "🙏 Bienvenue dans Parole de Vie IA !\n\n📖 Envoie une référence, par exemple Jean 3:16 ou Matthieu 6:33.\n\n🕊️ Tu peux aussi poser une question sur la Bible.";
  }
  if (!env.AI) return "La connexion Workers AI n'est pas encore configurée.";
  const verse = await bibleReference(message).catch(() => null);
  const source = verse
    ? "PASSAGE BIBLIQUE VERIFIE : " + verse.reference + "\n" + verse.text + "\nSource : " + verse.credit
    : "Aucun texte biblique n'a été vérifié pour cette demande.";

  const instructions = `Tu es Parole de Vie IA, assistant chrétien d'étude biblique.
Réponds en français, chaleureusement et avec profondeur.
Si un passage est fourni, cite fidèlement son texte et sa référence.
Présente : 1. Contexte biblique, 2. Explication du passage,
3. Symboles et sens spirituel, 4. Méditation profonde,
5. Application dans la vie, 6. Courte prière.
Pour une question générale, réponds avec prudence, en distinguant
le texte biblique des interprétations et des traditions.
N'invente jamais de citation ou de signification hébraïque ou grecque.
Ne prétends pas révéler des codes secrets comme des faits établis.
Si la référence n'a pas été vérifiée, indique-le clairement.
Ne donne pas un verset inventé.`;

  const result = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: "Demande : " + message + "\n\n" + source }
    ],
    max_tokens: 1100
  });
  return (result.response || "Je n'ai pas pu produire la méditation.").trim();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/webhook") {
      return new Response("Parole de Vie IA - service en ligne");
    }
    if (request.method !== "POST") {
      return new Response("Méthode non autorisée", { status: 405 });
    }
    if (!env.TELEGRAM_TOKEN || !env.WEBHOOK_SECRET) {
      return new Response("Configuration manquante", { status: 503 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Accès refusé", { status: 403 });
    }
    let update;
    try { update = await request.json(); }
    catch { return new Response("JSON invalide", { status: 400 }); }

    const msg = update.message;
    if (!msg?.text || !msg.chat?.id) return new Response("OK");
    ctx.waitUntil((async () => {
      try {
        await telegram(env, "sendChatAction", { chat_id: msg.chat.id, action: "typing" });
        const response = await answer(msg.text.slice(0, 1200), env);
        for (let i = 0; i < response.length; i += 3500) {
          await telegram(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: response.slice(i, i + 3500)
          });
        }
      } catch (error) {
        console.error("Bot error:", error.message);
        try {
          await telegram(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: "🙏 Le service est momentanément indisponible. Réessaie plus tard."
          });
        } catch {}
      }
    })());
    return new Response("OK");
  }
};
