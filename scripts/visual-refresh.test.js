const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { baccaratAnalysisFlex } = require('../ui/flex/baccarat');
const { firstAnalysis, nextAnalysis, calculateBet, getTianmenRequirements } = require('../modules/baccarat/ai');
const { currencyFor, parseCurrency } = require('../modules/baccarat/currency');
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
    const {html,data}=render({},'莊',compact);
    for(const text of ['莊','6,045','NT$ 345','剩餘本金','累計盈虧','16','18','38']) assert.ok(html.includes(text),text);
    assert.ok(!html.includes('NaN'));
    const legacy=JSON.parse(JSON.stringify(data).replaceAll('累計盈虧','累計模擬盈虧'));
    const legacyHtml=context.baccaratResultCard(context.walk(legacy.contents),[]);
    assert.ok(legacyHtml.includes('NT$ 345'));
    assert.ok(legacyHtml.includes('<span>累計盈虧</span>'));
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

test('TWD and MYR have independent chip sizes, five-stage limits and native settlement',()=>{
  for (const [currency, unit] of [['TWD',50],['MYR',10]]) {
    assert.equal(currencyFor(currency).minBet,unit);
    assert.equal(parseCurrency(currency),currency);
    const minimum=unit*57;
    assert.equal(getTianmenRequirements(minimum,currency).minBankroll,minimum);
    assert.equal(getTianmenRequirements(minimum-1,currency).sufficientBankroll,false);
    assert.equal(getTianmenRequirements(minimum,currency).requiredMaxBet,unit*31);
    const base={currency,mode:'天門',history:['莊','莊','莊'],capital:minimum,startBankroll:minimum,
      bankroll:minimum,maxBet:unit*31,results:{pass:0,fail:0,tie:0,observe:0},tianmenLevel:1};
    const first=firstAnalysis({...base,results:{...base.results}});
    assert.equal(first.bet,unit);
    assert.equal(first.session.lastBetMeta.baseBet,unit);
    const second=nextAnalysis(first.session,'閒');
    assert.equal(second.session.bankroll,minimum-unit);
    assert.equal(second.bet,unit*3);
    const winOutcome=second.prediction;
    const win=nextAnalysis(second.session,winOutcome);
    assert.equal(win.session.bankroll,minimum-unit+unit*3*(winOutcome==='莊'?0.95:1));
    const commission=firstAnalysis({...base,history:['莊','莊','莊'],results:{...base.results}});
    nextAnalysis(commission.session,'莊');
    assert.equal(commission.session.bankroll,minimum+unit*0.95);
    assert.equal(calculateBet({...base,maxBet:unit-1},'莊'),0);
    for(let i=0;i<20;i++) {
      const bet=calculateBet({...base,mode:'動態配注'},'莊');
      assert.equal(bet%unit,0);
      assert.ok(bet>=unit&&bet<=base.maxBet&&bet<=base.bankroll*0.2);
    }
    const paused=firstAnalysis({...base,bankroll:0,results:{...base.results}});
    assert.equal(paused.session.fundingAnalysisCount,1);
    nextAnalysis(paused.session,'和');
    assert.equal(paused.session.fundingAnalysisClosed,true);
    assert.equal(paused.session.bankroll,0);
  }
});

test('MYR and TWD amounts retain currency, decimals and profit signs on compact and full cards',()=>{
  for(const compact of [true,false]) {
    const {html}=render({currency:'MYR',bankroll:604.5,startBankroll:570},'莊',compact);
    assert.ok(html.includes('RM 604.5'));
    assert.ok(html.includes('RM 34.5'));
    assert.ok(!html.includes('NT$'));
    const negative=render({currency:'MYR',bankroll:310,startBankroll:570},'閒',compact).html;
    assert.ok(negative.includes('RM -260'));
    assert.ok(negative.includes('profit-negative'));
  }
});
test('home only offers resume for an active supported session',()=>{
  const start=source.indexOf('function renderHome(){');
  const end=source.indexOf('\n}',start)+2;
  const home=vm.createContext({view:{innerHTML:''},escapeHtml:context.escapeHtml,memberProfile:{},accessExpired:false,refreshOverview(){},accessAllowed:true,resumeBaccaratSession:false,resumeBaccaratPlatform:'DG',categoryOrder:['baccarat','atg','lottery','sports'],categories:Object.fromEntries(['baccarat','atg','lottery','sports'].map(key=>[key,{image:'/test.png',items:key==='baccarat'?[{id:'dg',command:'DG',name:'DG'}]:[]}]))});
  vm.runInContext(fs.readFileSync(require.resolve('../public/portal/components.js'),'utf8'),home);
  vm.runInContext(source.slice(start,end),home);
  home.renderHome();assert.ok(!home.view.innerHTML.includes('繼續 DG'));
  home.resumeBaccaratSession=true;home.renderHome();assert.ok(home.view.innerHTML.includes('繼續 DG'));assert.ok(home.view.innerHTML.includes('/portal/baccarat/dg/analyze'));
  home.categories.baccarat.items[0].disabled=true;home.renderHome();assert.ok(!home.view.innerHTML.includes('繼續 DG'));
});
