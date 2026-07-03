const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { COLORS, text } = require("./premium");

const DEFAULT_BASE_URL = "https://blackdomain-ai-v3-production.up.railway.app";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) return DEFAULT_BASE_URL;
  if (/^https:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");

  return `https://${raw.replace(/\/+$/, "")}`;
}

function publicBaseUrl() {
  return normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.RAILWAY_STATIC_URL ||
      DEFAULT_BASE_URL
  );
}

function imageUrl(fileName) {
  return `${publicBaseUrl()}/images/electronic/${fileName}?v=${imageVersion(fileName)}`;
}

function imageVersion(fileName) {
  try {
    const filePath = path.join(__dirname, "..", "..", "public", "images", "electronic", fileName);
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  } catch (error) {
    return "blackdomain-v3";
  }
}

function gameCard({ title, subtitle, image, actionText }) {
  return {
    type: "bubble",
    size: "kilo",
    styles: {
      hero: { backgroundColor: COLORS.black },
      body: { backgroundColor: COLORS.black },
      footer: { backgroundColor: COLORS.black },
    },
    hero: {
      type: "image",
      url: imageUrl(image),
      size: "full",
      aspectRatio: "8:9",
      aspectMode: "cover",
      action: {
        type: "message",
        text: actionText,
      },
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      action: {
        type: "message",
        text: actionText,
      },
      contents: [
        text(title, {
          size: "lg",
          weight: "bold",
          color: COLORS.gold,
          align: "center",
        }),
        text(subtitle, {
          size: "sm",
          color: COLORS.white,
          align: "center",
        }),
        {
          type: "separator",
          margin: "md",
          color: COLORS.goldDark,
        },
        text("點選卡片進入 AI 分析", {
          size: "xs",
          color: COLORS.gray,
          align: "center",
        }),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [
        text("BLACKDOMAIN ELECTRONIC AI", {
          size: "xxs",
          color: COLORS.muted,
          align: "center",
          wrap: false,
        }),
      ],
    },
  };
}

function electronicMenuFlex() {
  return {
    type: "flex",
    altText: "電子AI",
    contents: {
      type: "carousel",
      contents: [
        gameCard({
          title: "戰神賽特1",
          subtitle: "AI 推薦房・熱門排行・自選分析",
          image: "seth1.png",
          actionText: "戰神賽特1",
        }),
        gameCard({
          title: "戰神賽特2",
          subtitle: "AI 推薦房・熱門排行・自選分析",
          image: "seth2.png",
          actionText: "戰神賽特2",
        }),
        gameCard({
          title: "古神巴風特",
          subtitle: "AI 推薦房・熱門排行・自選分析",
          image: "baphomet.png",
          actionText: "古神巴風特",
        }),
      ],
    },
  };
}

module.exports = electronicMenuFlex;
