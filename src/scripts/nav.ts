// The nav slides away while reading down the page and comes back on any scroll up.
const nav = document.querySelector<HTMLElement>(".site-nav");
if (nav) {
  let last = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    nav.classList.toggle("is-hidden", y > last && y > 120);
    last = y;
  }, { passive: true });
  nav.addEventListener("focusin", () => nav.classList.remove("is-hidden"));
}
