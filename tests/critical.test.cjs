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
  class MarkdownRenderChild{
    constructor(el){this.containerEl=el;this.loaded=false;}
    load(){this.loaded=true;this.containerEl.dataset.akebiChildState='loaded';}
    unload(){this.loaded=false;this.containerEl.dataset.akebiChildState='unloaded';}
  }
  const obsidian={Modal,MarkdownRenderChild,FuzzySuggestModal:class extends Modal{setPlaceholder(){}},Plugin,PluginSettingTab:class{},Setting:class{},Notice:class{},setIcon:(el,name)=>el.setAttribute('data-icon',name),normalizePath:p=>p.replace(/\/+/g,'/'),MarkdownRenderer:{
    render:async(app,markdown,el,source,component)=>{
      assert(component instanceof MarkdownRenderChild);
      assert(component.loaded);
      el.dataset.renderedMarkdown=markdown;el.dataset.sourceNote=source;
      el.dataset.renderedWith='modernMarkdownRenderer';
    },
    renderMarkdown:async()=>{throw Error('Deprecated MarkdownRenderer unexpectedly used');}
  },getAllTags:cache=>cache.tags?.map(x=>x.tag)||[]};
  const cache=new Map();
  function load(name){
    if(name==='obsidian')return obsidian;
    const key=name.replace(/^\.\//,'');if(cache.has(key))return cache.get(key);
    const context={module:{exports:{}},require:load,console,Date,performance:{now:()=>clock},globalThis:w};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'src',key+'.js'),'utf8'),context,{filename:key+'.js'});
    cache.set(key,context.module.exports);return context.module.exports;
  }
  const api=load('./study');
  return {api,Plugin:load('./main'),load,window:w,setTime:n=>clock=n,close:()=>w.close()};
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
 assert.equal(api.studyTag('#akebi/Science\n'),'science');
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
 choose('核小体で');modal.main.querySelector('.sr-sentence-selected').click();modal.main.querySelector('.sr-sentence-selected').click();assert.equal(q.sentenceSelected.length,0);
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
 plugin._mastery.duplicateQ={...old.oldQ,attempts:7,correct:6,lastReviewedAt:'2026-01-02T00:00:00Z'};
 await plugin.adoptCardIds([{id:'akebi:stable',legacyId:'oldQ',duplicateIds:['duplicateQ']}]);
 assert.equal(plugin._mastery['akebi:stable'].attempts,7);assert(!plugin._mastery.duplicateQ);
 assert.equal(plugin.settings.idAliases.duplicateQ,'akebi:stable');

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
  assert(h.api.studySentenceAccepted(spec,spec.schemaVersion===3?spec.chunks.map(c=>c.tokens):spec.tokens),c.id);
  if(spec.schemaVersion===3)assert(h.api.studySentenceAccepted(spec,spec.chunks.map(c=>[...c.tokens].reverse())),c.id+' reversed within chunks');
  assert(spec.tokens.length+spec.distractors.length<=15,c.id);
  for(const a of spec.alternatives)assert(h.api.studySentenceAccepted(spec,a),c.id);
 }
 h.close();
});
test('chunk grading ignores local word order but not role assignment, negation or multiplicity',()=>{
 const h=harness(),a=h.api;
 const raw={...example.sentence,schemaVersion:3,chunks:[
   {id:'make',label:'合成',tokens:['粗面小胞体で','合成','され、'],mode:'bag'},
   {id:'transport',label:'輸送',tokens:['ゴルジ体を','経て'],mode:'bag'}]};
 const spec=a.studySentenceSpec({...example,sentence:raw});assert(spec);
 assert(a.studySentenceAccepted(spec,[['され、','粗面小胞体で','合成'],['経て','ゴルジ体を']]));
 assert(!a.studySentenceAccepted(spec,[['され、','ゴルジ体を','合成'],['経て','粗面小胞体で']]));
 assert(!a.studySentenceAccepted(spec,[['粗面小胞体で','合成','されず、'],['ゴルジ体を','経て']]));
 assert(!a.studySentenceAccepted(spec,[['粗面小胞体で','合成','合成'],['ゴルジ体を','経て']]));
 h.close();
});
test('archive exclusion, same-content Rep deduplication, hierarchy labels and quote-compatible identities',async()=>{
 const h=harness();const owner={manifest:{version:'0.8.1'},settings:{selectedStudyStage:'all',selectedDeckTag:'university/biology/sentences',repSize:10,recallLimitSeconds:5,sentenceLimitSeconds:120,soundEnabled:false},_mastery:{},_curated:{},_saveMastery(){},_flushMastery:async()=>true,saveData:async()=>{},adoptCardIds:async()=>{}};
 const note='#flashcards/university/biology/sentences\n'+example.question+' :: '+example.answer+'\n%%AKEBI '+JSON.stringify({sentence:example.sentence,akebi:{id:'core'}})+'%%\n';
 const linear='#flashcards/university/linear-algebra\n> 階数とは？ :: 行列の一次独立な列数\n';
 const files=[{path:'biology.md'},{path:'70_ARCHIVE/quarantine/biology.md'},{path:'backup/biology.md'},{path:'linear.md'}];
 const app={vault:{getMarkdownFiles:()=>files,cachedRead:async f=>f.path==='linear.md'?linear:note,getAbstractFileByPath:()=>null},metadataCache:{getFileCache:()=>null}};
 const modal=new h.api.AkebiStudyModal(app,owner);await modal._loadCards();assert.equal(modal.cards.length,2);
 assert(modal._tree.has('university/biology/sentences'));assert(modal._tree.has('university/linear-algebra'));
 const math=modal.cards.find(c=>c.source==='linear.md');assert.equal(math.question,'階数とは？');assert(math.legacyId.includes('>'));
 modal._renderShell();modal._goDeck('university');
 assert.equal(modal.main.querySelectorAll('.akebi-deck-node').length,2);
 assert.equal(modal.main.querySelector('.sr-mastery-start'),null);
 assert(!modal.main.textContent.includes('保存フォルダ'));
 owner.settings.tagLabels={'university':'大学','university/biology':'生物'};modal._renderHome();assert(modal.main.textContent.includes('生物'));
 const first=modal.cards.find(c=>c.sentence),second={...first,id:'second',question:'別の問題',answer:example.answer,source:'second.md'};
 const copy={...first,id:'old-id',source:'copy.md'};
 modal._start([first,copy,second]);assert.equal(modal.rep.size,2);
 const seen=[];
 for(let i=0;i<2;i++){seen.push(modal.current.card.question);modal._rate(false);modal._next();}
 assert.equal(new Set(seen).size,2);assert.equal(modal.screen,'rep-break');assert.equal(modal.rep.attempted,2);
 modal.main.querySelector('.sr-mastery-start').click();assert.equal(modal.rep.number,2);assert.equal(modal.repSeen.size,1);
 const tax=h.load('./taxonomy');assert(tax.excludedPath('70_ARCHIVE/quarantine/x.md'));assert(!tax.excludedPath('00_META/00_Inbox/linear.md'));
 assert.deepEqual(Array.from(tax.studyTags('#flashcards/university/biology/terms\n',['#flashcards/一般'])),['university/biology/terms']);
 assert.deepEqual(Array.from(tax.studyTags('---\ntags: [flashcards/university/linear-algebra]\n---\nQ :: A\n')),['university/linear-algebra']);
 assert.deepEqual(Array.from(tax.studyTags('---\ntags:\n  - akebi/university/biology/terms\n---\nQ :: A\n')),['university/biology/terms']);
 assert.notEqual(tax.reviewKey({question:'式',answer:'n!'}),tax.reviewKey({question:'式',answer:'n'}));

 h.close();
});
test('local-image metadata, safe paths and tag-label editing preserve questions and history',async()=>{
 const h=harness(),media=h.load('./media');
 assert.equal(media.localImage('https://elsewhere/image.png'),null);assert.equal(media.localImage('../secret.png'),null);assert.equal(media.localImage('data:image/png;base64,x'),null);
 assert.equal(media.localImage('images/図.png').path,'images/図.png');
 const text='#flashcards/university/biology\nQ :: A\n<!--SR:!2026-12-01,3,230-->\n%%RMUX {"akebi":{"id":"fixed"},"dummies":["B","C","D"]}%%\n';
 const edited=media.patchImages(text,{question:'Q'},[{path:'images/図.png',showOn:'answer'}]);
 assert(edited.includes('Q :: A\n<!--SR:!2026-12-01,3,230-->'));
 const obj=JSON.parse(edited.match(/%%RMUX (.*)%%/)[1]);assert.equal(obj.akebi.id,'fixed');assert.equal(obj.images[0].showOn,'answer');
 const paths=['university','university/biology','university/biology/terms'];
 const {TagNamesModal}=h.load('./dialogs');const owner={settings:{tagLabels:{}},saveData:async()=>{}};
 const dialog=new TagNamesModal({},owner,paths);dialog.open();
 const input=[...dialog.contentEl.querySelectorAll('input')].find(e=>e.getAttribute('aria-label')?.includes('/biologyの表示名'));
 assert(input);input.value='細胞生物学';input.dispatchEvent(new h.window.Event('input'));
 [...dialog.contentEl.querySelectorAll('button')].find(b=>b.textContent==='表示名を保存').click();await new Promise(r=>setImmediate(r));
 assert.equal(owner.settings.tagLabels['university/biology'],'細胞生物学');h.close();
});

