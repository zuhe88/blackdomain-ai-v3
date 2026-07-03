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
    throw new Error("OPENAI_API_KEY 未設定");
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "你是 BLACKDOMAIN AI 體育賽前分析助理。請使用繁體中文，根據提供的官方賽程、戰績、近期狀態與盤口方向做賽前分析。不得保證結果，不得提及投注保證，不得輸出英文隊名。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.4,
  });

  return response.choices?.[0]?.message?.content || "";
}

module.exports = {
  askSportsAI,
};
