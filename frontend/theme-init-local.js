/* The theme before the first paint (local app). Light by default everywhere: the landing (/ and /samples/*) uses its own
   saved choice, the app and the sign-in use the saved app choice; nothing saved = light. Key matches src/state/store.ts. */
try {
  var s = JSON.parse(localStorage.getItem("madp-factory-session-v3") || "{}");
  var landing = location.pathname === "/" || location.pathname.indexOf("/samples/") === 0;
  var t = landing ? (s.landingTheme === "dark" ? "dark" : "light") : (s.theme === "dark" ? "dark" : "light");
  if (landing && t === "dark") document.documentElement.dataset.firstPaint = "dark";
  document.documentElement.dataset.theme = t;
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
