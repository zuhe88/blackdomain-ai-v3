const REGISTRATION_URL = "https://atg888.3a1788.bet/";
const postback = (label, data, displayText) => ({ type: "postback", label, data, displayText });
function card(title, description, { tag = "MEMBER ACCESS", actions = [], detail } = {}) {
  return {
    type: "flex", altText: `ATG駭客｜${title}：${description}`,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", paddingAll: "22px", backgroundColor: "#191C24", spacing: "sm", contents: [
        { type: "text", text: "ATG / 駭客", color: "#FAFAFC", weight: "bold", size: "xl" },
        { type: "text", text: tag, color: "#FF4D65", size: "xxs", weight: "bold" },
      ] },
      body: { type: "box", layout: "vertical", backgroundColor: "#101218", paddingAll: "22px", spacing: "lg", contents: [
        { type: "box", layout: "vertical", height: "3px", width: "36px", backgroundColor: "#FF3655", contents: [] },
        { type: "text", text: title, wrap: true, weight: "bold", color: "#F8FAFF", size: "xl" },
        { type: "text", text: description, wrap: true, color: "#BCC3D1", size: "sm" },
        ...(detail ? [{ type: "box", layout: "vertical", backgroundColor: "#202430", cornerRadius: "8px", paddingAll: "14px", contents: [
          { type: "text", text: detail, color: "#F8FAFF", size: "sm", wrap: true },
        ] }] : []),
      ] },
      footer: { type: "box", layout: "vertical", backgroundColor: "#101218", paddingAll: "22px", paddingTop: "0px", spacing: "sm", contents: [
        ...actions.map((action, index) => ({ type: "button", style: "primary", color: index ? "#303746" : "#E82E4D", height: "md", action })),
        { type: "text", text: "ATG駭客 · 會員服務", size: "xxs", color: "#8992A3", align: "center", margin: "md" },
      ] },
    },
  };
}
const welcome = () => card("歡迎進入 ATG駭客", "我是 ATG駭客，負責把複雜的遊戲數據，整理成你看得懂的資訊。\n\n點擊下方按鈕，或回覆「AI」開始了解。", {
  tag: "WELCOME / 歡迎加入", actions: [{ type: "message", label: "開始了解 AI", text: "AI" }],
});
const choice = () => card("您有 3A 帳號嗎？", "請選擇目前的帳號狀態，我會引導您完成下一步。", {
  tag: "01 / 帳號確認", actions: [postback("有，我已有帳號", "atgx:has-account", "有"), postback("沒有，我要註冊", "atgx:no-account", "沒有")],
});
const existing = () => card("請傳送您的 3A 帳號", "看到後會第一時間協助您轉線。\n請直接在聊天室輸入帳號。", { tag: "02 / 提供帳號", detail: "僅限英文字母、數字或兩者組合。\n請勿提供密碼或驗證碼。" });
const registration = () => card("先完成註冊", "點擊下方按鈕前往註冊。\n完成後，回到這裡傳送您的 3A 帳號即可。", { tag: "02 / 建立帳號", actions: [{ type: "uri", label: "前往註冊", uri: REGISTRATION_URL }], detail: "只需提供帳號，不需要密碼。" });
const invalid = () => card("請確認帳號格式", "帳號只能包含英文字母或數字，不能有中文、空格或符號。\n\n請重新傳送您的 3A 帳號。", { tag: "02 / 重新輸入", detail: "例如：abc123、ABC 或 123456\n請勿提供密碼或驗證碼。" });
const received = (account) => card("帳號已收到", "您的資料已送出待確認，看到後會第一時間協助處理。", { tag: "03 / 等待確認", detail: `3A 帳號：${account}\n目前尚未完成轉線或開通。` });
module.exports = { welcome, choice, existing, registration, invalid, received, REGISTRATION_URL };
