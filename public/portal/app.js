const view=document.querySelector("#view");
const connection=document.querySelector("#connection");
const loading=document.querySelector("#loading");
const toasts=document.querySelector("#toasts");

const categories={
  baccarat:{name:"百家樂",subtitle:"AI 牌路分析",image:"/images/electronic/dg.png",items:[
    {id:"dg",name:"DG",subtitle:"DG 百家樂 AI",image:"/images/electronic/dg.png",command:"DG"},
    {id:"mt",name:"MT",subtitle:"MT 百家樂 AI",image:"/images/electronic/mt.png",command:"MT"},
  ]},
  atg:{name:"ATG",subtitle:"AI 電子選房",image:"/images/electronic/seth2-hd.webp",items:[
    {id:"set1",name:"賽特1",fullName:"戰神賽特1",subtitle:"AI 智能選房",image:"/images/electronic/seth1-hd.webp",command:"戰神賽特1"},
    {id:"set2",name:"賽特2",fullName:"戰神賽特2",subtitle:"AI 智能選房",image:"/images/electronic/seth2-hd.webp",command:"戰神賽特2"},
    {id:"baphomet",name:"古神",fullName:"古神巴風特",subtitle:"AI 智能選房",image:"/images/electronic/baphomet-hd.webp",command:"古神巴風特"},
    {id:"tiger",name:"虎小妹",subtitle:"AI 智能選房",image:"/images/electronic/tiger-girl-hd.webp",command:"虎小妹"},
    {id:"red3",name:"赤三國",subtitle:"AI 智能選房",image:"/images/electronic/red-three-kingdoms-hd.webp",command:"赤三國"},
  ]},
  lottery:{name:"彩票",subtitle:"AI 彩票預測",image:"/images/electronic/mb-marble-hd.webp",items:[
    {id:"horse",name:"ATG 賽馬",subtitle:"AI 賽馬預測",image:"/images/electronic/atg-horse-hd.webp",command:"ATG賽馬"},
    {id:"mb",name:"MB 彈珠",subtitle:"AI 彈珠預測",image:"/images/electronic/mb-marble-hd.webp",command:"MB彈珠"},
    {id:"539",name:"今彩 539",subtitle:"AI 號碼分析",image:"/images/electronic/lottery539-hd.webp",command:"539"},
  ]},
  sports:{name:"體育",subtitle:"AI 賽事分析",image:"/images/electronic/mlb.png",items:[
    {id:"mlb",name:"MLB",subtitle:"美國職棒分析",image:"/images/electronic/mlb.png",command:"MLB"},
    {id:"nba",name:"NBA",subtitle:"美國職籃分析",image:"/images/electronic/nba.png",command:"NBA"},
    {id:"cpbl",name:"CPBL",subtitle:"中華職棒分析",image:"/images/electronic/cpbl.png",command:"CPBL"},
  ]},
};
const categoryOrder=["baccarat","atg","lottery","sports"];
let authenticated=false;
let currentPath="/portal/";
let activeOperation=null;

