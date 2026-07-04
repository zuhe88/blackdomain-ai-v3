const crypto = require("crypto");
const express = require("express");
const { logError } = require("../utils/errorCodes");
const { handleLuckyBoxEvent } = require("../modules/luckyBox");

function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!channelSecret) {
    console.error("LINE_3A_CHANNEL_SECRET is not configured.");
    return false;
  }
  if (!signature) return false;
  const digest = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const signatureBuffer = Buffer.from(signature);
  const digestBuffer = Buffer.from(digest);
  if (signatureBuffer.length !== digestBuffer.length) return false;
  return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
}

function parseBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return { events: [] };
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    console.error("Invalid /webhook/3a JSON body:", error);
    return { events: [] };
  }
}

function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (!body) return Buffer.from("");
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (typeof body === "object") return Buffer.from(JSON.stringify(body), "utf8");
  return Buffer.from("");
}

function register3AWebhookRoutes(app) {
  const rawParser = typeof express.raw === "function" ? express.raw({ type: "*/*" }) : (req, res, next) => next();
  app.post("/webhook/3a", rawParser, async (req, res) => {
    res.status(200).send("OK");

    try {
      const rawBody = bodyToBuffer(req.body);
      const signature = req.get("x-line-signature") || "";
      const channelSecret = process.env.LINE_3A_CHANNEL_SECRET;

      if (rawBody.length > 0 && signature && !verifyLineSignature(rawBody, signature, channelSecret)) {
        console.error("Invalid LINE 3A webhook signature.");
        return;
      }

      const body = parseBody(rawBody);
      const events = Array.isArray(body.events) ? body.events : [];
      if (!events.length) return;

      for (const event of events) {
        try {
          console.log("[webhook/3a]", event.type, event.source?.userId || "no-user");
          await handleLuckyBoxEvent(event);
        } catch (error) {
          logError("E008", error);
        }
      }
    } catch (error) {
      console.error("Unhandled /webhook/3a error:", error);
    }
  });
}

module.exports = {
  register3AWebhookRoutes,
};