test('shared per-card Vault image links resolve, open and survive rename',async()=>{
  const h=harness(),media=h.load('./media');
  assert.equal(media.localImage('https://host/x.png'),null);
  assert.equal(media.localImage('![[../secret.png]]'),null);
  assert.equal(media.localImage('![[biology/細胞膜.png]]').path,'biology/細胞膜.png');
  assert.equal(media.localImage('[[細胞膜.png|細胞膜の構造]]').alt,'細胞膜の構造');
  assert.equal(media.localImage({path:'biology/細胞膜.png',showOn:'answer'}).showOn,'answer');
  const original='#flashcards/university/biology/terms\n'+
    '膜の構造は？ :: リン脂質二重層\n<!--SR:!2026-12-01,3,230-->\n'+
    '%%AKEBI {"akebi":{"id":"membrane"},"dummies":["A","B","C"],"explanation":"脂質二重層。"}%%\n';
  const card={source:'science.md',question:'膜の構造は？'};
  const updated=media.patchImages(original,card,[
    {link:'![[biology/細胞膜.png]]',alt:'細胞膜の模式図'},
    {link:'[[細胞膜.png|細胞膜の図]]',showOn:'answer'}
  ]);
  assert(updated.includes('膜の構造は？ :: リン脂質二重層\n<!--SR:!2026-12-01,3,230-->'));
  const meta=JSON.parse(updated.match(/%%AKEBI (\{.*\})%%/)[1]);
  assert.equal(meta.akebi.id,'membrane');
  assert.deepEqual([...meta.dummies],['A','B','C']);
  assert.equal(meta.images[0].link,'![[biology/細胞膜.png]]');
  assert.equal(meta.images[1].link,'![[細胞膜.png]]');
  assert.equal(meta.images[1].alt,'細胞膜の図');
  assert.throws(()=>media.patchImages(updated,card,[
    '![[biology/細胞膜.png]]','![[biology/細胞膜.png]]'
  ]));
  const files=new Map([['biology/細胞膜.png',{path:'biology/細胞膜.png',name:'細胞膜.png',basename:'細胞膜',extension:'png'}]]);
  const opened=[];
  const app={
    vault:{getAbstractFileByPath:path=>files.get(path),getResourcePath:f=>'app://resource/'+f.path},
    metadataCache:{getFirstLinkpathDest:link=>link==='細胞膜.png'?files.get('biology/細胞膜.png'):null},
    workspace:{openLinkText:async(link,source,newLeaf)=>opened.push({link,source,newLeaf})}
  };
  const modal=new h.api.AkebiStudyModal(app,{settings:{},_mastery:{}});
  const container=h.window.document.body.createDiv();
  const images=meta.images;
  modal._renderCardImages(container,{source:'science.md',images},'question');
  assert.equal(container.querySelectorAll('.akebi-card-image-link').length,1);
  assert.equal(container.querySelector('img').alt,'細胞膜の模式図');
  container.querySelector('button').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(opened[0].link,'biology/細胞膜.png');
  assert.equal(opened[0].source,'science.md');
  modal._renderCardImages(container,{source:'other.md',images},'answer');
  assert.equal(container.querySelectorAll('.akebi-card-image-link').length,3);
  const renamed=media.rewriteImageLinksInMarkdown(updated,
    'biology/細胞膜.png','assets/細胞膜_修正版.png');
  assert(renamed.includes('![[assets/細胞膜_修正版.png]]'));
  assert(renamed.includes('![[細胞膜.png]]'),'ambiguous basename is left intact');
  assert(renamed.includes('<!--SR:!2026-12-01,3,230-->'));
  const renamedAll=media.rewriteImageLinksInMarkdown(updated,
    'biology/細胞膜.png','assets/細胞膜_修正版.png',true);
  assert.equal((renamedAll.match(/assets\/細胞膜_修正版.png/g)||[]).length,2);
  assert.equal(media.rewriteImageLinksInMarkdown(renamedAll,
    'biology/細胞膜.png','assets/細胞膜_修正版.png',true),renamedAll);
  const documents=new Map([['science.md',updated],['other.md',original]]);
  const vault={
    getMarkdownFiles:()=>[...documents.keys()].map(path=>({path,extension:'md'})),
    cachedRead:async f=>documents.get(f.path),
    process:async(f,fn)=>documents.set(f.path,fn(documents.get(f.path))),
    getFiles:()=>[{path:'assets/細胞膜_修正版.png',name:'細胞膜_修正版.png',extension:'png'}]
  };
  const plugin=new h.Plugin({vault});
  plugin.settings={excludedPaths:[]};plugin._studyModal={cards:[]};
  const count=await plugin.updateImageReferences('biology/細胞膜.png','assets/細胞膜_修正版.png');
  assert.equal(count,1);
  assert.equal(documents.get('science.md'),renamedAll);
  assert.equal(documents.get('other.md'),original);
  const edited=new Map([['science.md',original]]);
  const app2={
    vault:{
      getAbstractFileByPath:path=>path==='science.md'?{path:'science.md',extension:'md'}:files.get(path),
      getResourcePath:path=>path,
      process:async(note,update)=>edited.set(note.path,update(edited.get(note.path)))
    },
    metadataCache:app.metadataCache,workspace:app.workspace
  };
  const editor=new h.api.AkebiStudyModal(app2,{settings:{},_mastery:{}});
  editor.screen='study';editor.current={card:{...card,images:[]}};
  const el=h.window.document.body.createDiv();
  editor._renderImageEditor(el);
  const field=el.querySelector('input[aria-label="画像リンク"]');
  field.value='![[biology/細胞膜.png]]';
  [...el.querySelectorAll('button')].find(b=>b.textContent==='画像リンクを追加').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert(edited.get('science.md').includes('"images":[{"link":"![[biology/細胞膜.png]]"'));
  assert.equal(editor.current.card.images.length,1);
  [...el.querySelectorAll('button')].find(b=>b.textContent==='解除').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(editor.current.card.images.length,0);
  assert(!edited.get('science.md').includes('"images":'));
  assert(files.has('biology/細胞膜.png'),'unlink must never delete the source image');
  h.close();
});