function escapeHtml(value){const element=document.createElement("div");element.textContent=String(value??"");return element.innerHTML;}
function normalizePath(pathname){const path=String(pathname||"").replace(/\/+$/,"");return path.startsWith("/portal")?path||"/portal":"/portal";}
function pathParts(pathname=location.pathname){return normalizePath(pathname).split("/").filter(Boolean).slice(1);}
function setConnection(state,text){connection.dataset.state=state;connection.querySelector("span").textContent=text;}
function toast(title,detail){const item=document.createElement("div");item.className="toast";item.innerHTML=`<b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span>`;toasts.append(item);setTimeout(()=>item.remove(),4000);}
function navigate(path,{replace=false}={}){const normalized=normalizePath(path);if(replace)history.replaceState({},"",normalized);else history.pushState({},"",normalized);currentPath=normalized;activeOperation=null;renderRoute();}
function backTo(path){navigate(path);}
function pageHeader(title,subtitle,backPath){return `<div class="page-heading">${backPath?`<button class="back-button" data-go="${backPath}">← 返回</button>`:"<p class=\"eyebrow\">BLACKDOMAIN AI</p>"}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>`;}
function card(item,path){return `<button class="selection-card" data-go="${path}"><div class="image-frame"><img src="${item.image}" alt="${escapeHtml(item.name)}"></div><div class="selection-copy"><div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.subtitle)}</p></div><span>進入 →</span></div></button>`;}
function renderHome(){view.innerHTML=`<section class="screen home-screen">${pageHeader("選擇分析項目","請選擇你要使用的 AI 分析類型")}<div class="category-grid">${categoryOrder.map(key=>card(categories[key],`/portal/${key}`)).join("")}</div></section>`;}
function renderCategory(categoryKey){const category=categories[categoryKey];if(!category)return navigate("/portal/",{replace:true});view.innerHTML=`<section class="screen">${pageHeader(`${category.name} AI`,`選擇要進入的項目`,"/portal/")}<div class="selection-grid">${category.items.map(item=>card(item,`/portal/${categoryKey}/${item.id}`)).join("")}</div></section>`;}
function actionButton(label,command,primary=true){return `<button class="operation-button${primary?" primary":""}" data-command="${escapeHtml(command)}">${escapeHtml(label)}<span>→</span></button>`;}
function renderGame(categoryKey,itemId){const category=categories[categoryKey];const item=category?.items.find(entry=>entry.id===itemId);if(!item)return navigate(`/portal/${categoryKey}`,{replace:true});activeOperation={categoryKey,item};let actions="";if(categoryKey==="atg")actions=`${actionButton("AI 推薦房","AI推薦房")}<button class="operation-button" data-custom-room>自選房分析<span>→</span></button>`;else if(categoryKey!=="baccarat")actions=actionButton(`開始${item.name}分析`,item.command);view.innerHTML=`<section class="screen operation-screen">${pageHeader(item.fullName||item.name,item.subtitle,`/portal/${categoryKey}`)}<article class="game-identity"><div class="game-image"><img src="${item.image}" alt="${escapeHtml(item.name)}"></div><div><p>SELECTED MODULE</p><h2>${escapeHtml(item.fullName||item.name)}</h2><span>${escapeHtml(item.subtitle)}</span></div></article>${actions?`<div class="operation-panel"><h2>選擇操作</h2><p>選擇後將進入即時 AI 分析</p><div class="operation-actions">${actions}</div><div id="customRoom"></div></div>`:""}<div id="result"></div></section>`;if(categoryKey==="baccarat")send(item.command,{showBusy:true,silent:false});else if(categoryKey==="atg")send(item.command,{showBusy:false,silent:true});}
function renderRoute(){if(!authenticated)return renderLogin();const [categoryKey,itemId]=pathParts();if(!categoryKey)return renderHome();if(!itemId)return renderCategory(categoryKey);renderGame(categoryKey,itemId);requestAnimationFrame(()=>{view.focus({preventScroll:true});scrollTo({top:0,behavior:"instant"});});}
function renderLogin(){view.innerHTML=`<section class="screen login-screen"><div class="brand-mark large">AI</div><p class="eyebrow">SECURE MEMBER ACCESS</p><h1>登入黑域AI</h1><p>請回到黑域AI LINE 官方帳號，輸入「網站登入」並點擊新的安全連結。</p></section>`;setConnection("offline","尚未登入");}
function walk(node,out={texts:[],actions:[],images:[]}){if(!node)return out;if(Array.isArray(node)){node.forEach(value=>walk(value,out));return out;}if(typeof node!=="object")return out;if(node.type==="text"&&node.text)out.texts.push(node.text);if(node.type==="image"&&node.url)out.images.push(node.url);if(node.action){if(node.action.type==="message")out.actions.push({label:node.action.label||node.action.text,text:node.action.text});if(node.action.type==="uri")out.actions.push({label:node.action.label||"開啟連結",uri:node.action.uri});}for(const key of ["contents","body","hero","footer"])walk(node[key],out);return out;}
function resultCard(message){const data=message.type==="text"?{texts:[message.text],actions:[],images:[]}:walk(message.contents);const texts=[...new Set(data.texts.map(String).map(text=>text.trim()).filter(text=>text&&!/^BLACKDOMAIN/i.test(text)))];const title=message.altText||texts.shift()||"AI 分析結果";const image=data.images[0]?`<div class="result-image"><img src="${escapeHtml(data.images[0])}" alt=""></div>`:"";const rows=texts.map((text,index)=>`<div class="result-row${index===0?" important":""}"><span>${index===0?"AI 結果":"分析資料"}</span><strong>${escapeHtml(text)}</strong></div>`).join("");const actions=[...new Map(data.actions.filter(action=>action.text||action.uri).map(action=>[action.text||action.uri,action])).values()].slice(0,4);return `<article class="result-card">${image}<div class="result-head"><div><p>AI ANALYSIS COMPLETE</p><h2>${escapeHtml(title)}</h2></div><span class="ready">已同步</span></div><div class="result-data">${rows||'<div class="result-row"><span>資料狀態</span><strong>分析完成</strong></div>'}</div>${actions.length?`<div class="result-actions">${actions.map((action,index)=>action.uri?`<a class="operation-button${index===0?" primary":""}" href="${escapeHtml(action.uri)}">${escapeHtml(action.label)}</a>`:`<button class="operation-button${index===0?" primary":""}" data-command="${escapeHtml(action.text)}">${escapeHtml(action.label)}</button>`).join("")}</div>`:""}</article>`;}
function renderResults(messages){const target=document.querySelector("#result");if(!target)return;const list=Array.isArray(messages)?messages:[messages];target.innerHTML=`<section class="result-view"><div class="result-view-heading"><h2>分析結果</h2><p>本次最新資料</p></div>${list.map(resultCard).join("")}</section>`;target.scrollIntoView({behavior:"smooth",block:"start"});}
async function send(text,{showBusy=true,silent=false}={}){if(!text)return;if(showBusy)loading.hidden=false;try{const response=await fetch("/api/web/command",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});if(response.status===401){authenticated=false;renderLogin();return;}if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();if(!silent&&data.messages?.length)renderResults(data.messages);else if(!silent)toast("等待最新資料","資料完成後會自動顯示在目前頁面");}catch(error){console.error("Portal command failed",error);if(!silent)toast("分析失敗","請稍後重新嘗試");}finally{if(showBusy)loading.hidden=true;}}
document.addEventListener("click",event=>{const route=event.target.closest("[data-go]");if(route){event.preventDefault();navigate(route.dataset.go);return;}if(event.target.closest("[data-custom-room]")){event.preventDefault();send("自選分析",{showBusy:false,silent:true});const target=document.querySelector("#customRoom");target.innerHTML='<form class="room-form" id="roomForm"><label for="roomNumber">ROOM NUMBER</label><div><input id="roomNumber" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="輸入房號" required><button type="submit">開始分析</button></div></form>';target.querySelector("input").focus();return;}const command=event.target.closest("[data-command]");if(command){event.preventDefault();send(command.dataset.command);}});
document.addEventListener("submit",event=>{if(event.target.id!=="roomForm")return;event.preventDefault();const value=event.target.querySelector("input").value.trim();if(!/^\d+$/.test(value)){toast("房號格式錯誤","請輸入數字房號");return;}send(value);});
addEventListener("popstate",()=>{currentPath=normalizePath(location.pathname);activeOperation=null;renderRoute();});
fetch("/api/web/me").then(response=>response.json()).then(value=>{authenticated=Boolean(value.authenticated);currentPath=normalizePath(location.pathname);renderRoute();if(!authenticated)return;const events=new EventSource("/api/web/events");events.addEventListener("ready",()=>setConnection("online","即時連線"));events.addEventListener("message",event=>{try{if(activeOperation)renderResults(JSON.parse(event.data));}catch(error){console.error("Portal event parse failed",error);}});events.onerror=()=>setConnection("connecting","重新連線");}).catch(error=>{console.error("Portal initialization failed",error);authenticated=false;renderLogin();});
