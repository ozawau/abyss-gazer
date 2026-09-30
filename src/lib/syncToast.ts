/** Desktop sync result toast (top-right). */
export function showSyncResultToast(message: string, ok: boolean): void {
  if (typeof document === "undefined") return;
  if (document.documentElement.classList.contains("is-android")) return;

  const existing = document.getElementById("abyss-sync-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.id = "abyss-sync-toast";
  toast.className = `sync-result-toast${ok ? " is-ok" : " is-error"}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));

  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 220);
  }, ok ? 2800 : 5200);
}
