// FILE: src/main.js
import { createClient } from "@supabase/supabase-js";
import { Html5QrcodeScanner, Html5QrcodeScanType } from "html5-qrcode";

/* ---------- Env + client ---------- */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
}
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const startBtn = $("startScan");
const stopBtn = $("stopScan");
const orderNoEl = $("orderNo");
const clearBtn = $("clearOrder");
const msgEl = $("msg");
const catEl = $("category");
const subEl = $("subCategory");
const descEl = $("desc");
const fileEl = $("photo");
const previewEl = $("preview");
const submitBtn = $("submitBtn");

let scanner = null;


/* ------------------------------------------------------------------
 * Options loader: options_error_list (category / sub_category)
 * ------------------------------------------------------------------ */
let _errorItemsCache = [];

async function fetchAllErrorItems() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("options_error_list").select("*");
  if (error) {
    console.error("[options_error_list] fetch error:", error);
    return [];
  }
  return data || [];
}

async function loadCategories() {
  // Clear current selects while loading
  catEl.innerHTML = '<option value="">Loading…</option>';
  subEl.innerHTML = '<option value=""></option>';

  _errorItemsCache = await fetchAllErrorItems();

  if (!_errorItemsCache.length) {
    catEl.innerHTML = '<option value="">No options found</option>';
    subEl.innerHTML = '<option value=""></option>';
    return;
  }

  // Unique, sorted categories
  const categories = Array.from(
    new Set(
      _errorItemsCache
        .map((i) => (i?.category || "").trim())
        .filter(Boolean)
    )
  ).sort();

  catEl.innerHTML = '<option value="">Select…</option>';
  categories.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c.toUpperCase();
    catEl.appendChild(o);
  });

  // Wire change handler once
  catEl.onchange = () => updateSubCategories(catEl.value);

  // Auto-select first category (optional)
  if (categories.length && !catEl.value) {
    catEl.value = categories[0];
    updateSubCategories(categories[0]);
  } else {
    // reset subs initially
    subEl.innerHTML = '<option value="">Select…</option>';
  }
}

function updateSubCategories(category) {
  const subs = Array.from(
    new Set(
      _errorItemsCache
        .filter(
          (i) =>
            (i?.category || "").trim().toLowerCase() ===
            (category || "").trim().toLowerCase()
        )
        .map((i) => (i?.sub_category || "").trim())
        .filter(Boolean)
    )
  ).sort();

  subEl.innerHTML = '<option value="">Select…</option>';
  subs.forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s.toUpperCase();
    subEl.appendChild(o);
  });
}

/* ---------- QR ---------- */
function startScanner() {
  if (scanner) return;
  const config = {
    fps: 10,
    qrbox: { width: 250, height: 250 },
    rememberLastUsedCamera: true,
    supportedScanTypes: [
      Html5QrcodeScanType.SCAN_TYPE_CAMERA,
      Html5QrcodeScanType.SCAN_TYPE_FILE, // has built-in upload button
    ],
  };
  scanner = new Html5QrcodeScanner("qr-region", config, false);
  scanner.render(onDecoded, () => {});
  startBtn.disabled = true;
  stopBtn.disabled = false;
}
function stopScanner() {
  if (!scanner) return;
  scanner
    .clear()
    .catch(() => {})
    .finally(() => {
      scanner = null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    });
}
function onDecoded(text) {
  if (!text) return;
  stopScanner();
  setOrderNo(String(text).trim());
  document.getElementById("formCard").scrollIntoView({ behavior: "smooth" });
}

/* ---------- Image preview ---------- */
fileEl.addEventListener("change", () => {
  const f = fileEl.files?.[0];
  if (!f) {
    previewEl.src = "";
    previewEl.style.display = "none";
    return;
  }
  const url = URL.createObjectURL(f);
  previewEl.src = url;
  previewEl.style.display = "block";
});

