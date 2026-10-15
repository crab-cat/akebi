const { Modal, Notice, setIcon, getAllTags } = require('obsidian');
// Akebi learning engine. Locally parsed Markdown; no upstream plugin dependency.
const STUDY_LEVELS = ["unseen", "weak", "known", "perfect"];
const STUDY_LABELS = {
  unseen: "やってない",
  weak: "苦手",
  known: "わかる",
  perfect: "完璧"
};

// Beta-evidence mastery model, inspired by Performance Factors Analysis.
// It is NOT FSRS and does not write a new interval to the native scheduler.
//
//   Ease = E[p] = alpha / (alpha + beta)
//   w_correct(t) = (1.15 + 6.8 exp(-(t / (0.45 * tau))^1.2)
//                     + 0.65 exp(-t / (2 * tau)))
//                  * (choice ? 0.90 : 1)
//   consecutive correct multiplier = 1 + 0.07 * min(previousStreak, 5)
//   w_wrong = 0.65 (timeout: 0.95). Past successes keep their value.
//
// Correct increments alpha, incorrect increments beta. These are weighted
// pseudo-counts, NOT independent Bernoulli trials or a calibrated retention
// probability. The bounded effective sample size keeps the model responsive.
const STUDY_EASE_VERSION = 2;
const STUDY_EASE_KNOWN = 0.60;
const STUDY_EASE_PERFECT = 0.82;
const STUDY_PRIORS = Object.freeze({
  unseen: [1.0, 1.0],
  weak: [1.0, 2.5],
  known: [3.5, 1.4],
  perfect: [10.0, 1.0]
});

function studyMasteryNext(previous, correct, evidence, timestamp) {
  const before = previous || {};
  const prevStage = STUDY_LEVELS.includes(before.stage) ? before.stage : "unseen";
  const prior = STUDY_PRIORS[prevStage];

  // Existing mastery.json records have stage/counters only. Assign
  // conservative pseudo-count priors from that stage on first update;
  // preserve the original counters, never reinterpret old timings.
  const existing = before.modelVersion === STUDY_EASE_VERSION && before.evidence;
  let alpha = existing && Number.isFinite(existing.alpha) && existing.alpha > 0
    ? existing.alpha : prior[0];
  let beta = existing && Number.isFinite(existing.beta) && existing.beta > 0
    ? existing.beta : prior[1];

  // Old callers can supply a boolean; new callers supply elapsed time,
  // mode, and the explicit confidence rating independently.
  const opts = evidence && typeof evidence === "object"
    ? evidence : {
      reactionMs: evidence ? 0 : 2000, easyMs: 1000,
      mode: "slide", explicitPerfect: false, timedOut: false
    };
  const elapsedMs = Number.isFinite(opts.reactionMs) ? Math.max(0, opts.reactionMs) : 60000;
  const easyMs = Number.isFinite(opts.easyMs)
    ? Math.max(250, opts.easyMs) : 1000;
  const manualBonus = opts.explicitPerfect ? 1.1 : 0;
  const modeWeight = opts.mode === "choice" ? 0.9 : 1.0;
  const quick = correct && !opts.timedOut && elapsedMs <= easyMs;
  // Five prior consecutive correct answers give at most a 35% bonus.
  // Any miss resets the run; historical successes continue to count in
  // alpha, so the streak is additive rather than a hard promotion gate.
  const previousStreak = before.lastWasCorrect === false ? 0
    : Math.max(0, Number(before.recoveryStreak) || 0);
  const streakBonus = correct ? 0.07 * Math.min(5, previousStreak) : 0;

  let appliedWeight;
  if (correct) {
    // Two smooth timescales: early high-confidence retrieval plus
    // a smaller, gradual latency signal throughout the countdown.
    const fastEvidence = 6.8 * Math.exp(-Math.pow(elapsedMs / (0.45 * easyMs), 1.2));
    const sustainedEvidence = 0.65 * Math.exp(-elapsedMs / (2 * easyMs));
    appliedWeight = (1.15 + fastEvidence + sustainedEvidence + manualBonus) *
      modeWeight * (1 + streakBonus);
    alpha += appliedWeight;
  } else {
    // One slip should lower confidence, not erase 3-5 solid recalls.
    appliedWeight = opts.timedOut ? 0.95 : 0.65;
    beta += appliedWeight;
  }

  // Prevent years of accumulated successes from making a lapse
  // effectively invisible; cap posterior evidence to 24 pseudo-trials.
  const mass = alpha + beta;
  if (mass > 24) {
    alpha *= 24 / mass;
    beta *= 24 / mass;
  }
  const score = alpha / (alpha + beta);
  const stage = score >= STUDY_EASE_PERFECT && correct ? "perfect"
    : score >= STUDY_EASE_KNOWN ? "known" : "weak";

  return {
    ...before,
    modelVersion: STUDY_EASE_VERSION,
    stage,
    memory: studyUpdateMemory(before, correct, opts, timestamp),
    // Floor the displayed Ease so a "わかる" 86.9 cannot show "87",
    // which visually implies it already crossed the Perfect threshold.
    ease: Math.floor(100 * score + 1e-9),
    evidence: { alpha, beta },
    lastEvidenceWeight: Number(appliedWeight.toFixed(3)),
    lastStreakBonus: Number(streakBonus.toFixed(3)),
    lastResponseMs: Math.round(elapsedMs),
    lastMode: ["choice","slide","sentence"].includes(opts.mode) ? opts.mode : "slide",
    attempts: (before.attempts || 0) + 1,
    correct: (before.correct || 0) + (correct ? 1 : 0),
    mistakes: (before.mistakes || 0) + (correct ? 0 : 1),
    recoveryStreak: correct ? (before.recoveryStreak || 0) + 1 : 0,
    quickStreak: quick ? (before.quickStreak || 0) + 1 : 0,
    lastReviewedAt: timestamp,
    lastWasCorrect: !!correct
  };
}


// FSRS-6's published power-law forgetting-curve SHAPE, with separately
// chosen conservative stability updates for this user's uncalibrated data.
// This is a local hybrid, NOT a trained FSRS-6 scheduler.
const STUDY_MEMORY_VERSION = 1;
const STUDY_DAY_MS = 86400000;
const STUDY_FORGET_DECAY = 0.1542;
const STUDY_FORGET_FACTOR = Math.pow(0.9, -1 / STUDY_FORGET_DECAY) - 1;
const STUDY_REVIEW_TARGET = 0.86; // review before likely 2-day forgetting
const STUDY_MEMORY_MAX_DAYS = 365;

function studyClamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function studySeedStability(record) {
  const saved = record?.memory;
  if (saved?.version === STUDY_MEMORY_VERSION &&
      Number.isFinite(saved.stabilityDays) && saved.stabilityDays > 0) {
    return studyClamp(saved.stabilityDays, 0.25, STUDY_MEMORY_MAX_DAYS);
  }
  // Historical mastery.json has correct/mistake counts but no spacing
  // intervals. Multiple same-day answers do NOT prove multi-week memory.
  // Lazily infer a conservative seed without rewriting old records.
  if (record?.lastWasCorrect === false || record?.stage === "weak") return 0.4;
  const correct = Math.max(0, Number(record?.correct) || 0);
  return studyClamp(
    0.66 + 0.12 * Math.log2(1 + correct) +
      (record?.stage === "perfect" ? 0.1 : 0),
    0.45, 1.25
  );
}

function studyRetrievability(elapsedDays, stabilityDays) {
  if (!Number.isFinite(elapsedDays) || !Number.isFinite(stabilityDays) ||
      stabilityDays <= 0) return null;
  return Math.pow(
    1 + STUDY_FORGET_FACTOR * Math.max(0, elapsedDays) / stabilityDays,
    -STUDY_FORGET_DECAY
  );
}

function studyMemoryDueDays(stabilityDays, target = STUDY_REVIEW_TARGET) {
  if (!Number.isFinite(stabilityDays) || stabilityDays <= 0 ||
      !Number.isFinite(target) || target <= 0 || target >= 1) return null;
  const scale = (Math.pow(target, -1 / STUDY_FORGET_DECAY) - 1) /
    STUDY_FORGET_FACTOR;
  // The due horizon can exceed the stability cap; do not mark a
  // 365-day memory as overdue while its predicted recall is still >86%.
  return studyClamp(stabilityDays * scale, 0.10, 730);
}

function studyMemoryState(record, nowMs = Date.now()) {
  if (!record?.lastReviewedAt) return null;
  const lastMs = Date.parse(record.lastReviewedAt);
  if (!Number.isFinite(lastMs)) return null;
  const stabilityDays = studySeedStability(record);
  const elapsedDays = Math.max(0, (nowMs - lastMs) / STUDY_DAY_MS);
  const retrievability = studyRetrievability(elapsedDays, stabilityDays);
  const dueDays = studyMemoryDueDays(stabilityDays);
  return {
    stabilityDays, elapsedDays, retrievability, dueDays,
    dueAt: new Date(lastMs + dueDays * STUDY_DAY_MS).toISOString(),
    due: elapsedDays >= dueDays
  };
}

function studyUpdateMemory(before, correct, options, timestamp) {
  const when = Date.parse(timestamp);
  const nowMs = Number.isFinite(when) ? when : Date.now();
  const prior = studyMemoryState(before, nowMs);
  const elapsedMs = Number.isFinite(options?.reactionMs)
    ? Math.max(0, options.reactionMs) : 60000;
  const easyMs = Math.max(250, Number(options?.easyMs) || 1000);
  const speed = Math.exp(-elapsedMs / (2 * easyMs));
  const mode = options?.mode === "choice" ? 0.9 : 1;
  let stabilityDays;

  if (correct && !prior) {
    // First apparent "perfect" is still a fragile trace: a fast choice
    // might last 1-2 days, not weeks. Same-day repetitions add only a little.
    stabilityDays = studyClamp(
      (0.6 + 0.62 * Math.exp(-elapsedMs / (1.2 * easyMs)) +
       (options?.explicitPerfect ? 0.08 : 0)) * mode,
      0.42, 1.35
    );
  } else if (correct) {
    const spacing = Math.min(1, prior.elapsedDays / 0.75);
    const spacedGrowth = 2.6 * (1 - prior.retrievability) * spacing *
      (0.85 + 0.15 * speed) * mode;
    const sameDayGrowth = 0.02 + 0.02 * speed;
    stabilityDays = studyClamp(
      prior.stabilityDays * (1 + sameDayGrowth + spacedGrowth),
      0.30, STUDY_MEMORY_MAX_DAYS
    );
  } else if (prior) {
    // A lapse calls for a prompt retry, but does not erase Ease/history.
    stabilityDays = studyClamp(
      prior.stabilityDays * (0.56 + 0.20 * (1 - prior.retrievability)),
      0.28, 1.2
    );
  } else {
    stabilityDays = 0.35;
  }
  const predicted = prior?.retrievability ?? null;
  const log = Array.isArray(before?.memory?.reviewLog)
    ? before.memory.reviewLog.slice(-31) : [];
  log.push({
    at: new Date(nowMs).toISOString(),
    elapsedDays: prior?.elapsedDays ?? null,
    predicted,
    observed: correct ? 1 : 0,
    responseMs: Math.round(elapsedMs)
  });
  const nextDueDays = studyMemoryDueDays(stabilityDays);
  return {
    version: STUDY_MEMORY_VERSION,
    stabilityDays: Number(stabilityDays.toFixed(6)),
    dueAt: new Date(nowMs + nextDueDays * STUDY_DAY_MS).toISOString(),
    lastPredicted: predicted == null ? null : Number(predicted.toFixed(4)),
    lastElapsedDays: prior?.elapsedDays ?? null,
    reviewLog: log
  };
}

