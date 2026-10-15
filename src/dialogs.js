'use strict';
const {Modal,FuzzySuggestModal,Notice}=require('obsidian');
const {EXTENSIONS}=require('./media');
const {tagLabel,defaultLabel}=require('./taxonomy');
class ImagePicker extends FuzzySuggestModal{
  constructor(app,done){super(app);this.done=done;this.setPlaceholder('Vault内の画像を選ぶ');}
  getItems(){return this.app.vault.getFiles().filter(f=>EXTENSIONS.has(f.extension?.toLowerCase()));}
  getItemText(file){return file.path;}
  onChooseItem(file){this.chosen=file;this.done(file);}
  onClose(){const win=this.contentEl.ownerDocument?.defaultView||globalThis;win.setTimeout(()=>{if(!this.chosen)this.done(null);},0);}
}
class TagNamesModal extends Modal{
  constructor(app,owner,paths){super(app);this.owner=owner;this.paths=[...new Set(paths)].filter(Boolean).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));}
  onOpen(){
    this.modalEl.addClass('akebi-tag-settings');const el=this.contentEl;el.empty();
    el.createEl('h2',{text:'タグ階層の表示名'});
    el.createEl('p',{text:'タグは英語の固定ID、ここで入力する名前は画面表示だけに使います。名前を変えても学習履歴は変わりません。'});
    const search=el.createEl('input');search.type='search';search.placeholder='タグまたは表示名を検索';search.setAttribute('aria-label','タグを検索');
    const list=el.createDiv({cls:'akebi-tag-label-list'}),draft={...(this.owner.settings.tagLabels||{})},rows=[];
    for(const path of this.paths){
      const row=list.createDiv({cls:'akebi-tag-label-row'});row.style.setProperty('--akebi-tag-depth',String(path.split('/').length-1));
      row.createEl('code',{text:'#flashcards/'+path});
      const input=row.createEl('input');input.type='text';input.value=tagLabel(path,draft);input.placeholder=defaultLabel(path);input.maxLength=80;
      input.setAttribute('aria-label','#flashcards/'+path+'の表示名');input.addEventListener('input',()=>{if(input.value.trim())draft[path]=input.value.trim();else delete draft[path];});
      rows.push({row,path,input});
    }
    search.addEventListener('input',()=>{const term=search.value.toLowerCase();for(const r of rows)r.row.hidden=!(r.path+' '+r.input.value).toLowerCase().includes(term);});
    const save=el.createEl('button',{text:'表示名を保存',cls:'mod-cta'});
    save.addEventListener('click',async()=>{
      try{save.disabled=true;this.owner.settings.tagLabels=draft;await this.owner.saveData(this.owner.settings);new Notice('タグの表示名を保存しました。');this.close();}
      catch(e){save.disabled=false;new Notice('表示名を保存できませんでした。');}
    });
  }
  onClose(){this.contentEl.empty();}
}
function pickImage(app){return new Promise(resolve=>new ImagePicker(app,resolve).open());}
module.exports={TagNamesModal,pickImage};