/* ---------- Supabase helpers ---------- */
async function fetchOrderIdByOrderNo(orderNo) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_no")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
async function uploadPhotoIfAny(file) {
  if (!file) return null;
  if (!supabase) throw new Error("Supabase not configured");
  const mime = file.type || "image/jpeg";
  if (!/^image\/(png|jpe?g)$/.test(mime))
    throw new Error("Unsupported image type");

  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}${String(now.getFullYear()).toString().slice(-2)}${String(
    now.getHours()
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const ext = mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  const filename = `error-report-${stamp}-${crypto
    .randomUUID()
    .slice(0, 8)}.${ext}`;

  const { data, error } = await supabase.storage
    .from("error_report_images")
    .upload(filename, file, { contentType: mime, upsert: false });
  if (error) throw error;

  const { data: pub, error: urlErr } = await supabase.storage
    .from("error_report_images")
    .getPublicUrl(data.path);
  if (urlErr) throw urlErr;
  return pub?.publicUrl || null;
}

/* ---------- Submit ---------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  msg("Saving…");

  const orderNo = orderNoEl.value.trim();
  const category = catEl.value.trim();
  const subcat = subEl.value.trim();
  const desc = descEl.value.trim();

  if (!orderNo || !category || !subcat || !desc) {
    msg("All fields are required.", "error");
    enableFormButtons();
    return;
  }
  if (!supabase) {
    msg("Supabase not configured. Set env and restart dev server.", "error");
    enableFormButtons();
    return;
  }

  try {
    const orderId = await fetchOrderIdByOrderNo(orderNo);
    if (!orderId) {
      msg("Order not found.", "error");
      enableFormButtons();
      return;
    }

    let imageUrl = null;
    const f = fileEl.files?.[0] || null;
    if (f) imageUrl = await uploadPhotoIfAny(f);

    const payload = {
      order_id: orderId,
      category,
      sub_category: subcat,
      description: desc,
      status: "flagged",
      ...(imageUrl ? { image: imageUrl } : {}),
    };

    const { error } = await supabase
      .from("order_error_reports")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    msg("Report added.", "success");
    descEl.value = "";
    fileEl.value = "";
    previewEl.src = "";
    previewEl.style.display = "none";
  } catch (err) {
    console.error(err);
    msg("Failed to add report.", "error");
  } finally {
    enableFormButtons();
  }
});

/* ---------- Controls & boot ---------- */
startBtn.addEventListener("click", startScanner);
stopBtn.addEventListener("click", stopScanner);
$("clearOrder").addEventListener("click", () => {
  orderNoEl.value = "";
  enableFormButtons();
  msg("Cleared.");
});

(async function boot() {
  // 1) Populate categories/sub-categories from options_error_list
  await loadCategories();

  // 2) Enable/disable buttons
  enableFormButtons();

  // 3) PWA SW
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {}
  }

  // 4) Start scanner by default
  try {
    startScanner();
  } catch {}

  // 5) Stop scanner when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner();
  });
})();

const formCard = document.getElementById("formCard");

// Show/hide the form card
function showForm(show) {
  formCard.style.display = show ? "block" : "none";
  if (show) {
    // focus the Category after a tick
    setTimeout(() => catEl?.focus(), 0);
  } else {
    // also reset any message when hiding
    msg("");
  }
}

function msg(text, tone = "") {
  if (!msgEl) return;
  msgEl.textContent = text || "";
  msgEl.className = tone || "muted";
}

function enableFormButtons() {
  const hasOrder = !!orderNoEl.value.trim();
  submitBtn.disabled = !hasOrder || !supabase;
  clearBtn.disabled = !hasOrder;
  // keep form visibility in sync
  showForm(hasOrder);
}

function setOrderNo(v) {
  orderNoEl.value = (v || "").trim();
  enableFormButtons();
  msg("Order number set.", "success");
  if (orderNoEl.value) {
    // Smooth scroll to form once we have an order no.
    document.getElementById("formCard").scrollIntoView({ behavior: "smooth" });
  }
}

$("clearOrder").addEventListener("click", () => {
  orderNoEl.value = "";
  enableFormButtons();     // this will also hide the form
  msg("Cleared.");
});

// Boot: make sure the form starts hidden
(async function boot() {
  await loadCategories();  // pre-load options (fine to do early)
  enableFormButtons();     // will hide the form since orderNo is empty

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch {}
  }
  try { startScanner(); } catch {}
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner();
  });
})();