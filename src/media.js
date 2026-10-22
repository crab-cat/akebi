'use strict';
const {Notice,MarkdownRenderer,MarkdownRenderChild}=require('obsidian');
const EXTENSIONS=new Set(['png','jpg','jpeg','webp','gif','avif']);
const MEDIA_EXTENSIONS=new Set([...EXTENSIONS,'pdf']);
const META=/^(\s*)%%(RMUX|AKEBI) (\{.*\})%%\s*$/;

function localImage(value){
  const raw=typeof value==='string'?{link:value}:value;
  if(!raw||typeof raw!=='object')return null;
  const original=(typeof raw.link==='string'?raw.link:raw.path);
  if(typeof original!=='string')return null;
  const input=original.trim();
  const embedded=/^!?\[\[([^\[\]\r\n]+)\]\]$/.exec(input);
  if((input.startsWith('![')||input.startsWith('[['))&&!embedded)return null;
  const pieces=embedded?embedded[1].split('|'):[input];
  if(pieces.length>2)return null;
  const target=pieces[0].trim();
  const hashAt=target.indexOf('#');
  const path=(hashAt<0?target:target.slice(0,hashAt)).trim();
  const ext=path.split('.').pop().toLowerCase();
  if(!path||path.startsWith('/')||/[:\\\r\n\0?#\[\]|]/.test(path)||
     path.split('/').some(x=>!x||x==='.'||x==='..')||
     !MEDIA_EXTENSIONS.has(ext))return null;
  const alt=typeof raw.alt==='string'&&raw.alt.trim()?raw.alt.trim():(pieces[1]||'').trim();
  if(/[\r\n]/.test(alt))return null;
  let fragment='',page=null,rect=null,width=null;
  const isPdf=ext==='pdf';
  if(isPdf){
    if(hashAt<0)return null;
    const params=target.slice(hashAt+1).split('&'),seen=new Set();
    const values={};
    for(const param of params){
      const k=param.indexOf('=');
      if(k<1)return null;
      const key=param.slice(0,k),val=param.slice(k+1);
      if(!['page','rect','width'].includes(key)||seen.has(key))return null;
      seen.add(key);values[key]=val;
    }
    const p=Number(values.page);
    const r=values.rect?.split(',').map(Number);
    if(!Number.isInteger(p)||p<1||p>50000 || !Array.isArray(r)||r.length!==4 ||
       r.some(n=>!Number.isFinite(n)||n<0||n>30000) || !(r[0]<r[2]&&r[1]<r[3]))return null;
    const w=values.width===undefined?450:Number(values.width);
    if(!Number.isInteger(w)||w<120||w>1200)return null;
    page=p;rect=r;width=w;
    fragment='#page='+p+'&rect='+r.map(n=>String(n)).join(',')+'&width='+w;
  }else if(hashAt>=0)return null;
  return {kind:isPdf?'pdf-rect':'image',link:'![['+path+fragment+']]',path,fragment,
    page,rect,width,alt:alt.slice(0,200),
    showOn:raw.showOn==='answer'?'answer':'question'};
}
function imageWithPath(ref,path){return '![['+path+(ref.fragment||'')+']]';}
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
  if(typeof newPath!=='string' || newPath.startsWith('/') ||
    newPath.split('/').some(part=>!part||part==='.'||part==='..') ||
    !MEDIA_EXTENSIONS.has(newPath.split('.').pop().toLowerCase()))return markdown;
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
      return {...storedImage(original),link:imageWithPath(current,newPath)};
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
  return file&&MEDIA_EXTENSIONS.has((file.extension||'').toLowerCase())?{ref,file}:null;
}
const mediaUI={
  _clearCardMedia(){
    for(const component of this._akebiPdfChildren||[]){
      try{component.unload?.();}catch(error){console.warn('akebi PDF embed cleanup',error);}
    }
    this._akebiPdfChildren=[];
  },
  _renderCardImages(parent,card,phase){
    // The underlying PDF viewer holds observers and PDF.js documents.
    // Unload the old render child whenever the question/feedback changes.
    this._clearCardMedia();
    for(const raw of (card.images||[]).slice(0,4)){
      const ref=localImage(raw);
      if(!ref)continue;
      if(ref.showOn==='answer'&&phase!=='answer'){
        parent.createEl('p',{text:'📖 参考図は答え合わせ後に表示されます。',
          cls:'akebi-pdf-rect-pending sr-mastery-caption'});
        continue;
      }
      const fig=parent.createEl('figure',{cls:'akebi-card-image'});
      const resolved=resolveImage(this.app,card,raw);
      if(!resolved){
        fig.createEl('span',{text:'Vault内画像の同期・リンクを確認：'+ref.path,cls:'sr-mastery-caption'});
        continue;
      }
      if(ref.kind==='pdf-rect'){
        fig.classList.add('akebi-card-pdf-rect');
        const region=fig.createDiv({cls:'akebi-pdf-rect-embed'});
        // PDF++ renders native PDF rectangle embeds; no raster copy is created.
        region.classList.add('markdown-rendered');
        // Obsidian's Markdown renderer owns the native PDF embed and PDF++
        // augments that viewer. The legacy renderMarkdown call did not
        // guarantee the native PDF child was loaded/cleaned up in a Modal.
        const child=typeof MarkdownRenderChild==='function'
          ? new MarkdownRenderChild(region) : null;
        if(child){
          child.load?.();
          (this._akebiPdfChildren ||= []).push(child);
        }
        const component=child||this.owner||this;
        const onError=error=>{
          if(!region.isConnected)return;
          region.replaceChildren();
          region.createSpan({text:'PDFの矩形を表示できません。元資料へのリンクから確認できます。',
            cls:'sr-mastery-caption'});
          console.warn('akebi PDF rect render',error);
        };
        try{
          if(typeof MarkdownRenderer?.render==='function'){
            void Promise.resolve(MarkdownRenderer.render(
              this.app,ref.link,region,card.source||'',component)).catch(onError);
          }else if(typeof MarkdownRenderer?.renderMarkdown==='function'){
            void Promise.resolve(MarkdownRenderer.renderMarkdown(
              ref.link,region,card.source||'',component)).catch(onError);
          }else onError(new Error('Obsidian MarkdownRenderer is unavailable'));
        }catch(error){onError(error);}
        const jump=fig.createEl('button',{
          cls:'akebi-pdf-rect-source',text:'配布資料の該当範囲を開く ↗'});
        jump.type='button';
        jump.setAttribute('aria-label','PDFの'+ref.page+'ページの矩形を開く');
        jump.addEventListener('click',()=>{
          void Promise.resolve(this.app.workspace?.openLinkText?.(
            resolved.file.path+ref.fragment,card.source,true))
            .catch(error=>new Notice('PDFを開けませんでした：'+String(error?.message||error)));
        });
      }else{
        const open=fig.createEl('button',{cls:'akebi-card-image-link'});
        open.type='button';
        open.setAttribute('aria-label','Vault内の画像を開く：'+(ref.alt||ref.path));
        open.title=ref.link+' · タップして元画像を開く';
        const image=open.createEl('img');
        image.alt=ref.alt||resolved.file.basename||'問題の図';
        image.draggable=false;
        image.src=this.app.vault.getResourcePath(resolved.file);
        open.addEventListener('click',()=>{
          void Promise.resolve(this.app.workspace?.openLinkText?.(
            resolved.file.path,card.source,true))
            .catch(error=>new Notice('画像を開けませんでした：'+String(error?.message||error)));
        });
      }
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
      return {link:imageWithPath(ref,file.path),alt:ref.alt,showOn:ref.showOn};
    });
    await this.app.vault.process(note,text=>patchImages(text,card,clean));
    card.images=clean;
  },
  _renderImageEditor(layer){
    const card=this.current?.card;
    if(!card||this.screen!=='study')return;
    const section=layer.createEl('details',{cls:'akebi-image-editor'});
    section.createEl('summary',{text:'この問題の画像リンク'});
    section.createEl('p',{text:'画像またはPDF++の矩形範囲をコピーしたrectリンク（#page=...&rect=...）を貼り付けられます。',cls:'sr-mastery-caption'});
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
    input.type='text';input.placeholder='![[生物学_配布.pdf#page=3&rect=100,80,850,440&width=450]]';
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
    const clip=section.createEl('button',{text:'PDF++でコピーした矩形を貼り付け'});
    clip.addEventListener('click',async()=>{
      try{
        clip.disabled=true;
        const clipboard=layer.ownerDocument?.defaultView?.navigator?.clipboard;
        if(typeof clipboard?.readText!=='function')
          throw Error('この端末ではクリップボードの直接読み取りが使えません。リンク欄へ貼り付けてください。');
        const text=(await clipboard.readText()).trim();
        const fragment=localImage(text);
        if(fragment?.kind!=='pdf-rect')
          throw Error('PDF++の矩形選択リンク（#page=...&rect=...）をコピーしてください。');
        await this._saveCardImages(card,[...(card.images||[]),
          {link:fragment.link,alt:fragment.alt,showOn:phase.value}]);
        refresh();
      }catch(error){new Notice(String(error.message||error));}
      finally{clip.disabled=false;}
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
module.exports={EXTENSIONS,MEDIA_EXTENSIONS,localImage,storedImage,patchImages,rewriteImageLinksInMarkdown,resolveImage,mediaUI};
