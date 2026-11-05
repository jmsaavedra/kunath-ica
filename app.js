"use strict";

// This public launcher contains no download password or visitor data.
const endpoint = "https://kung-overhaul-spectator.ngrok-free.dev";
const gate = document.querySelector("#gate");
const downloads = document.querySelector("#downloads");
const passwordInput = document.querySelector("#password");
const status = document.querySelector("#status");
let password = "";
let busy = false;
const healthRefreshMs = 5 * 60_000;
let healthSample = null;
let healthPollTimer;
let healthRetryTimer;
let uptimeTimer;
let healthController;
let healthGeneration = 0;
let lastHealthAttempt = 0;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach(button => { button.disabled = value; });
  passwordInput.disabled = value;
}

function lock() {
  stopHealth();
  password = "";
  gate.hidden = false;
  downloads.hidden = true;
  passwordInput.value = "";
  passwordInput.focus();
}

async function request(path, credential, timeoutMs = 150_000, signal) {
  let response;
  try {
    response = await fetch(endpoint + path, {
      headers: {"Authorization": "Bearer " + credential, "ngrok-skip-browser-warning": "1"},
      credentials: "omit", cache: "no-store", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Cannot reach the installation. Check your Internet connection and try again. The PC may be offline.");
  }
  if (response.status === 401) {
    lock();
    throw new Error("Incorrect password. Please try again.");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || "The download is unavailable. Please try again shortly or contact support.");
  }
  return response;
}

function formatUptime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return (days ? `${days}d ` : "") + `${hours}h ${minutes % 60}m`;
}

function renderHealth() {
  const ageMs = healthSample ? Math.max(0, Date.now() - healthSample.receivedAt) : 0;
  const fresh = healthSample && ageMs <= healthRefreshMs + 60_000;
  const projection = fresh ? healthSample.projection : {state: "unknown"};
  const tablet = fresh ? healthSample.tablet : {state: "unknown"};
  const serverLabels = {online: "Projection Server Online", attention: "Projection Server Needs Attention",
    unreachable: "Projection Server Unreachable", unknown: "Projection Server Status Unknown"};
  const tabletLabels = {connected: "Tablet Connected", disconnected: "Tablet Disconnected", unknown: "Tablet Status Unknown"};
  document.querySelector("#server-health").dataset.state = projection.state;
  document.querySelector("#server-label").textContent = serverLabels[projection.state] || serverLabels.unknown;
  document.querySelector("#tablet-health").dataset.state = tablet.state;
  document.querySelector("#tablet-label").textContent = tabletLabels[tablet.state] || tabletLabels.unknown;
  const uptime = projection.uptimeSeconds;
  document.querySelector("#uptime").textContent = typeof uptime === "number" && Number.isFinite(uptime) && uptime >= 0
    ? formatUptime(uptime + ageMs / 1000) : "—";
  document.querySelector("#live-health").title = healthSample
    ? `Last check: ${new Date(healthSample.receivedAt).toLocaleTimeString()}. Automatic checks every five minutes while visible.`
    : "Waiting for a current status check.";
}

async function refreshHealth() {
  if (!password || busy || document.hidden || healthController) return;
  clearTimeout(healthRetryTimer);
  const controller = new AbortController();
  healthController = controller;
  const generation = healthGeneration;
  lastHealthAttempt = Date.now();
  try {
    const response = await request("/api/status", password, 15_000, controller.signal);
    const data = await response.json();
    if (generation !== healthGeneration || !password) return;
    if (!data.projection || !data.tablet) throw new Error("Invalid status response.");
    if (data.retryAfterSeconds) {
      healthRetryTimer = setTimeout(() => void refreshHealth(), 15_000);
      return;
    }
    healthSample = {projection: data.projection, tablet: data.tablet, receivedAt: Date.now()};
  } catch {
    if (generation !== healthGeneration || !password) return;
    healthSample = {projection: {state: "unreachable", uptimeSeconds: null}, tablet: {state: "unknown"}, receivedAt: Date.now()};
  } finally {
    if (healthController === controller) healthController = null;
    if (generation === healthGeneration) renderHealth();
  }
}

function stopHealth() {
  healthGeneration++;
  clearInterval(healthPollTimer);
  clearTimeout(healthRetryTimer);
  clearInterval(uptimeTimer);
  healthController?.abort();
  healthController = null;
  healthSample = null;
}

function startHealth() {
  stopHealth();
  renderHealth();
  void refreshHealth();
  healthPollTimer = setInterval(() => void refreshHealth(), healthRefreshMs);
  uptimeTimer = setInterval(renderHealth, 1000);
}

gate.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const entered = passwordInput.value;
  setBusy(true);
  message("Checking password…");
  try {
    const response = await request("/api/session", entered);
    if (!response.headers.get("Content-Type")?.startsWith("application/json") || !(await response.json()).ok) {
      throw new Error("The installation did not return a valid response. Please contact support.");
    }
    password = entered;
    passwordInput.value = "";
    gate.hidden = true;
    downloads.hidden = false;
    message("Choose a download.");
    document.querySelector("#csv").focus();
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    if (password && !downloads.hidden) startHealth();
  }
});

async function download(path, type, fallback) {
  if (busy || !password) return;
  setBusy(true);
  message("Preparing download…");
  try {
    const response = await request(path, password);
    if (!response.headers.get("Content-Type")?.startsWith(type)) {
      throw new Error("The installation did not return the expected file. Please contact support.");
    }
    const file = await response.blob();
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = response.headers.get("Content-Disposition")?.match(/filename="([a-zA-Z0-9.-]+)"/)?.[1] || fallback;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    message("Download started. Check your browser’s Downloads folder.");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    if (Date.now() - lastHealthAttempt >= healthRefreshMs) void refreshHealth();
  }
}

document.querySelector("#csv").addEventListener("click", () =>
  download("/downloads/submissions.csv", "text/csv", "submissions.csv"));
document.querySelector("#report").addEventListener("click", () =>
  download("/downloads/system-report.txt", "text/plain", "kunath-system-report.txt"));
document.querySelector("#lock").addEventListener("click", () => { lock(); message(""); });
document.querySelector("#refresh-health").addEventListener("click", () => void refreshHealth());
document.addEventListener("visibilitychange", () => {
  if (password && !document.hidden) {
    renderHealth();
    if (Date.now() - lastHealthAttempt >= healthRefreshMs) void refreshHealth();
  }
});
