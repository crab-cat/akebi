"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/study.js
var require_study = __commonJS({
  "src/study.js"(exports2, module2) {
    var { Modal, Notice: Notice2, setIcon, getAllTags } = require("obsidian");
    var STUDY_LEVELS = ["unseen", "weak", "known", "perfect"];
    var STUDY_LABELS = {
      unseen: "\u3084\u3063\u3066\u306A\u3044",
      weak: "\u82E6\u624B",
      known: "\u308F\u304B\u308B",
      perfect: "\u5B8C\u74A7"
    };
    var STUDY_EASE_VERSION = 2;
    var STUDY_EASE_KNOWN = 0.6;
    var STUDY_EASE_PERFECT = 0.82;
    var STUDY_PRIORS = Object.freeze({
      unseen: [1, 1],
      weak: [1, 2.5],
      known: [3.5, 1.4],
      perfect: [10, 1]
    });
    function studyMasteryNext(previous, correct, evidence, timestamp) {
      const before = previous || {};
      const prevStage = STUDY_LEVELS.includes(before.stage) ? before.stage : "unseen";
      const prior = STUDY_PRIORS[prevStage];
      const existing = before.modelVersion === STUDY_EASE_VERSION && before.evidence;
      let alpha = existing && Number.isFinite(existing.alpha) && existing.alpha > 0 ? existing.alpha : prior[0];
      let beta = existing && Number.isFinite(existing.beta) && existing.beta > 0 ? existing.beta : prior[1];
      const opts = evidence && typeof evidence === "object" ? evidence : {
        reactionMs: evidence ? 0 : 2e3,
        easyMs: 1e3,
        mode: "slide",
        explicitPerfect: false,
        timedOut: false
      };
      const elapsedMs = Number.isFinite(opts.reactionMs) ? Math.max(0, opts.reactionMs) : 6e4;
      const easyMs = Number.isFinite(opts.easyMs) ? Math.max(250, opts.easyMs) : 1e3;
      const manualBonus = opts.explicitPerfect ? 1.1 : 0;
      const modeWeight = opts.mode === "choice" ? 0.9 : 1;
      const quick = correct && !opts.timedOut && elapsedMs <= easyMs;
      const previousStreak = before.lastWasCorrect === false ? 0 : Math.max(0, Number(before.recoveryStreak) || 0);
      const streakBonus = correct ? 0.07 * Math.min(5, previousStreak) : 0;
      let appliedWeight;
      if (correct) {
        const fastEvidence = 6.8 * Math.exp(-Math.pow(elapsedMs / (0.45 * easyMs), 1.2));
        const sustainedEvidence = 0.65 * Math.exp(-elapsedMs / (2 * easyMs));
        appliedWeight = (1.15 + fastEvidence + sustainedEvidence + manualBonus) * modeWeight * (1 + streakBonus);
        alpha += appliedWeight;
      } else {
        appliedWeight = opts.timedOut ? 0.95 : 0.65;
        beta += appliedWeight;
      }
      const mass = alpha + beta;
      if (mass > 24) {
        alpha *= 24 / mass;
        beta *= 24 / mass;
      }
      const score = alpha / (alpha + beta);
      const stage = score >= STUDY_EASE_PERFECT && correct ? "perfect" : score >= STUDY_EASE_KNOWN ? "known" : "weak";
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
        lastMode: ["choice", "slide", "sentence"].includes(opts.mode) ? opts.mode : "slide",
        attempts: (before.attempts || 0) + 1,
        correct: (before.correct || 0) + (correct ? 1 : 0),
        mistakes: (before.mistakes || 0) + (correct ? 0 : 1),
        recoveryStreak: correct ? (before.recoveryStreak || 0) + 1 : 0,
        quickStreak: quick ? (before.quickStreak || 0) + 1 : 0,
        lastReviewedAt: timestamp,
        lastWasCorrect: !!correct
      };
    }
    var STUDY_MEMORY_VERSION = 1;
    var STUDY_DAY_MS = 864e5;
    var STUDY_FORGET_DECAY = 0.1542;
    var STUDY_FORGET_FACTOR = Math.pow(0.9, -1 / STUDY_FORGET_DECAY) - 1;
    var STUDY_REVIEW_TARGET = 0.86;
    var STUDY_MEMORY_MAX_DAYS = 365;
    function studyClamp(value, lower, upper) {
      return Math.max(lower, Math.min(upper, value));
    }
    function studySeedStability(record) {
      const saved = record?.memory;
      if (saved?.version === STUDY_MEMORY_VERSION && Number.isFinite(saved.stabilityDays) && saved.stabilityDays > 0) {
        return studyClamp(saved.stabilityDays, 0.25, STUDY_MEMORY_MAX_DAYS);
      }
      if (record?.lastWasCorrect === false || record?.stage === "weak") return 0.4;
      const correct = Math.max(0, Number(record?.correct) || 0);
      return studyClamp(
        0.66 + 0.12 * Math.log2(1 + correct) + (record?.stage === "perfect" ? 0.1 : 0),
        0.45,
        1.25
      );
    }
    function studyRetrievability(elapsedDays, stabilityDays) {
      if (!Number.isFinite(elapsedDays) || !Number.isFinite(stabilityDays) || stabilityDays <= 0) return null;
      return Math.pow(
        1 + STUDY_FORGET_FACTOR * Math.max(0, elapsedDays) / stabilityDays,
        -STUDY_FORGET_DECAY
      );
    }
    function studyMemoryDueDays(stabilityDays, target = STUDY_REVIEW_TARGET) {
      if (!Number.isFinite(stabilityDays) || stabilityDays <= 0 || !Number.isFinite(target) || target <= 0 || target >= 1) return null;
      const scale = (Math.pow(target, -1 / STUDY_FORGET_DECAY) - 1) / STUDY_FORGET_FACTOR;
      return studyClamp(stabilityDays * scale, 0.1, 730);
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
        stabilityDays,
        elapsedDays,
        retrievability,
        dueDays,
        dueAt: new Date(lastMs + dueDays * STUDY_DAY_MS).toISOString(),
        due: elapsedDays >= dueDays
      };
    }
    function studyUpdateMemory(before, correct, options, timestamp) {
      const when = Date.parse(timestamp);
      const nowMs = Number.isFinite(when) ? when : Date.now();
      const prior = studyMemoryState(before, nowMs);
      const elapsedMs = Number.isFinite(options?.reactionMs) ? Math.max(0, options.reactionMs) : 6e4;
      const easyMs = Math.max(250, Number(options?.easyMs) || 1e3);
      const speed = Math.exp(-elapsedMs / (2 * easyMs));
      const mode = options?.mode === "choice" ? 0.9 : 1;
      let stabilityDays;
      if (correct && !prior) {
        stabilityDays = studyClamp(
          (0.6 + 0.62 * Math.exp(-elapsedMs / (1.2 * easyMs)) + (options?.explicitPerfect ? 0.08 : 0)) * mode,
          0.42,
          1.35
        );
      } else if (correct) {
        const spacing = Math.min(1, prior.elapsedDays / 0.75);
        const spacedGrowth = 2.6 * (1 - prior.retrievability) * spacing * (0.85 + 0.15 * speed) * mode;
        const sameDayGrowth = 0.02 + 0.02 * speed;
        stabilityDays = studyClamp(
          prior.stabilityDays * (1 + sameDayGrowth + spacedGrowth),
          0.3,
          STUDY_MEMORY_MAX_DAYS
        );
      } else if (prior) {
        stabilityDays = studyClamp(
          prior.stabilityDays * (0.56 + 0.2 * (1 - prior.retrievability)),
          0.28,
          1.2
        );
      } else {
        stabilityDays = 0.35;
      }
      const predicted = prior?.retrievability ?? null;
      const log = Array.isArray(before?.memory?.reviewLog) ? before.memory.reviewLog.slice(-31) : [];
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
    function studyNormalize(value) {
      return String(value || "").normalize("NFKC").replace(/\s+/g, "").replace(/[?？!！。:：]/g, "").trim();
    }
    function studyTag(text) {
      const cleaned = String(text).replace(/<!--[\s\S]*?-->/g, "").replace(/%%[\s\S]*?%%/g, "");
      const match = cleaned.match(/(?:^|\s)#(?:flashcards|akebi)(?:\/([^\s#\]]+))?(?=\s|$)/m);
      if (!match) return null;
      return match[1] || "\u4E00\u822C";
    }
    var STUDY_MC_PREFIX = "%%RMUX ";
    var STUDY_MC_PATTERN = /^\s*%%(?:RMUX|AKEBI)\s+(\{.*\})\s*%%\s*$/;
    var STUDY_SR_PATTERN = /^\s*<!--SR:[^>]*-->\s*$/;
    function studyReadMetadata(lines, cardLine) {
      let offset = cardLine + 1;
      if (STUDY_SR_PATTERN.test(lines[offset] || "")) offset++;
      const match = STUDY_MC_PATTERN.exec(lines[offset] || "");
      if (!match) return null;
      try {
        const item = JSON.parse(match[1]);
        return item && typeof item === "object" && !Array.isArray(item) ? item : null;
      } catch (_) {
        return null;
      }
    }
    function studyMetadataForCard(card) {
      const dummies = card.dummies;
      if (!Array.isArray(dummies) || dummies.length !== 3 || dummies.some((x) => typeof x !== "string" || !x.trim()) || new Set(dummies.map(studyNormalize)).size !== 3) return null;
      const chosen = typeof card.choiceAnswer === "string" && card.choiceAnswer.trim() ? card.choiceAnswer.trim() : card.answer;
      if (!chosen || !studyNormalize(card.answer).includes(studyNormalize(chosen))) return null;
      if (dummies.some((x) => studyNormalize(x) === studyNormalize(chosen))) return null;
      return { correct: chosen, options: studyShuffle([chosen, ...dummies]) };
    }
    function studyUpdateNoteMetadata(markdown, question, dummies, explanation, choiceAnswer, tips = null) {
      const normalized = studyNormalize(question);
      const lines = String(markdown).split(/\r?\n/);
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes(" :: ") || line.trim().startsWith("%%") || line.trim().startsWith("<!--")) continue;
        const head = line.split(" :: ")[0].trim();
        if (studyNormalize(head) === normalized) matches.push(i);
      }
      if (matches.length !== 1) throw new Error("\u540C\u3058\u554F\u984C\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u304B\u3001\u91CD\u8907\u3057\u3066\u3044\u307E\u3059");
      const row = matches[0];
      const insertAt = row + (STUDY_SR_PATTERN.test(lines[row + 1] || "") ? 2 : 1);
      const current = studyReadMetadata(lines, row) || {};
      const metadata = { ...current, dummies, explanation };
      if (choiceAnswer && choiceAnswer.trim()) metadata.choiceAnswer = choiceAnswer.trim();
      else delete metadata.choiceAnswer;
      const nextTips = tips === null ? current.tips || "" : String(tips || "").trim();
      if (nextTips) metadata.tips = nextTips;
      else delete metadata.tips;
      const encoded = STUDY_MC_PREFIX + JSON.stringify(metadata) + "%%";
      if (STUDY_MC_PATTERN.test(lines[insertAt] || "")) lines[insertAt] = encoded;
      else lines.splice(insertAt, 0, encoded);
      const newline = String(markdown).includes("\r\n") ? "\r\n" : "\n";
      return lines.join(newline);
    }
    function studyCourseFromNote(markdown, file, tag) {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] || "";
      const field = fm.split(/\r?\n/).find((row) => /^class:\s*/.test(row));
      if (field) {
        const raw = field.replace(/^class:\s*/, "").trim().replace(/^["']|["']$/g, "");
        const wiki = /^\[\[([^\]]+)\]\]$/.exec(raw);
        const text = wiki ? wiki[1].split("|").pop() : raw;
        const course = text.split("/").pop().replace(/\.md$/, "").trim();
        if (course && course !== "null" && course !== "[]") return course;
      }
      if (tag.startsWith("\u5927\u5B66\u4E00\u822C/")) return tag.slice("\u5927\u5B66\u4E00\u822C/".length).split("/")[0];
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
        if (/^\s*`{3,}/.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (inFence || line.trim().startsWith("<!--") || line.trim().startsWith("%%")) continue;
        const match = line.match(/^\s*(?![-#|])(.+?)\s+::\s+(.+?)\s*(?:<!--SR:.*?-->)?\s*$/);
        if (!match) continue;
        const question = match[1].trim();
        const answer = match[2].replace(/<!--SR:[\s\S]*?-->/g, "").trim();
        if (!question || !answer || question.length > 500 || answer.length > 1e3) continue;
        const metadata = studyReadMetadata(lines, index);
        result.push({
          id: typeof metadata?.akebi?.id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(metadata.akebi.id) ? "akebi:" + metadata.akebi.id : file.path + "::" + studyNormalize(question),
          legacyId: file.path + "::" + studyNormalize(question),
          source: file.path,
          question,
          answer,
          dummies: Array.isArray(metadata?.dummies) ? metadata.dummies.slice() : [],
          explanation: typeof metadata?.explanation === "string" ? metadata.explanation : "",
          tips: typeof metadata?.tips === "string" ? metadata.tips : "",
          audio: Array.isArray(metadata?.audio) ? metadata.audio.filter((p) => typeof p === "string") : [],
          anki: metadata?.anki && typeof metadata.anki === "object" ? metadata.anki : null,
          vocab: metadata?.vocab && typeof metadata.vocab === "object" ? metadata.vocab : null,
          choiceAnswer: typeof metadata?.choiceAnswer === "string" ? metadata.choiceAnswer : "",
          sentence: metadata?.sentence && typeof metadata.sentence === "object" ? metadata.sentence : null,
          // A native SR schedule comment means the card has been reviewed
          // previously, even if its next due date is in the future.
          studied: /<!--SR:/.test(line) || /<!--SR:/.test(lines[index + 1] || ""),
          nativeDue: /<!--SR:!(\d{4}-\d{2}-\d{2})/.exec(line + (lines[index + 1] || ""))?.[1] || null,
          genre: tag.split("/")[0],
          deck: tag,
          course,
          folder
        });
      }
      return result;
    }
    function studyOptions(card, peers, curated) {
      const local = studyMetadataForCard(card);
      if (local) return local;
      const spec = curated?.[card.question];
      if (spec && Array.isArray(spec.choices) && spec.choices.length === 4 && new Set(spec.choices.map(studyNormalize)).size === 4 && spec.choices.includes(spec.correct) && studyNormalize(card.answer).includes(studyNormalize(spec.correct))) {
        return { correct: spec.correct, options: studyShuffle(spec.choices) };
      }
      return null;
    }
    function studyCompactLegacy(raw) {
      const particles = /* @__PURE__ */ new Set(["\u306F", "\u304C", "\u3092", "\u306B", "\u3078", "\u3067", "\u3068", "\u306E", "\u3084", "\u3082", "\u304B\u3089", "\u307E\u3067", "\u3067\u306F", "\u3068\u3057\u3066", "\u3002", "\u3001"]);
      const compact = [];
      for (const t of raw.tokens || []) {
        if (particles.has(t) && compact.length) compact[compact.length - 1] += t;
        else compact.push(t);
      }
      if (compact.length < 3) return null;
      const prefix = compact.shift(), suffix = compact.pop();
      while (compact.length > 11) {
        let i = 0;
        for (let j = 1; j < compact.length - 1; j++) if ((compact[j] + compact[j + 1]).length < (compact[i] + compact[i + 1]).length) i = j;
        compact.splice(i, 2, compact[i] + compact[i + 1]);
      }
      return { schemaVersion: 2, prefix, suffix, tokens: compact, distractors: (raw.distractors || []).slice(0, 4), alternatives: [], concepts: raw.concepts || [], legacy: true };
    }
    function studySentenceSpec(card) {
      let raw = card?.sentence;
      if (!raw || typeof raw !== "object") return null;
      if (raw.schemaVersion === 1) raw = studyCompactLegacy(raw);
      if (!raw || raw.schemaVersion !== 2 || !Array.isArray(raw.tokens) || !Array.isArray(raw.distractors)) return null;
      if (raw.tokens.length < 3 || raw.tokens.length > 12 || raw.tokens.length + raw.distractors.length > 15 || raw.distractors.length < 1) return null;
      if (typeof raw.prefix !== "string" || typeof raw.suffix !== "string" || !raw.prefix || !raw.suffix) return null;
      const all = [...raw.tokens, ...raw.distractors];
      if (all.some((t) => typeof t !== "string" || !t.trim() || t.length > 70 || /[\r\n]/.test(t))) return null;
      const norm = (t) => String(t).normalize("NFKC").replace(/\s+/g, "");
      const canonical = raw.prefix + raw.tokens.join("") + raw.suffix;
      if (norm(canonical) !== norm(card.answer)) return null;
      const multiset = /* @__PURE__ */ new Map();
      for (const t of all) multiset.set(t, (multiset.get(t) || 0) + 1);
      const alternatives = [];
      for (const a of raw.alternatives || []) {
        if (!Array.isArray(a) || a.length < 1 || a.length > 12) continue;
        const left = new Map(multiset);
        let valid = true;
        for (const t of a) {
          if (!(left.get(t) > 0)) {
            valid = false;
            break;
          }
          left.set(t, left.get(t) - 1);
        }
        if (valid) alternatives.push(a.slice());
      }
      return {
        prefix: raw.prefix,
        suffix: raw.suffix,
        tokens: raw.tokens.slice(),
        distractors: raw.distractors.slice(),
        alternatives,
        concepts: Array.isArray(raw.concepts) ? raw.concepts.filter((x) => typeof x === "string") : [],
        canonical,
        maxLength: Math.max(raw.tokens.length, ...alternatives.map((a) => a.length)),
        legacy: !!raw.legacy
      };
    }
    function studySentenceAccepted(spec, selected) {
      if (!spec || !Array.isArray(selected)) return false;
      const norm = (t) => String(t).normalize("NFKC").replace(/\s+/g, "");
      const selectedText = selected.map((t) => typeof t === "string" ? t : t?.text);
      if (selectedText.some((t) => typeof t !== "string")) return false;
      const counts = /* @__PURE__ */ new Map();
      for (const t of [...spec.tokens, ...spec.distractors]) counts.set(t, (counts.get(t) || 0) + 1);
      for (const t of selectedText) {
        if (!(counts.get(t) > 0)) return false;
        counts.set(t, counts.get(t) - 1);
      }
      const actual = norm(selectedText.join(""));
      return [spec.tokens, ...spec.alternatives].some((a) => a.length === selectedText.length && norm(a.join("")) === actual);
    }
    function studySentenceBank(spec) {
      return spec ? studyShuffle([...spec.tokens, ...spec.distractors]).map((text, i) => ({ id: "piece-" + i, text })) : [];
    }
    function studyShuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
    var AkebiStudyModal2 = class extends Modal {
      constructor(app, companion) {
        super(app);
        this.owner = companion;
        this.win = this.contentEl.ownerDocument?.defaultView || globalThis;
        this.cards = [];
        this.filtered = [];
        this.queue = [];
        this.current = null;
        this.selectedGenre = this.owner.settings.selectedStudyGenre || "\u3059\u3079\u3066";
        this.selectedStage = this.owner.settings.selectedStudyStage || "all";
        this.selectedCourse = this.owner.settings.selectedStudyCourse || null;
        this.selectedFolder = this.owner.settings.selectedStudyFolder || null;
        this.selectedVocabulary = this.owner.settings.selectedStudyVocabulary || "";
        this.selectedActivity = this.owner.settings.selectedStudyActivity || "all";
        this.browseSubdecks = !!(this.selectedCourse || this.selectedFolder || this.selectedVocabulary || this.owner.settings.selectedStudyBrowseSubdecks);
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
        this.modalEl.setAttribute("aria-label", "akebi \u5B66\u7FD2");
        this.contentEl.empty();
        this._renderShell();
        this._renderLoading();
        void this._loadCards().then(() => {
          if (this._closed) return;
          this._renderHome();
        }).catch((err) => {
          this._showError("\u30AB\u30FC\u30C9\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F: " + String(err.message || err));
        });
        this._ticker = this.win.setInterval(() => this._tick(), 80);
      }
      onClose() {
        this._stopPronunciation?.();
        this._closed = true;
        void this.owner._flushMastery?.();
        this.win.clearInterval(this._ticker);
        this._stopCelebration();
        this.current = null;
        this.contentEl.empty();
        try {
          this.soundContext?.close();
        } catch (_) {
        }
        this.owner._studyModal = null;
      }
      _renderShell() {
        const shell = this.contentEl.createDiv({ cls: "sr-mastery-shell" });
        this.shell = shell;
        const top = shell.createDiv({ cls: "sr-mastery-topbar" });
        const gear = top.createEl("button", { cls: "sr-mastery-gear" });
        setIcon(gear, "settings-2");
        gear.type = "button";
        gear.setAttribute("aria-label", "\u5B66\u7FD2\u8A2D\u5B9A\u3092\u958B\u304F");
        gear.addEventListener("click", () => this._openSettings());
        const title = top.createDiv({ cls: "sr-mastery-heading", text: "akebi \xB7 " + this.owner.manifest.version });
        const home = top.createEl("button", { text: "\u30C7\u30C3\u30AD", cls: "sr-mastery-home-button" });
        home.addEventListener("click", () => {
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
        this.main.createEl("p", { text: "\u30AB\u30FC\u30C9\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u3059\u2026" });
      }
      _showError(message) {
        this.main.replaceChildren();
        this.main.createEl("p", { text: message });
        const back = this.main.createEl("button", { text: "\u623B\u308B" });
        back.addEventListener("click", () => this._renderHome());
      }
      async _loadCards() {
        const files = this.app.vault.getMarkdownFiles();
        const collected = [];
        for (const file of files) {
          if (this._closed) return;
          const cache = this.app.metadataCache.getFileCache(file);
          const cachedTags = cache ? getAllTags(cache) || [] : null;
          if (cachedTags && !cachedTags.some((t) => t === "#flashcards" || t.startsWith("#flashcards/") || t === "#akebi" || t.startsWith("#akebi/"))) continue;
          const raw = await this.app.vault.cachedRead(file);
          if (!raw.includes("#flashcards") && !raw.includes("#akebi")) continue;
          const tag = studyTag(raw);
          if (tag) collected.push(...studyCards(file, raw, tag));
        }
        this.invalidSentenceCount = collected.filter((c) => c.sentence && !studySentenceSpec(c)).length;
        this.cards = [...new Map(collected.filter((card) => card.vocab?.quizEnabled !== false && (!card.sentence || studySentenceSpec(card))).map((card) => [card.id, card])).values()];
        await this.owner.adoptCardIds(this.cards);
        const firstStage = this.selectedVocabulary + "/Stage 01";
        if (/^CEFR-J\/(A1|A2|B1|B2)$/.test(this.selectedVocabulary) && this.cards.some((c) => (c.vocab?.memberships || []).includes(firstStage))) {
          this.selectedVocabulary = firstStage;
          this._saveBrowserPreferences();
        }
      }
      _level(card, nowMs = Date.now()) {
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
        chart.setAttribute("aria-label", STUDY_LEVELS.map((stage) => STUDY_LABELS[stage] + " " + stats[stage] + "\u554F").join("\u3001"));
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
        chart.style.background = total ? "conic-gradient(from 0deg, " + slices.join(", ") + ")" : "var(--background-modifier-border)";
        chart.createSpan({ cls: "sr-mastery-donut-count", text: String(total) });
        return chart;
      }
      _genreList() {
        return ["\u3059\u3079\u3066", ...new Set(this.cards.map((x) => x.genre))].sort(
          (a, b) => a === "\u3059\u3079\u3066" ? -1 : b === "\u3059\u3079\u3066" ? 1 : a.localeCompare(b, "ja")
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
        if (this.selectedGenre !== "\u3059\u3079\u3066" && card.genre !== this.selectedGenre) return false;
        if (this.selectedCourse && card.course !== this.selectedCourse) return false;
        if (this.selectedFolder && card.folder !== this.selectedFolder) return false;
        if (this.selectedVocabulary && !(card.vocab?.memberships || []).includes(this.selectedVocabulary)) return false;
        if (this.selectedCourse && this.selectedGenre === "\u5927\u5B66\u4E00\u822C" && this.selectedActivity === "sentence" && !studySentenceSpec(card)) return false;
        if (this.selectedCourse && this.selectedGenre === "\u5927\u5B66\u4E00\u822C" && this.selectedActivity === "word" && !!studySentenceSpec(card)) return false;
        return true;
      }
      _vocabularyLabel(id) {
        const match = /^CEFR-J\/(A1|A2|B1|B2)\/Stage (\d+)$/.exec(id || "");
        if (match) return "CEFR-J " + match[1] + " \xB7 Stage " + Number(match[2]);
        const named = {
          "CEFR-J/A1": "CEFR-J A1",
          "CEFR-J/A2": "CEFR-J A2",
          "CEFR-J/B1": "CEFR-J B1",
          "CEFR-J/B2": "CEFR-J B2",
          "NGSL/\u4E00\u822C\u57FA\u790E": "NGSL \u4E00\u822C\u57FA\u790E",
          "NAWL/\u5B66\u8853": "NAWL \u5B66\u8853\u82F1\u8A9E",
          "TSL/TOEIC": "TSL TOEIC",
          "NGSL-GR/\u88DC\u52A9\u8A9E": "NGSL-GR \u88DC\u52A9\u8A9E"
        };
        return named[id] || (id.startsWith("NGSL-GR/") ? "NGSL-GR \u6BB5\u968E " + Number(id.split("/")[1]) : id);
      }
      _renderVocabularyBrowser(parent, cards) {
        const panel = parent.createDiv({ cls: "sr-mastery-vocabulary-browser" });
        const groups = [
          ["CEFR-J\u306E\u30EC\u30D9\u30EB", ["CEFR-J/A1", "CEFR-J/A2", "CEFR-J/B1", "CEFR-J/B2"]],
          ["\u76EE\u7684\u30FB\u4F7F\u7528\u983B\u5EA6", ["NGSL/\u4E00\u822C\u57FA\u790E", "NAWL/\u5B66\u8853", "TSL/TOEIC"]],
          ["NGSL-GR\u306E\u6BB5\u968E", ["NGSL-GR/\u88DC\u52A9\u8A9E", ...Array.from({ length: 11 }, (_, i) => "NGSL-GR/" + String(i + 1).padStart(2, "0"))]]
        ];
        for (const [title, ids] of groups) {
          if (!ids.some((id) => cards.some((c) => (c.vocab?.memberships || []).includes(id)))) continue;
          const section = title.startsWith("NGSL-GR") ? panel.createEl("details", { cls: "sr-mastery-vocabulary-extra" }) : panel;
          section.createEl(title.startsWith("NGSL-GR") ? "summary" : "h4", { text: title });
          const row = section.createDiv({ cls: "sr-mastery-vocabulary-facets" });
          for (const id of ids) {
            const count = cards.filter((c) => (c.vocab?.memberships || []).includes(id)).length;
            if (!count) continue;
            const btn = row.createEl("button", { text: this._vocabularyLabel(id) + " \xB7 " + count + "\u554F", cls: "sr-mastery-vocabulary-filter" });
            btn.setAttribute("data-vocabulary", id);
            btn.setAttribute("aria-pressed", String(this.selectedVocabulary === id));
            btn.classList.toggle("is-selected", this.selectedVocabulary === id);
            btn.addEventListener("click", () => {
              const firstStage = id + "/Stage 01";
              this.selectedVocabulary = title === "CEFR-J\u306E\u30EC\u30D9\u30EB" && cards.some((c) => (c.vocab?.memberships || []).includes(firstStage)) ? firstStage : id;
              this.selectedCourse = null;
              this.selectedFolder = null;
              this._saveBrowserPreferences();
              this._renderHome();
            });
          }
          if (title === "CEFR-J\u306E\u30EC\u30D9\u30EB") {
            const selected = /^CEFR-J\/(A1|A2|B1|B2)(?:\/Stage \d+)?$/.exec(this.selectedVocabulary || "");
            if (selected) {
              const parentTag = "CEFR-J/" + selected[1];
              const stages = [...new Set(cards.flatMap((c) => c.vocab?.memberships || []).filter((tag) => tag.startsWith(parentTag + "/Stage ")))].sort((a, b) => Number(a.split("Stage ")[1]) - Number(b.split("Stage ")[1]));
              if (stages.length) {
                const stageHeader = panel.createEl("h4", {
                  text: "CEFR-J " + selected[1] + " \u2014 Stage\u5225\uFF08\u7D04230\u301C250\u554F\uFF09"
                });
                const stageGrid = panel.createDiv({
                  cls: "sr-mastery-vocabulary-facets sr-mastery-vocabulary-stages"
                });
                for (const stageId of stages) {
                  const scoped = cards.filter((c) => (c.vocab?.memberships || []).includes(stageId));
                  const stageNumber = Number(stageId.split("Stage ")[1]);
                  const button = stageGrid.createEl("button", {
                    text: "Stage " + stageNumber + " \xB7 " + scoped.length + "\u554F",
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
        panel.createEl("p", { cls: "sr-mastery-caption", text: "CEFR-J\u306FStage\u3054\u3068\u7D04230\u301C250\u554F\u3002\u76EE\u7684\u5225\u30FB\u6BB5\u968E\u5225\u306F\u540C\u3058\u30AB\u30FC\u30C9\u306E\u5225\u5206\u985E\u306A\u306E\u3067Ease\u3092\u5171\u6709\u3057\u307E\u3059\u3002" });
      }
      _renderSubdeckBrowser(parent) {
        const container = parent.createDiv({ cls: "sr-mastery-subdeck-browser" });
        const back = container.createEl("button", {
          text: "\u2039 \u30B8\u30E3\u30F3\u30EB\u306B\u623B\u308B",
          cls: "sr-mastery-subdeck-back"
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
        container.createEl("h3", { text: this.selectedGenre === "\u3059\u3079\u3066" ? "\u30D5\u30A9\u30EB\u30C0\u5225" : this.selectedGenre + (this.selectedGenre === "\u82F1\u5358\u8A9E" ? " \u203A \u30EC\u30D9\u30EB\u30FB\u76EE\u7684\u5225" : " \u203A \u6388\u696D\u30FB\u30D5\u30A9\u30EB\u30C0\u5225") });
        const scoped = this.cards.filter((c) => this.selectedGenre === "\u3059\u3079\u3066" || c.genre === this.selectedGenre);
        const all = container.createEl("button", {
          text: "\u3053\u306E\u30B8\u30E3\u30F3\u30EB\u306E\u5168\u3066 \xB7 " + scoped.length + "\u554F",
          cls: "sr-mastery-subdeck-all"
        });
        all.classList.toggle("is-selected", !this.selectedCourse && !this.selectedFolder && !this.selectedVocabulary);
        all.addEventListener("click", () => {
          this.selectedCourse = null;
          this.selectedFolder = null;
          this._saveBrowserPreferences();
          this._renderHome();
        });
        if (this.selectedGenre === "\u82F1\u5358\u8A9E") this._renderVocabularyBrowser(container, scoped);
        const courses = [...new Set(scoped.map((c) => c.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
        if (courses.length) {
          container.createEl("h4", { text: "\u6388\u696D\u3054\u3068\u306E\u30C7\u30C3\u30AD" });
          const group = container.createDiv({ cls: "sr-mastery-subdeck-group" });
          for (const course of courses) {
            const count = scoped.filter((c) => c.course === course).length;
            const button = group.createEl("button", {
              text: course + " \xB7 " + count + "\u554F",
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
        if (this.selectedGenre === "\u5927\u5B66\u4E00\u822C" && this.selectedCourse) {
          const courseCards = scoped.filter((c) => c.course === this.selectedCourse);
          const relational = courseCards.filter((c) => studySentenceSpec(c));
          if (relational.length) {
            container.createEl("h4", { text: "\u5B66\u7FD2\u5185\u5BB9" });
            const modes = container.createDiv({ cls: "sr-mastery-activity-filters" });
            for (const [key, label, count] of [
              ["all", "\u5168\u3066", courseCards.length],
              ["word", "\u5358\u8A9E\u30FB\u7528\u8A9E", courseCards.length - relational.length],
              ["sentence", "\u95A2\u4FC2\u6027\u30FB\u6587\u7D44\u307F\u7ACB\u3066", relational.length]
            ]) {
              const button = modes.createEl("button", {
                text: label + " \xB7 " + count + "\u554F",
                cls: "sr-mastery-activity-filter"
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
        const folders = [...new Set(scoped.map((c) => c.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
        if (folders.length) {
          container.createEl("h4", { text: "\u4FDD\u5B58\u30D5\u30A9\u30EB\u30C0\u3054\u3068\u306E\u30C7\u30C3\u30AD" });
          const group = container.createDiv({ cls: "sr-mastery-subdeck-group" });
          for (const folder of folders) {
            const count = scoped.filter((c) => c.folder === folder).length;
            const name = folder.split("/").pop() || folder;
            const button = group.createEl("button", {
              text: name + " \xB7 " + count + "\u554F",
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
        if ((this.owner._masteryRevision ?? 0) > (this.owner._masterySavedRevision ?? 0)) {
          void this.owner._flushMastery?.();
        }
        this._stopCelebration();
        this.modalEl.classList.remove("sr-mastery-timeout-mode");
        this.screen = "home";
        this.main.replaceChildren();
        const lead = this.main.createEl("p", { text: "\u65E2\u306B\u7B54\u3048\u305F\u554F\u984C\u3082\u542B\u3081\u3001\u3044\u3064\u3067\u3082\u7DF4\u7FD2\u3067\u304D\u307E\u3059\u3002", cls: "sr-mastery-caption" });
        if (this.invalidSentenceCount) this.main.createEl("p", { text: this.invalidSentenceCount + "\u554F\u306E\u6587\u7D44\u307F\u7ACB\u3066\u3092\u51FA\u984C\u4FDD\u7559\u3057\u3066\u3044\u307E\u3059\u3002\u6B63\u7B54\u3068\u30D5\u30EC\u30FC\u30BA\u69CB\u6210\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", cls: "sr-mastery-caption" });
        if (this.browseSubdecks) {
          this._renderSubdeckBrowser(this.main);
        } else {
          const categories = this.main.createDiv({ cls: "sr-mastery-categories" });
          for (const genre of this._genreList()) {
            const genreCards = this.cards.filter((c) => genre === "\u3059\u3079\u3066" || c.genre === genre);
            const genreStats = this._stats(genreCards);
            const button = categories.createEl("button", { cls: "sr-mastery-category" });
            this._renderDonut(button, genreStats, true);
            const caption = button.createDiv({ cls: "sr-mastery-category-info" });
            caption.createSpan({
              text: ["\u5927\u5B66\u4E00\u822C", "\u82F1\u5358\u8A9E"].includes(genre) ? genre + " \u203A" : genre,
              cls: "sr-mastery-category-name"
            });
            caption.createSpan({ text: genreCards.length + "\u554F", cls: "sr-mastery-caption" });
            if (genre === "\u5927\u5B66\u4E00\u822C") {
              button.setAttribute("aria-label", "\u5927\u5B66\u4E00\u822C\u3092\u6388\u696D\u5225\u30FB\u30D5\u30A9\u30EB\u30C0\u5225\u306B\u958B\u304F");
            }
            if (genre === this.selectedGenre) button.classList.add("is-selected");
            button.setAttribute("aria-pressed", String(genre === this.selectedGenre));
            button.addEventListener("click", () => {
              this.selectedVocabulary = "";
              this.selectedGenre = genre;
              this.selectedCourse = null;
              this.selectedFolder = null;
              this.browseSubdecks = ["\u5927\u5B66\u4E00\u822C", "\u82F1\u5358\u8A9E"].includes(genre);
              this._saveBrowserPreferences();
              this._renderHome();
            });
          }
          const folders = this.main.createEl("button", {
            text: "\u4FDD\u5B58\u30D5\u30A9\u30EB\u30C0\u304B\u3089\u9078\u3076 \u203A",
            cls: "sr-mastery-folder-drill"
          });
          folders.addEventListener("click", () => {
            this.selectedVocabulary = "";
            this.selectedGenre = "\u3059\u3079\u3066";
            this.selectedCourse = null;
            this.selectedFolder = null;
            this.browseSubdecks = true;
            this._saveBrowserPreferences();
            this._renderHome();
          });
        }
        const cards = this.cards.filter((c) => this._matchesDeck(c));
        const stats = this._stats(cards);
        const overview = this.main.createDiv({ cls: "sr-mastery-overview" });
        this._renderDonut(overview, stats);
        const overviewDetail = overview.createDiv({ cls: "sr-mastery-overview-detail" });
        const scopeName = (this.selectedVocabulary ? this._vocabularyLabel(this.selectedVocabulary) : "") || this.selectedCourse || (this.selectedFolder ? this.selectedFolder.split("/").pop() : this.selectedGenre);
        overviewDetail.createEl("strong", {
          text: scopeName + " \xB7 " + cards.length + "\u554F"
        });
        overviewDetail.createEl("p", {
          cls: "sr-mastery-caption",
          text: "\u5B66\u7FD2\u6E08\u307F " + (cards.length - stats.unseen) + "\u554F"
        });
        const legend = overviewDetail.createDiv({ cls: "sr-mastery-legend" });
        for (const stage of STUDY_LEVELS) {
          const item = legend.createSpan({ cls: "sr-mastery-legend-item" });
          item.createSpan({ cls: "sr-mastery-legend-dot is-" + stage });
          item.createSpan({ text: STUDY_LABELS[stage] + " " + stats[stage] });
        }
        const due = cards.filter((card) => this._isDue(card));
        if (due.length) {
          const review = this.main.createEl("button", {
            text: "\u5FA9\u7FD2\u63A8\u5968 " + due.length + "\u554F \u203A",
            cls: "sr-mastery-due-start"
          });
          review.setAttribute("aria-label", "\u8A18\u61B6\u306E\u4E88\u6E2C\u671F\u9650\u304C\u6765\u305F\u30AB\u30FC\u30C9\u3092\u5FA9\u7FD2\u3059\u308B");
          review.addEventListener("click", () => this._start(due, true));
        } else {
          const upcoming = cards.map((card) => studyMemoryState(this.owner._mastery?.[card.id])).filter((state) => state?.dueAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
          if (upcoming) {
            const date = new Date(upcoming.dueAt);
            this.main.createEl("p", {
              cls: "sr-mastery-caption sr-mastery-upcoming",
              text: "\u6B21\u56DE\u306E\u5FA9\u7FD2\u76EE\u5B89\uFF1A" + date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
            });
          }
        }
        const statRow = this.main.createDiv({ cls: "sr-mastery-stats" });
        const stages = ["unseen", "weak", "known", "all", "perfect"];
        for (const stage of stages) {
          const amount = stage === "all" ? cards.length : stats[stage];
          const button = statRow.createEl("button");
          button.type = "button";
          button.className = "sr-mastery-stat";
          const name = stage === "all" ? "\u5168\u3066" : STUDY_LABELS[stage];
          button.textContent = name + " " + amount;
          button.classList.toggle("is-selected", this.selectedStage === stage);
          button.addEventListener("click", () => {
            this.selectedStage = stage;
            this._saveBrowserPreferences();
            this._renderHome();
          });
        }
        const start = this.main.createEl("button", { text: "\u5B66\u7FD2\u3092\u59CB\u3081\u308B", cls: "sr-mastery-start" });
        start.disabled = cards.length === 0 || this.selectedStage !== "all" && stats[this.selectedStage] === 0;
        start.addEventListener("click", () => this._start(cards));
        if (cards.length === 0) {
          this.main.createEl("p", { text: "\u3053\u306E\u30B8\u30E3\u30F3\u30EB\u306B\u30AB\u30FC\u30C9\u306F\u3042\u308A\u307E\u305B\u3093\u3002#flashcards/\u30B8\u30E3\u30F3\u30EB \u30BF\u30B0\u3092\u30CE\u30FC\u30C8\u306B\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044\u3002", cls: "sr-mastery-caption" });
        }
      }
      _selectionCards() {
        return this.cards.filter((c) => this._matchesDeck(c) && (this.selectedStage === "all" || this._level(c) === this.selectedStage));
      }
      _repeatSameSelection() {
        if (this.settingsOpen || !["rep-break", "done"].includes(this.screen)) return;
        const candidates = this._selectionCards();
        if (!candidates.length) return;
        void this.owner._flushMastery?.();
        this._start(candidates);
      }
      _start(candidates, ignoreStage = false) {
        const unique = new Map(candidates.filter(
          (c) => ignoreStage || this.selectedStage === "all" || this._level(c) === this.selectedStage
        ).map((card) => [card.id, card]));
        this.queue = studyShuffle([...unique.values()]);
        this.deferredWeak = /* @__PURE__ */ new Map();
        this.repSeen = /* @__PURE__ */ new Set();
        const reviewStamp = (card) => {
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
        while (this.queue.length && this.repSeen?.has(this.queue[0].id)) {
          this.queue.shift();
        }
        if (this.rep && this.rep.attempted > 0 && (this.rep.attempted >= this.rep.size || this.queue.length === 0)) {
          this._renderRepBreak();
          return;
        }
        if (!this.queue.length) {
          this.modalEl.classList.remove("sr-mastery-timeout-mode");
          this.current = null;
          this.screen = "done";
          this.main.replaceChildren();
          this.main.createEl("h3", { text: "\u4ECA\u56DE\u306E\u5B66\u7FD2\u306F\u5B8C\u4E86\uFF01" });
          this.main.createEl("p", { text: "\u56DE\u7B54 " + this.sessionStats.attempted + "\u56DE \xB7 \u6B63\u7B54 " + this.sessionStats.correct + "\u56DE" });
          const remaining = this._selectionCards().length;
          const again = this.main.createEl("button", {
            text: "\u540C\u3058\u30B8\u30E3\u30F3\u30EB\u3092\u3082\u3046\u4E00\u5EA6",
            cls: "sr-mastery-start"
          });
          again.disabled = remaining === 0;
          again.addEventListener("click", () => this._repeatSameSelection());
          const home = this.main.createEl("button", {
            text: "\u30C7\u30C3\u30AD\u306B\u623B\u308B",
            cls: "sr-mastery-native"
          });
          home.addEventListener("click", () => this._renderHome());
          return;
        }
        const card = this.queue.shift();
        this.repSeen?.add(card.id);
        const now = performance.now();
        this.screen = "study";
        this.current = {
          card,
          token: this._token,
          state: "front",
          limitMs: (studySentenceSpec(card) ? this.owner.settings.sentenceLimitSeconds || 120 : this.owner.settings.recallLimitSeconds) * 1e3,
          deadline: now + (studySentenceSpec(card) ? this.owner.settings.sentenceLimitSeconds || 120 : this.owner.settings.recallLimitSeconds) * 1e3,
          remainingFrozen: null,
          resumeAt: null,
          responseMs: null,
          sentence: studySentenceSpec(card),
          options: studySentenceSpec(card) ? null : studyOptions(card, this.cards, this.owner._curated || {}),
          choice: null,
          pointer: null
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
        const el = parent.createDiv({ cls: "akebi-celebration" });
        el.setAttribute("aria-hidden", "true");
        setIcon(el, mood === "failed" ? "sprout" : "flower-2");
      }
      _renderRepBreak(repaint = false) {
        if (!repaint) {
          if (!this.rep?.attempted) return;
          const result = { ...this.rep };
          result.percent = Math.round(result.correct / result.attempted * 100);
          result.mood = result.percent >= 85 ? "jumping" : result.percent >= 60 ? "waving" : "failed";
          result.message = result.percent === 100 ? "\u6E80\u70B9\uFF01\u3057\u3063\u304B\u308A\u899A\u3048\u76F4\u305B\u305F\u306D\u3002" : result.percent >= 85 ? "\u3059\u3054\u3044\uFF01\u7740\u5B9F\u306B\u8EAB\u306B\u3064\u3044\u3066\u3044\u308B\u306D\u3002" : result.percent >= 60 ? "\u3044\u3044\u8ABF\u5B50\uFF01\u7740\u5B9F\u306B\u899A\u3048\u3089\u308C\u3066\u3044\u308B\u306D" : "\u307E\u3060\u4F38\u3073\u308B\u3088\u3002\u82E6\u624B\u3092\u4E00\u7DD2\u306B\u89E3\u304D\u76F4\u305D\u3046";
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
        panel.createEl("p", { cls: "sr-mastery-caption", text: "Rep " + rep.number + " \xB7 \u304A\u3064\u304B\u308C\u3055\u307E\uFF01" });
        panel.createEl("h3", {
          text: rep.correct + "/" + rep.attempted,
          cls: "sr-mastery-rep-fraction"
        });
        this._celebrate(panel, rep.mood, !repaint);
        panel.createEl("p", { text: rep.message, cls: "sr-mastery-rep-words" });
        const hasPending = this.queue.length > 0 || (this.deferredWeak?.size || 0) > 0;
        const nextCandidates = hasPending ? [] : this._selectionCards();
        const remaining = nextCandidates.length;
        const stageName = this.selectedStage === "all" ? "\u5168\u3066" : STUDY_LABELS[this.selectedStage];
        const caption = hasPending ? "\u3053\u3053\u3067\u4E00\u606F\u3002\u6B21\u306ERep\u306F\u6E96\u5099\u304C\u3067\u304D\u3066\u304B\u3089\u59CB\u3081\u3089\u308C\u307E\u3059\u3002" : remaining ? this.selectedStage === "all" ? "\u540C\u3058\u30B8\u30E3\u30F3\u30EB\u3092\u7D9A\u3051\u3066\u3082\u3046\u4E00\u5468\u3067\u304D\u307E\u3059\u3002" : "\u300C" + stageName + "\u300D\u6B8B\u308A " + remaining + "\u554F\u3002\u540C\u3058\u96E3\u6613\u5EA6\u306E\u7DF4\u7FD2\u3092\u7D9A\u3051\u3089\u308C\u307E\u3059\u3002" : "\u300C" + stageName + "\u300D\u306E\u5BFE\u8C61\u306F0\u554F\u3002\u3053\u306E\u96E3\u6613\u5EA6\u306F\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002";
        panel.createEl("p", { text: caption, cls: "sr-mastery-caption" });
        const next = panel.createEl("button", {
          text: hasPending ? "\u6B21\u306ERep\u3078" : "\u540C\u3058\u30B8\u30E3\u30F3\u30EB\u3092\u3082\u3046\u4E00\u5EA6",
          cls: "sr-mastery-start"
        });
        next.disabled = !hasPending && !remaining;
        next.addEventListener("click", () => {
          if (this.settingsOpen || this.screen !== "rep-break") return;
          if (!hasPending) {
            this._repeatSameSelection();
            return;
          }
          this._stopCelebration();
          if (this.deferredWeak?.size) {
            this.queue = [...new Map([
              ...this.queue,
              ...studyShuffle([...this.deferredWeak.values()])
            ].map((card) => [card.id, card])).values()];
            this.deferredWeak.clear();
          }
          this.repSeen = /* @__PURE__ */ new Set();
          this.rep = {
            number: rep.number + 1,
            size: Math.min(this.owner.settings.repSize || 10, this.queue.length),
            attempted: 0,
            correct: 0
          };
          this._next();
        });
        const home = panel.createEl("button", {
          text: "\u30C7\u30C3\u30AD\u306B\u623B\u308B",
          cls: "sr-mastery-native"
        });
        home.addEventListener("click", () => this._renderHome());
      }
      _remaining() {
        const q = this.current;
        if (!q) return 0;
        if (q.state !== "front" && q.responseMs !== null) {
          return Math.max(0, q.limitMs - q.responseMs);
        }
        if (this.settingsOpen || q.resumeAt && performance.now() < q.resumeAt) {
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
            this.clockValue.textContent = "1\u79D2\u5F8C\u306B\u518D\u958B\u2026";
          } else if (q.state !== "front") {
            this.clockValue.textContent = "\u53CD\u5FDC " + ((q.responseMs ?? q.limitMs) / 1e3).toFixed(1) + "\u79D2";
          } else {
            const left = this._remaining();
            this.clockValue.textContent = "\u6B8B\u308A " + (left / 1e3).toFixed(1) + "\u79D2";
            if (left <= 0) this._reveal("timeout");
          }
        }
        if (this.clockBar) {
          this.clockBar.style.width = Math.max(0, 100 * this._remaining() / q.limitMs).toFixed(1) + "%";
        }
      }
      _pause(leaving = false) {
        if (!this.current) return;
        if (leaving) {
          this.current = null;
          return;
        }
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
          this._rate(false, false, true);
          return;
        }
        if (keepCard) {
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
        if (q.state === "graded" || q !== this.current) return;
        const sentenceEasyMs = Math.max(
          3e4,
          (this.owner.settings.sentenceLimitSeconds || 120) * 500
        );
        const quick = !!correct && q.revealReason !== "timeout" && q.responseMs <= (q.sentence ? sentenceEasyMs : this.owner.settings.easyThresholdSeconds * 1e3);
        const old = this.owner._mastery?.[q.card.id] ?? { stage: q.card.studied ? "known" : "unseen" };
        const next = studyMasteryNext(old, correct, {
          reactionMs: q.responseMs,
          easyMs: q.sentence ? sentenceEasyMs : this.owner.settings.easyThresholdSeconds * 1e3,
          // Whole-sentence assembly tests recall of conceptual relationships,
          // not 4-choice recognition; reuse the original mastery evidence.
          mode: q.sentence ? "sentence" : q.choice !== null ? "choice" : "slide",
          explicitPerfect,
          timedOut: q.revealReason === "timeout"
        }, (/* @__PURE__ */ new Date()).toISOString());
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
          this.deferredWeak.set(q.card.id, q.card);
        } else {
          this.deferredWeak.delete(q.card.id);
        }
        if (q.revealReason !== "timeout") this._playSound(correct ? "correct" : "wrong");
        if (q.revealReason === "timeout") {
          if (keepTimeoutFeedback) this._renderTimeoutOnly(q);
          else this._next();
        } else this._renderQuestion();
      }
      _sentenceCanEdit(q) {
        if (!q || q !== this.current || q.state !== "front" || this.screen !== "study" || this.settingsOpen || this._inResumeGrace()) return false;
        if (this._remaining() <= 0) {
          this._reveal("timeout");
          return false;
        }
        return true;
      }
      _sentencePlace(q, id) {
        if (!this._sentenceCanEdit(q) || q.sentenceSelected.length >= q.sentence.maxLength || q.sentenceSelected.includes(id) || !q.sentenceBank.some((t) => t.id === id)) return;
        q.sentenceSelected.push(id);
        this._refreshSentence(q);
      }
      _sentencePick(q, index) {
        if (!this._sentenceCanEdit(q) || index < 0 || index >= q.sentenceSelected.length) return;
        q.sentenceSelected.splice(index, 1);
        this._refreshSentence(q);
      }
      _sentenceSubmit(q) {
        if (!this._sentenceCanEdit(q)) return;
        const lengths = [q.sentence.tokens.length, ...q.sentence.alternatives.map((a) => a.length)];
        if (!lengths.includes(q.sentenceSelected.length)) return;
        const byId = new Map(q.sentenceBank.map((t) => [t.id, t]));
        const chosen = q.sentenceSelected.map((id) => byId.get(id));
        if (chosen.some((t) => !t) || new Set(q.sentenceSelected).size !== chosen.length) return;
        const correct = studySentenceAccepted(q.sentence, chosen);
        q.responseMs = this._elapsed();
        q.state = "back";
        q.revealReason = "sentence";
        q.choice = q.sentence.prefix + chosen.map((t) => t.text).join("") + q.sentence.suffix;
        this._rate(correct);
      }
      _refreshSentence(q) {
        if (q !== this.current || !q.sentenceBoard) return;
        q.sentenceBoard.replaceChildren();
        if (!q.sentenceSelected.length) q.sentenceBoard.createSpan({ text: "\u3053\u3053\u306B\u6587\u3092\u7D44\u307F\u7ACB\u3066\u308B", cls: "akebi-placeholder" });
        const byId = new Map(q.sentenceBank.map((t) => [t.id, t]));
        q.sentenceSelected.forEach((id, i) => {
          const chip = q.sentenceBoard.createEl("button", { text: byId.get(id).text, cls: "sr-sentence-chip sr-sentence-selected" });
          chip.type = "button";
          chip.setAttribute("aria-label", byId.get(id).text + "\u3092\u623B\u3059");
          chip.addEventListener("click", () => this._sentencePick(q, i));
        });
        for (const [id, button] of q.bankButtons) {
          const used = q.sentenceSelected.includes(id);
          button.disabled = used || q.sentenceSelected.length >= q.sentence.maxLength;
          button.classList.toggle("is-used", used);
          button.setAttribute("aria-pressed", String(used));
        }
        const complete = [q.sentence.tokens.length, ...q.sentence.alternatives.map((a) => a.length)].includes(q.sentenceSelected.length);
        q.checkButton.disabled = !complete;
        q.undoButton.disabled = q.sentenceSelected.length === 0;
        q.sentenceCounter.textContent = q.sentenceSelected.length + " / " + q.sentence.tokens.length + " \u30D5\u30EC\u30FC\u30BA";
      }
      _renderSentenceQuestion(q) {
        if (!q || q !== this.current) return;
        this.modalEl.classList.remove("sr-mastery-timeout-mode");
        this.main.replaceChildren();
        this.clockValue = null;
        this.clockBar = null;
        this.main.createEl("p", { text: (q.card.course || q.card.genre) + " \xB7 \u6587\u7D44\u307F\u7ACB\u3066", cls: "sr-mastery-caption" });
        if (this.rep) this.main.createEl("p", { text: "Rep " + this.rep.number + " \xB7 " + this.rep.attempted + "/" + this.rep.size + " \u56DE\u7B54", cls: "sr-mastery-rep-progress" });
        this.main.createEl("h3", { text: q.card.question, cls: "sr-sentence-question" });
        if (q.state === "front") {
          const clock = this.main.createDiv({ cls: "sr-mastery-clock" });
          this.clockValue = clock.createSpan();
          this.clockBar = clock.createDiv({ cls: "sr-mastery-clock-track" }).createDiv({ cls: "sr-mastery-clock-bar" });
          const frame = this.main.createDiv({ cls: "akebi-sentence-frame" });
          frame.createEl("p", { text: q.sentence.prefix, cls: "akebi-fixed-boundary" });
          q.sentenceBoard = frame.createDiv({ cls: "sr-sentence-placed" });
          q.sentenceBoard.setAttribute("aria-label", "\u7D44\u307F\u7ACB\u3066\u308B\u4E2D\u592E\u90E8\u5206");
          frame.createEl("p", { text: q.sentence.suffix, cls: "akebi-fixed-boundary" });
          q.sentenceCounter = this.main.createEl("p", { cls: "sr-sentence-counter" });
          this.main.createEl("p", { text: "\u5019\u88DC\u3092\u9806\u756A\u306B\u9078\u3076\u3002\u4E0A\u306E\u30D5\u30EC\u30FC\u30BA\u3092\u30BF\u30C3\u30D7\u3059\u308B\u3068\u623B\u305B\u307E\u3059\u3002", cls: "sr-mastery-caption" });
          const pool = this.main.createDiv({ cls: "sr-sentence-bank" });
          pool.setAttribute("role", "group");
          pool.setAttribute("aria-label", "\u5168\u3066\u306E\u5019\u88DC\u30D5\u30EC\u30FC\u30BA");
          q.bankButtons = /* @__PURE__ */ new Map();
          for (const tile of q.sentenceBank) {
            const b = pool.createEl("button", { text: tile.text, cls: "sr-sentence-chip sr-sentence-bank-chip" });
            b.type = "button";
            b.setAttribute("data-piece", tile.id);
            b.addEventListener("click", () => this._sentencePlace(q, tile.id));
            q.bankButtons.set(tile.id, b);
          }
          const actions = this.main.createDiv({ cls: "sr-sentence-actions" });
          q.undoButton = actions.createEl("button", { text: "\u4E00\u3064\u623B\u3059" });
          q.undoButton.type = "button";
          q.undoButton.addEventListener("click", () => this._sentencePick(q, q.sentenceSelected.length - 1));
          q.checkButton = actions.createEl("button", { text: "\u7B54\u3048\u5408\u308F\u305B", cls: "mod-cta sr-sentence-check" });
          q.checkButton.type = "button";
          q.checkButton.addEventListener("click", () => this._sentenceSubmit(q));
          this._refreshSentence(q);
          this._tick();
        } else {
          const status = q.revealReason === "timeout" ? "\u6642\u9593\u5207\u308C \xB7 FAIL\u8A18\u9332\u6E08\u307F" : q.result?.correct ? "\u6B63\u89E3\uFF01" : "\u5F79\u5272\u30FB\u9806\u5E8F\u30FB\u5426\u5B9A\u3092\u78BA\u8A8D\u3057\u3088\u3046";
          this.main.createEl("p", { text: status, cls: "sr-sentence-result-status" });
          const byId = new Map(q.sentenceBank.map((t) => [t.id, t]));
          if (q.sentenceSelected.length) {
            this.main.createEl("p", { text: "\u7D44\u307F\u7ACB\u3066\u305F\u6587", cls: "sr-sentence-caption" });
            this.main.createEl("p", { text: q.sentence.prefix + q.sentenceSelected.map((id) => byId.get(id)?.text || "").join("") + q.sentence.suffix, cls: "sr-sentence-attempt" });
          }
          this.main.createEl("p", { text: "\u6A21\u7BC4\u6587", cls: "sr-sentence-caption" });
          this.main.createEl("p", { text: q.sentence.canonical, cls: "sr-sentence-canonical" });
          if (q.card.explanation) this.main.createEl("p", { text: q.card.explanation, cls: "sr-mastery-explanation" });
          if (q.card.tips) this.main.createEl("p", { text: q.card.tips, cls: "sr-mastery-tips" });
          const next = this.main.createEl("button", { text: "\u6B21\u306E\u554F\u984C\u306B\u9032\u3080", cls: "sr-mastery-next" });
          next.addEventListener("click", () => {
            if (this.current === q && q.state === "graded" && !this.settingsOpen) this._next();
          });
        }
      }
      _renderTimeoutOnly(q) {
        if (q.sentence) {
          this._renderSentenceQuestion(q);
          return;
        }
        const isChoiceTimeout = this.owner.settings.studyMode === "choice" && !!q.options;
        this.modalEl.classList.add("sr-mastery-timeout-mode");
        this.main.replaceChildren();
        this.clockValue = null;
        this.clockBar = null;
        const card = this.main.createDiv({ cls: "sr-mastery-flashcard sr-mastery-timeout-card" });
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", isChoiceTimeout ? "\u6642\u9593\u5207\u308C\u3002\u6B63\u7B54\u3068\u89E3\u8AAC\u3002\u6B21\u306E\u554F\u984C\u306B\u9032\u3080" : "\u6642\u9593\u5207\u308C\u3002\u6B63\u7B54\u3068\u89E3\u8AAC\u3002\u5DE6\u3078\u30B9\u30EF\u30A4\u30D7\u3057\u3066\u6B21\u3078");
        card.createEl("p", { text: q.card.question, cls: "sr-mastery-question" });
        card.createEl("p", { text: "\u6B63\u7B54\uFF1A" + q.card.answer, cls: "sr-mastery-answer" });
        card.createEl("p", { text: "\u89E3\u8AAC", cls: "sr-mastery-explanation-title" });
        card.createEl("p", {
          text: q.card.explanation || "\u3053\u306E\u554F\u984C\u306E\u89E3\u8AAC\u306F\u672A\u767B\u9332\u3067\u3059\u3002",
          cls: "sr-mastery-explanation"
        });
        if (q.card.tips) card.createEl("p", {
          text: "\u{1F4A1} " + q.card.tips,
          cls: "sr-mastery-tips"
        });
        if (isChoiceTimeout) {
          const next = card.createEl("button", {
            text: "\u6B21\u306E\u554F\u984C\u306B\u9032\u3080",
            cls: "sr-mastery-next"
          });
          next.addEventListener("click", () => {
            if (this.current !== q || this.settingsOpen || q.revealReason !== "timeout" || q.state !== "graded") return;
            this._next();
          });
        } else {
          card.createEl("p", { text: "\u2190 \u5DE6\u3078\u30B9\u30EF\u30A4\u30D7", cls: "sr-mastery-timeout-instruction" });
          this._bindSwipe(card, q);
        }
      }
      _stopPronunciation() {
        if (!this._pronunciation) return;
        try {
          this._pronunciation.pause();
          this._pronunciation.currentTime = 0;
        } catch (_) {
        }
        this._pronunciation = null;
      }
      async _playPronunciation(relativePath) {
        if (typeof relativePath !== "string" || relativePath.startsWith("/") || relativePath.includes(":") || relativePath.split("/").includes("..")) return;
        const file = this.app.vault.getAbstractFileByPath?.(relativePath);
        if (!file || !["mp3", "wav", "ogg", "m4a"].includes(file.extension)) {
          new Notice2("\u767A\u97F3\u30D5\u30A1\u30A4\u30EB\u306E\u540C\u671F\u3092\u5F85\u3063\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044");
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
          new Notice2("\u767A\u97F3\u3092\u518D\u751F\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
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
          text: STUDY_LABELS[this._level(q.card)] + (Number.isFinite(state?.ease) ? " \xB7 Ease " + state.ease : "")
        });
        if (this.rep) {
          this.main.createEl("p", {
            cls: "sr-mastery-rep-progress",
            text: "Rep " + this.rep.number + " \xB7 " + this.rep.attempted + "/" + this.rep.size + " \u56DE\u7B54"
          });
        }
        const clock = this.main.createDiv({ cls: "sr-mastery-clock" });
        this.clockValue = clock.createSpan({ text: "\u6B8B\u308A " + this.owner.settings.recallLimitSeconds + "\u79D2" });
        const track = clock.createDiv({ cls: "sr-mastery-clock-track" });
        this.clockBar = track.createDiv({ cls: "sr-mastery-clock-bar" });
        const card = this.main.createDiv({ cls: "sr-mastery-flashcard" });
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", "\u554F\u984C");
        card.createEl("p", { text: q.card.question, cls: "sr-mastery-question" });
        if (q.card.audio?.length) {
          const pronunciation = card.createEl("button", { cls: "sr-mastery-pronunciation" });
          pronunciation.type = "button";
          pronunciation.setAttribute("aria-label", "\u82F1\u5358\u8A9E\u306E\u767A\u97F3\u3092\u8074\u304F");
          pronunciation.setAttribute("title", "\u767A\u97F3\u3092\u8074\u304F");
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
            const btn = grid.createEl("button", { text: index + 1 + ". " + option });
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
            card.createEl("p", { text: "\u3053\u306E\u554F\u984C\u306F4\u629E\u5019\u88DC\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u308B\u305F\u3081\u3001\u30B9\u30E9\u30A4\u30C9\u5F62\u5F0F\u3067\u51FA\u984C\u3057\u307E\u3059\u3002", cls: "sr-mastery-caption" });
          }
          card.classList.add("sr-mastery-slide");
          const tap = card.createEl("button", { text: "\u30BF\u30C3\u30D7\u3057\u3066\u7B54\u3048\u3092\u898B\u308B", cls: "sr-mastery-reveal" });
          tap.addEventListener("click", () => this._reveal("tap"));
          this._bindSwipe(card, q);
        } else {
          const wrongChoice = q.choice !== null && q.options && q.choice !== q.options.correct;
          if (wrongChoice) {
            const feedback = card.createDiv({ cls: "sr-mastery-chosen-wrong" });
            feedback.createEl("span", { text: "\u3042\u306A\u305F\u304C\u9078\u3093\u3060\u56DE\u7B54", cls: "sr-mastery-chosen-wrong-label" });
            feedback.createEl("p", { text: q.choice, cls: "sr-mastery-chosen-wrong-value" });
          }
          const back = card.createEl("p", {
            text: wrongChoice ? "\u6B63\u7B54\uFF1A" + q.card.answer : q.card.answer,
            cls: "sr-mastery-answer"
          });
          if (q.card.explanation) {
            card.createEl("p", { text: "\u89E3\u8AAC\uFF1A" + q.card.explanation, cls: "sr-mastery-explanation" });
          }
          if (q.card.tips) card.createEl("p", {
            text: "\u{1F4A1} " + q.card.tips,
            cls: "sr-mastery-tips"
          });
          if (q.choice !== null) {
            card.createEl("p", {
              text: wrongChoice ? "\u4E0D\u6B63\u89E3 \xB7 \u6B21\u306ERep\u3067\u518D\u6311\u6226" : "\u6B63\u89E3\uFF01",
              cls: "sr-mastery-caption"
            });
          }
          if (q.state === "back") {
            const buttons = card.createDiv({ cls: "sr-mastery-ratings" });
            for (const [label, value] of [["\u82E6\u624B", "weak"], ["\u308F\u304B\u308B", "known"], ["\u5B8C\u74A7", "perfect"]]) {
              const btn = buttons.createEl("button", { text: label });
              btn.addEventListener("click", () => this._rate(value !== "weak", value === "perfect"));
            }
            this._bindSwipe(card, q);
          } else {
            card.createEl("p", {
              text: "\u2192 " + STUDY_LABELS[q.result.stage] + (q.result.correct ? " \xB7 " + (q.result.quick ? "\u5373\u7B54" : "\u6B63\u89E3") : " \xB7 \u5F8C\u3067\u89E3\u304D\u76F4\u3057"),
              cls: "sr-mastery-outcome"
            });
            const next = card.createEl("button", { text: "\u6B21\u306E\u554F\u984C\u306B\u9032\u3080", cls: "sr-mastery-next" });
            next.addEventListener("click", () => {
              if (this.current === q && q.state === "graded" && !this.settingsOpen) this._next();
            });
          }
        }
        const bottom = this.main.createEl("p", {
          text: "\u6B8B\u308A " + (this.queue.length + 1) + "\u554F \xB7 " + q.card.source,
          cls: "sr-mastery-caption"
        });
        this._tick();
      }
      _bindSwipe(card, question) {
        card.addEventListener("pointerdown", (event) => {
          if (event.target.closest("button,a") || this.settingsOpen || this._inResumeGrace()) return;
          question.pointer = {
            x: event.clientX,
            y: event.clientY,
            start: performance.now(),
            moved: false,
            startedAfterTimeout: question.revealReason === "timeout"
          };
        });
        card.addEventListener("pointermove", (event) => {
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
        card.addEventListener("pointerup", (event) => {
          const p = question.pointer;
          question.pointer = null;
          if (!p || !p.moved || question !== this.current || this.settingsOpen || !card.isConnected) return;
          const dx = event.clientX - p.x;
          const dy = event.clientY - p.y;
          if (Math.abs(dx) < 66 || Math.abs(dy) > Math.abs(dx) * 0.7) {
            if (question.state === "back") this._renderQuestion();
            return;
          }
          if (question.revealReason === "timeout" && question.state === "graded") {
            if (p.startedAfterTimeout && dx < 0) this._next();
            return;
          }
          if (question.state === "back") this._rate(dx > 0);
        });
        card.addEventListener("pointercancel", () => {
          question.pointer = null;
          if (question === this.current && question.state === "back") this._renderQuestion();
        });
      }
      async _saveCardMetadata(card, dummies, explanation, choiceAnswer, tips = null) {
        if (!card?.source || !card.question) throw new Error("\u4FDD\u5B58\u3059\u308B\u554F\u984C\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
        const clean = dummies.map((x) => String(x || "").trim());
        if (clean.length !== 3 || clean.some((x) => !x || x.length > 120)) {
          throw new Error("\u8AA4\u7B54\u5019\u88DC\u30923\u3064\u3001\u305D\u308C\u305E\u308C120\u6587\u5B57\u4EE5\u5185\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");
        }
        if ([...clean, explanation, choiceAnswer, tips].some((x) => String(x || "").includes("%%") || String(x || "").includes("::") || String(x || "").includes("\n") || String(x || "").includes("\r"))) {
          throw new Error("\u6539\u884C\u3068 %%\u30FB:: \u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093");
        }
        if (new Set(clean.map(studyNormalize)).size !== 3) {
          throw new Error("\u8AA4\u7B54\u5019\u88DC\u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059");
        }
        const canonical = String(choiceAnswer || "").trim();
        if (canonical && !studyNormalize(card.answer).includes(studyNormalize(canonical))) {
          throw new Error("4\u629E\u7528\u306E\u6B63\u7B54\u306F\u3001\u5143\u306E\u6B63\u7B54\u306B\u542B\u307E\u308C\u308B\u8868\u8A18\u306B\u3057\u3066\u304F\u3060\u3055\u3044");
        }
        const correctLabel = canonical || card.answer;
        if (clean.some((x) => studyNormalize(x) === studyNormalize(correctLabel))) {
          throw new Error("\u8AA4\u7B54\u5019\u88DC\u306B\u6B63\u89E3\u3068\u540C\u3058\u5185\u5BB9\u304C\u3042\u308A\u307E\u3059");
        }
        const file = this.app.vault.getAbstractFileByPath(card.source);
        if (!file || file.extension !== "md") throw new Error("\u30AB\u30FC\u30C9\u5143\u306EMarkdown\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
        if (typeof this.app.vault.process !== "function") {
          throw new Error("Obsidian Vault.process \u304C\u4F7F\u3048\u306A\u3044\u305F\u3081\u3001\u5B89\u5168\u306B\u66F8\u304D\u8FBC\u3081\u307E\u305B\u3093");
        }
        const cleanTips = tips === null ? card.tips || "" : String(tips || "").trim();
        await this.app.vault.process(
          file,
          (current) => studyUpdateNoteMetadata(
            current,
            card.question,
            clean,
            String(explanation || "").trim(),
            canonical,
            cleanTips
          )
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
        const section = layer.createEl("details", { cls: "sr-mastery-mc-editor" });
        section.createEl("summary", { text: "\u3053\u306E\u554F\u984C\u306E4\u629E\u30FB\u89E3\u8AAC\u3092\u7DE8\u96C6" });
        section.createEl("p", { text: card.question, cls: "sr-mastery-caption" });
        section.createEl("p", { text: "\u6B63\u7B54\uFF1A" + card.answer, cls: "sr-mastery-caption" });
        const source = section.createDiv({ cls: "sr-mastery-edit-fields" });
        const shortLabel = source.createEl("label", { text: "4\u629E\u3067\u8868\u793A\u3059\u308B\u6B63\u7B54\uFF08\u7701\u7565\u53EF\uFF09" });
        const correctInput = source.createEl("input");
        correctInput.type = "text";
        correctInput.value = card.choiceAnswer || "";
        correctInput.placeholder = card.answer;
        shortLabel.appendChild(correctInput);
        const inputs = [];
        for (let i = 0; i < 3; i++) {
          const label = source.createEl("label", { text: "\u60F3\u5B9A\u8AA4\u7B54 " + (i + 1) });
          const field = source.createEl("textarea");
          field.value = card.dummies?.[i] || "";
          field.rows = 2;
          label.appendChild(field);
          inputs.push(field);
        }
        const explanationLabel = source.createEl("label", { text: "\u89E3\u8AAC\uFF08\u6642\u9593\u5207\u308C\u306B\u3082\u8868\u793A\uFF09" });
        const explanationInput = source.createEl("textarea");
        explanationInput.rows = 4;
        explanationInput.value = card.explanation || "";
        explanationLabel.appendChild(explanationInput);
        const tipsLabel = source.createEl("label", { text: "\u3072\u3068\u3053\u3068Tips\uFF08\u4EFB\u610F\uFF09" });
        const tipsInput = source.createEl("textarea");
        tipsInput.rows = 2;
        tipsInput.value = card.tips || "";
        tipsLabel.appendChild(tipsInput);
        const status = section.createEl("p", { cls: "sr-mastery-caption" });
        status.setAttribute("role", "status");
        const save = section.createEl("button", {
          text: "\u3053\u306E\u30AB\u30FC\u30C9\u306B\u4FDD\u5B58",
          cls: "sr-mastery-save-options"
        });
        save.addEventListener("click", async () => {
          if (save.disabled) return;
          save.disabled = true;
          status.textContent = "\u4FDD\u5B58\u3057\u3066\u3044\u307E\u3059\u2026";
          try {
            await this._saveCardMetadata(
              card,
              inputs.map((x) => x.value),
              explanationInput.value,
              correctInput.value,
              tipsInput.value
            );
            status.textContent = "\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002\u6B21\u56DE\u4EE5\u964D\u3082\u3053\u306E\u9078\u629E\u80A2\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002";
          } catch (error) {
            status.textContent = "\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\uFF1A" + String(error.message || error);
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
        layer.createEl("h3", { text: "\u5B66\u7FD2\u8A2D\u5B9A" });
        const mode = layer.createDiv({ cls: "sr-mastery-setting-field" });
        mode.createEl("label", { text: "\u51FA\u984C\u5F62\u5F0F" });
        const selector = mode.createEl("select");
        for (const [value, text] of [["choice", "4\u629E"], ["slide", "\u30B9\u30E9\u30A4\u30C9"]]) {
          const opt = selector.createEl("option", { text });
          opt.value = value;
        }
        selector.value = this.owner.settings.studyMode;
        selector.addEventListener("change", () => this._setSetting("studyMode", selector.value));
        this._renderCardMetadataEditor(layer);
        const repField = layer.createDiv({ cls: "sr-mastery-setting-field" });
        repField.createEl("label", { text: "1 Rep\u3042\u305F\u308A\u306E\u554F\u984C\u6570" });
        const repInput = repField.createEl("input");
        repInput.type = "number";
        repInput.min = "1";
        repInput.max = "50";
        repInput.step = "1";
        repInput.value = String(this.owner.settings.repSize || 10);
        repInput.setAttribute("aria-label", "Rep\u3054\u3068\u306E\u56DE\u7B54\u56DE\u6570");
        repInput.addEventListener("change", () => {
          const value = Math.max(1, Math.min(
            50,
            Math.round(Number(repInput.value) || 10)
          ));
          repInput.value = String(value);
          this._setSetting("repSize", value);
          if (this.rep && this.screen === "study") {
            const currentIsPending = this.current?.state !== "graded" ? 1 : 0;
            const outstanding = this.rep.attempted + this.queue.length + currentIsPending;
            this.rep.size = Math.max(
              this.rep.attempted + currentIsPending,
              Math.min(value, outstanding)
            );
          }
        });
        repField.createEl("small", {
          cls: "sr-mastery-caption",
          text: "Rep\u306E\u6700\u5927\u51FA\u984C\u6570\u3067\u3059\u3002\u5BFE\u8C61\u306E\u554F\u984C\u304C\u5C11\u306A\u3044\u5834\u5408\u3001\u5206\u6BCD\u306F\u305D\u306E\u4EF6\u6570\u306B\u5408\u308F\u305B\u307E\u3059\u3002"
        });
        const seconds = layer.createDiv({ cls: "sr-mastery-setting-field" });
        seconds.createEl("label", { text: "\u5236\u9650\u6642\u9593\uFF08\u79D2\uFF09" });
        const input = seconds.createEl("input");
        input.type = "range";
        input.min = "3";
        input.max = "60";
        input.step = "1";
        input.value = this.owner.settings.recallLimitSeconds;
        const valueText = seconds.createSpan({ text: input.value + "\u79D2" });
        input.addEventListener("input", () => {
          valueText.textContent = input.value + "\u79D2";
          this._setSetting("recallLimitSeconds", Number(input.value));
          if (this.current?.state === "front" && !this.current.sentence) {
            this.current.limitMs = Number(input.value) * 1e3;
            this.current.remainingFrozen = this.current.limitMs;
          }
        });
        const sentenceField = layer.createDiv({ cls: "sr-mastery-setting-field" });
        sentenceField.createEl("label", { text: "\u6587\u7D44\u307F\u7ACB\u3066\u306E\u5236\u9650\u6642\u9593\uFF08\u79D2\uFF09" });
        const sentenceInput = sentenceField.createEl("input");
        sentenceInput.type = "range";
        sentenceInput.min = "45";
        sentenceInput.max = "300";
        sentenceInput.step = "15";
        sentenceInput.value = this.owner.settings.sentenceLimitSeconds || 120;
        const sentenceTimeLabel = sentenceField.createSpan({
          text: sentenceInput.value + "\u79D2"
        });
        sentenceInput.addEventListener("input", () => {
          const seconds2 = Number(sentenceInput.value);
          sentenceTimeLabel.textContent = seconds2 + "\u79D2";
          this._setSetting("sentenceLimitSeconds", seconds2);
          if (this.current?.state === "front" && this.current.sentence) {
            this.current.limitMs = seconds2 * 1e3;
            this.current.remainingFrozen = this.current.limitMs;
          }
        });
        const fast = layer.createDiv({ cls: "sr-mastery-setting-field" });
        fast.createEl("label", { text: "\u53CD\u5FDC\u6642\u9593\u306E\u57FA\u6E96\uFF08\u79D2\uFF09" });
        const fastInput = fast.createEl("input");
        fastInput.type = "range";
        fastInput.min = "0.5";
        fastInput.max = "10";
        fastInput.step = "0.5";
        fastInput.value = this.owner.settings.easyThresholdSeconds;
        const fastText = fast.createSpan({ text: fastInput.value + "\u79D2" });
        fastInput.addEventListener("input", () => {
          fastText.textContent = fastInput.value + "\u79D2";
          this._setSetting("easyThresholdSeconds", Number(fastInput.value));
        });
        fast.createEl("small", {
          cls: "sr-mastery-caption",
          text: "\u901F\u3055\u306FEase\u3078\u306E\u52A0\u70B9\u306B\u4F7F\u3044\u307E\u3059\u3002\u5B8C\u74A7\u304B\u3069\u3046\u304B\u306F\u6B63\u7B54\u30FB\u8AA4\u7B54\u306E\u5C65\u6B74\u3082\u8E0F\u307E\u3048\u3066\u5224\u65AD\u3057\u307E\u3059\u3002"
        });
        const sound = layer.createDiv({ cls: "sr-mastery-setting-field" });
        const soundLabel = sound.createEl("label", { text: "\u52B9\u679C\u97F3" });
        const soundCheck = sound.createEl("input");
        soundCheck.type = "checkbox";
        soundCheck.checked = this.owner.settings.soundEnabled;
        soundCheck.addEventListener("change", () => this._setSetting("soundEnabled", soundCheck.checked));
        const volume = layer.createDiv({ cls: "sr-mastery-setting-field" });
        volume.createEl("label", { text: "\u97F3\u91CF" });
        const volumeInput = volume.createEl("input");
        volumeInput.type = "range";
        volumeInput.min = "0";
        volumeInput.max = "100";
        volumeInput.step = "5";
        volumeInput.value = this.owner.settings.soundVolume;
        const volumeText = volume.createSpan({ text: volumeInput.value + "%" });
        volumeInput.addEventListener("input", () => {
          volumeText.textContent = volumeInput.value + "%";
          this._setSetting("soundVolume", Number(volumeInput.value));
        });
        const soundPreview = layer.createEl("button", { text: "\u52B9\u679C\u97F3\u3092\u8A66\u8074" });
        soundPreview.addEventListener("click", () => this._playSound("correct"));
        const done = layer.createEl("button", { text: "\u5B66\u7FD2\u306B\u623B\u308B", cls: "sr-mastery-settings-done" });
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
          q.resumeAt = performance.now() + 1e3;
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
          gain.gain.setValueAtTime(1e-4, start);
          gain.gain.exponentialRampToValueAtTime(Math.max(2e-4, amplitude), start + 0.02);
          gain.gain.exponentialRampToValueAtTime(1e-4, start + 0.19);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.2);
        } catch (_) {
        }
      }
    };
    module2.exports = { AkebiStudyModal: AkebiStudyModal2, studyMasteryNext, studyCards, studyTag, studyOptions, studySentenceSpec, studySentenceAccepted, studySentenceBank, studyMemoryState };
  }
});

// src/main.js
var { Plugin, PluginSettingTab, Setting, Notice, normalizePath } = require("obsidian");
var { AkebiStudyModal } = require_study();
var DEFAULTS = Object.freeze({
  recallLimitSeconds: 10,
  easyThresholdSeconds: 2,
  sentenceLimitSeconds: 120,
  studyMode: "choice",
  choiceMode: true,
  soundEnabled: true,
  soundVolume: 25,
  repSize: 10,
  selectedStudyStage: "all",
  selectedStudyGenre: "\u3059\u3079\u3066",
  selectedStudyCourse: "",
  selectedStudyFolder: "",
  selectedStudyVocabulary: "",
  selectedStudyActivity: "all",
  selectedStudyBrowseSubdecks: false
});
var finite = (n, fallback, min, max) => Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
function settingsFrom(raw = {}) {
  return {
    ...DEFAULTS,
    ...raw,
    recallLimitSeconds: finite(raw.recallLimitSeconds, 10, 3, 60),
    easyThresholdSeconds: finite(raw.easyThresholdSeconds, 2, 0.5, 10),
    sentenceLimitSeconds: finite(raw.sentenceLimitSeconds, 120, 45, 300),
    repSize: Math.round(finite(raw.repSize, 10, 1, 50)),
    soundVolume: finite(raw.soundVolume, 25, 0, 100),
    studyMode: raw.studyMode === "slide" ? "slide" : "choice",
    selectedStudyStage: ["all", "unseen", "weak", "known", "perfect"].includes(raw.selectedStudyStage) ? raw.selectedStudyStage : "all",
    selectedStudyActivity: ["all", "word", "sentence"].includes(raw.selectedStudyActivity) ? raw.selectedStudyActivity : "all"
  };
}
function ledger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid study ledger. Existing data has not been overwritten.");
  const result = {};
  for (const [k, v] of Object.entries(value)) if (!["__proto__", "constructor", "prototype"].includes(k) && v && typeof v === "object" && !Array.isArray(v)) result[k] = v;
  return result;
}
function mergeNewer(disk, snapshot) {
  const merged = { ...disk };
  for (const [k, v] of Object.entries(snapshot)) {
    const previous = merged[k];
    const a = Date.parse(previous?.lastReviewedAt) || 0, b = Date.parse(v.lastReviewedAt) || 0;
    if (!previous || b >= a) merged[k] = v;
  }
  return merged;
}
var Akebi = class extends Plugin {
  async onload() {
    this._settingsWrite = Promise.resolve();
    this._saveChain = Promise.resolve();
    this._masteryRevision = 0;
    this._masterySavedRevision = 0;
    this._studyModal = null;
    this._curated = {};
    this.settings = settingsFrom(await this.loadData() || {});
    this.aliases = this.settings.idAliases || {};
    this._directory = normalizePath(this.manifest.dir || this.app.vault.configDir + "/plugins/" + this.manifest.id);
    try {
      this._mastery = await this.readLedger();
    } catch (error) {
      this._loadError = error;
      this._mastery = {};
      new Notice("akebi: \u5B66\u7FD2\u5C65\u6B74\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3002\u30D5\u30A1\u30A4\u30EB\u3092\u4FDD\u6301\u3057\u305F\u307E\u307E\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
    }
    if (!this._loadError && this.settings.migrationPending && !this.settings.legacyImportedAt) {
      try {
        await this.importLegacy();
      } catch (error) {
        this._loadError = error;
        new Notice("akebi: \u65E7\u5C65\u6B74\u3092\u53D6\u308A\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5143\u30D5\u30A1\u30A4\u30EB\u306F\u4FDD\u6301\u3057\u3066\u3044\u307E\u3059\u3002");
      }
    }
    this.addCommand({ id: "open-study", name: "\u5B66\u7FD2\u3092\u59CB\u3081\u308B", callback: () => this.openStudy() });
    this.addCommand({ id: "open-mastery-study", name: "\u5B66\u7FD2\uFF08\u4E92\u63DB\u30B3\u30DE\u30F3\u30C9\uFF09", callback: () => this.openStudy() });
    this.addCommand({ id: "check-cards", name: "\u554F\u984C\u5F62\u5F0F\u3092\u691C\u67FB\u3059\u308B", callback: () => this.checkCards() });
    this.addRibbonIcon("sprout", "akebi", () => this.openStudy());
    this.registerObsidianProtocolHandler("akebi", () => this.openStudy());
    this.addSettingTab(new AkebiSettings(this.app, this));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.handleRename(file.path, oldPath);
    }));
  }
  saveData(data) {
    const snapshot = JSON.parse(JSON.stringify(data));
    this._settingsWrite = (this._settingsWrite || Promise.resolve()).catch(() => {
    }).then(() => super.saveData(snapshot));
    return this._settingsWrite;
  }
  async readLedger() {
    const path = normalizePath(this._directory + "/mastery.json");
    if (!await this.app.vault.adapter.exists(path)) return {};
    return this.normalizeIds(ledger(JSON.parse(await this.app.vault.adapter.read(path))));
  }
  normalizeIds(records) {
    const result = {};
    for (const [key, value] of Object.entries(records)) {
      let id = key;
      const seen = /* @__PURE__ */ new Set();
      while (this.aliases?.[id] && !seen.has(id)) {
        seen.add(id);
        id = this.aliases[id];
      }
      const previous = result[id];
      if (!previous || (Date.parse(value.lastReviewedAt) || 0) >= (Date.parse(previous.lastReviewedAt) || 0)) result[id] = value;
    }
    return result;
  }
  async openStudy() {
    if (this._loadError) {
      new Notice("akebi: \u5C65\u6B74\u30D5\u30A1\u30A4\u30EB\u306E\u8AAD\u8FBC\u30A8\u30E9\u30FC\u3092\u89E3\u6D88\u3057\u3066\u304B\u3089\u518D\u8D77\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    if (this._studyModal || this._openingStudy) return;
    this._openingStudy = true;
    try {
      this._mastery = mergeNewer(await this.readLedger(), this._mastery);
      this._studyModal = new AkebiStudyModal(this.app, this);
      this._studyModal.open();
    } catch (error) {
      new Notice("akebi: \u5B66\u7FD2\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u65E2\u5B58\u30D5\u30A1\u30A4\u30EB\u306F\u4FDD\u6301\u3057\u3066\u3044\u307E\u3059\u3002");
    } finally {
      this._openingStudy = false;
    }
  }
  async checkCards() {
    const modal = new AkebiStudyModal(this.app, this);
    try {
      await modal._loadCards();
      const badCount = modal.invalidSentenceCount || 0;
      new Notice(badCount ? `akebi: \u6587\u7D44\u307F\u7ACB\u3066 ${badCount}\u554F\u306E\u30E1\u30BF\u30C7\u30FC\u30BF\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002` : `akebi: ${modal.cards.length}\u554F\u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F\u3002\u6587\u7D44\u307F\u7ACB\u3066\u306F\u518D\u69CB\u6210\u53EF\u80FD\u3067\u3059\u3002`, 8e3);
    } catch (error) {
      new Notice("akebi: \u691C\u67FB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" + String(error.message || error));
    }
  }
  _saveMastery() {
    if (this._loadError) return Promise.resolve(false);
    const revision = ++this._masteryRevision;
    const snapshot = JSON.parse(JSON.stringify(this._mastery));
    this._saveChain = this._saveChain.catch(() => {
    }).then(async () => {
      const latest = await this.readLedger();
      const merged = mergeNewer(latest, snapshot);
      await this.app.vault.adapter.write(normalizePath(this._directory + "/mastery.json"), JSON.stringify(merged, null, 2) + "\n");
      this._masterySavedRevision = revision;
      this._masterySaveError = null;
    }).catch((error) => {
      this._masterySaveError = error;
      new Notice("akebi: \u5B66\u7FD2\u7D50\u679C\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6B21\u306E\u753B\u9762\u79FB\u52D5\u3067\u518D\u8A66\u884C\u3057\u307E\u3059\u3002");
    });
    return this._saveChain;
  }
  async _flushMastery() {
    await this._saveChain;
    if (this._masterySavedRevision < this._masteryRevision) await this._saveMastery();
    return this._masterySavedRevision >= this._masteryRevision;
  }
  async adoptCardIds(cards) {
    let changed = false;
    for (const card of cards) {
      if (card.id !== card.legacyId && this._mastery[card.legacyId]) {
        this.aliases[card.legacyId] = card.id;
        changed = true;
      }
    }
    if (changed) {
      this._mastery = this.normalizeIds(this._mastery);
      this.settings.idAliases = { ...this.aliases };
      await this.saveData(this.settings);
      await this._saveMastery();
    }
  }
  async handleRename(newPath, oldPath) {
    if (this._loadError) return;
    let changed = false;
    for (const k of Object.keys(this._mastery)) if (k.startsWith(oldPath + "::")) {
      this.aliases[k] = newPath + k.slice(oldPath.length);
      changed = true;
    }
    if (changed) {
      this._mastery = this.normalizeIds(this._mastery);
      this.settings.idAliases = { ...this.aliases };
      await this.saveData(this.settings);
      await this._saveMastery();
    }
  }
  async importLegacy() {
    if (this._loadError) throw this._loadError;
    if (this.settings.legacyImportedAt) throw new Error("\u65E7\u5C65\u6B74\u306F\u3059\u3067\u306B\u53D6\u308A\u8FBC\u307E\u308C\u3066\u3044\u307E\u3059\u3002");
    const base = normalizePath(this.app.vault.configDir + "/plugins/repetition-mobile-ux");
    const source = normalizePath(base + "/mastery.json");
    if (!await this.app.vault.adapter.exists(source)) throw new Error("\u65E7Repetition\u306E\u5C65\u6B74\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002");
    const raw = await this.app.vault.adapter.read(source), imported = ledger(JSON.parse(raw));
    const snapshotPath = normalizePath(this._directory + "/legacy-import-backup.json");
    if (!await this.app.vault.adapter.exists(snapshotPath)) await this.app.vault.adapter.write(snapshotPath, raw);
    this._mastery = this.normalizeIds(mergeNewer(imported, this._mastery));
    const oldSettings = normalizePath(base + "/data.json");
    if (await this.app.vault.adapter.exists(oldSettings)) {
      const old = JSON.parse(await this.app.vault.adapter.read(oldSettings));
      this.settings = settingsFrom({ ...old, idAliases: { ...this.aliases }, migrationPending: false, legacyImportedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } else this.settings.legacyImportedAt = (/* @__PURE__ */ new Date()).toISOString();
    await this._saveMastery();
    if (this._masterySaveError) throw this._masterySaveError;
    await this.saveData(this.settings);
    return Object.keys(imported).length;
  }
  async onExternalSettingsChange() {
    if (this._studyModal) return;
    const stored = await this.loadData();
    if (stored) {
      this.settings = settingsFrom(stored);
      this.aliases = this.settings.idAliases || {};
    }
  }
  onunload() {
    this._studyModal?.close();
    void this._flushMastery();
  }
};
var AkebiSettings = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const el = this.containerEl;
    el.empty();
    new Setting(el).setName("akebi " + this.plugin.manifest.version).setHeading();
    new Setting(el).setName("\u5B66\u7FD2\u3092\u958B\u304F").setDesc("\u5358\u8A9E\u30FB4\u629E\u30FB\u65E5\u672C\u8A9E\u306E\u6587\u7D44\u307F\u7ACB\u3066\u3002\u307B\u304B\u306E\u30D7\u30E9\u30B0\u30A4\u30F3\u306F\u4E0D\u8981\u3067\u3059\u3002").addButton((b) => b.setButtonText("\u958B\u304F").onClick(() => this.plugin.openStudy()));
    new Setting(el).setName("\u65E7Repetition\u306E\u5C65\u6B74\u3092\u53D6\u308A\u8FBC\u3080").setDesc("\u65E7\u30D5\u30A1\u30A4\u30EB\u306F\u5909\u66F4\u305B\u305A\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u3092\u6B8B\u3057\u307E\u3059\u3002\u65E2\u5B58akebi\u306E\u65B0\u3057\u3044\u56DE\u7B54\u3092\u512A\u5148\u3057\u307E\u3059\u3002").addButton((b) => b.setButtonText(this.plugin.settings.legacyImportedAt ? "\u53D6\u8FBC\u6E08\u307F" : "\u53D6\u308A\u8FBC\u3080").setDisabled(!!this.plugin.settings.legacyImportedAt).onClick(async () => {
      try {
        b.setDisabled(true);
        const n = await this.plugin.importLegacy();
        new Notice(n + "\u4EF6\u306E\u5C65\u6B74\u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u3002");
        this.display();
      } catch (error) {
        new Notice("akebi: " + String(error.message || error));
        b.setDisabled(false);
      }
    }));
    new Setting(el).setName("\u554F\u984C\u3092\u691C\u67FB").setDesc("\u4E0D\u6B63\u306A\u30E1\u30BF\u30C7\u30FC\u30BF\u3084\u518D\u69CB\u6210\u3067\u304D\u306A\u3044\u6587\u3092\u8ABF\u3079\u307E\u3059\u3002").addButton((b) => b.setButtonText("\u691C\u67FB").onClick(() => this.plugin.checkCards()));
    el.createEl("p", { text: "\u5B66\u7FD2\u6642\u9593\u30FB\u97F3\u30FBRep\u30FB\u51FA\u984C\u5F62\u5F0F\u306F\u5B66\u7FD2\u753B\u9762\u306E\u8A2D\u5B9A\u304B\u3089\u5909\u66F4\u3067\u304D\u307E\u3059\u3002\u5168\u51E6\u7406\u306FVault\u5185\u3067\u5B8C\u7D50\u3057\u3001\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u901A\u4FE1\u306F\u884C\u3044\u307E\u305B\u3093\u3002" });
  }
};
module.exports = Akebi;
