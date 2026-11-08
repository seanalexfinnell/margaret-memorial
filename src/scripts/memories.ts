/** Shared memories: show approved ones, and send new ones to the family for review. */

type Memory = {
  id: string; created_at: string; name: string; relation?: string; place?: string; body: string;
  photos: { key: string; caption?: string }[];
};

// Pages change without a reload, so wire the memory book up each time it's arrived at.
function setup() {
  if (!document.querySelector("[data-memory-list]")) return;
  const list = document.querySelector<HTMLElement>("[data-memory-list]");
  const form = document.querySelector<HTMLFormElement>("[data-memory-form]");
  const statusEl = document.querySelector<HTMLElement>("[data-status]");
  const thumbs = document.querySelector<HTMLElement>("[data-thumbs]");
  const fileInput = form?.querySelector<HTMLInputElement>('input[type="file"]');

  const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  async function load() {
    if (!list) return;
    try {
      const res = await fetch("/api/memories");
      if (!res.ok) return;
      const items = (await res.json()) as Memory[];
      if (!items.length) return;
      list.innerHTML = items.map((m) => `
        <article class="memory">
          <div class="who"><b>${esc(m.name)}</b>${m.relation ? `<span>${esc(m.relation)}</span>` : ""}${m.place ? `<span>from ${esc(m.place)}</span>` : ""}</div>
          <p class="body">${esc(m.body)}</p>
          ${m.photos.length ? `<div class="pics">${m.photos.map((p) => `<img src="/api/photo/${encodeURIComponent(p.key)}" alt="${esc(p.caption || `Photo shared by ${m.name}`)}" loading="lazy">`).join("")}</div>` : ""}
        </article>`).join("");
    } catch { /* the empty state stays */ }
  }

  /** Shrink phone photos in the browser so a slow connection in Scotland isn't sending 8 MB files. */
  async function shrink(file: File, max = 1800): Promise<{ blob: Blob; w: number; h: number }> {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error("encode"))), "image/jpeg", 0.86));
    return { blob, w, h };
  }

  fileInput?.addEventListener("change", () => {
    if (!thumbs || !fileInput.files) return;
    thumbs.innerHTML = "";
    [...fileInput.files].slice(0, 4).forEach((f) => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      img.alt = "";
      thumbs.append(img);
    });
    if (fileInput.files.length > 4) say("Only the first four photos will be sent.", "err");
  });

  function say(msg: string, kind: "ok" | "err" | "" = "") {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `status ${kind}`;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const raw = new FormData(form);
    if (!String(raw.get("name") || "").trim() || !String(raw.get("body") || "").trim()) {
      say("Please add your name and a memory.", "err");
      return;
    }

    button.disabled = true;
    say("Sending…");
    try {
      const data = new FormData();
      for (const k of ["name", "relation", "place", "body", "website", "cf-turnstile-response"]) data.append(k, String(raw.get(k) || ""));
      const files = [...(fileInput?.files || [])].slice(0, 4);
      for (const f of files) {
        const { blob, w, h } = await shrink(f);
        data.append("photos", new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        data.append("dims", `${w}x${h}`);
      }
      const res = await fetch("/api/memories", { method: "POST", body: data });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn’t send. Please try again.");
      form.reset();
      if (thumbs) thumbs.innerHTML = "";
      say("Thank you. The family will read your memory and add it here soon.", "ok");
    } catch (err) {
      say(err instanceof Error ? err.message : "That didn’t send. Please try again.", "err");
    } finally {
      button.disabled = false;
      (window as any).turnstile?.reset?.();
    }
  });

  load();

  // Turnstile renders itself on a first load; on later arrivals render the widget by hand.
  const ts = document.querySelector<HTMLElement>(".cf-turnstile");
  const api = (window as any).turnstile;
  if (ts && api && !ts.querySelector("iframe")) api.render(ts);
}

document.addEventListener("astro:page-load", setup);
