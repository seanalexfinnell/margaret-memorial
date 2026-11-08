// The nav persists across page changes: it slides away while reading down the page,
// comes back on any scroll up, and marks the page you're on after each navigation.
const nav = document.querySelector<HTMLElement>(".site-nav");
if (nav) {
  let last = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    nav.classList.toggle("is-hidden", y > last && y > 120);
    last = y;
  }, { passive: true });
  nav.addEventListener("focusin", () => nav.classList.remove("is-hidden"));

  const mark = () => {
    const here = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
    nav.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href === here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    nav.classList.remove("is-hidden");
    last = scrollY;
  };
  document.addEventListener("astro:page-load", mark);
  // Lets page scripts tell a first visit from an arrival through the menu.
  document.addEventListener("astro:after-swap", () => { (window as any).__mmNavigated = true; });
}
