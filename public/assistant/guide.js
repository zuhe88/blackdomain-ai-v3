let device;
try { device = localStorage.getItem("blackdomain_assistant_device"); } catch {}
if (!device) {
  device = Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem("blackdomain_assistant_device", device); } catch {}
}
const loader = `https://blackdomain-ai-v3-production.up.railway.app/assistant/bookmarklet.js?v=20260907.03&device=${encodeURIComponent(device)}`;
const code = `javascript:(()=>{if(document.getElementById('blackdomain-floating-assistant')){document.getElementById('blackdomain-floating-assistant').remove();return}const s=document.createElement('script');s.src='${loader}&t='+Date.now();s.onerror=()=>alert('黑域 AI 助手載入失敗，請確認網路後重試');document.documentElement.appendChild(s)})()`;
const codeField = document.getElementById("code");
codeField.value = code;
async function copyText(button, value, success) {
  const status = button.nextElementSibling;
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = success;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    field.remove();
    button.focus();
    status.textContent = copied ? success : "無法自動複製，請長按下方文字手動複製。";
    if (!copied) {
      const manual = document.createElement("textarea");
      manual.value = value;
      manual.readOnly = true;
      manual.setAttribute("aria-label", "請手動複製的內容");
      status.replaceChildren(document.createTextNode(status.textContent), manual);
    }
  }
}
document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", () => {
  copyText(button, code, "已複製。接著依步驟 2 建立 Safari 書籤，再將程式貼到書籤的網址欄位。");
}));
document.getElementById("copy-page").addEventListener("click", event => {
  copyText(event.currentTarget, "https://blackdomain-ai-v3-production.up.railway.app/assistant/", "已複製教學網址，請貼到 Chrome 或 Safari 開啟。");
});
