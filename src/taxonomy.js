'use strict';
// Internal hierarchy uses stable tags; translated labels never enter card identities.
const LEGACY = Object.freeze({
  '大学一般':'university','大学':'university','一般':'general','英単語':'english',
  '雑学':'trivia','資格':'certifications','生物学':'biology','生物':'biology',
  '線形代数':'linear-algebra','線形代数学Ⅱ':'linear-algebra','線形代数学II':'linear-algebra',
  '工学応用数学':'applied-mathematics','関係性':'sentences','文章':'sentences','単語':'terms'
});
const LABELS = Object.freeze({
  university:'大学','university/biology':'生物','university/biology/terms':'単語',
  'university/biology/sentences':'文章','university/linear-algebra':'線形代数',
  'university/applied-mathematics':'工学応用数学',english:'英単語',trivia:'雑学',
  certifications:'資格',general:'一般','english/cefr-j':'CEFR-J','english/ngsl':'一般基礎',
  'english/nawl':'学術英語','english/toeic':'TOEIC','english/ngsl-gr':'頻度別',
  'english/programming':'プログラミング英語'
});
function tagPath(value) {
  if(typeof value!=='string')return '';
  let s=value.trim().replace(/^#?(?:flashcards|akebi)(?:\/|$)/i,'').replace(/^#+|\/+$/g,'');
  if(!s)return 'general';
  if(s.length>360 || /[\r\n<>]/.test(s) || s.split('/').some(p=>!p || p==='.' || p==='..'))return '';
  s=s.replace(/^CEFR-J\//i,'english/cefr-j/').replace(/^NGSL\/一般基礎$/i,'english/ngsl')
    .replace(/^NAWL\/学術$/i,'english/nawl').replace(/^TSL\/TOEIC$/i,'english/toeic')
    .replace(/^NGSL-GR\/(\d+)$/i,(_,n)=>'english/ngsl-gr/stage-'+String(Number(n)).padStart(2,'0'))
    .replace(/^NGSL-GR\/補助語$/i,'english/ngsl-gr/supplement');
  return s.split('/').map(p=>{
    p=p.trim();if(LEGACY[p])return LEGACY[p];
    if(/^Stage[ -]\d+$/i.test(p))return 'stage-'+String(Number(p.match(/\d+/)[0])).padStart(2,'0');
    return p.toLowerCase().replace(/\s+/g,'-');
  }).join('/');
}
function studyTags(markdown, cached=[]) {
  // Examples inside code fences are not deck declarations.
  let clean=String(markdown).replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[^\n]*(?=\n|$)/g,'\n')
    .replace(/<!--[\s\S]*?-->/g,'').replace(/%%[\s\S]*?%%/g,'');
  const tags=[...clean.matchAll(/(?:^|\s)#((?:flashcards|akebi)(?:\/[^\s#\]"',]+)?)(?=\s|$)/gm)].map(m=>m[1]);
  if(!tags.length){
    const fm=/^---\r?\n([\s\S]*?)\r?\n---/.exec(String(markdown))?.[1] || '';
    const field=/^tags:[^\n]*(?:\n[ \t]+[^\n]*)*/m.exec(fm)?.[0] || '';
    for(const m of field.matchAll(/(?:^|[\s\[,'"])(#?(?:flashcards|akebi)(?:\/[^\s\],"']+)?)(?=[\s\],"']|$)/gm))tags.push(m[1]);
  }
  if(!tags.length)for(const value of cached || [])if(typeof value==='string' && /^#?(?:flashcards|akebi)(?:\/|$)/i.test(value))tags.push(value);
  return [...new Set(tags.map(tagPath).filter(Boolean))];
}
function membershipPath(value) {
  if(/^CEFR-J\/|^NGSL\/|^NAWL\/|^TSL\/|^NGSL-GR\//i.test(value||''))return tagPath(value);
  if(/^(english|university|trivia|certifications)\//.test(value||''))return tagPath(value);
  return '';
}
function cardPaths(card,noteTags) {
  let paths=Array.isArray(card.explicitTags)&&card.explicitTags.length ? card.explicitTags.map(tagPath) : noteTags.slice();
  paths=paths.map(p=>{
    if(p==='university' && card.course)p+='/'+(LEGACY[card.course] || tagPath(card.course));
    if(p==='university/biology')p+=card.sentence?'/sentences':'/terms';
    return p;
  });
  for(const value of card.vocab?.memberships||[]){const path=membershipPath(value);if(path)paths.push(path);}
  paths=[...new Set(paths.filter(Boolean))];
  // Curriculum parents are views of their children, not duplicate cards.
  return paths.filter(p=>!paths.some(q=>q!==p && q.startsWith(p+'/')));
}
function defaultLabel(path) {
  if(LABELS[path])return LABELS[path];
  const leaf=path.split('/').pop();
  if(/^stage-\d+$/.test(leaf))return 'Stage '+Number(leaf.slice(6));
  if(/^[ab][12]$/.test(leaf))return leaf.toUpperCase();
  if(leaf==='terms')return '単語';if(leaf==='sentences')return '文章';
  if(leaf==='supplement')return '補助語';
  return leaf || 'デッキ';
}
function tagLabel(path, labels={}) {
  const custom=Object.prototype.hasOwnProperty.call(labels,path)?labels[path]:null;
  return typeof custom==='string'&&custom.trim()?custom.trim().slice(0,80):defaultLabel(path);
}
function excludedPath(path, extra=[]) {
  if(typeof path!=='string')return true;
  if(/(?:^|\/)(?:(?:\d+[_-])?(?:archives?|backups?|quarantine|trash)|node_modules)(?:\/|$)/i.test(path))return true;
  if(/\.bak(?:[-.]|$)|(?:^|\/)\./i.test(path))return true;
  return extra.some(p=>typeof p==='string' && p && (path===p || path.startsWith(p.replace(/\/$/,'')+'/')));
}
// Preserve mathematical punctuation: n! and n must not become the same answer.
const normalizeText=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
function reviewKey(card) {
  if(card.vocab?.lexemeId)return 'lexeme:'+card.vocab.lexemeId;
  return 'content:'+normalizeText(card.question)+'\u0000'+normalizeText(card.answer);
}
function dedupeCards(cards) {
  const byContent=new Map();const byId=new Map();let duplicates=0;
  const ordered=[...cards].sort((a,b)=>Number(b.id.startsWith('akebi:'))-Number(a.id.startsWith('akebi:')) || a.source.localeCompare(b.source));
  for(const c of ordered){
    c.reviewKey=reviewKey(c);
    const previous=byId.get(c.id) || byContent.get(c.reviewKey);
    if(previous){
      previous.tagPaths=[...new Set([...(previous.tagPaths||[]),...(c.tagPaths||[])])];
      previous.duplicateIds=[...new Set([...(previous.duplicateIds||[]),c.id])].filter(id=>id!==previous.id);
      duplicates++;continue;
    }
    byId.set(c.id,c);byContent.set(c.reviewKey,c);
  }
  return {cards:[...byContent.values()],duplicates};
}
function makeTree(cards) {
  const tree=new Map([['',{path:'',parent:null,children:new Set(),ids:new Set(),direct:new Set()}]]);
  for(const c of cards){
    for(const path of c.tagPaths||[tagPath(c.deck||c.genre||'general')]){
      if(!path)continue;
      const parts=path.split('/');let parent='';tree.get('').ids.add(c.id);
      for(let i=0;i<parts.length;i++){
        const key=parts.slice(0,i+1).join('/');
        if(!tree.has(key))tree.set(key,{path:key,parent,children:new Set(),ids:new Set(),direct:new Set()});
        tree.get(parent).children.add(key);tree.get(key).ids.add(c.id);parent=key;
      }
      tree.get(path).direct.add(c.id);
    }
  }
  return tree;
}
function oldSelection(settings) {
  if(typeof settings.selectedDeckTag==='string')return settings.selectedDeckTag;
  if(settings.selectedStudyVocabulary)return tagPath(settings.selectedStudyVocabulary);
  let path=tagPath(settings.selectedStudyGenre||'');
  if(['すべて','全て','all'].includes(settings.selectedStudyGenre)||!settings.selectedStudyGenre)return '';
  if(path==='university' && settings.selectedStudyCourse)path+='/'+(LEGACY[settings.selectedStudyCourse]||tagPath(settings.selectedStudyCourse));
  if(path==='university/biology' && ['word','sentence'].includes(settings.selectedStudyActivity))path+=settings.selectedStudyActivity==='sentence'?'/sentences':'/terms';
  return path;
}
module.exports={tagPath,studyTags,cardPaths,tagLabel,defaultLabel,excludedPath,reviewKey,dedupeCards,makeTree,oldSelection};
