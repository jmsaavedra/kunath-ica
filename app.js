"use strict";

// This public launcher contains no download password or visitor data.
const endpoint = "https://kung-overhaul-spectator.ngrok-free.dev";
const gate = document.querySelector("#gate");
const downloads = document.querySelector("#downloads");
const passwordInput = document.querySelector("#password");
const status = document.querySelector("#status");
let password = "";
let busy = false;

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
  password = "";
  gate.hidden = false;
  downloads.hidden = true;
  passwordInput.value = "";
  passwordInput.focus();
}

async function request(path, credential) {
  let response;
  try {
    response = await fetch(endpoint + path, {
      headers: {"Authorization": "Bearer " + credential, "ngrok-skip-browser-warning": "1"},
      credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(150_000),
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
  }
}

document.querySelector("#csv").addEventListener("click", () =>
  download("/downloads/submissions.csv", "text/csv", "submissions.csv"));
document.querySelector("#report").addEventListener("click", () =>
  download("/downloads/system-report.txt", "text/plain", "kunath-system-report.txt"));
document.querySelector("#lock").addEventListener("click", () => { lock(); message(""); });
