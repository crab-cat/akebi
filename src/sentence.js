'use strict';
const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
const counter=items=>{const out=new Map();for(const t of items)out.set(norm(t),(out.get(norm(t))||0)+1);return out;};
function contains(haystack,needle){const left=counter(haystack);for(const t of needle){const k=norm(t),n=left.get(k)||0;if(!n)return false;left.set(k,n-1);}return true;}
function sameBag(a,b){return a.length===b.length && contains(a,b);}
function compactLegacy(raw){
  const particles=new Set(['は','が','を','に','へ','で','と','の','や','も','から','まで','では','として','。','、']);
  const units=[];for(const t of raw.tokens||[]){if(particles.has(t)&&units.length)units[units.length-1]+=t;else units.push(t);}
  if(units.length<3)return null;
  const prefix=units.shift(),suffix=units.pop();
  while(units.length>11){let i=0;for(let j=1;j<units.length-1;j++)if((units[j]+units[j+1]).length<(units[i]+units[i+1]).length)i=j;units.splice(i,2,units[i]+units[i+1]);}
  return {schemaVersion:2,prefix,suffix,tokens:units,distractors:(raw.distractors||[]).slice(0,4),alternatives:[],concepts:raw.concepts||[],legacy:true};
}
function studySentenceSpec(card){
  let raw=card?.sentence;if(!raw||typeof raw!=='object')return null;
  if(raw.schemaVersion===1)raw=compactLegacy(raw);
  if(!raw||![2,3].includes(raw.schemaVersion))return null;
  if(typeof raw.prefix!=='string'||typeof raw.suffix!=='string'||!raw.prefix||!raw.suffix)return null;
  let chunks;
  if(raw.schemaVersion===3){
    if(!Array.isArray(raw.chunks)||!raw.chunks.length||raw.chunks.length>4)return null;
    chunks=raw.chunks.map((c,i)=>({id:typeof c.id==='string'?c.id:'chunk-'+(i+1),label:typeof c.label==='string'?c.label:'関係 '+(i+1),mode:c.mode==='ordered'?'ordered':'bag',tokens:c.tokens,alternatives:c.alternatives||[]}));
  }else chunks=[{id:'sentence',label:'中央の文章',mode:'ordered',tokens:raw.tokens,alternatives:raw.alternatives||[]}];
  if(chunks.some(c=>!Array.isArray(c.tokens)||!c.tokens.length||c.tokens.length>12||!Array.isArray(c.alternatives)||c.alternatives.length>8))return null;
  if(new Set(chunks.map(c=>c.id)).size!==chunks.length)return null;
  const tokens=chunks.flatMap(c=>c.tokens),distractors=raw.distractors;
  if(!Array.isArray(distractors)||!distractors.length||tokens.length<3||tokens.length+distractors.length>15)return null;
  const pool=[...tokens,...distractors];
  if(pool.some(t=>typeof t!=='string'||!t.trim()||t.length>70||/[\r\n]/.test(t)))return null;
  const canonical=raw.prefix+tokens.join('')+raw.suffix;
  if(norm(canonical)!==norm(card.answer))return null;
  if(Array.isArray(raw.tokens)&&norm(raw.tokens.join(''))!==norm(tokens.join('')))return null;
  for(const chunk of chunks){
    chunk.tokens=chunk.tokens.slice();
    if(chunk.alternatives.some(a=>!Array.isArray(a)||!a.length||a.length>12||a.some(t=>typeof t!=='string')||!contains(pool,a)))return null;
    chunk.alternatives=chunk.alternatives.map(a=>a.slice());
    chunk.maxLength=Math.max(chunk.tokens.length,...chunk.alternatives.map(a=>a.length));
    chunk.lengths=[...new Set([chunk.tokens.length,...chunk.alternatives.map(a=>a.length)])];
  }
  return {schemaVersion:raw.schemaVersion,prefix:raw.prefix,suffix:raw.suffix,tokens,distractors:distractors.slice(),chunks,
    alternatives:raw.schemaVersion===2?chunks[0].alternatives:[],canonical,
    maxLength:chunks.reduce((s,c)=>s+c.maxLength,0),concepts:Array.isArray(raw.concepts)?raw.concepts.filter(t=>typeof t==='string'):[],legacy:!!raw.legacy};
}
function studySentenceGrade(spec,selected){
  if(!spec||!Array.isArray(selected))return {correct:false,chunks:[]};
  const inputs=spec.schemaVersion===3 ? selected : [Array.isArray(selected[0])?selected[0]:selected];
  if(inputs.length!==spec.chunks.length||inputs.some(a=>!Array.isArray(a)))return {correct:false,chunks:spec.chunks.map(()=>false)};
  const text=inputs.map(a=>a.map(t=>typeof t==='string'?t:t?.text));
  if(text.flat().some(t=>typeof t!=='string') || !contains([...spec.tokens,...spec.distractors],text.flat()))return {correct:false,chunks:spec.chunks.map(()=>false)};
  const results=spec.chunks.map((c,i)=>[c.tokens,...c.alternatives].some(a=>
    c.mode==='bag'?sameBag(a,text[i]):(a.length===text[i].length && a.every((v,j)=>norm(v)===norm(text[i][j])))));
  return {correct:results.every(Boolean),chunks:results};
}
function studySentenceAccepted(spec,selected){return studySentenceGrade(spec,selected).correct;}
function studySentenceBank(spec){
  if(!spec)return [];const tiles=[...spec.tokens,...spec.distractors];
  for(let i=tiles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  return tiles.map((text,i)=>({id:'piece-'+i,text}));
}
module.exports={studySentenceSpec,studySentenceGrade,studySentenceAccepted,studySentenceBank};
