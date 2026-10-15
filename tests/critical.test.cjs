'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..');
function harness(){
  const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});
  const w=dom.window; let clock=0;
  const ep=w.HTMLElement.prototype;
  ep.createEl=function(tag,opts={}){const x=w.document.createElement(tag);if(opts.cls)x.className=opts.cls;if(opts.text!==undefined)x.textContent=opts.text;this.append(x);return x;};
  ep.createDiv=function(o){return this.createEl('div',o)};ep.createSpan=function(o){return this.createEl('span',o)};
  ep.empty=function(){this.replaceChildren()};ep.addClass=function(...args){this.classList.add(...args)};
  class Modal{constructor(app){this.app=app;this.modalEl=w.document.body.createDiv({cls:'modal'});this.contentEl=this.modalEl.createDiv({cls:'modal-content'});}open(){this.onOpen();}close(){this.onClose();this.modalEl.remove();}}
  class Plugin{constructor(app){this.app=app;this.manifest={id:'akebi',version:'0.8.0',dir:'.obsidian/plugins/akebi'};}async loadData(){return this.data||{};}async saveData(x){this.data=x;}registerEvent(){}addCommand(){}addRibbonIcon(){}registerObsidianProtocolHandler(){}addSettingTab(){}}
  const obsidian={Modal,Plugin,PluginSettingTab:class{},Setting:class{},Notice:class{},setIcon:(el,name)=>el.setAttribute('data-icon',name),normalizePath:p=>p.replace(/\/+/g,'/'),getAllTags:cache=>cache.tags?.map(x=>x.tag)||[]};
  const engine={module:{exports:{}},require:id=>obsidian,console,Date,performance:{now:()=>clock},globalThis:w};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'src/study.js'),'utf8'),engine);
  const api=engine.module.exports;
  const host={module:{exports:{}},require:id=>id==='obsidian'?obsidian:api,console,Date};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'src/main.js'),'utf8'),host);
  return {api,Plugin:host.module.exports,window:w,setTime:n=>clock=n,close:()=>w.close()};
}
const example={question:'輸送経路を組み立てる',answer:'タンパク質は粗面小胞体で合成され、ゴルジ体を経て分泌される。',id:'q',legacyId:'q',genre:'生物学',deck:'生物学',source:'cards.md',course:'生物学',dummies:[],explanation:'合成と輸送は別の過程。',sentence:{schemaVersion:2,prefix:'タンパク質は',suffix:'分泌される。',tokens:['粗面小胞体で','合成','され、','ゴルジ体を','経て'],distractors:['核小体で','分解','されず、'],alternatives:[]}};
test('canonical reconstruction, negation, duplicate multiplicity and v1 compatibility',()=>{
 const h=harness(),{api}=h;
 const spec=api.studySentenceSpec(example);assert(spec);assert.equal(spec.tokens.length+spec.distractors.length,8);
 assert(api.studySentenceAccepted(spec,spec.tokens));
 assert(!api.studySentenceAccepted(spec,['粗面小胞体で','合成','されず、','ゴルジ体を','経て']));
 assert(!api.studySentenceAccepted(spec,['粗面小胞体で','合成','され、','ゴルジ体を','ゴルジ体を']));
 const wrong={...example,answer:'違う文'};assert.equal(api.studySentenceSpec(wrong),null);
 const legacy={...example,sentence:{schemaVersion:1,tokens:['タンパク質','は','粗面小胞体','で','合成','され、','ゴルジ体','を','経て','分泌される。'],distractors:['核小体で','されず、']}};
 const old=api.studySentenceSpec(legacy);assert(old);assert.equal(old.canonical,example.answer);
 assert.equal(api.studyTag('#akebi/Science\n'),'Science');
 h.close();
});
test('real DOM: every candidate can be tapped, corrected and graded once; timeout persists before Next',async()=>{
 const h=harness();let saves=0;
 const owner={manifest:{version:'0.8.0'},settings:{recallLimitSeconds:5,sentenceLimitSeconds:120,easyThresholdSeconds:2,studyMode:'choice',repSize:10,soundEnabled:false,soundVolume:0},_mastery:{},_curated:{},_saveMastery(){saves++;},_flushMastery:async()=>true,saveData:async()=>{},adoptCardIds:async()=>{}};
 const modal=new h.api.AkebiStudyModal({vault:{getAbstractFileByPath:()=>null}},owner);modal._renderShell();modal.cards=[example];modal._start([example]);
 const q=modal.current;
 assert.equal(q.limitMs,120000);assert.equal(modal.main.querySelectorAll('.sr-sentence-bank-chip').length,8);
 assert.equal(modal.main.querySelectorAll('.akebi-fixed-boundary').length,2);
 const initialButtons=[...modal.main.querySelectorAll('.sr-sentence-bank-chip')];
 const choose=text=>{const btn=[...modal.main.querySelectorAll('.sr-sentence-bank-chip')].find(b=>b.textContent===text&&!b.disabled);assert(btn,text);btn.click();};
 choose('核小体で');modal.main.querySelector('.sr-sentence-selected').click();assert.equal(q.sentenceSelected.length,0);
 for(const t of example.sentence.tokens)choose(t);
 assert(initialButtons.every(b=>b.isConnected),'bank must not be detached on each click');
 assert.equal(q.checkButton.disabled,false);q.checkButton.click();assert.equal(saves,1);assert.equal(owner._mastery.q.correct,1);
 const next=modal.main.querySelector('.sr-mastery-next');next.click();next.click();assert.equal(saves,1);
 modal._start([example]);const expired=modal.current;h.setTime(expired.deadline+1);modal._tick();
 assert.equal(expired.state,'graded');assert.equal(owner._mastery.q.mistakes,1);assert.equal(saves,2);
 modal._renderHome();assert.equal(saves,2);assert.equal(owner._mastery.q.attempts,2);assert(!modal.current);
 h.close();
});
test('migration preserves old files/counters, newer records win, corrupt ledger refuses overwrite',async()=>{
 const h=harness();const store=new Map();
 const old={oldQ:{stage:'known',ease:72,attempts:6,correct:5,mistakes:1,lastReviewedAt:'2026-01-01T00:00:00Z'}};
 store.set('.obsidian/plugins/repetition-mobile-ux/mastery.json',JSON.stringify(old));
 store.set('.obsidian/plugins/repetition-mobile-ux/data.json',JSON.stringify({repSize:7,selectedStudyStage:'weak'}));
 const app={vault:{configDir:'.obsidian',on:()=>({}),adapter:{exists:async p=>store.has(p),read:async p=>store.get(p),write:async(p,text)=>{store.set(p,text);}}}};
 const plugin=new h.Plugin(app);await plugin.onload();const n=await plugin.importLegacy();assert.equal(n,1);
 assert.equal(plugin._mastery.oldQ.attempts,6);assert.equal(plugin.settings.repSize,7);assert.equal(plugin.settings.selectedStudyStage,'weak');
 assert.equal(store.get('.obsidian/plugins/repetition-mobile-ux/mastery.json'),JSON.stringify(old));
 assert(store.has('.obsidian/plugins/akebi/legacy-import-backup.json'));
 await plugin.adoptCardIds([{id:'akebi:stable',legacyId:'oldQ'}]);assert.equal(plugin._mastery['akebi:stable'].correct,5);
 assert(!plugin._mastery.oldQ);assert.equal(plugin.settings.idAliases.oldQ,'akebi:stable');
 const persisted=JSON.parse(store.get('.obsidian/plugins/akebi/mastery.json'));assert(!persisted.oldQ);assert.equal(persisted['akebi:stable'].attempts,6);
 await assert.rejects(plugin.importLegacy());
 store.set('.obsidian/plugins/akebi/mastery.json','broken JSON');
 const broken=new h.Plugin(app);await broken.onload();assert(broken._loadError);await broken._saveMastery();assert.equal(store.get('.obsidian/plugins/akebi/mastery.json'),'broken JSON');
 h.close();
});
test('optional private fixture: all authored sentences are exactly reconstructible and <=15 choices',()=>{
 if(!process.env.AKEBI_SENTENCES)return;
 const h=harness();const cards=JSON.parse(fs.readFileSync(process.env.AKEBI_SENTENCES,'utf8'));
 for(const c of cards){
  const answer=c.prefix+c.tokens.join('')+c.suffix;
  const spec=h.api.studySentenceSpec({sentence:c,answer});assert(spec,c.id);
  assert(h.api.studySentenceAccepted(spec,spec.tokens),c.id);
  assert(spec.tokens.length+spec.distractors.length<=15,c.id);
  for(const a of spec.alternatives)assert(h.api.studySentenceAccepted(spec,a),c.id);
 }
 h.close();
});
