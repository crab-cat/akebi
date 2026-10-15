'use strict';
const {Notice}=require('obsidian');
const EXTENSIONS=new Set(['png','jpg','jpeg','webp','gif','avif']);
const META=/^(\s*)%%(RMUX|AKEBI) (\{.*\})%%\s*$/;

function localImage(value){
  const raw=typeof value==='string'?{link:value}:value;
  if(!raw || typeof raw!=='object')return null;
  const original=(typeof raw.link==='string'?raw.link:raw.path);
  if(typeof original!=='string')return null;
  const input=original.trim();
  const embedded=/^!?\[\[([^\[\]\r\n]+)\]\]$/.exec(input);
  if((input.startsWith('![')||input.startsWith('[['))&&!embedded)return null;
  const pieces=embedded?embedded[1].split('|'):[input];
  if(pieces.length>2)return null;
  const path=pieces[0].trim();
  if(!path || path.startsWith('/') || /[:\\\r\n\0?#\[\]|]/.test(path) ||
    path.split('/').some(x=>!x||x==='.'||x==='..') ||
    !EXTENSIONS.has(path.split('.').pop().toLowerCase()))return null;
  const alt=typeof raw.alt==='string'&&raw.alt.trim()?raw.alt.trim():(pieces[1]||'').trim();
  if(/[\r\n]/.test(alt))return null;
  return {link:'![['+path+']]',path,alt:alt.slice(0,200),
    showOn:raw.showOn==='answer'?'answer':'question'};
}
function storedImage(image){
  const data=localImage(image);
  return data?{link:data.link,alt:data.alt,showOn:data.showOn}:null;
}
function imageFieldValid(images){
  if(!Array.isArray(images)||images.length>4)return false;
  const list=images.map(storedImage);
  return list.every(Boolean) && new Set(list.map(x=>x.link+'\0'+x.showOn)).size===list.length;
}
function patchImages(markdown,card,images){
  if(!imageFieldValid(images))throw Error('画像はVault内リンクで4件まで。重複した配置はできません。');
  const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').replace(/[?？!！。:：]/g,'');
  const newline=markdown.includes('\r\n')?'\r\n':'\n',lines=markdown.split(/\r?\n/),matches=[];
  let fence=false;
  for(let i=0;i<lines.length;i++){
    if(/^\s*(?:\x60{3,}|~{3,})/.test(lines[i])){fence=!fence;continue;}
    if(fence||!lines[i].includes(' :: ')||/^\s*(?:%%|<!--)/.test(lines[i]))continue;
    const head=lines[i].split(' :: ')[0].replace(/^\s*(?:>\s*)+/,'');
    if(norm(head)===norm(card.question))matches.push(i);
  }
  if(matches.length!==1)throw Error('元のカードが重複しているか見つかりません。');
  let i=matches[0]+1;
  if(/^\s*<!--SR:[^>]*-->\s*$/.test(lines[i]||''))i++;
  const found=META.exec(lines[i]||'');
  const meta=found?JSON.parse(found[3]):{};
  if(!meta||typeof meta!=='object'||Array.isArray(meta))throw Error('カードのメタデータが不正です。');
  const values=images.map(storedImage);
  if(values.length)meta.images=values;else delete meta.images;
  const line=(found?.[1]||'')+'%%'+(found?.[2]||'AKEBI')+' '+JSON.stringify(meta)+'%%';
  if(found)lines[i]=line;else lines.splice(i,0,line);
  return lines.join(newline);
}
function rewriteImageLinksInMarkdown(markdown,oldPath,newPath,allowBasename=false){
  const renamed=localImage({path:newPath});
  if(!renamed)return markdown;
  const oldName=oldPath.split('/').pop();
  const newline=markdown.includes('\r\n')?'\r\n':'\n',lines=markdown.split(/\r?\n/);
  let changed=false;
  for(let i=0;i<lines.length;i++){
    const found=META.exec(lines[i]);
    if(!found)continue;
    let meta;
    try{meta=JSON.parse(found[3]);}catch(_){continue;}
    if(!Array.isArray(meta?.images))continue;
    let rewritten=false;
    meta.images=meta.images.map(original=>{
      const current=localImage(original);
      if(!current)return original;
      if(current.path!==oldPath && !(allowBasename && current.path===oldName))return original;
      rewritten=true;
      return {...storedImage(original),link:renamed.link};
    });
    if(rewritten){
      lines[i]=found[1]+'%%'+found[2]+' '+JSON.stringify(meta)+'%%';
      changed=true;
    }
  }
  return changed?lines.join(newline):markdown;
}
function resolveImage(app,card,raw){
  const ref=localImage(raw);
  if(!ref)return null;
  const exact=app?.vault?.getAbstractFileByPath?.(ref.path);
  const linked=app?.metadataCache?.getFirstLinkpathDest?.(ref.path,card?.source||'');
  const file=exact?.extension?exact:linked;
  return file&&EXTENSIONS.has((file.extension||'').toLowerCase())?{ref,file}:null;
}
const mediaUI={
  _renderCardImages(parent,card,phase){
    for(const raw of (card.images||[]).slice(0,4)){
      const ref=localImage(raw);
      if(!ref || (ref.showOn==='answer'&&phase!=='answer'))continue;
      const fig=parent.createEl('figure',{cls:'akebi-card-image'});
      const resolved=resolveImage(this.app,card,raw);
      if(!resolved){
        fig.createEl('span',{text:'Vault内画像の同期・リンクを確認：'+ref.path,cls:'sr-mastery-caption'});
        continue;
      }
      const open=fig.createEl('button',{cls:'akebi-card-image-link'});
      open.type='button';
      open.setAttribute('aria-label','Vault内の画像を開く：'+(ref.alt||ref.path));
      open.title=ref.link+' · タップして元画像を開く';
      const image=open.createEl('img');
      image.alt=ref.alt||resolved.file.basename||'問題の図';
      image.draggable=false;image.src=this.app.vault.getResourcePath(resolved.file);
      open.addEventListener('click',()=>{
        void Promise.resolve(this.app.workspace?.openLinkText?.(resolved.file.path,card.source,true))
          .catch(error=>new Notice('画像を開けませんでした：'+String(error?.message||error)));
      });
      if(ref.alt)fig.createEl('figcaption',{text:ref.alt});
    }
  },
  async _saveCardImages(card,images){
    const note=this.app.vault.getAbstractFileByPath(card.source);
    if(!note||note.extension!=='md'||typeof this.app.vault.process!=='function')
      throw Error('安全に更新できる元ノートが見つかりません。');
    if(!imageFieldValid(images))throw Error('画像はVault内リンクで4件まで。');
    const clean=images.map(raw=>{
      const ref=localImage(raw);
      const file=resolveImage(this.app,card,raw)?.file;
      if(!file)throw Error('Vault内画像を解決できません：'+ref.path);
      return {link:'![['+file.path+']]',alt:ref.alt,showOn:ref.showOn};
    });
    await this.app.vault.process(note,text=>patchImages(text,card,clean));
    card.images=clean;
  },
  _renderImageEditor(layer){
    const card=this.current?.card;
    if(!card||this.screen!=='study')return;
    const section=layer.createEl('details',{cls:'akebi-image-editor'});
    section.createEl('summary',{text:'この問題の画像リンク'});
    section.createEl('p',{text:'画像は4択・解説と同じ問題のデータに保存。別の問題から同じVault画像を再利用できます。',cls:'sr-mastery-caption'});
    const items=section.createDiv();
    const refresh=()=>{
      items.replaceChildren();
      for(const [i,item] of (card.images||[]).entries()){
        const image=localImage(item);
        if(!image)continue;
        const row=items.createDiv({cls:'akebi-image-row'});
        row.createSpan({text:(image.showOn==='answer'?'解説：':'問題：')+image.link});
        const remove=row.createEl('button',{text:'解除'});
        remove.addEventListener('click',async()=>{
          try{await this._saveCardImages(card,card.images.filter((_,j)=>j!==i));refresh();}
          catch(error){new Notice(String(error.message||error));}
        });
      }
    };
    refresh();
    const label=section.createEl('label',{text:'Vault内の画像リンク'});
    const input=label.createEl('input');
    input.type='text';input.placeholder='![[attachments/細胞膜.png]]';
    input.setAttribute('aria-label','画像リンク');
    const phaseLabel=section.createEl('label',{text:'表示タイミング'});
    const phase=phaseLabel.createEl('select');
    phase.createEl('option',{text:'問題と解説'}).value='question';
    phase.createEl('option',{text:'解説のみ'}).value='answer';
    const add=section.createEl('button',{text:'画像リンクを追加'});
    add.addEventListener('click',async()=>{
      if(!input.value.trim())return;
      try{
        add.disabled=true;
        await this._saveCardImages(card,[...(card.images||[]),{link:input.value,showOn:phase.value}]);
        input.value='';refresh();
      }catch(error){new Notice(String(error.message||error));}
      finally{add.disabled=false;}
    });
    const pick=section.createEl('button',{text:'Vaultから画像を選ぶ'});
    pick.addEventListener('click',async()=>{
      if((card.images||[]).length>=4){new Notice('画像は4件までです。');return;}
      try{
        pick.disabled=true;
        const file=await this.owner.pickImage();
        if(!file)return;
        await this._saveCardImages(card,[...(card.images||[]),
          {link:'![['+file.path+']]',alt:file.basename,showOn:phase.value}]);
        refresh();
      }catch(error){new Notice(String(error.message||error));}
      finally{pick.disabled=false;}
    });
  }
};
module.exports={EXTENSIONS,localImage,storedImage,patchImages,rewriteImageLinksInMarkdown,resolveImage,mediaUI};
