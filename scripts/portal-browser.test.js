/* Isolated UI regression server. No production credentials, data or writes. */
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const express=require("express");
const {chromium}=require("playwright-core");
const {baccaratRoomFlex,baccaratPromptFlex,baccaratAnalysisFlex}=require("../ui/flex/baccarat");
const {currencyQuickReply,modeQuickReply}=require("../modules/baccarat/quickReply");
const {registerImageRoutes}=require("../routes/images");
const root=path.join(__dirname,"..");
function flex(title,texts,actions=[]){return {type:"flex",altText:title,contents:{type:"bubble",body:{type:"box",layout:"vertical",contents:texts.map(text=>({type:"text",text}))}},quickReply:{items:actions.map(text=>({type:"action",action:{type:"message",label:text,text}}))}};}

test("portal at six widths: routes, truthful empty states, navigation, inputs, errors and reduced motion",{timeout:180000},async()=>{
  const app=express();app.use(express.json());
  const state={authenticated:true,allowed:true,expired:false,failMe:false,failData:false,commands:[],amount:null,prediction:'觀望',modeOverride:null};
  let accessCalls=0;
  app.get('/api/web/me',(_req,res)=>{accessCalls++;if(state.failMe)return res.status(503).json({error:"測試連線失敗"});res.json({authenticated:state.authenticated,accessAllowed:state.allowed,accessExpired:state.expired,accessExpiresAt:null,isAdmin:false,mtEntryEnabled:false,allElectronicGamesEnabled:true,memberProfile:{account:null,accessType:"member",expiresAt:null,features:state.allowed?["百家樂分析","電子遊戲分析","彩票分析","體育數據"]:[]},messages:[]});});
  app.get('/health',(_req,res)=>res.json({ok:true}));
  app.get('/api/electronic/status',(_req,res)=>state.failData?res.status(503).json({error:"測試資料讀取失敗"}):res.json({games:[]}));
  app.get('/api/web/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write('event: ready\ndata: {}\n\n');req.on('close',()=>res.end());});
  app.post('/api/web/stop',(_req,res)=>res.json({ok:true}));
  app.post('/api/web/command',(req,res)=>{
    const value=req.body.text;state.commands.push(value);let messages=[];
    if(value==='DG')messages=[baccaratRoomFlex('DG',['RB01','RB02','RB03'])];
    else if(value==='RB01')messages=[baccaratPromptFlex({title:'請選擇幣別',lines:['台幣 TWD：最低下注 NT$ 50','令吉 MYR：最低下注 RM 10'],quickReply:currencyQuickReply()})];
    else if(['台幣 TWD','令吉 MYR'].includes(value)){state.currency=value.includes('MYR')?'MYR':'TWD';messages=[baccaratPromptFlex({title:'請選擇分析模式',lines:[`使用幣別：${value}`],quickReply:modeQuickReply()})];}
    else if(['AI配注','天門'].includes(value)){state.mode=value;state.inputStep='capital';messages=[baccaratPromptFlex({title:'請輸入本金',lines:[`使用幣別：${state.currency}`]})];}
    else if(/^\d+$/.test(value)&&value!=='539'){
      if(state.inputStep==='capital'){state.amount=value;state.inputStep='maxBet';messages=[baccaratPromptFlex({title:'請輸入單注上限',lines:[`使用幣別：${state.currency}`]})];}
      else messages=[baccaratAnalysisFlex({session:{currency:state.currency,platform:'DG',room:'RB01',mode:state.modeOverride||state.mode,bankroll:Number(state.amount),startBankroll:Number(state.amount),maxBet:Number(value),results:{pass:3,fail:2,tie:1,observe:2}},prediction:state.prediction,bet:state.prediction==='觀望'?0:state.currency==='MYR'?10:50,roomStats:{banker:18,player:11,tie:2,total:31},notice:'本機測試，非即時資料'})];
    }
    else if(value==='AI推薦房')messages=[flex('房間數據整理中',['戰神賽特2','房間數據整理中'])];
    else if(value==='取消推薦')messages=[flex('已取消推薦',['戰神賽特2','已取消推薦'])];
    else if(value==='VIP')messages=[flex('VIP中心',['VIP狀態','本機版面測試','LINE名稱','暫無資料','3A帳號','暫無資料','AI權限','百家樂AI / ATG AI / 彩票AI / 體育AI','到期時間','暫無資料','剩餘時間','暫無資料','最後更新時間','暫無資料'])];
    else if(value==='539')messages=[flex('539AI',['AI預測','暫無資料','預測日期','暫無資料','熱號','暫無資料','冷號','暫無資料'])];
    else if(['NBA','MLB','CPBL'].includes(value))messages=[flex(value+' 賽事資料',[value,'資料狀態','暫無資料','開賽時間','暫無資料']),flex(value+' 賽事資料',[value,'資料狀態','暫無資料'])];
    res.json({messages});
  });
  registerImageRoutes(app);
  app.use('/portal',express.static(path.join(root,'public/portal')));
  app.get('/portal/*',(_req,res)=>res.sendFile(path.join(root,'public/portal/index.html')));
  app.get('/',(_req,res)=>res.sendFile(path.join(root,'public/index.html')));
  app.use('/assistant',express.static(path.join(root,'public/assistant')));
  app.use(express.static(path.join(root,'public')));
  const server=await new Promise(resolve=>{const handle=app.listen(0,'127.0.0.1',()=>resolve(handle));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const executablePath=process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({executablePath,headless:true});
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Asia/Taipei'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const capture=process.env.PORTAL_CAPTURE_DIR;
  if(capture)fs.mkdirSync(capture,{recursive:true});
  async function open(route){await page.goto(base+route);await page.locator('#view h1').first().waitFor();}
  async function fit(label){const sizes=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(sizes.width<=sizes.viewport,`${label} overflows: ${JSON.stringify(sizes)}`);}
  async function screenshot(name){if(!capture)return;await page.evaluate(()=>{window.scrollTo({top:0,behavior:'instant'});const marker=document.createElement('div');marker.id='test-marker';marker.textContent='本機版面測試・非即時分析資料';marker.style.cssText='position:fixed;bottom:76px;right:12px;z-index:999;background:#253247;color:#f1f5f9;border:1px solid #94a3b8;padding:5px 10px;font:12px system-ui;border-radius:6px';document.body.append(marker);});await page.screenshot({path:path.join(capture,name+'.png'),fullPage:true,animations:'disabled'});if(name.startsWith('baccarat-')){await page.locator('.baccarat-result-card').screenshot({path:path.join(capture,name+'-panel.png'),animations:'disabled'});await page.locator('.baccarat-decision').screenshot({path:path.join(capture,name+'-decision.png'),animations:'disabled'});}if(name.startsWith('home-'))await page.screenshot({path:path.join(capture,name+'-viewport.png'),fullPage:false,animations:'disabled'});await page.locator('#test-marker').evaluate(node=>node.remove());}
  try{
    for(const width of [375,390,430,768,1024,1440]){
      state.prediction=[390,430].includes(width)?'閒':width===1440?'莊':'觀望';
      state.modeOverride=width===430?'自由配注':null;
      await page.setViewportSize({width,height:900});
      for(const route of ['/portal/','/portal/baccarat','/portal/atg','/portal/lottery','/portal/sports','/portal/settings','/portal/more','/portal/vip/status']){
        await open(route);await fit(`${width} ${route}`);
        if(route==='/portal/'){
          await page.locator('#overviewService strong').filter({hasText:'服務可連線'}).waitFor();
          assert.equal(await page.locator('#overviewData strong').innerText(),'暫無資料');
          assert.equal(await page.locator('.v4-hero h1').innerText(),'黑域AI');
          const body=await page.locator('body').innerText();assert.ok(!/BLACKDOMAIN|MEMBERSHIP|SECURE MEMBER/.test(body));
          assert.equal(await page.locator('.desktop-sidebar').isVisible(),width>900);
          assert.equal(await page.locator('#mobileDock').isVisible(),width<=900);
          for(const category of ['baccarat','atg','lottery','sports']){
            const covers=page.locator(`[data-feature="${category}"] .feature-game-stack img`);
            assert.ok(await covers.count()>=2,`${category} has no image stack`);
            await covers.evaluateAll(async nodes=>{await Promise.all(nodes.map(image=>image.decode()));});
          }
          if(width===1440){
            const initial=await page.locator('.ring-inner').evaluate(node=>getComputedStyle(node).transform);
            await page.waitForFunction(before=>getComputedStyle(document.querySelector('.ring-inner')).transform!==before,initial);
            await page.getByRole('button',{name:'暫停核心動畫',exact:true}).click();
            assert.equal(await page.locator('.ring-inner').evaluate(node=>getComputedStyle(node).animationPlayState),'paused');
            await page.getByRole('button',{name:'播放核心動畫',exact:true}).click();
            assert.equal(await page.locator('.ring-inner').evaluate(node=>getComputedStyle(node).animationPlayState),'running');
          }
          if([390,1440].includes(width))await screenshot(`home-${width}`);
        }
      }
      await open('/portal/baccarat/dg/analyze');await page.getByRole('button',{name:'RB01',exact:true}).waitFor();await fit(`${width} rooms`);
      await page.getByLabel('手動輸入房號',{exact:true}).fill('rb01');await page.getByRole('button',{name:'確認房間',exact:true}).click();
      await page.getByRole('heading',{name:'請選擇幣別',exact:true}).waitFor();await fit(`${width} currency selection`);
      if(width===390)await screenshot('currency-390');
      const useMyr=[390,768,1440].includes(width);
      await page.getByRole('button',{name:useMyr?'令吉 MYR':'台幣 TWD',exact:true}).click();
      await page.getByRole('button',{name:/^天門/}).click();await page.getByLabel('本金',{exact:true}).waitFor();
      await page.getByLabel('本金',{exact:true}).fill(useMyr?'570':'2850');await page.getByRole('button',{name:'確認本金',exact:true}).click();
      await page.getByLabel('單注上限',{exact:true}).fill(useMyr?'310':'1550');await page.getByRole('button',{name:'確認單注上限',exact:true}).click();
      await page.locator('.baccarat-result-card').waitFor();await fit(`${width} baccarat result`);
      assert.ok((await page.locator('.baccarat-result-card').innerText()).includes(useMyr?'令吉 MYR':'台幣 TWD'));
      const notice=page.locator('.baccarat-notice span');assert.ok(await notice.evaluate(node=>node.getBoundingClientRect().width)>200);
      assert.deepEqual(await page.locator('.road-grid strong').allTextContents(),['18','11','2','31']);
      const labels=await page.locator('.road-grid>div>span').evaluateAll(nodes=>nodes.map(node=>({font:parseFloat(getComputedStyle(node).fontSize),color:getComputedStyle(node).color,top:node.getBoundingClientRect().top})));
      assert.ok(labels.every(label=>label.font>=23));assert.equal(new Set(labels.map(label=>Math.round(label.top))).size,1);
      assert.equal(new Set(labels.slice(0,3).map(label=>label.color)).size,3);
      if(state.prediction!=='觀望')assert.notEqual(await page.locator('.prediction-glow').evaluate(node=>getComputedStyle(node).boxShadow),'none');
      if([390,430,1024,1440].includes(width))await screenshot(`baccarat-${width}`);
      await open('/portal/atg/set2/recommend');await page.getByRole('heading',{name:'房間數據整理中',exact:true}).waitFor();await fit(`${width} electronic waiting`);
      assert.equal(await page.locator('#analysisStage').count(),1);
      await page.getByRole('button',{name:'取消推薦',exact:true}).click();await page.getByRole('heading',{name:'已取消推薦',exact:true}).waitFor();
      await open('/portal/lottery/mb/analyze');await page.getByRole('button',{name:/賭城賽車/}).click();await page.getByRole('button',{name:/3.*碼/}).first().click();await page.getByRole('button',{name:'開始分析',exact:true}).waitFor();await fit(`${width} mb confirm`);
      await open('/portal/lottery/539/analyze');await page.locator('.lottery539-result-card').waitFor();await fit(`${width} 539`);
      await open('/portal/sports/nba/analyze');await page.getByRole('tab',{name:'第 2 場',exact:true}).click();assert.ok(await page.locator('[data-sports-slide="1"]').isVisible());await fit(`${width} sports`);
      if(width===390)await screenshot('sports-390');
    }
    await page.setViewportSize({width:390,height:844});await open('/portal/');await page.locator('#mobileDock').getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('heading',{name:'更多功能',exact:true}).waitFor();await page.getByRole('button',{name:'帳號設定',exact:true}).last().click();await page.getByRole('heading',{name:'帳號設定',exact:true}).waitFor();
    await page.getByRole('button',{name:/安裝黑域AI/}).click();await page.getByRole('dialog').waitFor({state:'visible'});await fit('install dialog');await page.getByRole('button',{name:'了解',exact:true}).click();
    await page.emulateMedia({reducedMotion:'reduce'});await open('/portal/');assert.equal(await page.locator('.screen').evaluate(node=>getComputedStyle(node).animationName),'none');assert.equal(await page.locator('.ring-inner').evaluate(node=>getComputedStyle(node).animationName),'none');
    state.allowed=false;state.expired=true;await open('/portal/baccarat/dg/analyze');await page.getByRole('heading',{name:'會員權限已到期',exact:true}).waitFor();await fit('expired');
    state.expired=false;await open('/portal/atg/set2/recommend');await page.getByRole('heading',{name:'需要開通權限',exact:true}).waitFor();
    state.authenticated=false;await open('/portal/');await page.getByRole('heading',{name:'登入黑域AI',exact:true}).waitFor();await fit('login');await screenshot('login-390');
    state.authenticated=true;state.failMe=true;await open('/portal/');await page.getByRole('heading',{name:'正在重新確認會員權限',exact:true}).waitFor();
    state.failMe=false;state.allowed=true;state.failData=true;await open('/portal/');await page.locator('#overviewData strong').filter({hasText:'無法取得'}).waitFor();
    await page.goto(base+'/');await page.getByRole('heading',{name:'黑域AI',exact:true}).waitFor();await fit('public landing');
    await page.goto(base+'/assistant/');await page.locator('h1').waitFor();await fit('assistant');
    assert.deepEqual(errors,[]);assert.ok(accessCalls>0);
    console.log('Validated 6 widths, 8 main routes, analysis flows and exception states. All API fixtures stayed on loopback.');
  }catch(error){console.error('Browser errors:',errors);console.error('Page:',await page.locator('#view').innerText().catch(()=>''));if(capture)await page.screenshot({path:path.join(capture,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
