const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = __dirname;
const packHtml = fs.readFileSync(path.join(dir, "skills_pack.html"), "utf8");

const styleMatch = packHtml.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = packHtml.match(/<script>([\s\S]*?)<\/script>/);
if (!styleMatch || !scriptMatch) throw new Error("Could not extract style/script from skills_pack.html");

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
vm.runInContext(jsCode + "\nthis.__DATA__ = { SVGS, PAPERS, PT_DATA };", ctx);
const { SVGS, PAPERS, PT_DATA } = ctx.__DATA__;

// Strip all Mark Schemes (ms)
const sanitizedPapers = PAPERS.map(p => ({
  id: p.id,
  label: p.label,
  subtitle: p.subtitle,
  defaultTime: p.defaultTime,
  questions: p.questions.map(q => ({
    qNo: q.qNo,
    title: q.title,
    source: q.source,
    totalMarks: q.totalMarks,
    svg: q.svg,
    parts: q.parts.map(pt => ({
      lbl: pt.lbl,
      ao: pt.ao,
      tier: pt.tier,
      marks: pt.marks,
      lines: pt.lines,
      text: pt.text
    }))
  }))
}));

const qaMarkup = packHtml.match(/function renderQA\(\) \{[\s\S]*?return `([\s\S]*?)`;\s*\}/)[1];

const studentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cambridge IGCSE Chemistry (0620) — Student Skills Test (Set B)</title>
<style>
${cleanCss}
.student-topbar {
  position: sticky; top: 0; z-index: 500; background: #0f172a; color: #fff;
  padding: 10px 18px; box-shadow: 0 3px 12px rgba(15, 23, 42, 0.18);
}
.student-topbar-inner {
  max-width: 960px; margin: 0 auto; display: flex; flex-wrap: wrap;
  justify-content: space-between; align-items: center; gap: 10px;
}
.student-inputs-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.student-inputs-inline input {
  padding: 5px 9px; border-radius: 6px; border: 1px solid #475569;
  background: #1e293b; color: #fff; font-size: 0.84rem; width: 165px;
}
.student-inputs-inline input::placeholder { color: #94a3b8; }
.student-topbar .timer-pill { background: #1e293b; color: #fff; border-color: #334155; }
.student-topbar .timer-pill.urgent { background: #7f1d1d; border-color: #ef4444; color: #fff; }
.student-topbar .btn-mini { background: #334155; color: #fff; border-color: #475569; }
</style>
</head>
<body>

<div class="student-topbar no-print" id="studentTopbar">
  <div class="student-topbar-inner">
    <div class="student-inputs-inline">
      <strong style="font-size:0.9rem;">0620 Skills (Set B)</strong>
      <input type="text" id="stName" placeholder="Họ tên học sinh...">
      <input type="text" id="stSchool" placeholder="Trường đang học...">
    </div>
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
      <div class="timer-pill" id="stTimerPill">⏱️ <span id="stTimerText">45:00</span></div>
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
const SVGS = ${JSON.stringify(SVGS, null, 2)};
const PAPERS = ${JSON.stringify(sanitizedPapers, null, 2)};
const PT_DATA = ${JSON.stringify(PT_DATA)};

let state = {
  paperId: "B1",
  showPT: true,
  showQA: true,
  timeMinutes: 45,
  studentName: "",
  studentSchool: "",
  examDate: "",
  answers: {},
  submitted: false,
  timedOut: false,
  startedAt: null,
  deadlineAt: null,
  tokenCopied: false,
  timerSeconds: 45 * 60,
  elapsedSeconds: 0,
  timerRunning: false,
  timerInterval: null
};

const STORAGE_KEY = "igcse0620_setB_" + (window.location.search || "default");

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

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function getActivePaper() {
  return PAPERS.find(p => p.id === state.paperId) || PAPERS[0];
}

function parseUrlParams() {
  const p = new URLSearchParams(window.location.search);
  let customTime = false;
  if (p.has("paper") && PAPERS.some(x => x.id === p.get("paper").toUpperCase())) {
    state.paperId = p.get("paper").toUpperCase();
  }
  if (p.has("pt")) state.showPT = p.get("pt") !== "0";
  if (p.has("qa")) state.showQA = p.get("qa") !== "0";
  if (p.has("time")) {
    const t = parseInt(p.get("time"), 10);
    if (t >= 10 && t <= 120) { state.timeMinutes = t; customTime = true; }
  }
  if (!customTime) state.timeMinutes = getActivePaper().defaultTime;
  state.timerSeconds = state.timeMinutes * 60;
  const now = new Date();
  state.examDate = String(now.getDate()).padStart(2,"0") + "/" + String(now.getMonth()+1).padStart(2,"0") + "/" + now.getFullYear();
}

function formatTime(sec) {
  return String(Math.floor(sec / 60)).padStart(2,"0") + ":" + String(sec % 60).padStart(2,"0");
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
  return toBase64Utf8(JSON.stringify({
    pack: "B",
    paperId: state.paperId,
    time: state.timeMinutes,
    pt: state.showPT,
    qa: state.showQA,
    name: state.studentName,
    school: state.studentSchool,
    date: state.examDate,
    startedAt: state.startedAt,
    submittedAt: Date.now(),
    elapsedSeconds: state.elapsedSeconds,
    answers: state.answers
  }));
}

function copySubmissionToken() {
  const token = buildSubmissionToken();
  state.tokenCopied = true;
  saveDraft();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).then(() => showToast("Đã copy Mã Bài Làm Set B! Hãy gửi ngay cho Giáo viên.")).catch(() => window.prompt("Copy Mã Bài Làm:", token));
  } else {
    window.prompt("Copy Mã Bài Làm:", token);
  }
}

function downloadSubmissionFile() {
  const token = buildSubmissionToken();
  state.tokenCopied = true;
  saveDraft();
  const safeName = (state.studentName || "hoc_sinh").trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  const content = [
    "IGCSE Chemistry (0620) - Set B Submission (" + state.paperId + ")",
    "Candidate: " + (state.studentName || "(unnamed)"),
    "School: " + (state.studentSchool || "(unspecified)"),
    "Paper: " + state.paperId,
    "Time Limit: " + state.timeMinutes + " mins",
    "Time Spent: " + formatTime(state.elapsedSeconds),
    "",
    "--- SUBMISSION TOKEN (Paste in Teacher App -> Nhap Ma Bai Lam) ---",
    token
  ].join("\\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "IGCSE_0620_SetB_" + state.paperId + "_" + safeName + ".txt";
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
  if (stBtn) { stBtn.disabled = true; stBtn.textContent = "✅ Đã nộp bài"; }
  const startBtn = document.getElementById("btnStStartTimer");
  if (startBtn) startBtn.classList.add("hidden");
  document.getElementById("stName").readOnly = true;
  document.getElementById("stSchool").readOnly = true;
  renderPaper();
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast(isTimeout ? "⏰ Hết giờ — bài làm đã tự động khóa và nộp!" : "✅ Đã nộp bài thành công!");
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
    cells += !el ? '<div class="pt-cell pt-empty"></div>' : '<div class="pt-cell"><span>' + el[0] + '</span><b>' + el[1] + '</b><span>' + el[2] + '</span></div>';
  });
  return '<div class="appendix-page" id="appendix-pt"><h3 style="margin:0 0 4px; text-align:center;">The Periodic Table of Elements (Cambridge IGCSE 0620 — 2026–2028)</h3><div class="pt-grid">' + cells + '</div><p style="font-size:0.82rem; margin:8px 0 0;"><strong>The volume of one mole of any gas is 24 dm³ at room temperature and pressure (r.t.p.).</strong></p></div>';
}

function renderQA() {
  return ${JSON.stringify(qaMarkup)};
}

function renderPaper() {
  const p = getActivePaper();
  const sName = escHtml(state.studentName) || "___________________________________";
  const sSchool = escHtml(state.studentSchool) || "_________________________";
  let totalMarks = 0;
  p.questions.forEach(q => q.parts.forEach(pt => totalMarks += pt.marks));

  let html = "";
  if (state.submitted) {
    const answered = Object.keys(state.answers).filter(k => String(state.answers[k] || "").trim().length > 0).length;
    const tokStr = buildSubmissionToken();
    html += '<div class="report-banner">' +
      '<h2><span>' + (state.timedOut ? "⏰ Hết giờ — Bài làm đã tự động khóa và nộp!" : "✅ Đã nộp bài thành công!") + '</span>' +
      '<span class="no-print" style="display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn-share" style="padding:6px 12px; font-size:0.82rem;" onclick="copySubmissionToken()">📋 Copy Mã Bài Làm gửi Giáo viên</button>' +
      '<button class="btn-mini" style="padding:6px 12px; font-size:0.82rem;" onclick="downloadSubmissionFile()">💾 Tải file .txt dự phòng</button>' +
      '<button class="btn-print" style="padding:6px 12px; font-size:0.82rem;" onclick="window.print()">🖨️ In / Lưu PDF bài làm</button>' +
      '</span></h2>' +
      '<div class="report-stats">' +
      '<div class="stat-pill"><div class="lbl">Số ý đã trả lời</div><div class="val">' + answered + ' ý</div></div>' +
      '<div class="stat-pill"><div class="lbl">Thời gian làm bài</div><div class="val">' + formatTime(state.elapsedSeconds) + '</div></div>' +
      '<div class="stat-pill"><div class="lbl">Trạng thái</div><div class="val">⏳ Chờ giáo viên chấm</div></div>' +
      '</div>' +
      '<div class="calc-result band-wait">⚠️ <strong>QUAN TRỌNG: Bài làm mới chỉ lưu trên máy của bạn!</strong> Hãy bấm <strong>📋 Copy Mã Bài Làm</strong> (hoặc <strong>💾 Tải file .txt</strong>) và gửi ngay cho Giáo viên. Nếu có câu vẽ hình trên giấy, hãy chụp ảnh gửi kèm.</div>' +
      '<textarea class="no-print" readonly onclick="this.select()" style="width:100%; margin-top:8px; min-height:62px; font-family:monospace; font-size:0.75rem; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;">' + escHtml(tokStr) + '</textarea>' +
      '</div>';
  }

  html += '<div class="cam-header"><div class="cam-header-top"><div>' +
    '<div class="cam-title">Cambridge IGCSE™ Chemistry (0620) — Past-Paper Skills Test</div>' +
    '<div class="cam-sub">' + escHtml(p.label) + ' • ' + escHtml(p.subtitle) + ' • Syllabus 2026–2028</div></div>' +
    '<div style="text-align:right; font-size:0.86rem; white-space:nowrap; flex-shrink:0;">' +
    '<div><strong>Total Marks: ' + totalMarks + '</strong></div>' +
    '<div>Time Allowed: <strong>' + state.timeMinutes + ' mins</strong></div></div></div>' +
    '<div class="cam-meta-grid">' +
    '<div><strong>Candidate Name:</strong> <span id="hdrName">' + sName + '</span></div>' +
    '<div><strong>Date:</strong> ' + escHtml(state.examDate) + '</div>' +
    '<div><strong>Current School:</strong> <span id="hdrSchool">' + sSchool + '</span></div>' +
    '<div><strong>Paper Code:</strong> Set B — ' + p.id + '</div></div>' +
    '<div class="cam-instructions"><strong>READ THESE INSTRUCTIONS FIRST:</strong> Answer all questions in clear scientific English. Show all working in calculations (3 s.f. where appropriate).</div></div>';

  p.questions.forEach(q => {
    const partsHtml = q.parts.map((pt, idx) => {
      const rkey = p.id + "_q" + q.qNo + "_" + idx;
      const savedVal = state.answers[rkey] || "";
      const tierCls = pt.tier === "Core" ? "badge-core" : (pt.tier === "Ext" ? "badge-ext" : "badge-atp");
      return '<div class="subpart"><div class="subpart-head"><span><strong>' + pt.lbl + '</strong> ' + pt.text + '</span>' +
        '<span class="q-meta"><span class="badge badge-ao">' + pt.ao + '</span><span class="badge ' + tierCls + '">[' + pt.tier + ']</span><span class="marks-tag">[' + pt.marks + ']</span></span></div>' +
        '<textarea class="online-ta" ' + (state.submitted ? "readonly" : "") + ' placeholder="Nhập bài làm / phương trình / tính toán..." oninput="setTextAnswer(\\'' + rkey + '\\', this.value)">' + escHtml(savedVal) + '</textarea>' +
        '<div class="print-ans" id="pa_' + rkey + '">' + (escHtml(savedVal) || "(No written answer)") + '</div></div>';
    }).join("");
    html += '<div class="q-card"><div class="q-head"><div class="q-num">Question ' + q.qNo + ' — ' + q.title + '</div>' +
      '<div class="q-meta"><span class="badge badge-src">' + q.source + '</span><span class="marks-tag">[Total: ' + q.totalMarks + ']</span></div></div>' +
      (q.svg ? '<div class="svg-wrap">' + SVGS[q.svg] + '</div>' : "") + partsHtml + '</div>';
  });

  if (state.showPT) html += renderPT();
  if (state.showQA) html += renderQA();
  document.getElementById("paperSheet").innerHTML = html;
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
  document.getElementById("stName").oninput = e => {
    state.studentName = e.target.value;
    saveDraft();
    const h = document.getElementById("hdrName");
    if (h) h.textContent = state.studentName || "___________________________________";
  };
  document.getElementById("stSchool").oninput = e => {
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

fs.writeFileSync(path.join(dir, "skills_student.html"), studentHtml, "utf8");
console.log("Generated skills_student.html (" + studentHtml.length + " bytes)");
