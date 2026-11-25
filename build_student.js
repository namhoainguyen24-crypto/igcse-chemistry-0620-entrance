const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = __dirname;
const indexHtml = fs.readFileSync(path.join(dir, "index.html"), "utf8");

const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
if (!styleMatch || !scriptMatch) throw new Error("Could not extract style/script from index.html");

const cleanCss = styleMatch[1]
  .replace(/\.rubric-bar\s*\{[\s\S]*?\}\s*/g, "")
  .replace(/\.mark-pill[\s\S]*?\}\s*/g, "")
  .replace(/\.ms-box\s*\{[\s\S]*?\}\s*/g, "");

const jsCode = scriptMatch[1].replace(/initUI\(\);\s*$/, "");
const ctx = {
  window: { location: { search: "", origin: "https://example.com", pathname: "/" } },
  document: { getElementById: () => ({ value: "", textContent: "", classList: { toggle(){}, add(){}, remove(){} } }), querySelectorAll: () => [] },
  URLSearchParams,
  console
};
vm.createContext(ctx);
vm.runInContext(jsCode + "\nthis.__DATA__ = { PRESETS, SVGS, MODULES, PT_DATA };", ctx);
const { PRESETS, SVGS, MODULES, PT_DATA } = ctx.__DATA__;

// Strip all answer keys (ans) and mark schemes (ms)
const sanitizedModules = MODULES.map(m => ({
  id: m.id,
  short: m.short,
  title: m.title,
  cup: m.cup,
  mcqCore: { stem: m.mcqCore.stem, options: m.mcqCore.options },
  mcqExt: { stem: m.mcqExt.stem, options: m.mcqExt.options },
  theoryCore: { stem: m.theoryCore.stem, svg: m.theoryCore.svg, parts: m.theoryCore.parts },
  theoryExt: { stem: m.theoryExt.stem, svg: m.theoryExt.svg, parts: m.theoryExt.parts },
  atp: { stem: m.atp.stem, marks: m.atp.marks, lines: m.atp.lines }
}));

const studentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cambridge IGCSE Chemistry (0620) — Student Online Entrance Exam (Syllabus 2026–2028)</title>
<style>
${cleanCss}
</style>
</head>
<body>

<div class="student-topbar no-print" id="studentTopbar">
  <div class="student-topbar-inner">
    <div class="student-inputs-inline">
      <strong style="font-size:0.9rem;">0620 Entrance</strong>
      <input type="text" id="stName" placeholder="Họ tên học sinh...">
      <input type="text" id="stSchool" placeholder="Trường đang học...">
    </div>
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
      <div class="timer-pill" id="stTimerPill">⏱️ <span id="stTimerText">50:00</span></div>
      <button class="btn-mini" id="btnStStartTimer" onclick="startStudentTimer()">▶️ Bắt đầu tính giờ</button>
      <button class="btn-mini" id="btnJumpPT" onclick="jumpTo('appendix-pt')">Periodic Table</button>
      <button class="btn-mini" id="btnJumpQA" onclick="jumpTo('appendix-qa')">QA Notes</button>
      <button class="btn-submit-online" id="btnStSubmit" onclick="submitOnlineExam(false)">🚀 Nộp bài</button>
      <button class="btn-mini" onclick="window.print()">🖨️ In / PDF</button>
    </div>
  </div>
</div>

<div class="paper-sheet" id="paperSheet"></div>
<div class="toast no-print" id="toastBox"></div>

<script>
const PRESETS = ${JSON.stringify(PRESETS, null, 2)};
const SVGS = ${JSON.stringify(SVGS, null, 2)};
const MODULES = ${JSON.stringify(sanitizedModules, null, 2)};
const PT_DATA = ${JSON.stringify(PT_DATA)};
const MODULE_ORDER = MODULES.map(m => m.id);

let state = {
  selected: ["1", "2", "3a", "3b", "12a"],
  tier: "dual",
  milestone: "Mốc 2A — Đầu HK II Year 1 (CUP Ch. 1–5, 21)",
  showPT: true,
  showQA: true,
  timeMinutes: 50,
  studentName: "",
  studentSchool: "",
  examDate: "",
  answers: {},
  submitted: false,
  timedOut: false,
  startedAt: null,
  deadlineAt: null,
  tokenCopied: false,
  timerSeconds: 50 * 60,
  elapsedSeconds: 0,
  timerRunning: false,
  timerInterval: null
};

const STORAGE_KEY = "igcse0620_setA_" + (window.location.search || "default");

