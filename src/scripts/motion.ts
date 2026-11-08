/**
 * Scroll behaviour for the photo essay: smooth scrolling, her name rising in on load,
 * photographs easing from a slight zoom as they pass, the Montreal photographs changing
 * with each passage, and the closing line. Under reduced motion only the sequence swap runs.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
gsap.registerPlugin(ScrollTrigger, SplitText);

// Sequence: show the photograph that belongs to the passage in the middle of the screen.
document.querySelectorAll<HTMLElement>(".sequence").forEach((seq) => {
  const frames = seq.querySelectorAll<HTMLElement>("[data-seq]");
  seq.querySelectorAll<HTMLElement>("[data-step]").forEach((step) => {
    ScrollTrigger.create({
      trigger: step,
      start: "top 60%",
      end: "bottom 40%",
      onToggle: (self) => {
        if (!self.isActive) return;
        frames.forEach((f) => f.classList.toggle("is-active", f.dataset.seq === step.dataset.step));
      },
    });
  });
});

if (!reduce) {
  const lenis = new Lenis({ duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 3) });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  document.fonts.ready.then(() => {
    const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
    intro.from("[data-cover-media] img", { scale: 1.08, duration: 2.4, ease: "power2.out" }, 0);
    document.querySelectorAll<HTMLElement>(".cover [data-split]").forEach((el) => {
      const split = SplitText.create(el, { type: "words,chars", mask: "chars" });
      intro.from(split.chars, { yPercent: 110, duration: 1.4, stagger: 0.06 }, 0.3);
    });
    intro.from(".cover [data-reveal]", { opacity: 0, y: 14, duration: 1.2, stagger: 0.12 }, 0.8);

    // Photographs settle from a slight zoom as they cross the screen.
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

    ScrollTrigger.refresh();
  });
}
