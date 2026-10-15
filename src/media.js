'use strict';
const {Notice}=require('obsidian');
const EXTENSIONS=new Set(['png','jpg','jpeg','webp','gif','avif']);
function localImage(value){
  const raw=typeof value==='string'?{path:value}:value;
  if(!raw||typeof raw.path!=='string')return null;
  const path=raw.path.trim();
  if(!path || path.startsWith('/') || /[:\\\r\n\0?#]/.test(path) || path.split('/').some(p=>!p||p==='.'||p==='..') || !EXTENSIONS.has(path.split('.').pop().toLowerCase()))return null;
  return {path,alt:typeof raw.alt==='string'?raw.alt.slice(0,200):'',showOn:raw.showOn==='answer'?'answer':'question'};
}
function patchImages(markdown,card,images){
  const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').replace(/[?？!！。:：]/g,'');
  const newline=markdown.includes('\r\n')?'\r\n':'\n',lines=markdown.split(/\r?\n/),matches=[];
  let fence=false;
  for(let i=0;i<lines.length;i++){
    if(/^\s*`{3,}/.test(lines[i])){fence=!fence;continue;}
    if(fence || !lines[i].includes(' :: ') || /^\s*(?:%%|<!--)/.test(lines[i]))continue;
    if(norm(lines[i].split(' :: ')[0].replace(/^\s*(?:>\s*)+/,''))===norm(card.question))matches.push(i);
  }
  if(matches.length!==1)throw Error('元のカードが重複しているか見つかりません。');
  const row=matches[0];let i=row+1;if(/^\s*<!--SR:[^>]*-->\s*$/.test(lines[i]||''))i++;
  const found=/^(\s*)%%(RMUX|AKEBI) (\{.*\})%%\s*$/.exec(lines[i]||'');
  const m=found?JSON.parse(found[3]):{};if(!m||typeof m!=='object'||Array.isArray(m))throw Error('カードのメタデータが不正です。');
  m.images=images.map(localImage).filter(Boolean);
  if(m.images.length!==images.length || images.length>4)throw Error('画像はVault内のラスタ画像を4件まで指定できます。');
  if(!m.images.length)delete m.images;
  const line=(found?.[1]||'')+'%%'+(found?.[2]||'AKEBI')+' '+JSON.stringify(m)+'%%';
  if(found)lines[i]=line;else lines.splice(i,0,line);
  return lines.join(newline);
}
const mediaUI={
  _renderCardImages(parent,card,phase){
    for(const data of (card.images||[]).map(localImage).filter(Boolean).slice(0,4)){
      if(data.showOn==='answer' && phase!=='answer')continue;
      const fig=parent.createEl('figure',{cls:'akebi-card-image'});
      const file=this.app.vault.getAbstractFileByPath?.(data.path);
      if(file && EXTENSIONS.has((file.extension||'').toLowerCase())){
        const image=fig.createEl('img');image.alt=data.alt||file.basename||'問題の図';image.draggable=false;
        image.src=this.app.vault.getResourcePath(file);
      }else fig.createEl('span',{text:'画像を同期中：'+data.path.split('/').pop(),cls:'sr-mastery-caption'});
      if(data.alt)fig.createEl('figcaption',{text:data.alt});
    }
  },
  async _saveCardImages(card,images){
    const file=this.app.vault.getAbstractFileByPath(card.source);
    if(!file || file.extension!=='md' || typeof this.app.vault.process!=='function')throw Error('安全に更新できる元ノートが見つかりません。');
    const clean=images.map(localImage);if(clean.some(x=>!x)||clean.length>4)throw Error('Vault内の画像を4件まで選んでください。');
    await this.app.vault.process(file,text=>patchImages(text,card,clean));card.images=clean;
  },
  _renderImageEditor(layer){
    const card=this.current?.card;if(!card || this.screen!=='study')return;
    const section=layer.createEl('details',{cls:'akebi-image-editor'});section.createEl('summary',{text:'この問題の画像'});
    section.createEl('p',{text:'Vault内の画像を問題または解説に紐付けます。外部URLは読み込みません。',cls:'sr-mastery-caption'});
    const items=section.createDiv();
    const render=()=>{
      items.replaceChildren();
      for(const [i,item] of (card.images||[]).entries()){
        const image=localImage(item);if(!image)continue;
        const row=items.createDiv({cls:'akebi-image-row'});
        row.createSpan({text:(image.showOn==='answer'?'解説：':'問題：')+image.path.split('/').pop()});
        const remove=row.createEl('button',{text:'解除'});remove.addEventListener('click',async()=>{
          try{await this._saveCardImages(card,card.images.filter((_,j)=>j!==i));render();}catch(e){new Notice(String(e.message||e));}
        });
      }
    };render();
    for(const [phase,label] of [['question','問題に画像を追加'],['answer','解説に画像を追加']]){
      const button=section.createEl('button',{text:label});
      button.addEventListener('click',async()=>{
        if((card.images||[]).length>=4){new Notice('画像は4件までです。');return;}
        try{
          button.disabled=true;const file=await this.owner.pickImage();if(!file)return;
          await this._saveCardImages(card,[...(card.images||[]),{path:file.path,alt:file.basename,showOn:phase}]);render();
        }catch(e){new Notice(String(e.message||e));}finally{button.disabled=false;}
      });
    }
  }
};
module.exports={EXTENSIONS,localImage,patchImages,mediaUI};
