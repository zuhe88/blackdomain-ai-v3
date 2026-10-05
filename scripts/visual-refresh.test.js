const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { baccaratAnalysisFlex } = require('../ui/flex/baccarat');
const source = fs.readFileSync(require.resolve('../public/portal/app.js'), 'utf8');
const context = vm.createContext({escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), actionMarkup: () => ''});
for (const name of ['walk','valueAfter','valueBefore','roomStatsFromTexts','baccaratPerformance','baccaratResultCard']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n', start);
  const body = name === 'baccaratResultCard' ? source.slice(start, source.indexOf('\n}', start) + 2) : source.slice(start,end);
  vm.runInContext(body, context);
}
const session = { platform:'DG',room:'RB03',mode:'天門',bankroll:6045,startBankroll:5700,maxBet:3100,results:{pass:1,fail:4,tie:1,observe:1} };
function render(overrides={}, prediction='莊', compact=true) {
  const data = baccaratAnalysisFlex({session:{...session,...overrides},prediction,bet:100,roomStats:{banker:16,player:18,tie:4,total:38},autoResult:true,compact});
  return {data, html:context.baccaratResultCard(context.walk(data.contents),[])};
}
test('compact and full LINE cards preserve actual values in web display',()=>{
  for (const compact of [true,false]) {
    const {html}=render({},'莊',compact);
    for(const text of ['莊','6,045','+345','剩餘模擬本金','累計模擬盈虧','16','18','38']) assert.ok(html.includes(text),text);
    assert.ok(!html.includes('NaN'));
  }
});
test('free mode and funding pause hide simulation figures without losing warning',()=>{
  for(const mode of [{mode:'自由配注'},{fundingPaused:true}]) {
    const {html}=render(mode);
    assert.ok(!html.includes('finance-grid'));
    if(mode.fundingPaused) assert.ok(html.includes('資金條件不足'));
  }
});
test('observation hides betting amount and negative profit stays negative',()=>{
  const {html}=render({bankroll:3100},'觀望');
  assert.ok(html.includes('-2,600')); assert.ok(html.includes('profit-negative'));
  assert.ok(!html.includes('建議下注')); assert.ok(html.includes('觀望'));
});
test('legacy compact cards and untrusted text are handled safely',()=>{
  const html=context.baccaratResultCard({texts:['DG RB03','下一局建議','閒','建議下注','100','本金 3100','獲利 -2600','本房牌路統計','莊','15','閒','18','和','4','總','37','同步提示：<img src=x onerror=alert(1)>']},[]);
  assert.ok(html.includes('3,100'));assert.ok(html.includes('-2,600'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});
