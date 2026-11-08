/**
 * Motion for the obituary page: smooth scrolling, her name rising in on a first visit,
 * photographs easing from a slight zoom as they pass, the photo sequence, and the closing line.
 * Pages change without a reload, so this sets up on every arrival at the obituary and
 * tears itself down before leaving. Under reduced motion only the sequence swap runs.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

let teardown: (() => void) | null = null;

function setup() {
  teardown?.();
  teardown = null;
  if (!document.querySelector(".cover")) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const arrived = (window as any).__mmNavigated === true; // came here through the menu: the title already morphed in
  let lenis: Lenis | null = null;
  let tick: ((time: number) => void) | null = null;
  let alive = true;

  const ctx = gsap.context(() => {
    document.querySelectorAll<HTMLElement>(".sequence").forEach((seq) => {
      const frames = seq.querySelectorAll<HTMLElement>("[data-seq]");
      seq.querySelectorAll<HTMLElement>("[data-step]").forEach((step) => {
        ScrollTrigger.create({
          trigger: step, start: "top 60%", end: "bottom 40%",
          onToggle: (self) => {
            if (!self.isActive) return;
            frames.forEach((f) => f.classList.toggle("is-active", f.dataset.seq === step.dataset.step));
          },
        });
      });
    });
  });

  if (!reduce) {
    lenis = new Lenis({ duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 3) });
    lenis.on("scroll", ScrollTrigger.update);
    tick = (time) => lenis!.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    document.fonts.ready.then(() => {
      if (!alive) return;
      ctx.add(() => {
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro.from("[data-cover-media] img", { scale: 1.08, duration: 2.4, ease: "power2.out" }, 0);
        if (!arrived) {
          document.querySelectorAll<HTMLElement>(".cover [data-split]").forEach((el) => {
            const split = SplitText.create(el, { type: "words,chars", mask: "chars" });
            intro.from(split.chars, { yPercent: 110, duration: 1.4, stagger: 0.06 }, 0.3);
          });
        }
        intro.from(arrived ? ".cover .fullname" : ".cover [data-reveal]", { opacity: 0, y: 14, duration: 1.2, stagger: 0.12 }, arrived ? 0.3 : 0.8);

        document.querySelectorAll<HTMLElement>("main .photo-plate").forEach((plate) => {
          const img = plate.querySelector("img");
          if (!img) return;
          gsap.fromTo(img, { scale: 1.1 }, {
            scale: 1, ease: "none",
            scrollTrigger: { trigger: plate, start: "top bottom", end: "bottom top", scrub: true },
          });
        });

        document.querySelectorAll<HTMLElement>(".closing [data-split]").forEach((el) => {
          const split = SplitText.create(el, { type: "words", mask: "words" });
          gsap.from(split.words, {
            yPercent: 100, duration: 1.2, stagger: 0.09, ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 80%", once: true },
          });
        });
      });
      ScrollTrigger.refresh();
    });
  }

  teardown = () => {
    alive = false;
    ctx.revert();
    if (tick) gsap.ticker.remove(tick);
    lenis?.destroy();
  };
}

document.addEventListener("astro:page-load", setup);
document.addEventListener("astro:before-swap", () => { teardown?.(); teardown = null; });