test('PDF++ rect links render the original lecture rectangle, preserve SR and survive rename',async()=>{
 const h=harness(),m=h.load('./media');
 const pdf='![[example-lecture.pdf#page=14&rect=250,80,850,470&width=450]]';
 const parsed=m.localImage(pdf);
 assert(parsed);assert.equal(parsed.kind,'pdf-rect');assert.equal(parsed.page,14);
 assert(!m.localImage('![[file.pdf#page=2]]'));
 assert(!m.localImage('![[file.pdf#page=2&rect=200,40,100,120]]'));
 assert(!m.localImage('![[file.pdf#page=2&rect=100,40,300,120&onload=1]]'));
 const text='#akebi/university/biology/terms\nCell? :: 細胞骨格\n'+
   '<!--SR:!2026-12-01,4,230-->\n%%AKEBI {"akebi":{"id":"cell"},"dummies":["核","膜","葉緑体"]}%%\n';
 const updated=m.patchImages(text,{question:'Cell?'},[{link:pdf,showOn:'answer'}]);
 assert(updated.includes(pdf));assert(updated.includes('<!--SR:!2026-12-01,4,230-->'));
 const renamed=m.rewriteImageLinksInMarkdown(updated,'example-lecture.pdf','lectures/renamed.pdf');
 assert(renamed.includes('![[lectures/renamed.pdf#page=14&rect=250,80,850,470&width=450]]'));
 assert.equal(m.rewriteImageLinksInMarkdown(renamed,'example-lecture.pdf','lectures/renamed.pdf'),renamed);
 const source={path:'resources/handouts/example-lecture.pdf',extension:'pdf',basename:'配布資料'};
 const opened=[];
 const app={vault:{getAbstractFileByPath:p=>p==='cell.md'?{path:'cell.md',extension:'md'}:p===source.path?source:null,
   process:async(f,fn)=>{app.patched=fn(text);}},
   metadataCache:{getFirstLinkpathDest:()=>source},
   workspace:{openLinkText:async(link,note)=>opened.push([link,note])}};
 const modal=new h.api.AkebiStudyModal(app,{settings:{},_mastery:{}});
 const region=h.window.document.body.createDiv();
 modal._renderCardImages(region,{source:'cell.md',images:[{link:pdf,showOn:'answer'}]},'question');
 assert.equal(region.querySelector('.akebi-pdf-rect-embed'),null);
 modal._renderCardImages(region,{source:'cell.md',images:[{link:pdf,showOn:'answer'}]},'answer');
 assert.equal(region.querySelector('.akebi-pdf-rect-embed').dataset.renderedMarkdown,pdf);
 assert.equal(region.querySelector('.akebi-pdf-rect-embed').dataset.renderedWith,'modernMarkdownRenderer');
 assert.equal(region.querySelector('.akebi-pdf-rect-embed').dataset.akebiChildState,'loaded');
 region.querySelector('.akebi-pdf-rect-source').click();
 await new Promise(done=>setImmediate(done));
 assert(opened[0][0].includes('#page=14&rect=250,80,850,470'));
 await modal._saveCardImages({source:'cell.md',question:'Cell?',images:[]},[{link:pdf,showOn:'answer'}]);
 assert(app.patched.includes('![[resources/handouts/example-lecture.pdf#page=14&rect=250,80,850,470&width=450]]'));
 const pdfRegion=region.querySelector('.akebi-pdf-rect-embed');
 modal._renderCardImages(h.window.document.body.createDiv(),{source:'cell.md',images:[]},'question');
 assert.equal(pdfRegion.dataset.akebiChildState,'unloaded','previous PDF++ child must be destroyed on rerender');
 h.close();
});