function saveDraft() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      studentName: state.studentName,
      studentSchool: state.studentSchool,
      answers: state.answers,
      submitted: state.submitted,
      timedOut: state.timedOut,
      startedAt: state.startedAt,
      deadlineAt: state.deadlineAt,
      elapsedSeconds: state.elapsedSeconds,
      tokenCopied: state.tokenCopied
    }));
  } catch (e) {}
}

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg) {
  const box = document.getElementById("toastBox");
  box.textContent = msg;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 2600);
}

function sortModIds(ids) {
  const uniq = Array.from(new Set(ids));
  return uniq.sort((a, b) => MODULE_ORDER.indexOf(a) - MODULE_ORDER.indexOf(b));
}

function expandLegacyModIds(rawList) {
  const out = [];
  rawList.forEach(tok => {
    const t = tok.trim().toLowerCase();
    if (t === "3") { out.push("3a", "3b"); }
    else if (t === "12") { out.push("12a", "12b"); }
    else if (MODULE_ORDER.includes(t)) { out.push(t); }
  });
  return sortModIds(out);
}

function detectPresetFromSelection(ids) {
  const sorted = sortModIds(ids).join(",");
  return PRESETS.find(p => sortModIds(p.modules).join(",") === sorted) || null;
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function parseUrlParams() {
  const p = new URLSearchParams(window.location.search);
  let customTime = false;
  if (p.has("mods")) {
    const ids = expandLegacyModIds(p.get("mods").split(","));
    if (ids.length) {
      state.selected = ids;
      const matched = detectPresetFromSelection(ids);
      if (!p.has("milestone")) {
        state.milestone = matched ? matched.milestone : "Đề tùy chọn (Custom Modular Test)";
      }
    }
  }
  if (p.has("tier") && ["dual","core","ext"].includes(p.get("tier"))) {
    state.tier = p.get("tier");
  }
  if (p.has("milestone")) {
    state.milestone = p.get("milestone");
  }
  if (p.has("pt")) state.showPT = p.get("pt") !== "0";
  if (p.has("qa")) state.showQA = p.get("qa") !== "0";
  if (p.has("time")) {
    const t = parseInt(p.get("time"), 10);
    if (t >= 5 && t <= 180) {
      state.timeMinutes = t;
      customTime = true;
    }
  }
  if (!customTime) {
    const m = getMarksBreakdown();
    state.timeMinutes = Math.max(15, m.total);
  }
  state.timerSeconds = state.timeMinutes * 60;
  const now = new Date();
  state.examDate = String(now.getDate()).padStart(2,"0") + "/" + String(now.getMonth()+1).padStart(2,"0") + "/" + now.getFullYear();
}

function getMarksBreakdown() {
  const n = state.selected.length;
  if (state.tier === "dual") return { core: n * 4, ext: n * 4, atp: n * 2, total: n * 10 };
  if (state.tier === "core") return { core: n * 4, ext: 0, atp: n * 2, total: n * 6 };
  return { core: 0, ext: n * 4, atp: n * 2, total: n * 6 };
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
}

function updateTimerDisplays() {
  const el = document.getElementById("stTimerText");
  const pill = document.getElementById("stTimerPill");
  if (el) el.textContent = formatTime(state.timerSeconds);
  if (pill) pill.classList.toggle("urgent", state.timerSeconds <= 300);
}

function syncWallClock() {
  if (!state.startedAt || !state.deadlineAt || state.submitted) return;
  const now = Date.now();
  state.elapsedSeconds = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  state.timerSeconds = Math.max(0, Math.ceil((state.deadlineAt - now) / 1000));
  updateTimerDisplays();
  if (now >= state.deadlineAt) {
    submitOnlineExam(true);
  }
}

function startStudentTimer() {
  if (state.timerRunning || state.submitted) return;
  if (!state.startedAt) {
    state.startedAt = Date.now();
    state.deadlineAt = state.startedAt + state.timeMinutes * 60 * 1000;
    saveDraft();
  }
  state.timerRunning = true;
  const btn = document.getElementById("btnStStartTimer");
  if (btn) btn.classList.add("hidden");
  syncWallClock();
  if (!state.submitted) {
    state.timerInterval = setInterval(syncWallClock, 500);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.timerRunning && !state.submitted) syncWallClock();
});

