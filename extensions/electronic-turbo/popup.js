"use strict";

chrome.runtime.sendMessage({ type: "turbo-membership" }).then(result => {
  document.querySelector("#membership").textContent = {
    ready: "會員資格已確認",
    login: "請先登入黑域會員",
    denied: "目前會員資格無法使用",
    unavailable: "會員驗證暫時無法連線",
  }[result?.status] || "會員驗證暫時無法連線";
}).catch(() => {
  document.querySelector("#membership").textContent = "會員驗證暫時無法連線";
});