function studyCalibrationSummary(records, minDays = 0.5) {
  let count = 0, predictedSum = 0, observedSum = 0, brierSum = 0;
  for (const item of Object.values(records || {})) {
    for (const row of item?.memory?.reviewLog || []) {
      if (!Number.isFinite(row.predicted) ||
          !Number.isFinite(row.elapsedDays) ||
          row.elapsedDays < minDays ||
          (row.observed !== 0 && row.observed !== 1)) continue;
      count++;
      predictedSum += row.predicted;
      observedSum += row.observed;
      brierSum += Math.pow(row.predicted - row.observed, 2);
    }
  }
  return {
    count,
    meanPredicted: count ? predictedSum / count : null,
    observedRecall: count ? observedSum / count : null,
    brier: count ? brierSum / count : null
  };
}

function studyNormalize(value) {
  return String(value || "")
    .normalize("NFKC").replace(/\s+/g, "")
    .replace(/[?？!！。:：]/g, "").trim();
}
function studyTag(text) {
  // Explicit flashcard deck hierarchy. Skip comments and code fences.
  const cleaned = String(text).replace(/<!--[\s\S]*?-->/g, "").replace(/%%[\s\S]*?%%/g, "");
  const match = cleaned.match(/(?:^|\s)#(?:flashcards|akebi)(?:\/([^\s#\]]+))?(?=\s|$)/m);
  if (!match) return null;
  return match[1] || "一般";
}
// Card-local multiple-choice metadata. Stored in a hidden Obsidian comment
// immediately after the card and its optional native SR schedule comment.
const STUDY_MC_PREFIX = "%%RMUX ";
const STUDY_MC_PATTERN = /^\s*%%(?:RMUX|AKEBI)\s+(\{.*\})\s*%%\s*$/;
const STUDY_SR_PATTERN = /^\s*<!--SR:[^>]*-->\s*$/;

function studyReadMetadata(lines, cardLine) {
  let offset = cardLine + 1;
  if (STUDY_SR_PATTERN.test(lines[offset] || "")) offset++;
  const match = STUDY_MC_PATTERN.exec(lines[offset] || "");
  if (!match) return null;
  try {
    const item = JSON.parse(match[1]);
    return item && typeof item === "object" && !Array.isArray(item) ? item : null;
  } catch (_) { return null; }
}

function studyMetadataForCard(card) {
  const dummies = card.dummies;
  if (!Array.isArray(dummies) || dummies.length !== 3 ||
      dummies.some(x => typeof x !== "string" || !x.trim()) ||
      new Set(dummies.map(studyNormalize)).size !== 3) return null;
  const chosen = typeof card.choiceAnswer === "string" && card.choiceAnswer.trim()
    ? card.choiceAnswer.trim() : card.answer;
  if (!chosen || !studyNormalize(card.answer).includes(studyNormalize(chosen))) return null;
  if (dummies.some(x => studyNormalize(x) === studyNormalize(chosen))) return null;
  return { correct: chosen, options: studyShuffle([chosen, ...dummies]) };
}

function studyUpdateNoteMetadata(markdown, question, dummies, explanation, choiceAnswer, tips = null) {
  const normalized = studyNormalize(question);
  const lines = String(markdown).split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(" :: ") || line.trim().startsWith("%%") ||
        line.trim().startsWith("<!--")) continue;
    const head = line.split(" :: ")[0].trim();
    if (studyNormalize(head) === normalized) matches.push(i);
  }
  if (matches.length !== 1) throw new Error("同じ問題が見つからないか、重複しています");
  const row = matches[0];
  const insertAt = row + (STUDY_SR_PATTERN.test(lines[row + 1] || "") ? 2 : 1);
  const current = studyReadMetadata(lines, row) || {};
  // Preserve imported Anki provenance/audio and extension fields during edits.
  const metadata = { ...current, dummies, explanation };
  if (choiceAnswer && choiceAnswer.trim()) metadata.choiceAnswer = choiceAnswer.trim();
  else delete metadata.choiceAnswer;
  // Existing editor callers that do not supply tips must not erase them.
  const nextTips = tips === null ? (current.tips || "") : String(tips || "").trim();
  if (nextTips) metadata.tips = nextTips;
  else delete metadata.tips;
  const encoded = STUDY_MC_PREFIX + JSON.stringify(metadata) + "%%";
  if (STUDY_MC_PATTERN.test(lines[insertAt] || "")) lines[insertAt] = encoded;
  else lines.splice(insertAt, 0, encoded);
  const newline = String(markdown).includes("\r\n") ? "\r\n" : "\n";
  return lines.join(newline);
}

