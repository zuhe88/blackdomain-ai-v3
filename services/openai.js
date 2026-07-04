let openai = null;

function loadOpenAI() {
  try {
    return require("openai");
  } catch (error) {
    return null;
  }
}

const OpenAI = loadOpenAI();

if (process.env.OPENAI_API_KEY && OpenAI) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

async function askSportsAI(prompt) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY 尚未設定");
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "你是 BLACKDOMAIN AI 體育賽前分析助理。請使用繁體中文，提供專業、保守、可讀的賽前分析。不要保證結果，不要顯示信心百分比，不要使用星星評分，不要提到 OpenAI 或資料來源。請輸出四到六點重點，每點一句。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.35,
  });

  return response.choices?.[0]?.message?.content || "";
}

module.exports = {
  askSportsAI,
};