test('passive forgetting demotes perfect → known → estimated weak, without grading or mutating Ease',()=>{
 const h=harness(),{api}=h;
 const day=86400000,start=Date.parse('2026-10-01T12:00:00Z');
 const record={
   modelVersion:2,stage:'perfect',ease:93,attempts:12,correct:12,mistakes:0,
   lastWasCorrect:true,lastReviewedAt:new Date(start).toISOString(),
   memory:{version:1,stabilityDays:1.0,dueAt:new Date(start+2*day).toISOString(),
     reviewLog:[{observed:1,responseMs:500}]},
   evidence:{alpha:15,beta:1.5}
 };
 const untouched=JSON.stringify(record);
 const get=(d,r=record,t=0.65)=>
   api.studyDisplayLevel(r,'unseen',start+d*day,t);
 assert.equal(get(0).stage,'perfect');
 assert.equal(get(2).stage,'known');
 assert.equal(get(2).inferredWeak,false);
 assert.equal(get(14).stage,'known');
 assert.equal(get(16).stage,'weak');
 assert.equal(get(16).inferredWeak,true);
 assert(get(16).retrievability<=0.65);
 assert.equal(get(10,record,0.70).stage,'weak');
 assert.equal(get(10,record,0.60).stage,'known');
 assert.equal(get(16,{...record,stage:'known'}).stage,'weak');
 assert.equal(get(16,{...record,stage:'weak'}).inferredWeak,false);
 assert.equal(api.studyDisplayLevel(null,'unseen',start+100*day).stage,'unseen');
 assert.equal(api.studyDisplayLevel(null,'known',start+100*day).stage,'known');
 assert.equal(get(100,{...record,lastReviewedAt:'invalid'}).stage,'perfect');
 assert.equal(get(100,{...record,lastReviewedAt:null}).stage,'perfect');
 assert.equal(JSON.stringify(record),untouched,'historical Ease, evidence and scores are immutable');
 h.close();
});
test('estimated weak is counted in donut/weak filter, ordered by recall risk, and shows a provisional hint',()=>{
 const h=harness(),{api}=h,now=Date.now(),day=86400000;
 const mk=(id,stage,days,s)=>({
   id,legacyId:id,question:id,answer:id,course:'biology',genre:'university',
   deck:'university/biology/terms',tagPaths:['university/biology/terms'],studied:true
 });
 const oldStrong=mk('oldStrong','perfect',20,10);
 const recentForgotten=mk('recentForgotten','known',7,0.30);
 const fresh=mk('fresh','perfect',1,10);
 const unseen={...mk('unseen','unseen',0,0),studied:false};
 const owner={
   manifest:{version:'0.8.5'},
   settings:{inferredWeakThreshold:0.65,repSize:2,selectedStudyStage:'weak',
     recallLimitSeconds:8,studyMode:'slide',easyThresholdSeconds:2,
     soundEnabled:false,sentenceLimitSeconds:120,selectedDeckTag:'university/biology/terms'},
   _mastery:{},_curated:{},saveData:async()=>{},_flushMastery:async()=>true,
   _saveMastery:()=>{throw Error('Passive inference may not write progress')}
 };
 const records={
   oldStrong:{stage:'perfect',ease:95,attempts:8,correct:8,mistakes:0,
     memory:{version:1,stabilityDays:10},lastReviewedAt:new Date(now-20*day).toISOString()},
   recentForgotten:{stage:'known',ease:80,attempts:6,correct:6,mistakes:0,
     memory:{version:1,stabilityDays:0.3},lastReviewedAt:new Date(now-7*day).toISOString()},
   fresh:{stage:'perfect',ease:94,attempts:8,correct:8,mistakes:0,
     memory:{version:1,stabilityDays:10},lastReviewedAt:new Date(now-day).toISOString()}
 };
 owner._mastery=records;
 const prev=JSON.stringify(records);
 const modal=new api.AkebiStudyModal({vault:{getAbstractFileByPath:()=>null}},owner);
 modal._renderShell();
 const cards=[oldStrong,recentForgotten,fresh,unseen];
 modal.cards=cards;
 modal.selectedDeck='university/biology/terms';
 modal.selectedStage='weak';
 modal._tree=api.makeTree(cards);modal._cardIndex=new Map(cards.map(c=>[c.id,c]));
 assert.equal(modal._level(recentForgotten,now),'weak');
 assert.equal(modal._level(oldStrong,now),'known');
 assert.equal(modal._level(fresh,now),'perfect');
 assert.equal(modal._level(unseen,now),'unseen');
 assert.equal(modal._stats(cards,now).weak,1);
 assert.equal(modal._selectionCards().map(c=>c.id).join(','),'recentForgotten');
 modal._renderHome();
 assert(modal.main.textContent.includes('忘れてるかも：1問'));
 assert(modal.main.textContent.includes('Ease・正誤回数は減らしません'));
 assert(modal.main.textContent.includes('苦手 1'));
 assert.equal(modal._isDue(recentForgotten,now),true);
 // Both are due; the newer but less stable card must be shown first.
 owner._mastery.oldStrong.memory.stabilityDays=10; // R~0.84, just overdue
 owner._mastery.recentForgotten.memory.stabilityDays=0.30; // R~0.62
 assert.equal(modal._isDue(oldStrong,now),true);
 modal._start([oldStrong,recentForgotten],true);
 assert.equal(modal.current.card.id,'recentForgotten');
 assert(modal.main.textContent.includes('忘れているかも'));
 assert.equal(JSON.stringify(records).includes('attempts'),true);
 // No grading: started study but no answer, so no new record.
 assert.equal(owner._mastery.recentForgotten.attempts,6);
 h.close();
});
