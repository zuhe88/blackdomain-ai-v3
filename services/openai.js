const OpenAI = require("openai");

let openai = null;

if (process.env.OPENAI_API_KEY) {
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
          "你是 BLACKDOMAIN AI 體育分析引擎，只分析世界盃、MLB、NBA，不要分析百家樂、電子或539。回答要專業、簡潔，使用繁體中文。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  return response.choices[0].message.content;
}

module.exports = {
  askSportsAI,
};
