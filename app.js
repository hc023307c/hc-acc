

// ===== 0. Supabase 設定 =====
const SUPABASE_URL = "https://dkuspusfjjaneuhrlwiu.supabase.co";
const SUPABASE_KEY =
  "sb_publishable_cwMVesislX0jBWYWetTLZA_Ud8fhpBB";

// 由 CDN 載入的 supabase 物件
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// ===== 1. 共用 DOM & Debug 工具 =====
const jsStatusEl = document.getElementById("js-status");
const debugEl = document.getElementById("debug");
const userInfoEl = document.getElementById("user-info");
const authStatusEl = document.getElementById("auth-status");
const ledgerInputEl = document.getElementById("ledger-input");
const ledgerListEl = document.getElementById("ledger-list");
const ledgerTbodyEl = document.getElementById("ledger-tbody");

function logDebug(msg, obj) {
  if (!debugEl) return; // index.html / ledger.html 都有，但保險一下
  const text = msg + (obj ? " " + JSON.stringify(obj, null, 2) : "");
  debugEl.textContent += text + "\n";
  console.log("[DEBUG]", msg, obj || "");
}

if (jsStatusEl) {
  jsStatusEl.textContent =
    "✅ JS 已載入，Supabase client 建立完成。";
}
logDebug("Supabase client created");

// 帳號 → email： admin → admin@demo.local
function accountToEmail(account) {
  return account + "@demo.local";
}

// ===== 2. Auth：登入 / 登出 / 取得 user / 讀 profile =====

async function handleLogin() {
  const accountInput = document.getElementById("login-account");
  const passwordInput = document.getElementById("login-password");

  if (!accountInput || !passwordInput) {
    alert("這個頁面沒有登入表單。");
    return;
  }

  const account = accountInput.value.trim();
  const password = passwordInput.value;

  if (!account || !password) {
    if (authStatusEl) authStatusEl.textContent = "請輸入帳號與密碼";
    alert("請輸入帳號與密碼");
    return;
  }

  const email = accountToEmail(account);
  logDebug("嘗試登入", { email });

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

  if (error) {
    if (authStatusEl)
      authStatusEl.textContent = "登入失敗：" + error.message;
    logDebug("登入失敗", error);
    alert("登入失敗：" + error.message);
    return;
  }

  if (authStatusEl) {
    authStatusEl.textContent =
      "登入成功：" + (data.user?.email || "");
  }
  logDebug("登入成功", data);

  // 登入成功 → 直接跳到 ledger.html
  window.location.href = "ledger.html";
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  if (authStatusEl) authStatusEl.textContent = "已登出";
  if (userInfoEl) userInfoEl.textContent = "尚未登入";

  if (ledgerInputEl) ledgerInputEl.classList.add("hidden");
  if (ledgerListEl) ledgerListEl.classList.add("hidden");
  if (ledgerTbodyEl) ledgerTbodyEl.innerHTML = "";

  logDebug("已登出");

  // 登出後回登入頁
  window.location.href = "index.html";
}

// 取得目前使用者（沒登入時回 null，不當成錯誤）
async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    // 初次載入沒 session 時會出現 AuthSessionMissingError，忽略
    if (error.name !== "AuthSessionMissingError") {
      logDebug("getUser error", error);
    }
    return null;
  }
  return data.user || null;
}

async function loadProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("username, role")
    .eq("id", userId)
    .single();

  if (error) {
    logDebug("載入 profile 失敗", error);
    return null;
  }

  return data;
}

async function refreshUserInfo() {
  const user = await getCurrentUser();
  if (!user) {
    if (userInfoEl) userInfoEl.textContent = "尚未登入";
    if (ledgerInputEl) ledgerInputEl.classList.add("hidden");
    if (ledgerListEl) ledgerListEl.classList.add("hidden");
    return;
  }

  const profile = await loadProfile(user.id);
  const role = profile?.role || "user";
  const username = profile?.username || user.email;

  if (userInfoEl) {
    userInfoEl.innerHTML = `
      目前登入：<strong>${username}</strong>
      <span class="tag ${role === "admin" ? "admin" : "user"}">
        ${role === "admin" ? "管理員" : "一般使用者"}
      </span>
      <span style="font-size: 12px; color:#6b7280;">（${user.email}）</span>
    `;
  }

  if (ledgerInputEl) ledgerInputEl.classList.remove("hidden");
  if (ledgerListEl) ledgerListEl.classList.remove("hidden");
}

// 讓按鈕用
function goToIndex() {
  window.location.href = "index.html";
}

// ===== 3. 記帳：載入 / 新增 / 刪除 =====

