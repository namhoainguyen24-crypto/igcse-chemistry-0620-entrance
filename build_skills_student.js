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
  timerSeconds: 45 * 60,
  elapsedSeconds: 0,
  timerRunning: false,
  timerInterval: null
};

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

function startStudentTimer() {
  if (state.timerRunning || state.submitted) return;
  state.timerRunning = true;
  const btn = document.getElementById("btnStStartTimer");
  if (btn) btn.classList.add("hidden");
  state.timerInterval = setInterval(() => {
    state.elapsedSeconds++;
    if (state.timerSeconds > 1) {
      state.timerSeconds--;
      updateTimerDisplays();
    } else {
      state.timerSeconds = 0;
      updateTimerDisplays();
      submitOnlineExam(true);
    }
  }, 1000);
}

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
    elapsedSeconds: state.elapsedSeconds,
    answers: state.answers
  }));
}

function copySubmissionToken() {
  const token = buildSubmissionToken();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).then(() => showToast("Đã copy Mã Bài Làm Set B gửi Giáo viên!")).catch(() => window.prompt("Copy Mã Bài Làm:", token));
  } else {
    window.prompt("Copy Mã Bài Làm:", token);
  }
}

function submitOnlineExam(isTimeout = false) {
  if (state.submitted) return;
  clearInterval(state.timerInterval);
  state.timerRunning = false;
  state.submitted = true;
  state.timedOut = !!isTimeout;
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
    html += '<div class="report-banner">' +
      '<h2><span>' + (state.timedOut ? "⏰ Hết giờ — Bài làm đã tự động khóa và nộp!" : "✅ Đã nộp bài thành công!") + '</span>' +
      '<span class="no-print" style="display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn-share" style="padding:6px 12px; font-size:0.82rem;" onclick="copySubmissionToken()">📋 Copy Mã Bài Làm gửi Giáo viên</button>' +
      '<button class="btn-print" style="padding:6px 12px; font-size:0.82rem;" onclick="window.print()">🖨️ In / Lưu PDF bài làm</button>' +
      '</span></h2>' +
      '<div class="report-stats">' +
      '<div class="stat-pill"><div class="lbl">Số ý đã trả lời</div><div class="val">' + answered + ' ý</div></div>' +
      '<div class="stat-pill"><div class="lbl">Thời gian làm bài</div><div class="val">' + formatTime(state.elapsedSeconds) + '</div></div>' +
      '<div class="stat-pill"><div class="lbl">Trạng thái</div><div class="val">⏳ Chờ giáo viên chấm</div></div>' +
      '</div>' +
      '<div class="calc-result band-wait">Bài làm đã khóa. Hãy bấm <strong>📋 Copy Mã Bài Làm gửi Giáo viên</strong> (hoặc In/PDF) để giáo viên chấm điểm chi tiết kỹ năng AO1/AO2/AO3.</div>' +
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

function initStudent() {
  parseUrlParams();
  document.getElementById("btnJumpPT").classList.toggle("hidden", !state.showPT);
  document.getElementById("btnJumpQA").classList.toggle("hidden", !state.showQA);
  document.getElementById("stName").oninput = e => {
    state.studentName = e.target.value;
    const h = document.getElementById("hdrName");
    if (h) h.textContent = state.studentName || "___________________________________";
  };
  document.getElementById("stSchool").oninput = e => {
    state.studentSchool = e.target.value;
    const h = document.getElementById("hdrSchool");
    if (h) h.textContent = state.studentSchool || "_________________________";
  };
  renderPaper();
}

initStudent();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "skills_student.html"), studentHtml, "utf8");
console.log("Generated skills_student.html (" + studentHtml.length + " bytes)");