function studyCourseFromNote(markdown, file, tag) {
  // Course is derived from existing class frontmatter, not copied into
  // newly invented tags. Original university notes remain untouched.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] || "";
  const field = fm.split(/\r?\n/).find(row => /^class:\s*/.test(row));
  if (field) {
    const raw = field.replace(/^class:\s*/, "").trim().replace(/^["']|["']$/g, "");
    const wiki = /^\[\[([^\]]+)\]\]$/.exec(raw);
    const text = wiki ? wiki[1].split("|").pop() : raw;
    const course = text.split("/").pop().replace(/\.md$/, "").trim();
    if (course && course !== "null" && course !== "[]") return course;
  }
  if (tag.startsWith("大学一般/")) return tag.slice("大学一般/".length).split("/")[0];
  return null;
}

function studyCards(file, markdown, tag) {
  const result = [];
  let inFence = false;
  const course = studyCourseFromNote(markdown, file, tag);
  const folder = (file.path || "").split("/").slice(0, -1).join("/");
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*`{3,}/.test(line)) { inFence = !inFence; continue; }
    if (inFence || line.trim().startsWith("<!--") || line.trim().startsWith("%%")) continue;
    const match = line.match(/^\s*(?![-#|])(.+?)\s+::\s+(.+?)\s*(?:<!--SR:.*?-->)?\s*$/);
    if (!match) continue;
    const question = match[1].trim();
    const answer = match[2].replace(/<!--SR:[\s\S]*?-->/g, "").trim();
    if (!question || !answer || question.length > 500 || answer.length > 1000) continue;
    const metadata = studyReadMetadata(lines, index);
    result.push({
      id: typeof metadata?.akebi?.id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(metadata.akebi.id)
        ? "akebi:" + metadata.akebi.id : file.path + "::" + studyNormalize(question),
      legacyId: file.path + "::" + studyNormalize(question),
      source: file.path,
      question,
      answer,
      dummies: Array.isArray(metadata?.dummies) ? metadata.dummies.slice() : [],
      explanation: typeof metadata?.explanation === "string" ? metadata.explanation : "",
      tips: typeof metadata?.tips === "string" ? metadata.tips : "",
      audio: Array.isArray(metadata?.audio) ? metadata.audio.filter(p => typeof p === "string") : [],
      anki: metadata?.anki && typeof metadata.anki === "object" ? metadata.anki : null,
      vocab: metadata?.vocab && typeof metadata.vocab === "object" ? metadata.vocab : null,
      choiceAnswer: typeof metadata?.choiceAnswer === "string" ? metadata.choiceAnswer : "",
      sentence: metadata?.sentence && typeof metadata.sentence === "object"
        ? metadata.sentence : null,
      // A native SR schedule comment means the card has been reviewed
      // previously, even if its next due date is in the future.
      studied: /<!--SR:/.test(line) || /<!--SR:/.test(lines[index + 1] || ""),
      nativeDue: /<!--SR:!(\d{4}-\d{2}-\d{2})/.exec(line + (lines[index+1] || ""))?.[1] || null,
      genre: tag.split("/")[0],
      deck: tag,
      course,
      folder
    });
  }
  return result;
}

function studyOptions(card, peers, curated) {
  // The original Markdown answer and three manually specified wrong
  // answers are the source of truth; the note-local data comes first.
  const local = studyMetadataForCard(card);
  if (local) return local;

  // Pre-migration fallback only; no generated random answers from
  // adjacent cards (those often do not represent plausible confusions).
  const spec = curated?.[card.question];
  if (spec && Array.isArray(spec.choices) && spec.choices.length === 4 &&
    new Set(spec.choices.map(studyNormalize)).size === 4 &&
    spec.choices.includes(spec.correct) &&
    studyNormalize(card.answer).includes(studyNormalize(spec.correct))) {
    return { correct: spec.correct, options: studyShuffle(spec.choices) };
  }
  return null; // New cards without dummies fall back to slide mode.
}


// Sentence puzzles use curated Japanese word/particle tiles to preserve
// technical terms. Alternatives are explicit, never guessed by a parser.
function studyCompactLegacy(raw) {
  const particles=new Set(["は","が","を","に","へ","で","と","の","や","も","から","まで","では","として","。","、"]);
  const compact=[];
  for(const t of raw.tokens || []) {
    if(particles.has(t) && compact.length) compact[compact.length-1]+=t;
    else compact.push(t);
  }
  if(compact.length<3) return null;
  const prefix=compact.shift(), suffix=compact.pop();
  // Preserve exact text while grouping adjacent phrase units; no semantic guesses.
  while(compact.length>11) {
    let i=0;
    for(let j=1;j<compact.length-1;j++) if((compact[j]+compact[j+1]).length<(compact[i]+compact[i+1]).length)i=j;
    compact.splice(i,2,compact[i]+compact[i+1]);
  }
  return {schemaVersion:2,prefix,suffix,tokens:compact,distractors:(raw.distractors||[]).slice(0,4),alternatives:[],concepts:raw.concepts||[],legacy:true};
}
function studySentenceSpec(card) {
  let raw=card?.sentence;
  if(!raw || typeof raw!=="object")return null;
  if(raw.schemaVersion===1)raw=studyCompactLegacy(raw);
  if(!raw || raw.schemaVersion!==2 || !Array.isArray(raw.tokens) || !Array.isArray(raw.distractors))return null;
  if(raw.tokens.length<3 || raw.tokens.length>12 || raw.tokens.length+raw.distractors.length>15 || raw.distractors.length<1)return null;
  if(typeof raw.prefix!=="string" || typeof raw.suffix!=="string" || !raw.prefix || !raw.suffix)return null;
  const all=[...raw.tokens,...raw.distractors];
  if(all.some(t=>typeof t!=="string" || !t.trim() || t.length>70 || /[\r\n]/.test(t)))return null;
  const norm=t=>String(t).normalize('NFKC').replace(/\s+/g,'');
  const canonical=raw.prefix+raw.tokens.join('')+raw.suffix;
  if(norm(canonical)!==norm(card.answer))return null;
  const multiset=new Map();
  for(const t of all)multiset.set(t,(multiset.get(t)||0)+1);
  const alternatives=[];
  for(const a of raw.alternatives||[]){
    if(!Array.isArray(a) || a.length<1 || a.length>12)continue;
    const left=new Map(multiset);let valid=true;
    for(const t of a){if(!(left.get(t)>0)){valid=false;break;}left.set(t,left.get(t)-1);}
    if(valid)alternatives.push(a.slice());
  }
  return {prefix:raw.prefix,suffix:raw.suffix,tokens:raw.tokens.slice(),distractors:raw.distractors.slice(),alternatives,
    concepts:Array.isArray(raw.concepts)?raw.concepts.filter(x=>typeof x==='string'):[],canonical,
    maxLength:Math.max(raw.tokens.length,...alternatives.map(a=>a.length)),legacy:!!raw.legacy};
}
function studySentenceAccepted(spec, selected) {
  if(!spec || !Array.isArray(selected))return false;
  const norm=t=>String(t).normalize('NFKC').replace(/\s+/g,'');
  const selectedText=selected.map(t=>typeof t==='string'?t:t?.text);
  if(selectedText.some(t=>typeof t!=='string'))return false;
  // Also enforce tile multiplicity; neither duplicate reuse nor a missing tile is valid.
  const counts=new Map();
  for(const t of [...spec.tokens,...spec.distractors])counts.set(t,(counts.get(t)||0)+1);
  for(const t of selectedText){if(!(counts.get(t)>0))return false;counts.set(t,counts.get(t)-1);}
  const actual=norm(selectedText.join(''));
  return [spec.tokens,...spec.alternatives].some(a=>a.length===selectedText.length && norm(a.join(''))===actual);
}
function studySentenceBank(spec) {
  return spec ? studyShuffle([...spec.tokens,...spec.distractors]).map((text,i)=>({id:'piece-'+i,text})) : [];
}
function studyShuffle(list) {
  const copy=[...list];
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
}


class AkebiStudyModal extends Modal {
  constructor(app, companion) {
    super(app);
    this.owner = companion;
    this.win = this.contentEl.ownerDocument?.defaultView || globalThis;
    this.cards = [];
    this.filtered = [];
    this.queue = [];
    this.current = null;
    this.selectedGenre = this.owner.settings.selectedStudyGenre || "すべて";
    this.selectedStage = this.owner.settings.selectedStudyStage || "all";
    this.selectedCourse = this.owner.settings.selectedStudyCourse || null;
    this.selectedFolder = this.owner.settings.selectedStudyFolder || null;
    this.selectedVocabulary = this.owner.settings.selectedStudyVocabulary || "";
    this.selectedActivity = this.owner.settings.selectedStudyActivity || "all";
    this.browseSubdecks = !!(this.selectedCourse || this.selectedFolder || this.selectedVocabulary ||
      this.owner.settings.selectedStudyBrowseSubdecks);
    this.screen = "home";
    this.settingsOpen = false;
    this.soundContext = null;
    this._ticker = null;
    this._saving = Promise.resolve();
    this._token = 0;
    this.rep = null;
    this.repHistory = [];
    this._celebrationTimer = null;
  }

  onOpen() {
    this.modalEl.addClass("sr-mastery-modal", "akebi-modal");
    this.modalEl.setAttribute("aria-label", "akebi 学習");
    this.contentEl.empty();
    this._renderShell();
    this._renderLoading();
    void this._loadCards().then(() => {
      if (this._closed) return;
      this._renderHome();
    }).catch(err => {
      this._showError("カードを読み込めませんでした: " + String(err.message || err));
    });
    this._ticker = this.win.setInterval(() => this._tick(), 80);
  }

  onClose() {
    this._stopPronunciation?.();
    this._closed = true;
    // Grade writes run immediately after every response; closing a
    // half-finished Rep waits for the latest snapshot and retries on error.
    void this.owner._flushMastery?.();
    this.win.clearInterval(this._ticker);
    this._stopCelebration();
    this.current = null;
    this.contentEl.empty();
    try { this.soundContext?.close(); } catch (_) {}
    this.owner._studyModal = null;
  }

  _renderShell() {
    const shell = this.contentEl.createDiv({ cls: "sr-mastery-shell" });
    this.shell = shell;
    const top = shell.createDiv({ cls: "sr-mastery-topbar" });
    const gear = top.createEl("button", { cls: "sr-mastery-gear" });
    setIcon(gear, "settings-2");
    gear.type = "button";
    gear.setAttribute("aria-label", "学習設定を開く");
    gear.addEventListener("click", () => this._openSettings());
    const title = top.createDiv({ cls: "sr-mastery-heading", text: "akebi · " + this.owner.manifest.version });
    const home = top.createEl("button", { text: "デッキ", cls: "sr-mastery-home-button" });
    home.addEventListener("click", () => {
      // Leaving before Rep completion must not discard already graded
      // ease/streak updates.
      void this.owner._flushMastery?.();
      this._pause(true);
      this.screen = "home";
      this._renderHome();
    });
    this.main = shell.createDiv({ cls: "sr-mastery-main" });
    this.settingsLayer = shell.createDiv({ cls: "sr-mastery-settings" });
    this.settingsLayer.hidden = true;
  }

  _renderLoading() {
    this.main.replaceChildren();
    this.main.createEl("p", { text: "カードを読み込んでいます…" });
  }
  _showError(message) {
    this.main.replaceChildren();
    this.main.createEl("p", { text: message });
    const back = this.main.createEl("button", { text: "戻る" });
    back.addEventListener("click", () => this._renderHome());
  }

  async _loadCards() {
    const files = this.app.vault.getMarkdownFiles();
    const collected = [];
    // Serial reads avoid spiking memory/IO on iPhone. Metadata cache is
    // not guaranteed to be warm, so read every eligible plain Markdown.
    for (const file of files) {
      if (this._closed) return;
      const cache = this.app.metadataCache.getFileCache(file);
      const cachedTags = cache ? (getAllTags(cache) || []) : null;
      if (cachedTags && !cachedTags.some(t=>t === "#flashcards" || t.startsWith("#flashcards/") || t === "#akebi" || t.startsWith("#akebi/"))) continue;
      const raw = await this.app.vault.cachedRead(file);
      if (!raw.includes("#flashcards") && !raw.includes("#akebi")) continue;
      const tag = studyTag(raw);
      if (tag) collected.push(...studyCards(file, raw, tag));
    }
    this.invalidSentenceCount=collected.filter(c=>c.sentence && !studySentenceSpec(c)).length;
    this.cards = [...new Map(collected.filter(card => card.vocab?.quizEnabled !== false &&
      (!card.sentence || studySentenceSpec(card)))
      .map(card => [card.id, card])).values()];
    await this.owner.adoptCardIds(this.cards);
    // Upgrade a stored old "A1 entire level" selection to the smaller
    // Stage 1 without moving notes or touching any mastery records.
    const firstStage = this.selectedVocabulary + "/Stage 01";
    if (/^CEFR-J\/(A1|A2|B1|B2)$/.test(this.selectedVocabulary) &&
        this.cards.some(c => (c.vocab?.memberships || []).includes(firstStage))) {
      this.selectedVocabulary = firstStage;
      this._saveBrowserPreferences();
    }
  }

  _level(card, nowMs = Date.now()) {
    // "Perfect" represents learned strength. Once predicted recall
    // reaches the review threshold, surface it as "Known" again without
    // mutating the stored Ease, historical successes or native SR data.
    const record = this.owner._mastery?.[card.id];
    const level = record?.stage || (card.studied ? "known" : "unseen");
    if (level === "perfect" && studyMemoryState(record, nowMs)?.due) {
      return "known";
    }
    return level;
  }

  _isDue(card, nowMs = Date.now()) {
    const record = this.owner._mastery?.[card.id];
    return record ? !!studyMemoryState(record, nowMs)?.due : !!(card.nativeDue && Date.parse(card.nativeDue) <= nowMs);
  }

  _stats(cards) {
    const result = { unseen: 0, weak: 0, known: 0, perfect: 0 };
    for (const card of cards) result[this._level(card)]++;
    return result;
  }

  _renderDonut(parent, stats, compact = false) {
    const total = STUDY_LEVELS.reduce((sum, stage) => sum + stats[stage], 0);
    const colors = {
      unseen: "var(--text-faint)",
      weak: "var(--sr-mastery-weak)",
      known: "var(--sr-mastery-known)",
      perfect: "var(--sr-mastery-perfect)"
    };
    const chart = parent.createDiv({
      cls: "sr-mastery-donut" + (compact ? " is-mini" : "")
    });
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", STUDY_LEVELS.map(stage =>
      STUDY_LABELS[stage] + " " + stats[stage] + "問").join("、"));
    const slices = [];
    let position = 0;
    if (total) {
      for (const stage of STUDY_LEVELS) {
        if (!stats[stage]) continue;
        const from = position;
        position += 100 * stats[stage] / total;
        slices.push(colors[stage] + " " + from.toFixed(2) + "% " + position.toFixed(2) + "%");
      }
    }
    chart.style.background = total
      ? "conic-gradient(from 0deg, " + slices.join(", ") + ")"
      : "var(--background-modifier-border)";
    chart.createSpan({ cls: "sr-mastery-donut-count", text: String(total) });
    return chart;
  }

  _genreList() {
    return ["すべて", ...new Set(this.cards.map(x => x.genre))].sort((a, b) =>
      a === "すべて" ? -1 : b === "すべて" ? 1 : a.localeCompare(b, "ja")
    );
  }

  _saveBrowserPreferences() {
    const settings = this.owner.settings;
    settings.selectedStudyStage = this.selectedStage;
    settings.selectedStudyGenre = this.selectedGenre;
    settings.selectedStudyCourse = this.selectedCourse || "";
    settings.selectedStudyFolder = this.selectedFolder || "";
    settings.selectedStudyVocabulary = this.selectedVocabulary || "";
    settings.selectedStudyActivity = this.selectedActivity || "all";
    settings.selectedStudyBrowseSubdecks = this.browseSubdecks;
    void this.owner.saveData(settings);
  }

  _matchesDeck(card) {
    if (this.selectedGenre !== "すべて" && card.genre !== this.selectedGenre) return false;
    if (this.selectedCourse && card.course !== this.selectedCourse) return false;
    if (this.selectedFolder && card.folder !== this.selectedFolder) return false;
    if (this.selectedVocabulary && !(card.vocab?.memberships || []).includes(this.selectedVocabulary)) return false;
    if (this.selectedCourse && this.selectedGenre === "大学一般" &&
        this.selectedActivity === "sentence" && !studySentenceSpec(card)) return false;
    if (this.selectedCourse && this.selectedGenre === "大学一般" &&
        this.selectedActivity === "word" && !!studySentenceSpec(card)) return false;
    return true;
  }

  _vocabularyLabel(id) {
    const match = /^CEFR-J\/(A1|A2|B1|B2)\/Stage (\d+)$/.exec(id || "");
    if (match) return "CEFR-J " + match[1] + " · Stage " + Number(match[2]);
    const named = { "CEFR-J/A1": "CEFR-J A1", "CEFR-J/A2": "CEFR-J A2",
      "CEFR-J/B1": "CEFR-J B1", "CEFR-J/B2": "CEFR-J B2",
      "NGSL/一般基礎": "NGSL 一般基礎", "NAWL/学術": "NAWL 学術英語",
      "TSL/TOEIC": "TSL TOEIC", "NGSL-GR/補助語": "NGSL-GR 補助語" };
    return named[id] || (id.startsWith("NGSL-GR/") ? "NGSL-GR 段階 " + Number(id.split("/")[1]) : id);
  }

  _renderVocabularyBrowser(parent, cards) {
    const panel = parent.createDiv({ cls: "sr-mastery-vocabulary-browser" });
    const groups = [
      ["CEFR-Jのレベル", ["CEFR-J/A1","CEFR-J/A2","CEFR-J/B1","CEFR-J/B2"]],
      ["目的・使用頻度", ["NGSL/一般基礎","NAWL/学術","TSL/TOEIC"]],
      ["NGSL-GRの段階", ["NGSL-GR/補助語", ...Array.from({length:11},(_,i)=>"NGSL-GR/"+String(i+1).padStart(2,"0"))]]
    ];
    for (const [title, ids] of groups) {
      if (!ids.some(id=>cards.some(c=>(c.vocab?.memberships||[]).includes(id)))) continue;
      const section = title.startsWith("NGSL-GR")
        ? panel.createEl("details", { cls: "sr-mastery-vocabulary-extra" }) : panel;
      section.createEl(title.startsWith("NGSL-GR") ? "summary" : "h4", { text: title });
      const row = section.createDiv({ cls: "sr-mastery-vocabulary-facets" });
      for (const id of ids) {
        const count=cards.filter(c=>(c.vocab?.memberships||[]).includes(id)).length;
        if (!count) continue;
        const btn=row.createEl("button", { text: this._vocabularyLabel(id)+" · "+count+"問", cls:"sr-mastery-vocabulary-filter" });
        btn.setAttribute("data-vocabulary",id);
        btn.setAttribute("aria-pressed",String(this.selectedVocabulary===id));
        btn.classList.toggle("is-selected",this.selectedVocabulary===id);
        btn.addEventListener("click",()=>{
          // Select a manageable Stage 1 rather than making the learner
          // begin an intimidating 1,000-2,800 item level by default.
          const firstStage = id + "/Stage 01";
          this.selectedVocabulary = title === "CEFR-Jのレベル" &&
            cards.some(c => (c.vocab?.memberships || []).includes(firstStage))
            ? firstStage : id;
          this.selectedCourse=null;this.selectedFolder=null;
          this._saveBrowserPreferences();this._renderHome();
        });
      }
      if (title === "CEFR-Jのレベル") {
        const selected = /^CEFR-J\/(A1|A2|B1|B2)(?:\/Stage \d+)?$/.exec(this.selectedVocabulary || "");
        if (selected) {
          const parentTag = "CEFR-J/" + selected[1];
          const stages = [...new Set(cards.flatMap(c => c.vocab?.memberships || [])
            .filter(tag => tag.startsWith(parentTag + "/Stage ")))]
            .sort((a,b) => Number(a.split("Stage ")[1]) - Number(b.split("Stage ")[1]));
          if (stages.length) {
            const stageHeader = panel.createEl("h4", {
              text: "CEFR-J " + selected[1] + " — Stage別（約230〜250問）"
            });
            const stageGrid = panel.createDiv({
              cls: "sr-mastery-vocabulary-facets sr-mastery-vocabulary-stages"
            });
            for (const stageId of stages) {
              const scoped = cards.filter(c => (c.vocab?.memberships || []).includes(stageId));
              const stageNumber = Number(stageId.split("Stage ")[1]);
              const button = stageGrid.createEl("button", {
                text: "Stage " + stageNumber + " · " + scoped.length + "問",
                cls: "sr-mastery-vocabulary-filter sr-mastery-vocabulary-stage"
              });
              button.setAttribute("data-vocabulary", stageId);
              button.setAttribute("aria-pressed", String(this.selectedVocabulary === stageId));
              button.classList.toggle("is-selected", this.selectedVocabulary === stageId);
              button.addEventListener("click", () => {
                this.selectedVocabulary = stageId;
                this.selectedCourse = null;
                this.selectedFolder = null;
                this._saveBrowserPreferences();
                this._renderHome();
              });
            }
          }
        }
      }
    }
    panel.createEl("p",{cls:"sr-mastery-caption",text:"CEFR-JはStageごと約230〜250問。目的別・段階別は同じカードの別分類なのでEaseを共有します。"});
  }

  _renderSubdeckBrowser(parent) {
    const container = parent.createDiv({ cls: "sr-mastery-subdeck-browser" });
    const back = container.createEl("button", {
      text: "‹ ジャンルに戻る", cls: "sr-mastery-subdeck-back"
    });
    back.addEventListener("click", () => {
      this.selectedVocabulary = "";
      this.browseSubdecks = false;
      this.selectedVocabulary = "";
      this.selectedCourse = null;
      this.selectedFolder = null;
      this._saveBrowserPreferences();
      this._renderHome();
    });
    container.createEl("h3", { text: this.selectedGenre === "すべて"
      ? "フォルダ別" : this.selectedGenre + (this.selectedGenre === "英単語" ? " › レベル・目的別" : " › 授業・フォルダ別") });

    const scoped = this.cards.filter(c =>
      this.selectedGenre === "すべて" || c.genre === this.selectedGenre);
    const all = container.createEl("button", {
      text: "このジャンルの全て · " + scoped.length + "問",
      cls: "sr-mastery-subdeck-all"
    });
    all.classList.toggle("is-selected", !this.selectedCourse && !this.selectedFolder && !this.selectedVocabulary);
    all.addEventListener("click", () => {
      this.selectedCourse = null;
      this.selectedFolder = null;
      this._saveBrowserPreferences();
      this._renderHome();
    });

    if (this.selectedGenre === "英単語") this._renderVocabularyBrowser(container, scoped);

    const courses = [...new Set(scoped.map(c => c.course).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,"ja"));
    if (courses.length) {
      container.createEl("h4", { text: "授業ごとのデッキ" });
      const group = container.createDiv({ cls: "sr-mastery-subdeck-group" });
      for (const course of courses) {
        const count = scoped.filter(c => c.course === course).length;
        const button = group.createEl("button", {
          text: course + " · " + count + "問",
          cls: "sr-mastery-subdeck-course"
        });
        button.classList.toggle("is-selected", this.selectedCourse === course);
        button.setAttribute("aria-pressed", String(this.selectedCourse === course));
        button.addEventListener("click", () => {
          this.selectedVocabulary = "";
          this.selectedCourse = course;
          this.selectedFolder = null;
          this.selectedActivity = "all";
          this._saveBrowserPreferences();
          this._renderHome();
        });
      }
    }

    if (this.selectedGenre === "大学一般" && this.selectedCourse) {
      const courseCards = scoped.filter(c => c.course === this.selectedCourse);
      const relational = courseCards.filter(c => studySentenceSpec(c));
      if (relational.length) {
        container.createEl("h4", { text: "学習内容" });
        const modes = container.createDiv({ cls: "sr-mastery-activity-filters" });
        for (const [key, label, count] of [
          ["all", "全て", courseCards.length],
          ["word", "単語・用語", courseCards.length - relational.length],
          ["sentence", "関係性・文組み立て", relational.length]
        ]) {
          const button = modes.createEl("button", {
            text: label + " · " + count + "問", cls: "sr-mastery-activity-filter"
          });
          button.setAttribute("data-activity", key);
          button.setAttribute("aria-pressed", String(this.selectedActivity === key));
          button.classList.toggle("is-selected", this.selectedActivity === key);
          button.addEventListener("click", () => {
            this.selectedActivity = key;
            this._saveBrowserPreferences();
            this._renderHome();
          });
        }
      }
    }
    const folders = [...new Set(scoped.map(c => c.folder).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,"ja"));
    if (folders.length) {
      container.createEl("h4", { text: "保存フォルダごとのデッキ" });
      const group = container.createDiv({ cls: "sr-mastery-subdeck-group" });
      for (const folder of folders) {
        const count = scoped.filter(c => c.folder === folder).length;
        const name = folder.split("/").pop() || folder;
        const button = group.createEl("button", {
          text: name + " · " + count + "問",
          cls: "sr-mastery-subdeck-folder"
        });
        button.setAttribute("title", folder);
        button.classList.toggle("is-selected", this.selectedFolder === folder);
        button.setAttribute("aria-pressed", String(this.selectedFolder === folder));
        button.addEventListener("click", () => {
          this.selectedVocabulary = "";
          this.selectedFolder = folder;
          this.selectedCourse = null;
          this._saveBrowserPreferences();
          this._renderHome();
        });
      }
    }
  }

  _renderHome() {
    this.current = null;
    this._stopPronunciation();
    // All routes back to the deck list (home, Rep result, back button)
    // request a persistence flush even if the Rep was not completed.
    if ((this.owner._masteryRevision ?? 0) > (this.owner._masterySavedRevision ?? 0)) {
      void this.owner._flushMastery?.();
    }
    this._stopCelebration();
    this.modalEl.classList.remove("sr-mastery-timeout-mode");
    this.screen = "home";
    this.main.replaceChildren();
    const lead = this.main.createEl("p", { text: "既に答えた問題も含め、いつでも練習できます。", cls: "sr-mastery-caption" });
    if(this.invalidSentenceCount)this.main.createEl("p",{text:this.invalidSentenceCount+"問の文組み立てを出題保留しています。正答とフレーズ構成を確認してください。",cls:"sr-mastery-caption"});
    if (this.browseSubdecks) {
      this._renderSubdeckBrowser(this.main);
    } else {
      const categories = this.main.createDiv({ cls: "sr-mastery-categories" });
      for (const genre of this._genreList()) {
        const genreCards = this.cards.filter(c => genre === "すべて" || c.genre === genre);
        const genreStats = this._stats(genreCards);
        const button = categories.createEl("button", { cls: "sr-mastery-category" });
        this._renderDonut(button, genreStats, true);
        const caption = button.createDiv({ cls: "sr-mastery-category-info" });
        caption.createSpan({
          text: ["大学一般", "英単語"].includes(genre) ? genre + " ›" : genre,
          cls: "sr-mastery-category-name"
        });
        caption.createSpan({ text: genreCards.length + "問", cls: "sr-mastery-caption" });
        if (genre === "大学一般") {
          button.setAttribute("aria-label", "大学一般を授業別・フォルダ別に開く");
        }
        if (genre === this.selectedGenre) button.classList.add("is-selected");
        button.setAttribute("aria-pressed", String(genre === this.selectedGenre));
        button.addEventListener("click", () => {
          this.selectedVocabulary = "";
          this.selectedGenre = genre;
          this.selectedCourse = null;
          this.selectedFolder = null;
          this.browseSubdecks = ["大学一般", "英単語"].includes(genre);
          this._saveBrowserPreferences();
          this._renderHome();
        });
      }
      const folders = this.main.createEl("button", {
        text: "保存フォルダから選ぶ ›", cls: "sr-mastery-folder-drill"
      });
      folders.addEventListener("click", () => {
        this.selectedVocabulary = "";
        this.selectedGenre = "すべて";
        this.selectedCourse = null;
        this.selectedFolder = null;
        this.browseSubdecks = true;
        this._saveBrowserPreferences();
        this._renderHome();
      });
    }
    const cards = this.cards.filter(c => this._matchesDeck(c));
    const stats = this._stats(cards);
    const overview = this.main.createDiv({ cls: "sr-mastery-overview" });
    this._renderDonut(overview, stats);
    const overviewDetail = overview.createDiv({ cls: "sr-mastery-overview-detail" });
    const scopeName = (this.selectedVocabulary ? this._vocabularyLabel(this.selectedVocabulary) : "") || this.selectedCourse ||
      (this.selectedFolder ? this.selectedFolder.split("/").pop() : this.selectedGenre);
    overviewDetail.createEl("strong", {
      text: scopeName + " · " + cards.length + "問"
    });
    overviewDetail.createEl("p", { cls: "sr-mastery-caption",
      text: "学習済み " + (cards.length - stats.unseen) + "問" });
    const legend = overviewDetail.createDiv({ cls: "sr-mastery-legend" });
    for (const stage of STUDY_LEVELS) {
      const item = legend.createSpan({ cls: "sr-mastery-legend-item" });
      item.createSpan({ cls: "sr-mastery-legend-dot is-" + stage });
      item.createSpan({ text: STUDY_LABELS[stage] + " " + stats[stage] });
    }
    const due = cards.filter(card => this._isDue(card));
    if (due.length) {
      const review = this.main.createEl("button", {
        text: "復習推奨 " + due.length + "問 ›",
        cls: "sr-mastery-due-start"
      });
      review.setAttribute("aria-label", "記憶の予測期限が来たカードを復習する");
      review.addEventListener("click", () => this._start(due, true));
    } else {
      const upcoming = cards.map(card =>
        studyMemoryState(this.owner._mastery?.[card.id]))
        .filter(state => state?.dueAt)
        .sort((a,b) => a.dueAt.localeCompare(b.dueAt))[0];
      if (upcoming) {
        const date = new Date(upcoming.dueAt);
        this.main.createEl("p", {
          cls: "sr-mastery-caption sr-mastery-upcoming",
          text: "次回の復習目安：" +
            date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
        });
      }
    }
    const statRow = this.main.createDiv({ cls: "sr-mastery-stats" });
    // First row: 未着手・苦手・わかる / second: 全て・完璧.
    const stages = ["unseen", "weak", "known", "all", "perfect"];
    for (const stage of stages) {
      const amount = stage === "all" ? cards.length : stats[stage];
      const button = statRow.createEl("button");
      button.type = "button";
      button.className = "sr-mastery-stat";
      const name = stage === "all" ? "全て" : STUDY_LABELS[stage];
      button.textContent = name + " " + amount;
      button.classList.toggle("is-selected", this.selectedStage === stage);
      button.addEventListener("click", () => {
        this.selectedStage = stage;
        this._saveBrowserPreferences();
        this._renderHome();
      });
    }
    const start = this.main.createEl("button", { text: "学習を始める", cls: "sr-mastery-start" });
    start.disabled = cards.length === 0 ||
      (this.selectedStage !== "all" && stats[this.selectedStage] === 0);
    start.addEventListener("click", () => this._start(cards));

    if (cards.length === 0) {
      this.main.createEl("p", { text: "このジャンルにカードはありません。#flashcards/ジャンル タグをノートに付けてください。", cls: "sr-mastery-caption" });
    }
  }

  _selectionCards() {
    // The live selection, not the completed session's old queue. Re-evaluate
    // mastery after every round so "weak" and "known" can be exhausted.
    return this.cards.filter(c => this._matchesDeck(c) &&
      (this.selectedStage === "all" || this._level(c) === this.selectedStage));
  }

  _repeatSameSelection() {
    if (this.settingsOpen || !["rep-break", "done"].includes(this.screen)) return;
    const candidates = this._selectionCards();
    if (!candidates.length) return; // Cleared level: don't switch to All.
    void this.owner._flushMastery?.();
    this._start(candidates);
  }

  _start(candidates, ignoreStage = false) {
    const unique = new Map(candidates.filter(c =>
      ignoreStage || this.selectedStage === "all" ||
      this._level(c) === this.selectedStage
    ).map(card => [card.id, card]));
    this.queue = studyShuffle([...unique.values()]);
    // A weak card belongs to the NEXT Rep, never the Rep in which
    // it was just seen. Exactly one presentation per card per Rep.
    this.deferredWeak = new Map();
    this.repSeen = new Set();
    // Across new sessions, choose never-studied or oldest-reviewed
    // cards first; avoid offering the same recently answered subset.
    const reviewStamp = card => {
      const stamp = this.owner._mastery?.[card.id]?.lastReviewedAt;
      const date = stamp ? Date.parse(stamp) : NaN;
      return Number.isFinite(date) ? date : 0;
    };
    this.queue.sort((a, b) => reviewStamp(a) - reviewStamp(b));
    this.sessionStats = { attempted: 0, correct: 0 };
    this.repHistory = [];
    this.rep = {
      number: 1,
      // The setting is a MAXIMUM, not a guaranteed ten-question batch.
      // When only 3 cards match the selected deck/stage, show 0/3.
      size: Math.min(this.owner.settings.repSize || 10, this.queue.length),
      attempted: 0,
      correct: 0
    };
    this._next();
  }

  _next() {
    this._stopPronunciation();
    this._token++;
    // A previously shown card cannot be selected again in this Rep,
    // including when an older queue contains duplicates.
    while (this.queue.length && this.repSeen?.has(this.queue[0].id)) {
      // Defensive deduplication: an already shown card must not be
      // re-enqueued merely because a stale duplicate was encountered.
      this.queue.shift();
    }
    if (this.rep && this.rep.attempted > 0 &&
      (this.rep.attempted >= this.rep.size || this.queue.length === 0)) {
      this._renderRepBreak();
      return;
    }
    if (!this.queue.length) {
      this.modalEl.classList.remove("sr-mastery-timeout-mode");
      this.current = null;
      this.screen = "done";
      this.main.replaceChildren();
      this.main.createEl("h3", { text: "今回の学習は完了！" });
      this.main.createEl("p", { text: "回答 " + this.sessionStats.attempted + "回 · 正答 " + this.sessionStats.correct + "回" });
      const remaining = this._selectionCards().length;
      const again = this.main.createEl("button", {
        text: "同じジャンルをもう一度", cls: "sr-mastery-start"
      });
      again.disabled = remaining === 0;
      again.addEventListener("click", () => this._repeatSameSelection());
      const home = this.main.createEl("button", {
        text: "デッキに戻る", cls: "sr-mastery-native"
      });
      home.addEventListener("click", () => this._renderHome());
      return;
    }
    const card = this.queue.shift();
    this.repSeen?.add(card.id);
    const now = performance.now();
    this.screen = "study";
    this.current = {
      card, token: this._token, state: "front",
      limitMs: (studySentenceSpec(card) ?
        (this.owner.settings.sentenceLimitSeconds || 120) :
        this.owner.settings.recallLimitSeconds) * 1000,
      deadline: now + (studySentenceSpec(card) ?
        (this.owner.settings.sentenceLimitSeconds || 120) :
        this.owner.settings.recallLimitSeconds) * 1000,
      remainingFrozen: null, resumeAt: null, responseMs: null,
      sentence: studySentenceSpec(card),
      options: studySentenceSpec(card) ? null :
        studyOptions(card, this.cards, this.owner._curated || {}),
      choice: null, pointer: null
    };
    if (this.current.sentence) {
      this.current.sentenceBank = studySentenceBank(this.current.sentence);
      this.current.sentenceSelected = [];
      this.current.sentencePicked = null;
    }
    this._renderQuestion();
    this._tick();
  }

  _stopCelebration() {
    if (this._celebrationTimer != null) {
      this.win.clearInterval(this._celebrationTimer);
      this._celebrationTimer = null;
    }
  }

  _celebrate(parent, mood) {
    const el=parent.createDiv({cls:"akebi-celebration"});
    el.setAttribute("aria-hidden","true");
    setIcon(el,mood==="failed" ? "sprout" : "flower-2");
  }

  _renderRepBreak(repaint = false) {
    if (!repaint) {
      if (!this.rep?.attempted) return;
      const result = { ...this.rep };
      result.percent = Math.round(result.correct / result.attempted * 100);
      result.mood = result.percent >= 85 ? "jumping"
        : result.percent >= 60 ? "waving" : "failed";
      result.message = result.percent === 100
        ? "満点！しっかり覚え直せたね。"
        : result.percent >= 85
          ? "すごい！着実に身についているね。"
          : result.percent >= 60
            ? "いい調子！着実に覚えられているね"
            : "まだ伸びるよ。苦手を一緒に解き直そう";
      this._repBreakData = result;
      this.repHistory.push({ ...result });
      this._playSound(result.mood === "failed" ? "wrong" : "correct");
    }
    const rep = this._repBreakData;
    if (!rep) return;
    this.modalEl.classList.remove("sr-mastery-timeout-mode");
    this._stopCelebration();
    this.current = null;
    this.screen = "rep-break";
    this.main.replaceChildren();
    const panel = this.main.createDiv({ cls: "sr-mastery-rep-summary" });
    panel.createEl("p", { cls: "sr-mastery-caption", text: "Rep " + rep.number + " · おつかれさま！" });
    panel.createEl("h3", { text: rep.correct + "/" + rep.attempted,
      cls: "sr-mastery-rep-fraction" });
    // The fraction (e.g. 9/10) conveys accuracy; no redundant % label.
    this._celebrate(panel, rep.mood, !repaint);
    panel.createEl("p", { text: rep.message, cls: "sr-mastery-rep-words" });
    const hasPending = this.queue.length > 0 || (this.deferredWeak?.size || 0) > 0;
    const nextCandidates = hasPending ? [] : this._selectionCards();
    const remaining = nextCandidates.length;
    const stageName = this.selectedStage === "all"
      ? "全て" : STUDY_LABELS[this.selectedStage];
    const caption = hasPending
      ? "ここで一息。次のRepは準備ができてから始められます。"
      : remaining
        ? (this.selectedStage === "all"
          ? "同じジャンルを続けてもう一周できます。"
          : "「" + stageName + "」残り " + remaining + "問。同じ難易度の練習を続けられます。")
        : "「" + stageName + "」の対象は0問。この難易度は完了しました。";
    panel.createEl("p", { text: caption, cls: "sr-mastery-caption" });
    const next = panel.createEl("button", {
      text: hasPending ? "次のRepへ" : "同じジャンルをもう一度",
      cls: "sr-mastery-start"
    });
    next.disabled = !hasPending && !remaining;
    next.addEventListener("click", () => {
      if (this.settingsOpen || this.screen !== "rep-break") return;
      if (!hasPending) {
        // Restart *this exact course/folder/genre/difficulty* from live
        // mastery; cards promoted to another difficulty are excluded.
        this._repeatSameSelection();
        return;
      }
      this._stopCelebration();
      // Rotate through all unshown cards first. Only after the unique
      // pool is exhausted do incorrect cards return (still once per Rep).
      if (this.deferredWeak?.size) {
        this.queue = [...new Map([
          ...this.queue,
          ...studyShuffle([...this.deferredWeak.values()])
        ].map(card => [card.id, card])).values()];
        this.deferredWeak.clear();
      }
      this.repSeen = new Set();
      this.rep = {
        number: rep.number + 1,
        size: Math.min(this.owner.settings.repSize || 10, this.queue.length),
        attempted: 0, correct: 0
      };
      this._next();
    });
    const home = panel.createEl("button", { text: "デッキに戻る",
      cls: "sr-mastery-native" });
    home.addEventListener("click", () => this._renderHome());
  }

  _remaining() {
    const q = this.current;
    if (!q) return 0;
    // Once an answer is revealed, the clock and progress bar freeze.
    if (q.state !== "front" && q.responseMs !== null) {
      return Math.max(0, q.limitMs - q.responseMs);
    }
    if (this.settingsOpen || (q.resumeAt && performance.now() < q.resumeAt)) {
      return q.remainingFrozen ?? q.limitMs;
    }
    return Math.max(0, q.deadline - performance.now());
  }

  _elapsed() {
    if (!this.current) return 0;
    return Math.max(0, this.current.limitMs - this._remaining());
  }

  _inResumeGrace() {
    return !!(this.current?.resumeAt && performance.now() < this.current.resumeAt);
  }

  _tick() {
    const q = this.current;
    if (!q || this.screen !== "study" || this.settingsOpen) return;
    if (this.clockValue) {
      if (q.resumeAt && performance.now() < q.resumeAt) {
        this.clockValue.textContent = "1秒後に再開…";
      } else if (q.state !== "front") {
        this.clockValue.textContent = "反応 " + ((q.responseMs ?? q.limitMs) / 1000).toFixed(1) + "秒";
      } else {
        const left = this._remaining();
        this.clockValue.textContent = "残り " + (left / 1000).toFixed(1) + "秒";
        if (left <= 0) this._reveal("timeout");
      }
    }
    if (this.clockBar) {
      this.clockBar.style.width = Math.max(0, 100 * this._remaining() / q.limitMs).toFixed(1) + "%";
    }
  }

  _pause(leaving = false) {
    if (!this.current) return;
    if (leaving) { this.current = null; return; }
    if (this.current.state === "front") {
      this.current.remainingFrozen = this._remaining();
    }
  }

  _reveal(reason, keepCard = false) {
    const q = this.current;
    if (!q || q.state !== "front" || this.settingsOpen || this._inResumeGrace()) return;
    if (reason !== "timeout" && this._remaining() <= 0) reason = "timeout";
    if (reason === "timeout") {
      keepCard = false;
      this._stopPronunciation();
    }
    q.responseMs = reason === "timeout" ? q.limitMs : this._elapsed();
    q.state = "back";
    q.revealReason = reason;
    this._playSound(reason === "timeout" ? "timeout" : "reveal");
    if (reason === "timeout") {
      // Commit the failure BEFORE showing the explanation, so leaving
      // for the deck or closing the modal cannot discard this attempt.
      // The timeout feedback is then read-only: Next/swipe only navigates.
      this._rate(false, false, true);
      return;
    }
    if (keepCard) {
      // Do not detach the pointer target until this swipe finishes.
      const card = this.main.querySelector(".sr-mastery-flashcard");
      card?.querySelector(".sr-mastery-reveal")?.remove();
      card?.createEl("p", { text: q.card.answer, cls: "sr-mastery-answer" });
    } else {
      this._renderQuestion();
    }
  }

  _rate(correct, explicitPerfect = false, keepTimeoutFeedback = false) {
    const q = this.current;
    if (!q || q.state === "graded" || this.settingsOpen || this._inResumeGrace()) return;
    if (q.revealReason === "timeout" && correct) return;
    if (q.state === "front") this._reveal("manual");
    // _reveal may have turned the pending attempt into a timeout failure.
    // Never score that same question again after an asynchronous reveal.
    if (q.state === "graded" || q !== this.current) return;
    const sentenceEasyMs = Math.max(30000,
      (this.owner.settings.sentenceLimitSeconds || 120) * 500);
    const quick = !!correct && q.revealReason !== "timeout" &&
      q.responseMs <= (q.sentence ? sentenceEasyMs
        : this.owner.settings.easyThresholdSeconds * 1000);
    const old = this.owner._mastery?.[q.card.id] ??
      { stage: q.card.studied ? "known" : "unseen" };
    const next = studyMasteryNext(old, correct, {
      reactionMs: q.responseMs,
      easyMs: q.sentence ? sentenceEasyMs :
        this.owner.settings.easyThresholdSeconds * 1000,
      // Whole-sentence assembly tests recall of conceptual relationships,
      // not 4-choice recognition; reuse the original mastery evidence.
      mode: q.sentence ? "sentence" : (q.choice !== null ? "choice" : "slide"),
      explicitPerfect,
      timedOut: q.revealReason === "timeout"
    }, new Date().toISOString());
    this.owner._mastery[q.card.id] = next;
    this.owner._saveMastery();
    q.state = "graded";
    q.result = { correct, quick, stage: next.stage };
    this.sessionStats.attempted++;
    if (correct) this.sessionStats.correct++;
    if (this.rep) {
      this.rep.attempted++;
      if (correct) this.rep.correct++;
    }
    if (!correct) {
      // Review unsuccessful retrievals only after new questions have
      // been exhausted. A correct answer that merely remains "weak"
      // must NOT be forced back into the next Rep.
      this.deferredWeak.set(q.card.id, q.card);
    } else {
      this.deferredWeak.delete(q.card.id);
    }
    if (q.revealReason !== "timeout") this._playSound(correct ? "correct" : "wrong");
    // Timeout plays a single audio cue at expiry and is already graded.
    // Keep the explanation visible until the user explicitly navigates.
    if (q.revealReason === "timeout") {
      if (keepTimeoutFeedback) this._renderTimeoutOnly(q);
      else this._next();
    } else this._renderQuestion();
  }

  _sentenceCanEdit(q) {
    if (!q || q !== this.current || q.state !== "front" ||
        this.screen !== "study" || this.settingsOpen || this._inResumeGrace()) return false;
    if (this._remaining() <= 0) {
      this._reveal("timeout");
      return false;
    }
    return true;
  }

  _sentencePlace(q, id) {
    if(!this._sentenceCanEdit(q) || q.sentenceSelected.length>=q.sentence.maxLength || q.sentenceSelected.includes(id) || !q.sentenceBank.some(t=>t.id===id))return;
    q.sentenceSelected.push(id);this._refreshSentence(q);
  }
  _sentencePick(q,index) {
    if(!this._sentenceCanEdit(q) || index<0 || index>=q.sentenceSelected.length)return;
    q.sentenceSelected.splice(index,1);this._refreshSentence(q);
  }
  _sentenceSubmit(q) {
    if(!this._sentenceCanEdit(q))return;
    const lengths=[q.sentence.tokens.length,...q.sentence.alternatives.map(a=>a.length)];
    if(!lengths.includes(q.sentenceSelected.length))return;
    const byId=new Map(q.sentenceBank.map(t=>[t.id,t]));
    const chosen=q.sentenceSelected.map(id=>byId.get(id));
    if(chosen.some(t=>!t) || new Set(q.sentenceSelected).size!==chosen.length)return;
    const correct=studySentenceAccepted(q.sentence,chosen);
    q.responseMs=this._elapsed();q.state='back';q.revealReason='sentence';
    q.choice=q.sentence.prefix+chosen.map(t=>t.text).join('')+q.sentence.suffix;
    this._rate(correct);
  }
  _refreshSentence(q) {
    if(q!==this.current || !q.sentenceBoard)return;
    q.sentenceBoard.replaceChildren();
    if(!q.sentenceSelected.length)q.sentenceBoard.createSpan({text:'ここに文を組み立てる',cls:'akebi-placeholder'});
    const byId=new Map(q.sentenceBank.map(t=>[t.id,t]));
    q.sentenceSelected.forEach((id,i)=>{
      const chip=q.sentenceBoard.createEl('button',{text:byId.get(id).text,cls:'sr-sentence-chip sr-sentence-selected'});
      chip.type='button';chip.setAttribute('aria-label',byId.get(id).text+'を戻す');
      chip.addEventListener('click',()=>this._sentencePick(q,i));
    });
    for(const [id,button] of q.bankButtons){
      const used=q.sentenceSelected.includes(id);
      button.disabled=used || q.sentenceSelected.length>=q.sentence.maxLength;
      button.classList.toggle('is-used',used);button.setAttribute('aria-pressed',String(used));
    }
    const complete=[q.sentence.tokens.length,...q.sentence.alternatives.map(a=>a.length)].includes(q.sentenceSelected.length);
    q.checkButton.disabled=!complete;q.undoButton.disabled=q.sentenceSelected.length===0;
    q.sentenceCounter.textContent=q.sentenceSelected.length+' / '+q.sentence.tokens.length+' フレーズ';
  }
  _renderSentenceQuestion(q) {
    if(!q || q!==this.current)return;
    this.modalEl.classList.remove('sr-mastery-timeout-mode');this.main.replaceChildren();
    this.clockValue=null;this.clockBar=null;
    this.main.createEl('p',{text:(q.card.course || q.card.genre)+' · 文組み立て',cls:'sr-mastery-caption'});
    if(this.rep)this.main.createEl('p',{text:'Rep '+this.rep.number+' · '+this.rep.attempted+'/'+this.rep.size+' 回答',cls:'sr-mastery-rep-progress'});
    this.main.createEl('h3',{text:q.card.question,cls:'sr-sentence-question'});
    if(q.state==='front'){
      const clock=this.main.createDiv({cls:'sr-mastery-clock'});
      this.clockValue=clock.createSpan();this.clockBar=clock.createDiv({cls:'sr-mastery-clock-track'}).createDiv({cls:'sr-mastery-clock-bar'});
      const frame=this.main.createDiv({cls:'akebi-sentence-frame'});
      frame.createEl('p',{text:q.sentence.prefix,cls:'akebi-fixed-boundary'});
      q.sentenceBoard=frame.createDiv({cls:'sr-sentence-placed'});
      q.sentenceBoard.setAttribute('aria-label','組み立てる中央部分');
      frame.createEl('p',{text:q.sentence.suffix,cls:'akebi-fixed-boundary'});
      q.sentenceCounter=this.main.createEl('p',{cls:'sr-sentence-counter'});
      this.main.createEl('p',{text:'候補を順番に選ぶ。上のフレーズをタップすると戻せます。',cls:'sr-mastery-caption'});
      const pool=this.main.createDiv({cls:'sr-sentence-bank'});
      pool.setAttribute('role','group');pool.setAttribute('aria-label','全ての候補フレーズ');
      q.bankButtons=new Map();
      for(const tile of q.sentenceBank){
        const b=pool.createEl('button',{text:tile.text,cls:'sr-sentence-chip sr-sentence-bank-chip'});b.type='button';
        b.setAttribute('data-piece',tile.id);b.addEventListener('click',()=>this._sentencePlace(q,tile.id));q.bankButtons.set(tile.id,b);
      }
      const actions=this.main.createDiv({cls:'sr-sentence-actions'});
      q.undoButton=actions.createEl('button',{text:'一つ戻す'});q.undoButton.type='button';
      q.undoButton.addEventListener('click',()=>this._sentencePick(q,q.sentenceSelected.length-1));
      q.checkButton=actions.createEl('button',{text:'答え合わせ',cls:'mod-cta sr-sentence-check'});q.checkButton.type='button';
      q.checkButton.addEventListener('click',()=>this._sentenceSubmit(q));
      this._refreshSentence(q);this._tick();
    }else{
      const status=q.revealReason==='timeout'?'時間切れ · FAIL記録済み':q.result?.correct?'正解！':'役割・順序・否定を確認しよう';
      this.main.createEl('p',{text:status,cls:'sr-sentence-result-status'});
      const byId=new Map(q.sentenceBank.map(t=>[t.id,t]));
      if(q.sentenceSelected.length){
        this.main.createEl('p',{text:'組み立てた文',cls:'sr-sentence-caption'});
        this.main.createEl('p',{text:q.sentence.prefix+q.sentenceSelected.map(id=>byId.get(id)?.text||'').join('')+q.sentence.suffix,cls:'sr-sentence-attempt'});
      }
      this.main.createEl('p',{text:'模範文',cls:'sr-sentence-caption'});
      this.main.createEl('p',{text:q.sentence.canonical,cls:'sr-sentence-canonical'});
      if(q.card.explanation)this.main.createEl('p',{text:q.card.explanation,cls:'sr-mastery-explanation'});
      if(q.card.tips)this.main.createEl('p',{text:q.card.tips,cls:'sr-mastery-tips'});
      const next=this.main.createEl('button',{text:'次の問題に進む',cls:'sr-mastery-next'});
      next.addEventListener('click',()=>{if(this.current===q && q.state==='graded' && !this.settingsOpen)this._next();});
    }
  }

  _renderTimeoutOnly(q) {
    if (q.sentence) {
      this._renderSentenceQuestion(q);
      return;
    }
    // Both modes have ALREADY recorded FAIL on timeout. The Next button
    // (choice) or fresh left swipe (slide) only advances the question.
    const isChoiceTimeout = this.owner.settings.studyMode === "choice" && !!q.options;
    this.modalEl.classList.add("sr-mastery-timeout-mode");
    this.main.replaceChildren();
    this.clockValue = null;
    this.clockBar = null;
    const card = this.main.createDiv({ cls: "sr-mastery-flashcard sr-mastery-timeout-card" });
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", isChoiceTimeout
      ? "時間切れ。正答と解説。次の問題に進む"
      : "時間切れ。正答と解説。左へスワイプして次へ");
    card.createEl("p", { text: q.card.question, cls: "sr-mastery-question" });
    card.createEl("p", { text: "正答：" + q.card.answer, cls: "sr-mastery-answer" });
    card.createEl("p", { text: "解説", cls: "sr-mastery-explanation-title" });
    card.createEl("p", {
      text: q.card.explanation || "この問題の解説は未登録です。",
      cls: "sr-mastery-explanation"
    });
    if (q.card.tips) card.createEl("p", {
      text: "💡 " + q.card.tips, cls: "sr-mastery-tips"
    });
    if (isChoiceTimeout) {
      const next = card.createEl("button", {
        text: "次の問題に進む", cls: "sr-mastery-next"
      });
      next.addEventListener("click", () => {
        if (this.current !== q || this.settingsOpen ||
            q.revealReason !== "timeout" || q.state !== "graded") return;
        this._next(); // Failure was saved at the exact timeout, not here.
      });
    } else {
      card.createEl("p", { text: "← 左へスワイプ", cls: "sr-mastery-timeout-instruction" });
      this._bindSwipe(card, q);
    }
  }

  _stopPronunciation() {
    if (!this._pronunciation) return;
    try { this._pronunciation.pause(); this._pronunciation.currentTime = 0; } catch (_) {}
    this._pronunciation = null;
  }

  async _playPronunciation(relativePath) {
    // Only play Vault-local imported audio, never URLs or path traversal.
    if (typeof relativePath !== "string" || relativePath.startsWith("/") ||
        relativePath.includes(":") || relativePath.split("/").includes("..")) return;
    const file = this.app.vault.getAbstractFileByPath?.(relativePath);
    if (!file || !["mp3", "wav", "ogg", "m4a"].includes(file.extension)) {
      new Notice("発音ファイルの同期を待ってから再度お試しください");
      return;
    }
    this._stopPronunciation();
    try {
      if (!this.win.Audio) throw new Error("Audio unavailable");
      const player = new this.win.Audio(this.app.vault.getResourcePath(file));
      player.preload = "none";
      this._pronunciation = player;
      await player.play();
    } catch (_) {
      this._stopPronunciation();
      new Notice("発音を再生できませんでした");
    }
  }

  _renderQuestion() {
    const q = this.current;
    if (!q) return;
    if (q.sentence) {
      this._renderSentenceQuestion(q);
      return;
    }
    if (q.revealReason === "timeout" && q.state !== "front") {
      this._renderTimeoutOnly(q);
      return;
    }
    this.modalEl.classList.remove("sr-mastery-timeout-mode");
    this.main.replaceChildren();
    const row = this.main.createDiv({ cls: "sr-mastery-card-info" });
    row.createSpan({ text: q.card.deck });
    const state = this.owner._mastery?.[q.card.id];
    row.createSpan({
      text: STUDY_LABELS[this._level(q.card)] +
        (Number.isFinite(state?.ease) ? " · Ease " + state.ease : "")
    });
    if (this.rep) {
      this.main.createEl("p", { cls: "sr-mastery-rep-progress",
        text: "Rep " + this.rep.number + " · " + this.rep.attempted + "/" + this.rep.size + " 回答" });
    }
    const clock = this.main.createDiv({ cls: "sr-mastery-clock" });
    this.clockValue = clock.createSpan({ text: "残り " + this.owner.settings.recallLimitSeconds + "秒" });
    const track = clock.createDiv({ cls: "sr-mastery-clock-track" });
    this.clockBar = track.createDiv({ cls: "sr-mastery-clock-bar" });
    const card = this.main.createDiv({ cls: "sr-mastery-flashcard" });
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "問題");
    card.createEl("p", { text: q.card.question, cls: "sr-mastery-question" });
    if (q.card.audio?.length) {
      const pronunciation = card.createEl("button", { cls: "sr-mastery-pronunciation" });
      pronunciation.type = "button";
      pronunciation.setAttribute("aria-label", "英単語の発音を聴く");
      pronunciation.setAttribute("title", "発音を聴く");
      setIcon(pronunciation, "volume-2");
      pronunciation.addEventListener("click", () => {
        if (q === this.current && !this.settingsOpen && !this._inResumeGrace()) {
          void this._playPronunciation(q.card.audio[0]);
        }
      });
    }

    const choicesAvailable = this.owner.settings.studyMode === "choice" && !!q.options;
    if (q.state === "front" && choicesAvailable) {
      const grid = card.createDiv({ cls: "sr-mastery-options" });
      q.options.options.forEach((option, index) => {
        const btn = grid.createEl("button", { text: (index + 1) + ". " + option });
        btn.type = "button";
        btn.addEventListener("click", () => {
          if (this.settingsOpen || q !== this.current || q.state !== "front") return;
          if (this._remaining() <= 0) {
            this._reveal("timeout");
            return;
          }
          const correct = option === q.options.correct;
          q.choice = option;
          this._reveal("choice");
          this._rate(correct);
        });
      });
    } else if (q.state === "front") {
      if (this.owner.settings.studyMode === "choice" && !q.options) {
        card.createEl("p", { text: "この問題は4択候補が不足しているため、スライド形式で出題します。", cls: "sr-mastery-caption" });
      }
      card.classList.add("sr-mastery-slide");
      const tap = card.createEl("button", { text: "タップして答えを見る", cls: "sr-mastery-reveal" });
      tap.addEventListener("click", () => this._reveal("tap"));
      this._bindSwipe(card, q);
    } else {
      const wrongChoice = q.choice !== null && q.options &&
        q.choice !== q.options.correct;
      if (wrongChoice) {
        const feedback = card.createDiv({ cls: "sr-mastery-chosen-wrong" });
        feedback.createEl("span", { text: "あなたが選んだ回答", cls: "sr-mastery-chosen-wrong-label" });
        feedback.createEl("p", { text: q.choice, cls: "sr-mastery-chosen-wrong-value" });
      }
      const back = card.createEl("p", {
        text: wrongChoice ? "正答：" + q.card.answer : q.card.answer,
        cls: "sr-mastery-answer"
      });
      if (q.card.explanation) {
        card.createEl("p", { text: "解説：" + q.card.explanation, cls: "sr-mastery-explanation" });
      }
      if (q.card.tips) card.createEl("p", {
        text: "💡 " + q.card.tips, cls: "sr-mastery-tips"
      });
      if (q.choice !== null) {
        card.createEl("p", {
          text: wrongChoice ? "不正解 · 次のRepで再挑戦" : "正解！",
          cls: "sr-mastery-caption"
        });
      }
      if (q.state === "back") {
        const buttons = card.createDiv({ cls: "sr-mastery-ratings" });
        for (const [label, value] of [["苦手", "weak"], ["わかる", "known"], ["完璧", "perfect"]]) {
          const btn = buttons.createEl("button", { text: label });
          btn.addEventListener("click", () => this._rate(value !== "weak", value === "perfect"));
        }
        this._bindSwipe(card, q);
      } else {
        card.createEl("p", {
          text: "→ " + STUDY_LABELS[q.result.stage] +
            (q.result.correct ? " · " + (q.result.quick ? "即答" : "正解") : " · 後で解き直し"),
          cls: "sr-mastery-outcome"
        });
        const next = card.createEl("button", { text: "次の問題に進む", cls: "sr-mastery-next" });
        next.addEventListener("click", () => { if (this.current === q && q.state === "graded" && !this.settingsOpen) this._next(); });
      }
    }
    const bottom = this.main.createEl("p", {
      text: "残り " + (this.queue.length + 1) + "問 · " + q.card.source,
      cls: "sr-mastery-caption"
    });
    this._tick();
  }

  _bindSwipe(card, question) {
    card.addEventListener("pointerdown", event => {
      if (event.target.closest("button,a") || this.settingsOpen || this._inResumeGrace()) return;
      question.pointer = {
        x: event.clientX, y: event.clientY,
        start: performance.now(), moved: false,
        startedAfterTimeout: question.revealReason === "timeout"
      };
    });
    card.addEventListener("pointermove", event => {
      const p = question.pointer;
      if (!p || this.settingsOpen || question !== this.current) return;
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 16) {
        question.pointer = null;
        return;
      }
      if (Math.abs(dx) > 12 && Math.abs(dx) > 1.4 * Math.abs(dy)) {
        p.moved = true;
        if (question.state === "front") this._reveal("swipe", true);
      }
    });
    card.addEventListener("pointerup", event => {
      const p = question.pointer;
      question.pointer = null;
      if (!p || !p.moved || question !== this.current || this.settingsOpen || !card.isConnected) return;
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      if (Math.abs(dx) < 66 || Math.abs(dy) > Math.abs(dx) * .7) {
        if (question.state === "back") this._renderQuestion();
        return;
      }
      if (question.revealReason === "timeout" && question.state === "graded") {
        // Timeout was graded on expiry. An earlier swipe cannot advance
        // unseen feedback; a new left swipe only navigates, never scores.
        if (p.startedAfterTimeout && dx < 0) this._next();
        return; // Right swipe is ignored after timeout.
      }
      if (question.state === "back") this._rate(dx > 0);
    });
    card.addEventListener("pointercancel", () => {
      question.pointer = null;
      if (question === this.current && question.state === "back") this._renderQuestion();
    });
  }

  async _saveCardMetadata(card, dummies, explanation, choiceAnswer, tips = null) {
    if (!card?.source || !card.question) throw new Error("保存する問題が見つかりません");
    const clean = dummies.map(x => String(x || "").trim());
    if (clean.length !== 3 || clean.some(x => !x || x.length > 120)) {
      throw new Error("誤答候補を3つ、それぞれ120文字以内で入力してください");
    }
    if ([...clean, explanation, choiceAnswer, tips].some(x =>
      String(x || "").includes("%%") || String(x || "").includes("::") ||
      String(x || "").includes("\n") || String(x || "").includes("\r"))) {
      throw new Error("改行と %%・:: は使用できません");
    }
    if (new Set(clean.map(studyNormalize)).size !== 3) {
      throw new Error("誤答候補が重複しています");
    }
    const canonical = String(choiceAnswer || "").trim();
    if (canonical && !studyNormalize(card.answer).includes(studyNormalize(canonical))) {
      throw new Error("4択用の正答は、元の正答に含まれる表記にしてください");
    }
    const correctLabel = canonical || card.answer;
    if (clean.some(x => studyNormalize(x) === studyNormalize(correctLabel))) {
      throw new Error("誤答候補に正解と同じ内容があります");
    }
    const file = this.app.vault.getAbstractFileByPath(card.source);
    if (!file || file.extension !== "md") throw new Error("カード元のMarkdownが見つかりません");
    // Vault.process holds an editor-aware file lock and avoids stale whole-
    // file overwrites when native Spaced Repetition writes an SR comment.
    if (typeof this.app.vault.process !== "function") {
      throw new Error("Obsidian Vault.process が使えないため、安全に書き込めません");
    }
    const cleanTips = tips === null ? (card.tips || "") : String(tips || "").trim();
    await this.app.vault.process(file, current =>
      studyUpdateNoteMetadata(current, card.question, clean,
        String(explanation || "").trim(), canonical, cleanTips)
    );
    Object.assign(card, {
      dummies: clean,
      explanation: String(explanation || "").trim(),
      tips: cleanTips,
      choiceAnswer: canonical
    });
    if (this.current?.card?.id === card.id) {
      this.current.options = studyOptions(card, this.cards, this.owner._curated || {});
    }
    return true;
  }

  _renderCardMetadataEditor(layer) {
    const card = this.current?.card;
    if (!card || this.screen !== "study" || this.current?.sentence) return;
    // Collapsed by default so timer and sound settings remain near the top.
    const section = layer.createEl("details", { cls: "sr-mastery-mc-editor" });
    section.createEl("summary", { text: "この問題の4択・解説を編集" });
    section.createEl("p", { text: card.question, cls: "sr-mastery-caption" });
    section.createEl("p", { text: "正答：" + card.answer, cls: "sr-mastery-caption" });
    const source = section.createDiv({ cls: "sr-mastery-edit-fields" });

    const shortLabel = source.createEl("label", { text: "4択で表示する正答（省略可）" });
    const correctInput = source.createEl("input");
    correctInput.type = "text";
    correctInput.value = card.choiceAnswer || "";
    correctInput.placeholder = card.answer;
    shortLabel.appendChild(correctInput);

    const inputs = [];
    for (let i = 0; i < 3; i++) {
      const label = source.createEl("label", { text: "想定誤答 " + (i + 1) });
      const field = source.createEl("textarea");
      field.value = card.dummies?.[i] || "";
      field.rows = 2;
      label.appendChild(field);
      inputs.push(field);
    }

    const explanationLabel = source.createEl("label", { text: "解説（時間切れにも表示）" });
    const explanationInput = source.createEl("textarea");
    explanationInput.rows = 4;
    explanationInput.value = card.explanation || "";
    explanationLabel.appendChild(explanationInput);
    const tipsLabel = source.createEl("label", { text: "ひとことTips（任意）" });
    const tipsInput = source.createEl("textarea");
    tipsInput.rows = 2;
    tipsInput.value = card.tips || "";
    tipsLabel.appendChild(tipsInput);

    const status = section.createEl("p", { cls: "sr-mastery-caption" });
    status.setAttribute("role", "status");
    const save = section.createEl("button", {
      text: "このカードに保存",
      cls: "sr-mastery-save-options"
    });
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      save.disabled = true;
      status.textContent = "保存しています…";
      try {
        await this._saveCardMetadata(card,
          inputs.map(x => x.value), explanationInput.value, correctInput.value, tipsInput.value);
        status.textContent = "保存しました。次回以降もこの選択肢を使用します。";
      } catch (error) {
        status.textContent = "保存できません：" + String(error.message || error);
      } finally {
        save.disabled = false;
      }
    });
  }

  _openSettings() {
    if (this.settingsOpen) return;
    this._pause();
    this._stopCelebration();
    this.settingsOpen = true;
    const layer = this.settingsLayer;
    layer.replaceChildren();
    layer.hidden = false;
    layer.createEl("h3", { text: "学習設定" });

    const mode = layer.createDiv({ cls: "sr-mastery-setting-field" });
    mode.createEl("label", { text: "出題形式" });
    const selector = mode.createEl("select");
    for (const [value, text] of [["choice", "4択"], ["slide", "スライド"]]) {
      const opt = selector.createEl("option", { text });
      opt.value = value;
    }
    selector.value = this.owner.settings.studyMode;
    selector.addEventListener("change", () => this._setSetting("studyMode", selector.value));
    this._renderCardMetadataEditor(layer);

    const repField = layer.createDiv({ cls: "sr-mastery-setting-field" });
    repField.createEl("label", { text: "1 Repあたりの問題数" });
    const repInput = repField.createEl("input");
    repInput.type = "number";
    repInput.min = "1";
    repInput.max = "50";
    repInput.step = "1";
    repInput.value = String(this.owner.settings.repSize || 10);
    repInput.setAttribute("aria-label", "Repごとの回答回数");
    repInput.addEventListener("change", () => {
      const value = Math.max(1, Math.min(50,
        Math.round(Number(repInput.value) || 10)));
      repInput.value = String(value);
      this._setSetting("repSize", value);
      if (this.rep && this.screen === "study") {
        const currentIsPending = this.current?.state !== "graded" ? 1 : 0;
        const outstanding = this.rep.attempted +
          this.queue.length + currentIsPending;
        // Respect cards already completed and the question on screen;
        // never display 3/10 when only one question remains to be asked.
        this.rep.size = Math.max(
          this.rep.attempted + currentIsPending,
          Math.min(value, outstanding)
        );
      }
    });
    repField.createEl("small", { cls: "sr-mastery-caption",
      text: "Repの最大出題数です。対象の問題が少ない場合、分母はその件数に合わせます。" });

    const seconds = layer.createDiv({ cls: "sr-mastery-setting-field" });
    seconds.createEl("label", { text: "制限時間（秒）" });
    const input = seconds.createEl("input");
    input.type = "range";
    input.min = "3"; input.max = "60"; input.step = "1";
    input.value = this.owner.settings.recallLimitSeconds;
    const valueText = seconds.createSpan({ text: input.value + "秒" });
    input.addEventListener("input", () => {
      valueText.textContent = input.value + "秒";
      this._setSetting("recallLimitSeconds", Number(input.value));
      if (this.current?.state === "front" && !this.current.sentence) {
        this.current.limitMs = Number(input.value) * 1000;
        this.current.remainingFrozen = this.current.limitMs;
      }
    });
    const sentenceField = layer.createDiv({ cls: "sr-mastery-setting-field" });
    sentenceField.createEl("label", { text: "文組み立ての制限時間（秒）" });
    const sentenceInput = sentenceField.createEl("input");
    sentenceInput.type = "range";
    sentenceInput.min = "45"; sentenceInput.max = "300"; sentenceInput.step = "15";
    sentenceInput.value = this.owner.settings.sentenceLimitSeconds || 120;
    const sentenceTimeLabel = sentenceField.createSpan({
      text: sentenceInput.value + "秒"
    });
    sentenceInput.addEventListener("input", () => {
      const seconds = Number(sentenceInput.value);
      sentenceTimeLabel.textContent = seconds + "秒";
      this._setSetting("sentenceLimitSeconds", seconds);
      if (this.current?.state === "front" && this.current.sentence) {
        this.current.limitMs = seconds * 1000;
        this.current.remainingFrozen = this.current.limitMs;
      }
    });
    const fast = layer.createDiv({ cls: "sr-mastery-setting-field" });
    fast.createEl("label", { text: "反応時間の基準（秒）" });
    const fastInput = fast.createEl("input");
    fastInput.type = "range";
    fastInput.min = "0.5"; fastInput.max = "10"; fastInput.step = "0.5";
    fastInput.value = this.owner.settings.easyThresholdSeconds;
    const fastText = fast.createSpan({ text: fastInput.value + "秒" });
    fastInput.addEventListener("input", () => {
      fastText.textContent = fastInput.value + "秒";
      this._setSetting("easyThresholdSeconds", Number(fastInput.value));
    });
    fast.createEl("small", { cls: "sr-mastery-caption",
      text: "速さはEaseへの加点に使います。完璧かどうかは正答・誤答の履歴も踏まえて判断します。" });
    const sound = layer.createDiv({ cls: "sr-mastery-setting-field" });
    const soundLabel = sound.createEl("label", { text: "効果音" });
    const soundCheck = sound.createEl("input");
    soundCheck.type = "checkbox";
    soundCheck.checked = this.owner.settings.soundEnabled;
    soundCheck.addEventListener("change", () => this._setSetting("soundEnabled", soundCheck.checked));
    const volume = layer.createDiv({ cls: "sr-mastery-setting-field" });
    volume.createEl("label", { text: "音量" });
    const volumeInput = volume.createEl("input");
    volumeInput.type = "range";
    volumeInput.min = "0"; volumeInput.max = "100"; volumeInput.step = "5";
    volumeInput.value = this.owner.settings.soundVolume;
    const volumeText = volume.createSpan({ text: volumeInput.value + "%" });
    volumeInput.addEventListener("input", () => {
      volumeText.textContent = volumeInput.value + "%";
      this._setSetting("soundVolume", Number(volumeInput.value));
    });
    const soundPreview = layer.createEl("button", { text: "効果音を試聴" });
    soundPreview.addEventListener("click", () => this._playSound("correct"));
    const done = layer.createEl("button", { text: "学習に戻る", cls: "sr-mastery-settings-done" });
    done.addEventListener("click", () => this._closeSettings());
    this._playSound("reveal");
  }

  _setSetting(key, value) {
    this.owner.settings[key] = value;
    void this.owner.saveData(this.owner.settings);
  }

  _closeSettings() {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.settingsLayer.hidden = true;
    if (this.current?.state === "front") {
      const q = this.current;
      q.resumeAt = performance.now() + 1000;
      q.deadline = q.resumeAt + (q.remainingFrozen ?? q.limitMs);
    }
    if (this.current) this._renderQuestion();
    else if (this.screen === "rep-break") this._renderRepBreak(true);
    else this._renderHome();
  }

  _playSound(kind) {
    if (!this.owner.settings.soundEnabled || this.owner.settings.soundVolume <= 0) return;
    try {
      const AudioType = this.win.AudioContext || this.win.webkitAudioContext;
      if (!AudioType) return;
      const ctx = this.soundContext || new AudioType();
      this.soundContext = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = kind === "wrong" ? "triangle" : "sine";
      const pitch = { correct: 660, wrong: 260, timeout: 330, reveal: 480 }[kind] || 480;
      const start = ctx.currentTime;
      const amplitude = 0.035 * (this.owner.settings.soundVolume / 100);
      oscillator.frequency.setValueAtTime(pitch, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amplitude), start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    } catch (_) {
      // Unsupported audio hardware never blocks studying.
    }
  }
}

module.exports = { AkebiStudyModal, studyMasteryNext, studyCards, studyTag, studyOptions, studySentenceSpec, studySentenceAccepted, studySentenceBank, studyMemoryState };
