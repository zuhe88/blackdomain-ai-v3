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

async function askLottery539AI({ targetDate, history }) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY 尚未設定");
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "你是 BLACKDOMAIN AI 今彩539資料分析助理。只能根據使用者提供的歷史開獎資料分析，不可自行編造最新資料。請使用繁體中文。請輸出 JSON，不要 markdown，不要保證中獎，不要提勝率。JSON 格式必須為 {\"prediction\":[\"01\"],\"hot\":[\"01\"],\"cold\":[\"01\"],\"summary\":\"文字\"}，每組最多5個號碼，號碼範圍01到39，同組不可重複。",
      },
      {
        role: "user",
        content: JSON.stringify({
          targetDate,
          history,
          instruction: "請分析近期頻率、遺漏期數與分布，產生 AI預測、熱號、冷號。",
        }),
      },
    ],
    temperature: 0.2,
  });

  return response.choices?.[0]?.message?.content || "";
}

module.exports = {
  askSportsAI,
  askLottery539AI,
};