window.addEventListener("beforeunload", e => {
  const hasWork = state.timerRunning || Object.keys(state.answers).length > 0;
  if ((!state.submitted && hasWork) || (state.submitted && !state.tokenCopied)) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function jumpTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function buildSubmissionToken() {
  const payload = {
    v: 1,
    mods: state.selected,
    tier: state.tier,
    time: state.timeMinutes,
    milestone: state.milestone,
    pt: state.showPT,
    qa: state.showQA,
    name: state.studentName,
    school: state.studentSchool,
    date: state.examDate,
    startedAt: state.startedAt,
    submittedAt: Date.now(),
    elapsedSeconds: state.elapsedSeconds,
    answers: state.answers
  };
  return toBase64Utf8(JSON.stringify(payload));
}

function copySubmissionToken() {
  const token = buildSubmissionToken();
  state.tokenCopied = true;
  saveDraft();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).then(() => {
      showToast("Đã copy Mã Bài Làm! Hãy gửi ngay mã này cho Giáo viên.");
    }).catch(() => {
      window.prompt("Copy Mã Bài Làm gửi Giáo viên:", token);
    });
  } else {
    window.prompt("Copy Mã Bài Làm gửi Giáo viên:", token);
  }
}

function downloadSubmissionFile() {
  const token = buildSubmissionToken();
  state.tokenCopied = true;
  saveDraft();
  const safeName = (state.studentName || "hoc_sinh").trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  const content = [
    "IGCSE Chemistry (0620) - Set A Submission",
    "Candidate: " + (state.studentName || "(unnamed)"),
    "School: " + (state.studentSchool || "(unspecified)"),
    "Milestone: " + state.milestone,
    "Time Limit: " + state.timeMinutes + " mins",
    "Time Spent: " + formatTime(state.elapsedSeconds),
    "",
    "--- SUBMISSION TOKEN (Paste in Teacher App -> Nhap Ma Bai Lam) ---",
    token
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "IGCSE_0620_SetA_" + safeName + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("Đã tải file .txt dự phòng chứa Mã Bài Làm!");
}

function submitOnlineExam(isTimeout = false) {
  if (state.submitted) return;
  clearInterval(state.timerInterval);
  state.timerRunning = false;
  if (state.startedAt) {
    state.elapsedSeconds = Math.max(state.elapsedSeconds, Math.floor((Date.now() - state.startedAt) / 1000));
  }
  state.submitted = true;
  state.timedOut = !!isTimeout;
  saveDraft();
  const stBtn = document.getElementById("btnStSubmit");
  if (stBtn) {
    stBtn.disabled = true;
    stBtn.textContent = "✅ Đã nộp bài";
  }
  const startBtn = document.getElementById("btnStStartTimer");
  if (startBtn) startBtn.classList.add("hidden");
  document.getElementById("stName").readOnly = true;
  document.getElementById("stSchool").readOnly = true;
  renderPaper();
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast(isTimeout ? "⏰ Hết giờ — bài làm đã tự động khóa và nộp!" : "✅ Đã nộp bài thành công!");
}

function selectMcq(key, optIdx) {
  if (state.submitted) return;
  if (!state.timerRunning) startStudentTimer();
  state.answers[key] = optIdx;
  saveDraft();
  const list = document.querySelectorAll('li[data-mcq-key="' + key + '"]');
  list.forEach((li, i) => {
    li.classList.toggle("selected-opt", i === optIdx);
    const radio = li.querySelector('input[type="radio"]');
    if (radio) radio.checked = (i === optIdx);
  });
}

function setTextAnswer(key, val) {
  if (state.submitted) return;
  if (!state.timerRunning) startStudentTimer();
  state.answers[key] = val;
  saveDraft();
  const pa = document.getElementById("pa_" + key);
  if (pa) pa.textContent = val || "(No written answer)";
}

function renderPT() {
  const groups = ["I","II","","","","","","","","","","","III","IV","V","VI","VII","VIII"];
  let cells = groups.map(g => '<div class="pt-cell pt-hdr">' + g + '</div>').join("");
  PT_DATA.forEach(el => {
    if (!el) {
      cells += '<div class="pt-cell pt-empty"></div>';
    } else {
      cells += '<div class="pt-cell"><span>' + el[0] + '</span><b>' + el[1] + '</b><span>' + el[2] + '</span></div>';
    }
  });
  return '<div class="appendix-page" id="appendix-pt">' +
    '<h3 style="margin:0 0 4px; text-align:center;">The Periodic Table of Elements (Cambridge IGCSE 0620 — 2026–2028)</h3>' +
    '<div class="pt-grid">' + cells + '</div>' +
    '<p style="font-size:0.82rem; margin:8px 0 0;">*58–71 Lanthanoids &amp; 90–103 Actinoids omitted for compact diagnostic printing. <strong>The volume of one mole of any gas is 24 dm³ at room temperature and pressure (r.t.p.).</strong></p>' +
    '</div>';
}

function renderQA() {
  return ${JSON.stringify(indexHtml.match(/function renderQA\(\) \{[\s\S]*?return `([\s\S]*?)`;\s*\}/)[1])};
}

function renderPaper() {
  const sheet = document.getElementById("paperSheet");
  const chosen = MODULES.filter(m => state.selected.includes(m.id));
  const m = getMarksBreakdown();
  const tierLabel = state.tier === "dual" ? "Dual-Tier (Core + Supplement + ATP)" : (state.tier === "core" ? "Core Only (Foundation Check)" : "Extended Focus (Supplement + ATP)");
  const sName = escHtml(state.studentName) || "___________________________________";
  const sSchool = escHtml(state.studentSchool) || "_________________________";

  let html = "";
  if (state.submitted) {
    const answeredMcqs = Object.keys(state.answers).filter(k => k.startsWith("mcq_")).length;
    const answeredWritten = Object.keys(state.answers).filter(k => (k.startsWith("th_") || k.startsWith("atp_")) && String(state.answers[k] || "").trim().length > 0).length;
    const bannerTitle = state.timedOut
      ? "⏰ Hết giờ — Bài làm đã tự động khóa và nộp!"
      : "✅ Đã nộp bài thành công!";
    const tokStr = buildSubmissionToken();
    html += '<div class="report-banner">' +
      '<h2><span>' + bannerTitle + '</span>' +
      '<span class="no-print" style="display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn-share" style="padding:6px 12px; font-size:0.82rem;" onclick="copySubmissionToken()">📋 Copy Mã Bài Làm gửi Giáo viên</button>' +
      '<button class="btn-mini" style="padding:6px 12px; font-size:0.82rem;" onclick="downloadSubmissionFile()">💾 Tải file .txt dự phòng</button>' +
      '<button class="btn-print" style="padding:6px 12px; font-size:0.82rem;" onclick="window.print()">🖨️ In / Lưu PDF bài làm</button>' +
      '</span></h2>' +
      '<div class="report-stats">' +
      '<div class="stat-pill"><div class="lbl">Câu Trắc nghiệm đã chọn</div><div class="val">' + answeredMcqs + ' câu</div></div>' +
      '<div class="stat-pill"><div class="lbl">Ý Tự luận/ATP đã trả lời</div><div class="val">' + answeredWritten + ' ý</div></div>' +
      '<div class="stat-pill"><div class="lbl">Thời gian làm bài</div><div class="val">' + formatTime(state.elapsedSeconds) + '</div></div>' +
      '<div class="stat-pill"><div class="lbl">Trạng thái chấm</div><div class="val">⏳ Chờ giáo viên chấm</div></div>' +
      '</div>' +
      '<div class="calc-result band-wait" style="margin-top:4px;">⚠️ <strong>QUAN TRỌNG: Bài làm mới chỉ lưu trên máy của bạn!</strong> Hãy bấm <strong>📋 Copy Mã Bài Làm</strong> (hoặc <strong>💾 Tải file .txt</strong>) và gửi ngay cho Giáo viên qua Zalo / Email / LMS.</div>' +
      '<textarea class="no-print" readonly onclick="this.select()" style="width:100%; margin-top:8px; min-height:62px; font-family:monospace; font-size:0.75rem; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;">' + escHtml(tokStr) + '</textarea>' +
      '</div>';
  }

  html += '<div class="cam-header">' +
    '<div class="cam-header-top">' +
    '<div>' +
    '<div class="cam-title">Cambridge IGCSE™ Chemistry (0620) — Entrance Diagnostic</div>' +
    '<div class="cam-sub">' + escHtml(state.milestone) + ' • ' + tierLabel + ' • Syllabus 2026–2028</div>' +
    '</div>' +
    '<div style="text-align:right; font-size:0.86rem; white-space:nowrap; flex-shrink:0;">' +
    '<div><strong>Total Marks: ' + m.total + '</strong></div>' +
    '<div>Time Allowed: <strong>' + state.timeMinutes + ' mins</strong></div>' +
    '</div></div>' +
    '<div class="cam-meta-grid">' +
    '<div><strong>Candidate Name:</strong> <span id="hdrName">' + sName + '</span></div>' +
    '<div><strong>Date:</strong> ' + escHtml(state.examDate) + '</div>' +
    '<div><strong>Current School:</strong> <span id="hdrSchool">' + sSchool + '</span></div>' +
    '<div><strong>Modules Covered:</strong> ' + chosen.map(x => x.short).join(", ") + '</div>' +
    '</div>' +
    '<div class="cam-instructions"><strong>READ THESE INSTRUCTIONS FIRST:</strong> Answer all questions. Electronic calculators may be used. Show clear working in all calculations (give numerical answers to 3 significant figures where appropriate).</div>' +
    '</div>';

  const mcqs = [];
  chosen.forEach(mod => {
    if (state.tier !== "ext") mcqs.push({ mod, tier: "Core", item: mod.mcqCore });
    if (state.tier !== "core") mcqs.push({ mod, tier: "Ext", item: mod.mcqExt });
  });
  html += '<div class="section-banner"><span>SECTION A — Multiple Choice</span><span>' + mcqs.length + ' marks</span></div>';
  let qNo = 1;
  const letters = ["A", "B", "C", "D"];
  mcqs.forEach(entry => {
    const key = "mcq_" + entry.mod.id + "_" + entry.tier;
    const picked = state.answers[key];
    const badge = entry.tier === "Core" ? '<span class="badge badge-core">[Core]</span>' : '<span class="badge badge-ext">[Ext]</span>';
    const optsHtml = entry.item.options.map((opt, idx) => {
      const cls = "online-opt" + (picked === idx ? " selected-opt" : "");
      const onclickAttr = !state.submitted ? ('onclick="selectMcq(\\'' + key + '\\', ' + idx + ')"') : "";
      return '<li class="' + cls + '" data-mcq-key="' + key + '" ' + onclickAttr + '>' +
        '<input type="radio" name="' + key + '" ' + (picked === idx ? "checked" : "") + ' ' + (state.submitted ? "disabled" : "") + ' style="margin-top:3px;">' +
        '<span><strong>' + letters[idx] + '.</strong> ' + opt + '</span></li>';
    }).join("");
    html += '<div class="q-card"><div class="q-head"><div class="q-num">' + qNo + '. ' + entry.item.stem + '</div>' +
      '<div class="q-meta"><span class="badge badge-topic">' + entry.mod.short + '</span>' + badge + '<span class="marks-tag">[1]</span></div></div>' +
      '<ul class="mcq-opts">' + optsHtml + '</ul></div>';
    qNo++;
  });

  const theories = [];
  chosen.forEach(mod => {
    if (state.tier !== "ext") theories.push({ mod, tier: "Core", item: mod.theoryCore });
    if (state.tier !== "core") theories.push({ mod, tier: "Ext", item: mod.theoryExt });
  });
  const renderedSvgs = new Set();
  html += '<div class="section-banner"><span>SECTION B — Structured Theory</span><span>' + (theories.length * 3) + ' marks</span></div>';
  theories.forEach(entry => {
    const badge = entry.tier === "Core" ? '<span class="badge badge-core">[Core]</span>' : '<span class="badge badge-ext">[Ext]</span>';
    let svgHtml = "";
    if (entry.item.svg) {
      const svgKey = entry.mod.id + "_" + entry.item.svg;
      if (!renderedSvgs.has(svgKey)) {
        renderedSvgs.add(svgKey);
        svgHtml = '<div class="svg-wrap">' + SVGS[entry.item.svg] + '</div>';
      } else {
        svgHtml = '<div style="font-size:0.84rem; color:#475569; font-style:italic; margin:4px 0 6px;">(Refer to the diagram shown in the previous question.)</div>';
      }
    }
    const partsHtml = entry.item.parts.map((pt, idx) => {
      const rkey = "th_" + entry.mod.id + "_" + entry.tier + "_" + idx;
      const savedVal = state.answers[rkey] || "";
      return '<div class="subpart"><div class="subpart-head"><span><strong>' + pt.lbl + '</strong> ' + pt.text + '</span><span class="marks-tag">[' + pt.marks + ']</span></div>' +
        '<textarea class="online-ta" ' + (state.submitted ? "readonly" : "") + ' placeholder="Nhập câu trả lời và các bước tính toán tại đây..." oninput="setTextAnswer(\\'' + rkey + '\\', this.value)">' + escHtml(savedVal) + '</textarea>' +
        '<div class="print-ans" id="pa_' + rkey + '">' + (escHtml(savedVal) || "(No written answer)") + '</div></div>';
    }).join("");
    html += '<div class="q-card"><div class="q-head"><div class="q-num">Question ' + qNo + ' — ' + entry.mod.title.replace(/^(Topic|Module) [\\w]+:\\s*/, "") + '</div>' +
      '<div class="q-meta"><span class="badge badge-topic">' + entry.mod.short + '</span>' + badge + '<span class="marks-tag">[3]</span></div></div>' +
      '<div>' + entry.item.stem + '</div>' + svgHtml + partsHtml + '</div>';
    qNo++;
  });

  html += '<div class="section-banner"><span>SECTION C — Practical Skills &amp; Analysis (Paper 6 ATP)</span><span>' + (chosen.length * 2) + ' marks</span></div>';
  chosen.forEach(mod => {
    const rkey = "atp_" + mod.id;
    const savedVal = state.answers[rkey] || "";
    html += '<div class="q-card"><div class="q-head"><div class="q-num">Question ' + qNo + ' — Practical Investigation (' + mod.title.replace(/^(Topic|Module) [\\w]+:\\s*/, "") + ')</div>' +
      '<div class="q-meta"><span class="badge badge-topic">' + mod.short + '</span><span class="badge badge-atp">[ATP]</span><span class="marks-tag">[2]</span></div></div>' +
      '<div>' + mod.atp.stem + '</div>' +
      '<textarea class="online-ta" ' + (state.submitted ? "readonly" : "") + ' placeholder="Nhập nhận xét thí nghiệm / phương án xử lý sai số tại đây..." oninput="setTextAnswer(\\'' + rkey + '\\', this.value)">' + escHtml(savedVal) + '</textarea>' +
      '<div class="print-ans" id="pa_' + rkey + '">' + (escHtml(savedVal) || "(No written answer)") + '</div></div>';
    qNo++;
  });

  if (state.showPT) html += renderPT();
  if (state.showQA) html += renderQA();
  sheet.innerHTML = html;
  updateTimerDisplays();
}

function restoreDraft() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return;
    if (typeof d.studentName === "string") {
      state.studentName = d.studentName;
      document.getElementById("stName").value = d.studentName;
    }
    if (typeof d.studentSchool === "string") {
      state.studentSchool = d.studentSchool;
      document.getElementById("stSchool").value = d.studentSchool;
    }
    if (d.answers && typeof d.answers === "object") state.answers = d.answers;
    state.startedAt = d.startedAt || null;
    state.deadlineAt = d.deadlineAt || null;
    state.elapsedSeconds = Number(d.elapsedSeconds || 0);
    state.tokenCopied = !!d.tokenCopied;
    state.timedOut = !!d.timedOut;
    if (d.submitted) {
      state.submitted = true;
      const stBtn = document.getElementById("btnStSubmit");
      if (stBtn) { stBtn.disabled = true; stBtn.textContent = "✅ Đã nộp bài"; }
      const startBtn = document.getElementById("btnStStartTimer");
      if (startBtn) startBtn.classList.add("hidden");
      document.getElementById("stName").readOnly = true;
      document.getElementById("stSchool").readOnly = true;
      showToast("Đã khôi phục bài làm đã nộp từ máy.");
    } else if (state.startedAt && state.deadlineAt) {
      const now = Date.now();
      if (now >= state.deadlineAt) {
        state.timerSeconds = 0;
        state.elapsedSeconds = state.timeMinutes * 60;
        submitOnlineExam(true);
      } else {
        startStudentTimer();
        showToast("Đã khôi phục bài làm đã lưu tự động!");
      }
    } else if (Object.keys(state.answers).length > 0) {
      showToast("Đã khôi phục bài làm đã lưu tự động!");
    }
  } catch (e) {}
}

function initStudent() {
  parseUrlParams();
  document.getElementById("btnJumpPT").classList.toggle("hidden", !state.showPT);
  document.getElementById("btnJumpQA").classList.toggle("hidden", !state.showQA);
  document.getElementById("stName").oninput = (e) => {
    state.studentName = e.target.value;
    saveDraft();
    const h = document.getElementById("hdrName");
    if (h) h.textContent = state.studentName || "___________________________________";
  };
  document.getElementById("stSchool").oninput = (e) => {
    state.studentSchool = e.target.value;
    saveDraft();
    const h = document.getElementById("hdrSchool");
    if (h) h.textContent = state.studentSchool || "_________________________";
  };
  restoreDraft();
  renderPaper();
}

initStudent();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "student.html"), studentHtml, "utf8");
console.log("Generated student.html (" + studentHtml.length + " bytes)");