async function loadLedger() {
  if (!ledgerTbodyEl) return; // 只有 ledger.html 才有

  const user = await getCurrentUser();
  if (!user) {
    ledgerTbodyEl.innerHTML =
      '<tr><td colspan="7">請先登入</td></tr>';
    // 沒登入 → 回登入頁
    window.location.href = "index.html";
    return;
  }

  ledgerTbodyEl.innerHTML =
    '<tr><td colspan="7">載入中...</td></tr>';

  const { data, error } = await supabaseClient
    .from("ledger")
    .select(
      "id, happened_at, type, category, amount, note, created_at, user_id"
    )
    .order("happened_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    ledgerTbodyEl.innerHTML =
      `<tr><td colspan="7">載入失敗：${error.message}</td></tr>`;
    logDebug("載入 ledger 失敗", error);
    return;
  }

  logDebug("載入 ledger 成功", data);

  if (!data || data.length === 0) {
    ledgerTbodyEl.innerHTML =
      '<tr><td colspan="7">目前沒有記帳資料</td></tr>';
    return;
  }

  // 將 user_id 轉成 username
  const userIds = [...new Set(data.map((row) => row.user_id))];
  const profileMap = new Map();

  if (userIds.length > 0) {
    const { data: profiles, error: pError } = await supabaseClient
      .from("profiles")
      .select("id, username, role")
      .in("id", userIds);

    if (pError) {
      logDebug("載入多個 profiles 失敗", pError);
    } else if (profiles) {
      profiles.forEach((p) => profileMap.set(p.id, p));
    }
  }

  ledgerTbodyEl.innerHTML = "";
  data.forEach((row) => {
    const tr = document.createElement("tr");

    const typeLabel =
      row.type === "income"
        ? '<span class="badge-income">收入</span>'
        : '<span class="badge-expense">支出</span>';

    const profile = profileMap.get(row.user_id);
    const who = profile ? profile.username : row.user_id;

    tr.innerHTML = `
      <td>${row.happened_at}</td>
      <td>${typeLabel}</td>
      <td>${row.category || ""}</td>
      <td>${row.amount}</td>
      <td>${row.note || ""}</td>
      <td>${who}</td>
      <td>
        <button type="button" onclick="deleteEntry(${row.id})">刪除</button>
      </td>
    `;
    ledgerTbodyEl.appendChild(tr);
  });
}

async function addEntry() {
  const user = await getCurrentUser();
  if (!user) {
    alert("請先登入");
    window.location.href = "index.html";
    return;
  }

  const dateEl = document.getElementById("entry-date");
  const typeEl = document.getElementById("entry-type");
  const categoryEl = document.getElementById("entry-category");
  const amountEl = document.getElementById("entry-amount");
  const noteEl = document.getElementById("entry-note");

  if (!dateEl || !typeEl || !categoryEl || !amountEl || !noteEl) {
    alert("這個頁面沒有完整的記帳表單。");
    return;
  }

  const date = dateEl.value;
  const type = typeEl.value;
  const category = categoryEl.value.trim();
  const amountStr = amountEl.value;
  const note = noteEl.value.trim();

  if (!date || !amountStr) {
    alert("請至少填寫日期與金額");
    return;
  }

  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    alert("金額需為正數");
    return;
  }

  const { error } = await supabaseClient.from("ledger").insert({
    happened_at: date,
    type,
    category,
    amount,
    note,
    // user_id 使用 DEFAULT auth.uid() + RLS 控制，不可信任前端傳入
  });

  if (error) {
    alert("新增記帳失敗：" + error.message);
    logDebug("新增記帳失敗", error);
    return;
  }

  amountEl.value = "";
  noteEl.value = "";

  await loadLedger();
}

async function deleteEntry(id) {
  const ok = confirm("確定要刪除此筆記帳嗎？");
  if (!ok) return;

  const { error } = await supabaseClient
    .from("ledger")
    .delete()
    .eq("id", id);

  if (error) {
    alert("刪除失敗：" + error.message);
    logDebug("刪除失敗", error);
    return;
  }

  await loadLedger();
}

// ===== 4. 頁面載入時的初始化 =====
document.addEventListener("DOMContentLoaded", async () => {
  logDebug("page loaded");

  const isIndexPage =
    document.getElementById("index-page") !== null;
  const isLedgerPage =
    document.getElementById("ledger-page") !== null;

  if (isIndexPage) {
    // 如果已經登入，直接跳去 ledger.html
    const user = await getCurrentUser();
    if (user) {
      logDebug("index: 已登入，轉到 ledger.html", user);
      window.location.href = "ledger.html";
      return;
    } else {
      logDebug("index: 尚未登入");
    }
  }

  if (isLedgerPage) {
    // 檢查登入，然後載入資料
    const user = await getCurrentUser();
    if (!user) {
      logDebug("ledger: 尚未登入，轉回 index.html");
      window.location.href = "index.html";
      return;
    }
    await refreshUserInfo();
    await loadLedger();
  }
});
