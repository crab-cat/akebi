'use strict';
const { Plugin, PluginSettingTab, Setting, Notice, normalizePath } = require('obsidian');
const { AkebiStudyModal } = require('./study');
const {TagNamesModal,pickImage}=require('./dialogs');
const {MEDIA_EXTENSIONS,localImage,rewriteImageLinksInMarkdown}=require('./media');
const {excludedPath}=require('./taxonomy');

const DEFAULTS = Object.freeze({
  recallLimitSeconds: 10, easyThresholdSeconds: 2, sentenceLimitSeconds: 120,
  studyMode: 'choice', choiceMode: true, soundEnabled: true, soundVolume: 25,
  sentenceAreaHeight: 320, tagLabels: {}, excludedPaths: [], selectedDeckTag:null,
  repSize: 10, selectedStudyStage: 'all', selectedStudyGenre: 'すべて',
  selectedStudyCourse: '', selectedStudyFolder: '', selectedStudyVocabulary: '',
  selectedStudyActivity: 'all', selectedStudyBrowseSubdecks: false
});
const finite = (n, fallback, min, max) => Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback;
function settingsFrom(raw={}) {
  return {...DEFAULTS,...raw,
    recallLimitSeconds:finite(raw.recallLimitSeconds,10,3,60),
    easyThresholdSeconds:finite(raw.easyThresholdSeconds,2,.5,10),
    sentenceLimitSeconds:finite(raw.sentenceLimitSeconds,120,45,300),
    repSize:Math.round(finite(raw.repSize,10,1,50)),
    sentenceAreaHeight:finite(raw.sentenceAreaHeight,320,220,520),
    tagLabels:raw.tagLabels && typeof raw.tagLabels==='object' && !Array.isArray(raw.tagLabels) ? raw.tagLabels : {},
    excludedPaths:Array.isArray(raw.excludedPaths)?raw.excludedPaths.filter(x=>typeof x==='string'):[],
    soundVolume:finite(raw.soundVolume,25,0,100),
    studyMode:raw.studyMode==='slide'?'slide':'choice',
    selectedStudyStage:['all','unseen','weak','known','perfect'].includes(raw.selectedStudyStage)?raw.selectedStudyStage:'all',
    selectedStudyActivity:['all','word','sentence'].includes(raw.selectedStudyActivity)?raw.selectedStudyActivity:'all'
  };
}
function ledger(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid study ledger. Existing data has not been overwritten.');
  const result={};
  for(const [k,v] of Object.entries(value))if(!['__proto__','constructor','prototype'].includes(k) && v && typeof v==='object' && !Array.isArray(v))result[k]=v;
  return result;
}
function mergeNewer(disk, snapshot) {
  const merged={...disk};
  for(const [k,v] of Object.entries(snapshot)){
    const previous=merged[k];
    const a=Date.parse(previous?.lastReviewedAt)||0,b=Date.parse(v.lastReviewedAt)||0;
    if(!previous || b>=a)merged[k]=v;
  }
  return merged;
}
class Akebi extends Plugin {
  async onload() {
    this._settingsWrite=Promise.resolve();this._saveChain=Promise.resolve();
    this._masteryRevision=0;this._masterySavedRevision=0;this._studyModal=null;this._curated={};
    this.settings=settingsFrom(await this.loadData()||{});
    this.aliases=this.settings.idAliases || {};
    this._directory=normalizePath(this.manifest.dir || this.app.vault.configDir+'/plugins/'+this.manifest.id);
    try {this._mastery=await this.readLedger();}
    catch(error){this._loadError=error;this._mastery={};new Notice('akebi: 学習履歴を読み込めません。ファイルを保持したまま停止しました。');}
    if(!this._loadError && this.settings.migrationPending && !this.settings.legacyImportedAt){
      try{await this.importLegacy();}catch(error){this._loadError=error;new Notice('akebi: 旧履歴を取り込めませんでした。元ファイルは保持しています。');}
    }
    this.addCommand({id:'open-study',name:'学習を始める',callback:()=>this.openStudy()});
    this.addCommand({id:'open-mastery-study',name:'学習（互換コマンド）',callback:()=>this.openStudy()});
    this.addCommand({id:'check-cards',name:'問題形式を検査する',callback:()=>this.checkCards()});
    this.addRibbonIcon('sprout','akebi',()=>this.openStudy());
    this.registerObsidianProtocolHandler('akebi',()=>this.openStudy());
    this.addSettingTab(new AkebiSettings(this.app,this));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
      if(!file || !oldPath)return;
      if(file.extension==='md')void this.handleRename(file.path,oldPath);
      else if(MEDIA_EXTENSIONS.has((file.extension||'').toLowerCase()))
        this.queueImageRename(oldPath,file.path);
    }));
  }
  saveData(data) {
    const snapshot=JSON.parse(JSON.stringify(data));
    this._settingsWrite=(this._settingsWrite || Promise.resolve()).catch(()=>{}).then(()=>super.saveData(snapshot));
    return this._settingsWrite;
  }
  async readLedger() {
    const path=normalizePath(this._directory+'/mastery.json');
    if(!await this.app.vault.adapter.exists(path))return {};
    return this.normalizeIds(ledger(JSON.parse(await this.app.vault.adapter.read(path))));
  }
  normalizeIds(records) {
    const result={};
    for(const [key,value] of Object.entries(records)){
      let id=key;const seen=new Set();
      while(this.aliases?.[id] && !seen.has(id)){seen.add(id);id=this.aliases[id];}
      const previous=result[id];
      if(!previous || (Date.parse(value.lastReviewedAt)||0)>=(Date.parse(previous.lastReviewedAt)||0))result[id]=value;
    }
    return result;
  }
  async openStudy() {
    if(this._loadError){new Notice('akebi: 履歴ファイルの読込エラーを解消してから再起動してください。');return;}
    if(this._studyModal || this._openingStudy)return;
    this._openingStudy=true;
    try {
      this._mastery=mergeNewer(await this.readLedger(),this._mastery);
      this._studyModal=new AkebiStudyModal(this.app,this);this._studyModal.open();
    } catch(error){new Notice('akebi: 学習画面を開けませんでした。既存ファイルは保持しています。');}
    finally{this._openingStudy=false;}
  }
  pickImage(){return pickImage(this.app);}
  async openTagNames(cards){
    try{
      if(!cards){const reader=new AkebiStudyModal(this.app,this);await reader._loadCards();cards=reader.cards;}
      const {makeTree}=require('./taxonomy');
      new TagNamesModal(this.app,this,[...makeTree(cards).keys(),...(this._knownTagPaths||[])]).open();
    }catch(error){new Notice('タグの一覧を読み込めませんでした。');}
  }
  async checkCards() {
    const modal=new AkebiStudyModal(this.app,this);
    try {
      await modal._loadCards();
      const badCount=modal.invalidSentenceCount || 0;
      new Notice(badCount ? `akebi: 文組み立て ${badCount}問のメタデータを確認してください。` : `akebi: ${modal.cards.length}問を読み込みました。文組み立ては再構成可能です。`,8000);
    } catch(error){new Notice('akebi: 検査できませんでした。'+String(error.message||error));}
  }
  _saveMastery() {
    if(this._loadError)return Promise.resolve(false);
    const revision=++this._masteryRevision;
    const snapshot=JSON.parse(JSON.stringify(this._mastery));
    this._saveChain=this._saveChain.catch(()=>{}).then(async()=>{
      const latest=await this.readLedger();
      const merged=mergeNewer(latest,snapshot);
      await this.app.vault.adapter.write(normalizePath(this._directory+'/mastery.json'),JSON.stringify(merged,null,2)+'\n');
      this._masterySavedRevision=revision;this._masterySaveError=null;
    }).catch(error=>{
      this._masterySaveError=error;
      new Notice('akebi: 学習結果を保存できませんでした。次の画面移動で再試行します。');
    });
    return this._saveChain;
  }
  async _flushMastery() {
    await this._saveChain;
    if(this._masterySavedRevision<this._masteryRevision)await this._saveMastery();
    return this._masterySavedRevision>=this._masteryRevision;
  }
  async adoptCardIds(cards) {
    let changed=false;
    for(const card of cards){
      const priorIds=[card.legacyId,...(card.duplicateIds||[])];
      for(const id of priorIds){
        if(id && id!==card.id && this._mastery[id] && this.aliases[id]!==card.id){
          this.aliases[id]=card.id;changed=true;
        }
      }
    }
    if(changed){
      this._mastery=this.normalizeIds(this._mastery);this.settings.idAliases={...this.aliases};
      await this.saveData(this.settings);await this._saveMastery();
    }
  }
  async handleRename(newPath,oldPath) {
    if(this._loadError)return;
    let changed=false;
    for(const k of Object.keys(this._mastery))if(k.startsWith(oldPath+'::')){
      this.aliases[k]=newPath+k.slice(oldPath.length);changed=true;
    }
    if(changed){
      this._mastery=this.normalizeIds(this._mastery);this.settings.idAliases={...this.aliases};
      await this.saveData(this.settings);await this._saveMastery();
    }
  }
  queueImageRename(oldPath,newPath) {
    this._imageRenameQueue=(this._imageRenameQueue||Promise.resolve())
      .then(()=>this.updateImageReferences(oldPath,newPath))
      .catch(error=>{
        console.error('akebi: image link update failed',error);
        new Notice('akebi: 画像のリンク更新に失敗しました。カード元のノートを確認してください。');
      });
    return this._imageRenameQueue;
  }
  async updateImageReferences(oldPath,newPath) {
    const oldName=oldPath.split('/').pop();
    // A bare basename is rewritten only if it is unambiguous in the Vault.
    const other=this.app.vault.getFiles?.().some(f=>f.path!==newPath && f.name===oldName);
    const allowBasename=other===false;
    let changed=0;
    for(const note of this.app.vault.getMarkdownFiles()){
      if(excludedPath(note.path,this.settings.excludedPaths||[]))continue;
      const raw=await this.app.vault.cachedRead(note);
      if(!raw.includes('%%RMUX ')&&!raw.includes('%%AKEBI '))continue;
      if(!raw.includes(oldPath)&&!(allowBasename&&raw.includes(oldName)))continue;
      const next=rewriteImageLinksInMarkdown(raw,oldPath,newPath,allowBasename);
      if(raw===next)continue;
      await this.app.vault.process(note,current=>
        rewriteImageLinksInMarkdown(current,oldPath,newPath,allowBasename));
      changed++;
    }
    for(const card of this._studyModal?.cards||[]){
      if(!Array.isArray(card.images))continue;
      card.images=card.images.map(item=>{
        const link=localImage(item);
        if(!link || (link.path!==oldPath && !(allowBasename&&link.path===oldName)))return item;
        return {...item,path:undefined,link:'![['+newPath+(link.fragment||'')+']]',
          showOn:link.showOn,alt:link.alt};
      });
    }
    return changed;
  }
  async importLegacy() {
    if(this._loadError)throw this._loadError;
    if(this.settings.legacyImportedAt)throw new Error('旧履歴はすでに取り込まれています。');
    const base=normalizePath(this.app.vault.configDir+'/plugins/repetition-mobile-ux');
    const source=normalizePath(base+'/mastery.json');
    if(!await this.app.vault.adapter.exists(source))throw new Error('旧Repetitionの履歴が見つかりません。');
    const raw=await this.app.vault.adapter.read(source), imported=ledger(JSON.parse(raw));
    const snapshotPath=normalizePath(this._directory+'/legacy-import-backup.json');
    if(!await this.app.vault.adapter.exists(snapshotPath))await this.app.vault.adapter.write(snapshotPath,raw);
    this._mastery=this.normalizeIds(mergeNewer(imported,this._mastery));
    const oldSettings=normalizePath(base+'/data.json');
    if(await this.app.vault.adapter.exists(oldSettings)){
      const old=JSON.parse(await this.app.vault.adapter.read(oldSettings));
      this.settings=settingsFrom({...old,idAliases:{...this.aliases},migrationPending:false,legacyImportedAt:new Date().toISOString()});
    }else this.settings.legacyImportedAt=new Date().toISOString();
    await this._saveMastery();
    if(this._masterySaveError)throw this._masterySaveError;
    await this.saveData(this.settings);
    return Object.keys(imported).length;
  }
  async onExternalSettingsChange() {
    if(this._studyModal)return; // Do not reset a running countdown or partially built sentence.
    const stored=await this.loadData();
    if(stored){this.settings=settingsFrom(stored);this.aliases=this.settings.idAliases || {}; }
  }
  onunload() {
    this._studyModal?.close();void this._flushMastery();
  }
}
class AkebiSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const el=this.containerEl;el.empty();
    new Setting(el).setName('akebi '+this.plugin.manifest.version).setHeading();
    new Setting(el).setName('学習を開く').setDesc('単語・4択・日本語の文組み立て。ほかのプラグインは不要です。')
      .addButton(b=>b.setButtonText('開く').onClick(()=>this.plugin.openStudy()));
    new Setting(el).setName('旧Repetitionの履歴を取り込む').setDesc('旧ファイルは変更せずバックアップを残します。既存akebiの新しい回答を優先します。')
      .addButton(b=>b.setButtonText(this.plugin.settings.legacyImportedAt?'取込済み':'取り込む')
        .setDisabled(!!this.plugin.settings.legacyImportedAt).onClick(async()=>{
          try{b.setDisabled(true);const n=await this.plugin.importLegacy();new Notice(n+'件の履歴を取り込みました。');this.display();}
          catch(error){new Notice('akebi: '+String(error.message||error));b.setDisabled(false);}
        }));
    new Setting(el).setName('タグ階層の表示名').setDesc('英語のタグ階層に大学・生物・単語などの表示名を付けます。').addButton(b=>b.setButtonText('一覧と編集').onClick(()=>this.plugin.openTagNames()));
    new Setting(el).setName('問題を検査').setDesc('不正なメタデータや再構成できない文を調べます。').addButton(b=>b.setButtonText('検査').onClick(()=>this.plugin.checkCards()));
    el.createEl('p',{text:'学習時間・音・Rep・出題形式は学習画面の設定から変更できます。全処理はVault内で完結し、ネットワーク通信は行いません。'});
  }
}
module.exports=Akebi;
