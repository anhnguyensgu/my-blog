// Progressive enhancements; every page works without this script.
(() => {
  const root = document.documentElement;

  // Theme toggle: an explicit choice is stored; otherwise the OS preference applies.
  const prefersDark = matchMedia("(prefers-color-scheme: dark)");
  document.querySelector(".theme-toggle")?.addEventListener("click", () => {
    const current = root.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage may be unavailable (private mode); the toggle still works for this page.
    }
  });

  // Copy buttons on code blocks.
  for (const block of document.querySelectorAll(".codeblock")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector("code")?.textContent ?? "");
        button.textContent = "Copied";
      } catch {
        button.textContent = "Failed";
      }
      setTimeout(() => (button.textContent = "Copy"), 1600);
    });
    block.append(button);
  }

  // Reading progress and table-of-contents highlighting, updated once per frame.
  const nav = document.querySelector(".nav");
  const tocLinks = [...document.querySelectorAll(".toc a")];
  const headings = tocLinks
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter((heading) => heading !== null);
  const article = document.body.classList.contains("is-article");
  if (!article && headings.length === 0) return;

  let queued = false;
  const update = () => {
    queued = false;
    if (article && nav) {
      const max = root.scrollHeight - innerHeight;
      nav.style.setProperty("--progress", String(max > 0 ? Math.min(1, scrollY / max) : 0));
    }
    let active = headings[0];
    for (const heading of headings) if (heading.getBoundingClientRect().top < 140) active = heading;
    for (const link of tocLinks) link.classList.toggle("active", link.hash === `#${active?.id}`);
  };
  addEventListener("scroll", () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
})();
