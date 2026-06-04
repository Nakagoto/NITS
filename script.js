/* =====================================
   NITS v4 - 曜日対応版
===================================== */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getFirestore, doc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

/* ===== Firebase設定 ===== */
const firebaseConfig = {
  apiKey:            "AIzaSyCzt22Hi-anZJbnXSZngLexcZtDOh58fqw",
  authDomain:        "nits-4f2a4.firebaseapp.com",
  projectId:         "nits-4f2a4",
  storageBucket:     "nits-4f2a4.firebasestorage.app",
  messagingSenderId: "71805932965",
  appId:             "1:71805932965:web:e91954fe69ae7a192ac44c"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const configRef = doc(db, "config", "main");

/* ===== データ ===== */
let baseSchedule    = {};   // 曜日別基本時間割
let todayOverride   = {};   // 今日の上書き { date, periods }
let periods         = {};   // 校時定義 { p1:{label,start,end}, ... }
let ads             = {};   // 広告データ
let adAssign        = {};   // 広告割り当て { p1:{classAds:[],breakAds:[]}, ... }
let scheduleMode    = "normal";
let fortyFivePeriods = {};

/* ===== 校時の固定順序 ===== */
const PERIOD_ORDER = ["p1","p2","p3","p4","lunch","p5","p6","p7"];

/* ===== DOM ===== */
const subjectElement   = document.getElementById("subjectName");
const modeLabelElement = document.getElementById("modeLabel");
const noticeArea       = document.getElementById("noticeArea");
const noticeText       = document.getElementById("noticeText");
const noticeImage      = document.getElementById("noticeImage");
const noticeVideo      = document.getElementById("noticeVideo");

/* ===== Firestore同期 ===== */
function startRealtimeSync() {
  onSnapshot(configRef, snap => {
    if (!snap.exists()) {
      console.error("config/main が存在しません");
      subjectElement.textContent = "設定なし";
      modeLabelElement.textContent = "エラー";
      return;
    }
    const d = snap.data();
    baseSchedule     = d.baseSchedule     || {};
    todayOverride    = d.todayOverride    || {};
    periods          = d.periods          || getDefaultPeriods();
    ads              = d.ads              || {};
    adAssign         = d.adAssign         || {};
    scheduleMode     = d.scheduleMode     || "normal";
    fortyFivePeriods = d.fortyFivePeriods || {};

    console.log("Firestore同期完了");
    updateAll();
  }, err => {
    console.error("Firestore接続エラー:", err);
  });
}

/* ===== デフォルト校時定義（Firestoreにperiodsがない場合のフォールバック） ===== */
function getDefaultPeriods() {
  return {
    p1:    { label:"1校時", start:"08:45", end:"09:35" },
    p2:    { label:"2校時", start:"09:45", end:"10:35" },
    p3:    { label:"3校時", start:"10:45", end:"11:35" },
    p4:    { label:"4校時", start:"11:45", end:"12:35" },
    lunch: { label:"昼休み", start:"12:35", end:"13:20" },
    p5:    { label:"5校時", start:"13:20", end:"14:10" },
    p6:    { label:"6校時", start:"14:20", end:"15:10" },
    p7:    { label:"7校時", start:"15:20", end:"16:10" }
  };
}

/* ===== 今日の曜日キー ===== */
function getTodayDayKey() {
  const days = ["sun","mon","tue","wed","thu","fri","sat"];
  return days[new Date().getDay()];
}

/* ===== 今日の時間割を取得（基本＋上書き） ===== */
function getTodaySchedule() {
  const dayKey = getTodayDayKey();

  // 土日は授業なし
  if (dayKey === "sat" || dayKey === "sun") return {};

  const base = baseSchedule[dayKey] || {};

  // todayOverrideが今日の日付なら上書き適用
  const todayStr = new Date().toISOString().slice(0, 10);
  let override = {};
  if (todayOverride.date === todayStr) {
    override = todayOverride.periods || {};
  }

  // マージ（上書き優先）
  const merged = { ...base, ...override };
  return merged;
}

/* ===== 45分モード適用済みの実際の終了時刻を返す ===== */
function getActualEnd(key, baseEnd) {
  if (scheduleMode === "45min" && fortyFivePeriods[key]) {
    // 終了時刻を5分前にする（50分→45分）
    const [h, m] = baseEnd.split(":").map(Number);
    const total = h * 60 + m - 5;
    return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
  }
  return baseEnd;
}

/* ===== 時刻→分 ===== */
function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/* ===== 現在状態取得 ===== */
function getCurrentState() {
  const p = { ...getDefaultPeriods(), ...periods };
  const todaySub = getTodaySchedule();
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const dayKey = getTodayDayKey();

  // 土日
  if (dayKey === "sat" || dayKey === "sun") {
    return { mode:"off", key:"", subject:"休日", adIds:[] };
  }

  for (let i = 0; i < PERIOD_ORDER.length; i++) {
    const key = PERIOD_ORDER[i];
    const pd = p[key];
    if (!pd || !pd.start || !pd.end) continue;

    const start = toMin(pd.start);
    const end   = toMin(getActualEnd(key, pd.end));
    const subject = todaySub[key] || "";

    // 授業中・給食中
    if (cur >= start && cur < end) {
      const assign = adAssign[key] || {};
      return {
        mode:    key === "lunch" ? "lunch" : "class",
        key,
        subject: subject || (key === "lunch" ? "昼休み" : ""),
        adIds:   assign.classAds || []
      };
    }

    // 休み時間（この校時終了〜次校時開始）
    if (i < PERIOD_ORDER.length - 1) {
      const nextKey = PERIOD_ORDER[i + 1];
      const nextPd  = p[nextKey];
      if (nextPd && nextPd.start) {
        const nextStart = toMin(nextPd.start);
        if (cur >= end && cur < nextStart) {
          const nextSubject = todaySub[nextKey] || "";
          const assign = adAssign[key] || {};
          return {
            mode:    "break",
            key:     nextKey,
            subject: nextSubject || "",
            adIds:   assign.breakAds || []
          };
        }
      }
    }
  }

  // 授業時間外（朝・放課後）
  const firstPd = p[PERIOD_ORDER[0]];
  if (firstPd && cur < toMin(firstPd.start)) {
    const firstSub = todaySub[PERIOD_ORDER[0]] || "";
    return { mode:"break", key:PERIOD_ORDER[0], subject:firstSub, adIds:[] };
  }

  return { mode:"off", key:"", subject:"放課後", adIds:[] };
}

/* ===== 共通ユーティリティ ===== */
function parseColorTags(text) {
  return text
    .replaceAll("/n", "<br>")
    .replace(/\[cyan\](.*?)\[\/cyan\]/g,  '<span style="color:cyan">$1</span>')
    .replace(/\[red\](.*?)\[\/red\]/g,    '<span style="color:red">$1</span>')
    .replace(/\[blue\](.*?)\[\/blue\]/g,  '<span style="color:#4488ff">$1</span>');
}

function formatSubject(text) {
  const chars = [...text];
  if (chars.length >= 2 && chars.length <= 5) return chars.join(" ");
  return text;
}

/* ===== 本時/次は ===== */
function updateMode() {
  const { mode } = getCurrentState();
  modeLabelElement.textContent =
    mode === "break" ? "次は" :
    mode === "off"   ? "　　" : "本時";
}

/* ===== 教科名スクロール ===== */
let subjectTimer = null;

function updateSubject() {
  const { subject } = getCurrentState();
  const raw = subject || "　";
  const len = [...raw].length;

  subjectElement.style.transition = "none";
  subjectElement.style.transform  = "translateX(0)";
  subjectElement.style.left       = "0px";
  if (subjectTimer) clearTimeout(subjectTimer);
  void subjectElement.offsetWidth;

  if (len <= 8) {
    subjectElement.textContent = formatSubject(raw);
    const tw = subjectElement.scrollWidth;
    subjectElement.style.left = `${(1772 - tw) / 2}px`;
    return;
  }

  subjectElement.textContent = raw;
  const tw  = subjectElement.scrollWidth;
  const sx  = 1772;
  const dist = sx + tw;
  subjectElement.style.left = `${sx}px`;
  subjectTimer = setTimeout(() => {
    subjectElement.style.transition = `transform ${dist / 130}s linear`;
    subjectElement.style.transform  = `translateX(-${dist}px)`;
  }, 500);
}

/* ===== 授業2分前チェック ===== */
function isPreClass() {
  const p = { ...getDefaultPeriods(), ...periods };
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const sec = now.getSeconds();
  const curSec = cur * 60 + sec; // 秒単位

  for (const key of PERIOD_ORDER) {
    if (key === "lunch") continue; // 給食は対象外
    const pd = p[key];
    if (!pd || !pd.start) continue;
    const [h, m] = pd.start.split(":").map(Number);
    const startSec = (h * 60 + m) * 60;
    // 授業開始の120秒前〜0秒前
    if (curSec >= startSec - 120 && curSec < startSec) return true;
  }
  return false;
}

/* ===== 広告表示 ===== */
let currentAdIndex = 0;
let preClassShowing = false;

function showLeft2() {
  noticeArea.style.background = "#000000";
  noticeText.style.display    = "none";
  noticeVideo.style.display   = "none";
  noticeImage.style.display   = "block";
  noticeImage.src = "images/left2.png";
}

function showAd(ad) {
  if (!ad) return;
  noticeArea.style.background = ad.color === "white" ? "#ffffff" : "#000000";
  noticeText.style.color      = ad.color === "white" ? "#000000" : "#ffffff";
  noticeText.style.display    = "none";
  noticeImage.style.display   = "none";
  noticeVideo.style.display   = "none";

  if (ad.type === "text") {
    noticeText.style.display = "block";
    noticeText.innerHTML = parseColorTags(ad.text || "");
  } else if (ad.type === "image") {
    noticeImage.style.display = "block";
    noticeImage.src = ad.src || "";
  } else if (ad.type === "video") {
    noticeVideo.style.display = "block";
    noticeVideo.src = ad.src || "";
    noticeVideo.load();
  }
}

function updateAds() {
  // 授業2分前はleft2.png固定表示
  if (isPreClass()) {
    if (!preClassShowing) {
      preClassShowing = true;
      showLeft2();
    }
    return;
  }
  preClassShowing = false;

  const { adIds } = getCurrentState();
  if (!adIds || adIds.length === 0) {
    noticeArea.style.background = "#000000";
    noticeText.style.display    = "none";
    noticeImage.style.display   = "none";
    noticeVideo.style.display   = "none";
    return;
  }
  if (currentAdIndex >= adIds.length) currentAdIndex = 0;
  showAd(ads[adIds[currentAdIndex]]);
  currentAdIndex++;
}

/* ===== 全体更新 ===== */
function updateAll() {
  updateMode();
  updateSubject();
  currentAdIndex = 0;
  updateAds();
}

/* ===== 起動 ===== */
subjectElement.textContent   = "読込中...";
modeLabelElement.textContent = "接続";
startRealtimeSync();

/* ===== 広告ローテーション（10秒ごと） ===== */
setInterval(() => {
  if (Object.keys(periods).length === 0 && Object.keys(baseSchedule).length === 0) return;
  updateAds();
}, 10000);

/* ===== 状態変化検知（1秒ごと） ===== */
let lastKey = "", lastMode = "", lastPreClass = false;
setInterval(() => {
  if (Object.keys(periods).length === 0 && Object.keys(baseSchedule).length === 0) return;
  const { key, mode } = getCurrentState();
  const pre = isPreClass();

  // 2分前フラグが切り替わった瞬間に広告更新
  if (pre !== lastPreClass) {
    lastPreClass = pre;
    currentAdIndex = 0;
    updateAds();
  }

  if (key !== lastKey || mode !== lastMode) {
    lastKey = key; lastMode = mode;
    updateAll();
  }
}, 1000);

/* ===== スケーリング ===== */
function resizeContainer() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1279);
  document.getElementById("parentContainer").style.transform =
    `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener("load",   resizeContainer);
window.addEventListener("resize", resizeContainer);

console.log("NITS v4 起動");
