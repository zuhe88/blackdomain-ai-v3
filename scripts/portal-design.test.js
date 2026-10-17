const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const {portalProfile} = require("../services/portalProfile");
const context = vm.createContext({Intl, Date});
vm.runInContext(fs.readFileSync(require.resolve("../public/portal/components.js"),"utf8"),context);
const UI = context.PortalUI;

test("future, stale, incomplete and missing room data never become an updated source",()=>{
  const now=Date.parse("2026-10-17T08:00:00Z");
  const game={updatedAt:"2026-10-17T07:59:55Z",ready:true,freshDetailCount:3};
  assert.equal(UI.sourceSummary([game],now).label,"資料已更新");
  for(const sources of [undefined,[],[{...game,updatedAt:"2026-10-17T08:01:00Z"}],[{...game,updatedAt:"2026-10-17T07:50:00Z"}],[{...game,freshDetailCount:0}],[{...game,ready:false}],[game,{...game,freshDetailCount:0}]]) {
    assert.notEqual(UI.sourceSummary(sources,now).label,"資料已更新");
    assert.equal(UI.sourceSummary(sources,now).tone,"warning");
  }
});
test("member presentation follows server decision and never fabricates permanent membership",()=>{
  const denied=portalProfile({allowed:false,user:{account3A:"example",aiPermission:true}},null);
  assert.equal(denied.features.length,0);
  assert.equal(denied.accessType,"none");
  assert.equal(portalProfile({allowed:true,isAdmin:true},null).accessType,"admin");
  assert.equal(portalProfile({allowed:true,globalAccess:true},null).accessType,"global");
  assert.equal(portalProfile({allowed:true},null).accessType,"member");
  assert.equal(UI.expiry(portalProfile({allowed:true},null)),"暫無資料");
  const permanent=portalProfile({allowed:true,user:{account3A:"example",aiPermission:true,expiresAt:null}},null);
  assert.equal(UI.expiry(permanent),"永久有效");
  assert.equal(UI.date("2026-10-17T08:00:00Z").includes("16:00:00"),true);
});
test("account and data text are escaped before shared markup is rendered",()=>{
  const html=UI.member({account:'<img src=x onerror=alert(1)>',features:['<script>']},true,false);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
});
