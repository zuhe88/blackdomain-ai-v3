# BLACKDOMAIN AI V3

BLACKDOMAIN AI V3 是 LINE Messaging API 專用的黑金風格 AI 互動系統。

## 可用指令

- 首頁：`黑域AI`、`首頁`、`開始`、`選單`
- 百家樂AI：`百家樂`、`百家樂AI`、`🤖 百家樂AI`
- 電子AI：`電子`、`電子AI`、`🎰 電子AI`
- 電子遊戲：`戰神賽特1`、`戰神賽特2`、`古神巴風特`
- 539AI：`539`、`539AI`、`📊 539AI`、`539預測`、`539今日`
- 體育AI：`體育`、`體育AI`、`⚽ 體育AI`、`MLB`、`NBA`、`世界盃`
- VIP：`VIP`、`VIP查詢`、`👑 VIP查詢`、`VIP會員`、`會員中心`
- 幸運盒：`幸運盒`、`Lucky Box`、`LUCKY BOX`、`抽獎`、`開盒`

## 本機測試

```bash
npm test
```

測試會使用模擬 LINE SDK 驗證所有主要指令、Flex Message、replyMessage、pushMessage、靜態圖片路由與圖片 URL fallback。

## Railway

啟動指令：

```bash
npm start
```

健康檢查：

```text
/health
```
