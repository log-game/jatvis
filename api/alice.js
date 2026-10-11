let cachedToken = null;
let tokenExpiresAt = 0;

const SYSTEM_PROMPT = `
Ты Джарвис — интеллектуальный помощник в стиле ассистента
Тони Старка из фильмов Marvel.
Общайся на русском языке, спокойно, уверенно и вежливо.
Допускается лёгкая ирония.
Не начинай каждый ответ с приветствия.
Отвечай так, чтобы Алисе было удобно читать текст вслух.
Не используй Markdown, эмодзи и длинные списки.
По умолчанию отвечай кратко, в 1–4 предложениях.
Не утверждай, что выполнил действие, если ты его не выполнял.
`;

function aliceReply(event, text, endSession = false) {
  return {
    version: "1.0",
    session: event.session,
    response: {
      text: String(text).slice(0, 1024),
      end_session: endSession
    }
  };
}

async function getGigaChatToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;

  if (!authKey) {
    throw new Error("Не задан GIGACHAT_AUTH_KEY");
  }

  const response = await fetch(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${authKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: crypto.randomUUID()
      },
      body: new URLSearchParams({
        scope: process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS"
      }),
      signal: AbortSignal.timeout(1800)
    }
  );

  if (!response.ok) {
    throw new Error(`Ошибка авторизации GigaChat: ${response.status}`);
  }

  const data = await response.json();

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + 25 * 60 * 1000;

  return cachedToken;
}

async function askGigaChat(question) {
  const token = await getGigaChatToken();

  const response = await fetch(
    "https://api.giga.chat/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.GIGACHAT_MODEL || "GigaChat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question }
        ],
        temperature: 0.7,
        max_tokens: 160
      }),
      signal: AbortSignal.timeout(2500)
    }
  );

  if (!response.ok) {
    throw new Error(`Ошибка GigaChat: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(200).json({
      status: "ok",
      message: "Джарвис готов принимать запросы Алисы."
    });
  }

  const event = req.body;

  if (!event?.session || !event?.request) {
    return res.status(400).json({
      error: "Ожидается запрос от навыка Алисы."
    });
  }

  const type = event.request.type;

  if (type === "SessionStarted") {
    return res.status(200).json(
      aliceReply(event, "Джарвис к вашим услугам. Слушаю вас.")
    );
  }

  if (type !== "SimpleUtterance") {
    return res.status(200).json(
      aliceReply(event, "Слушаю вас. Чем могу помочь?")
    );
  }

  const question = (event.request.command || "").trim();

  if (!question) {
    return res.status(200).json(
      aliceReply(event, "Слушаю вас. Что требуется?")
    );
  }

  if (["выход", "завершить работу", "пока", "до свидания"]
    .includes(question.toLowerCase())) {
    return res.status(200).json(
      aliceReply(event, "До встречи. Буду готов продолжить.", true)
    );
  }

  try {
    const answer = await askGigaChat(question);

    return res.status(200).json(
      aliceReply(
        event,
        answer || "Не удалось получить ответ. Попробуйте ещё раз."
      )
    );
  } catch (error) {
    console.error("Jarvis error:", error.message);

    return res.status(200).json(
      aliceReply(
        event,
        "Не удалось получить ответ от нейросети. Попробуйте ещё раз."
      )
    );
  }
      }
