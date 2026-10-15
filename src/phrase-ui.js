'use strict';
const {studySentenceGrade}=require('./sentence');
const phraseUI={
  _sentenceCanEdit(q){
    if(!q || q!==this.current || q.state!=='front' || this.screen!=='study' || this.settingsOpen || this._inResumeGrace())return false;
    if(this._remaining()<=0){this._reveal('timeout');return false;}return true;
  },
  _sentenceLocation(q,id){
    for(let c=0;c<q.sentenceChunks.length;c++){const index=q.sentenceChunks[c].indexOf(id);if(index>=0)return {chunk:c,index};}return null;
  },
  _sentenceCanClick(q){return performance.now()>=(this._suppressSentenceClickUntil||0) && this._sentenceCanEdit(q);},
  _sentencePlace(q,id){
    if(!this._sentenceCanClick(q) || !q.sentenceBank.some(t=>t.id===id) || this._sentenceLocation(q,id))return;
    if(q.sentencePicked){this._sentenceMove(q,id,q.activeChunk,null,q.sentencePicked);return;}
    let target=q.activeChunk;
    if(q.sentenceChunks[target].length>=q.sentence.chunks[target].maxLength){target=q.sentenceChunks.findIndex((a,i)=>a.length<q.sentence.chunks[i].maxLength);if(target<0)return;}
    this._sentenceMove(q,id,target);
    if(q.sentenceChunks[target].length>=q.sentence.chunks[target].maxLength){const next=q.sentenceChunks.findIndex((a,i)=>a.length<q.sentence.chunks[i].maxLength);if(next>=0){q.activeChunk=next;this._refreshSentence(q);}}
  },
  _sentencePick(q,id){
    if(!this._sentenceCanClick(q))return;
    // Accept an index for legacy keyboard/test callers; real UI uses stable tile IDs.
    if(typeof id==='number')id=q.sentenceSelected[id];
    const where=this._sentenceLocation(q,id);if(!where)return;
    if(q.sentencePicked===id){this._sentenceMove(q,id,-1);return;}
    if(q.sentencePicked){this._sentenceMove(q,q.sentencePicked,where.chunk,where.index,id);return;}
    q.sentencePicked=id;q.activeChunk=where.chunk;this._refreshSentence(q);
  },
  _sentenceChooseChunk(q,index){
    if(!this._sentenceCanClick(q) || !q.sentenceChunks[index])return;
    if(q.sentencePicked){this._sentenceMove(q,q.sentencePicked,index);return;}
    q.activeChunk=index;this._refreshSentence(q);
  },
  _sentenceMove(q,id,target,index=null,swapId=null){
    if(!this._sentenceCanEdit(q) || !q.sentenceBank.some(t=>t.id===id))return false;
    const from=this._sentenceLocation(q,id);
    if(swapId===id)return false;
    if(target===-1){if(!from)return false;q.sentenceChunks[from.chunk].splice(from.index,1);}
    else if(swapId){
      const other=this._sentenceLocation(q,swapId);if(!other)return false;
      if(from)q.sentenceChunks[from.chunk][from.index]=swapId;
      q.sentenceChunks[other.chunk][other.index]=id;target=other.chunk;
    }else{
      const dest=q.sentenceChunks[target];if(!dest)return false;
      if(dest.length-(from?.chunk===target?1:0)>=q.sentence.chunks[target].maxLength)return false;
      if(from)q.sentenceChunks[from.chunk].splice(from.index,1);
      const at=index===null?dest.length:Math.max(0,Math.min(dest.length,index));dest.splice(at,0,id);
    }
    q.sentencePicked=null;if(target>=0)q.activeChunk=target;
    this._refreshSentence(q);return true;
  },
  _sentenceSubmit(q){
    if(!this._sentenceCanClick(q))return;
    if(!q.sentence.chunks.every((c,i)=>c.lengths.includes(q.sentenceChunks[i].length)))return;
    const bank=new Map(q.sentenceBank.map(t=>[t.id,t]));const grouped=q.sentenceChunks.map(ids=>ids.map(id=>bank.get(id)));
    if(grouped.flat().some(t=>!t) || new Set(q.sentenceSelected).size!==q.sentenceSelected.length)return;
    const result=studySentenceGrade(q.sentence,grouped);q.chunkResult=result;
    q.responseMs=this._elapsed();q.state='back';q.revealReason='sentence';
    q.choice=q.sentence.prefix+grouped.flat().map(t=>t.text).join('')+q.sentence.suffix;
    this._rate(result.correct);
  },
  _refreshSentence(q){
    if(q!==this.current || !q.chunkBoards)return;
    const scroll=this.main.scrollTop,inner=q.sentenceFrame.scrollTop;
    q.sentenceSelected=q.sentenceChunks.flat();const byId=new Map(q.sentenceBank.map(t=>[t.id,t]));
    q.sentenceChunks.forEach((ids,c)=>{
      const board=q.chunkBoards[c];board.replaceChildren();
      if(!ids.length)board.createSpan({text:'この関係の語句を選ぶ',cls:'akebi-placeholder'});
      for(const id of ids){
        const chip=board.createEl('button',{text:byId.get(id).text,cls:'sr-sentence-chip sr-sentence-selected'});
        chip.type='button';chip.setAttribute('data-piece',id);chip.classList.toggle('is-picked',q.sentencePicked===id);
        chip.setAttribute('aria-pressed',String(q.sentencePicked===id));
        chip.setAttribute('aria-label',byId.get(id).text+'。二つを選んで交換、同じ語句を二回で戻す');
        chip.addEventListener('click',()=>this._sentencePick(q,id));this._bindSentencePointer(chip,q,id);
      }
      q.chunkBoxes[c].classList.toggle('is-active',q.activeChunk===c);
      q.chunkTitles[c].setAttribute('aria-pressed',String(q.activeChunk===c));
      q.chunkCounters[c].textContent=ids.length+' / '+q.sentence.chunks[c].tokens.length;
    });
    for(const [id,b] of q.bankButtons){
      const used=q.sentenceSelected.includes(id);b.disabled=used || (!q.sentencePicked && q.sentenceSelected.length>=q.sentence.maxLength);
      b.classList.toggle('is-used',used);b.setAttribute('aria-pressed',String(used));
    }
    q.checkButton.disabled=!q.sentence.chunks.every((c,i)=>c.lengths.includes(q.sentenceChunks[i].length));
    q.undoButton.disabled=!q.sentenceSelected.length;
    q.sentenceCounter.textContent=q.sentenceSelected.length+' / '+q.sentence.tokens.length+' フレーズ';
    q.sentenceFrame.scrollTop=inner;this.main.scrollTop=scroll;
  },
  _bindSentencePointer(el,q,id){
    el.addEventListener('pointerdown',event=>{
      if(event.isPrimary===false || (event.button!==undefined && event.button!==0) || !this._sentenceCanEdit(q))return;
      this._cancelSentenceDrag();
      this._sentenceDrag={q,id,el,pointerId:event.pointerId,x:event.clientX,y:event.clientY,active:false,ghost:null};
      try{el.setPointerCapture(event.pointerId);}catch(_){}
    });
    el.addEventListener('pointermove',event=>{
      const drag=this._sentenceDrag;if(!drag || drag.el!==el || drag.pointerId!==event.pointerId)return;
      if(!drag.active && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<8)return;
      if(!this._sentenceCanEdit(q)){this._cancelSentenceDrag();return;}
      if(!drag.active){drag.active=true;drag.ghost=this.modalEl.createDiv({text:el.textContent,cls:'akebi-drag-ghost'});el.classList.add('is-dragging');}
      event.preventDefault();drag.ghost.style.transform=`translate(${event.clientX+12}px,${event.clientY+10}px)`;
      const hit=this.contentEl.ownerDocument.elementFromPoint?.(event.clientX,event.clientY);
      this.main.querySelectorAll('.is-drop-target').forEach(e=>e.classList.remove('is-drop-target'));
      const zone=hit?.closest?.('[data-chunk-index],.sr-sentence-bank');if(zone && this.main.contains(zone))zone.classList.add('is-drop-target');
      const box=this.main.getBoundingClientRect();
      if(event.clientY<box.top+28)this.main.scrollTop-=12;
      if(event.clientY>box.bottom-28)this.main.scrollTop+=12;
    });
    el.addEventListener('pointerup',event=>{
      const drag=this._sentenceDrag;if(!drag || drag.el!==el || drag.pointerId!==event.pointerId)return;
      if(!drag.active){this._cancelSentenceDrag();return;}
      event.preventDefault();const hit=this.contentEl.ownerDocument.elementFromPoint?.(event.clientX,event.clientY);
      this._suppressSentenceClickUntil=performance.now()+350;this._cancelSentenceDrag();
      if(!hit || !this.main.contains(hit) || !this._sentenceCanEdit(q))return;
      const placed=hit.closest?.('.sr-sentence-selected');
      if(placed){const targetId=placed.getAttribute('data-piece');const where=this._sentenceLocation(q,targetId);if(where)this._sentenceMove(q,id,where.chunk,where.index,targetId);return;}
      const zone=hit.closest?.('[data-chunk-index]');
      if(zone){this._sentenceMove(q,id,Number(zone.getAttribute('data-chunk-index')));return;}
      if(hit.closest?.('.sr-sentence-bank'))this._sentenceMove(q,id,-1);
    });
    el.addEventListener('pointercancel',()=>this._cancelSentenceDrag());
    el.addEventListener('lostpointercapture',()=>{if(this._sentenceDrag?.el===el)this._cancelSentenceDrag();});
  },
  _cancelSentenceDrag(){
    const drag=this._sentenceDrag;this._sentenceDrag=null;
    if(drag){drag.ghost?.remove();drag.el?.classList.remove('is-dragging');try{drag.el.releasePointerCapture(drag.pointerId);}catch(_){}}
    this.main?.querySelectorAll?.('.is-drop-target').forEach(e=>e.classList.remove('is-drop-target'));
  },
  _renderSentenceQuestion(q){
    if(!q || q!==this.current)return;
    this._cancelSentenceDrag();this.modalEl.classList.remove('sr-mastery-timeout-mode');this.main.replaceChildren();
    this.clockValue=null;this.clockBar=null;
    this.main.createEl('p',{text:(this._scopeLabel?.()||q.card.course||q.card.genre)+' · 関係性',cls:'sr-mastery-caption'});
    if(this.rep)this.main.createEl('p',{text:'Rep '+this.rep.number+' · '+this.rep.attempted+'/'+this.rep.size+' 回答',cls:'sr-mastery-rep-progress'});
    this.main.createEl('h3',{text:q.card.question,cls:'sr-sentence-question'});
    this._renderCardImages?.(this.main,q.card,q.state==='front'?'question':'answer');
    if(q.state==='front'){
      if(!q.sentenceChunks)q.sentenceChunks=q.sentence.chunks.map(()=>[]);
      if(!Number.isInteger(q.activeChunk))q.activeChunk=0;
      const clock=this.main.createDiv({cls:'sr-mastery-clock'});this.clockValue=clock.createSpan();
      this.clockBar=clock.createDiv({cls:'sr-mastery-clock-track'}).createDiv({cls:'sr-mastery-clock-bar'});
      const frame=this.main.createDiv({cls:'akebi-sentence-frame'});q.sentenceFrame=frame;
      frame.style.setProperty('--akebi-answer-height',String(this.owner.settings.sentenceAreaHeight || 320)+'px');
      frame.createEl('p',{text:q.sentence.prefix,cls:'akebi-fixed-boundary'});
      q.chunkBoxes=[];q.chunkBoards=[];q.chunkTitles=[];q.chunkCounters=[];
      q.sentence.chunks.forEach((chunk,i)=>{
        const box=frame.createDiv({cls:'akebi-chunk'});box.setAttribute('data-chunk-index',String(i));
        const title=box.createEl('button',{cls:'akebi-chunk-title'});title.type='button';
        title.createSpan({text:chunk.label});const count=title.createSpan({cls:'akebi-chunk-count'});
        const board=box.createDiv({cls:'sr-sentence-placed'});board.setAttribute('aria-label',chunk.label+'のチャンク');
        box.addEventListener('click',event=>{if(event.target.closest('.sr-sentence-selected'))return;this._sentenceChooseChunk(q,i);});
        q.chunkBoxes.push(box);q.chunkBoards.push(board);q.chunkTitles.push(title);q.chunkCounters.push(count);
      });
      frame.createEl('p',{text:q.sentence.suffix,cls:'akebi-fixed-boundary'});
      q.sentenceCounter=this.main.createEl('p',{cls:'sr-sentence-counter'});
      this.main.createEl('p',{text:q.sentence.schemaVersion===3?'チャンク内は語順不問。二つをタップして交換、同じ語句を二回で戻す。ドラッグでも移動できます。':'二つをタップして交換、同じ語句を二回で戻す。ドラッグでも移動できます。',cls:'sr-mastery-caption akebi-phrase-help'});
      const pool=this.main.createDiv({cls:'sr-sentence-bank'});pool.setAttribute('role','group');pool.setAttribute('aria-label','全候補フレーズ');
      q.bankButtons=new Map();
      for(const tile of q.sentenceBank){
        const b=pool.createEl('button',{text:tile.text,cls:'sr-sentence-chip sr-sentence-bank-chip'});b.type='button';b.setAttribute('data-piece',tile.id);
        b.addEventListener('click',()=>this._sentencePlace(q,tile.id));this._bindSentencePointer(b,q,tile.id);q.bankButtons.set(tile.id,b);
      }
      const actions=this.main.createDiv({cls:'sr-sentence-actions'});
      q.undoButton=actions.createEl('button',{text:'戻す'});q.undoButton.type='button';
      q.undoButton.addEventListener('click',()=>{if(this._sentenceCanClick(q))this._sentenceMove(q,q.sentencePicked || q.sentenceSelected.at(-1),-1);});
      q.checkButton=actions.createEl('button',{text:'答え合わせ',cls:'mod-cta sr-sentence-check'});q.checkButton.type='button';q.checkButton.addEventListener('click',()=>this._sentenceSubmit(q));
      this._refreshSentence(q);this._tick();
    }else{
      const status=q.revealReason==='timeout'?'時間切れ · FAIL記録済み':q.result?.correct?'正解！':'チャンクの役割・対象・否定を確認';
      this.main.createEl('p',{text:status,cls:'sr-sentence-result-status'});
      const byId=new Map(q.sentenceBank.map(t=>[t.id,t]));
      q.sentence.chunks.forEach((chunk,i)=>{
        const chosen=(q.sentenceChunks[i]||[]).map(id=>byId.get(id)?.text||'').join('');
        this.main.createEl('p',{text:chunk.label+(q.chunkResult?.chunks?.[i]===true?' ✓':''),cls:'sr-sentence-caption'});
        this.main.createEl('p',{text:chosen||'未回答',cls:'sr-sentence-attempt'});
      });
      this.main.createEl('p',{text:'模範文（語順は一例）',cls:'sr-sentence-caption'});this.main.createEl('p',{text:q.sentence.canonical,cls:'sr-sentence-canonical'});
      if(q.card.explanation)this.main.createEl('p',{text:q.card.explanation,cls:'sr-mastery-explanation'});
      if(q.card.tips)this.main.createEl('p',{text:q.card.tips,cls:'sr-mastery-tips'});
      const next=this.main.createEl('button',{text:'次の問題に進む',cls:'sr-mastery-next'});
      next.addEventListener('click',()=>{if(this.current===q && q.state==='graded' && !this.settingsOpen)this._next();});
    }
  }
};
module.exports=phraseUI;
