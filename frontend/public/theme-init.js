/* the theme before the first paint: the landing (/ and /samples/*) has its own (dark by default), the app and the sign-in use the saved one; the landing hero is always dark, so the landing is painted dark until the app loads (data-first-paint) */
try {
  var s = JSON.parse(localStorage.getItem("madp-factory-session-v3") || localStorage.getItem("madp-factory-session-v2") || "{}");
  var landing = location.pathname === "/" || location.pathname.indexOf("/samples/") === 0;
  if (landing) document.documentElement.dataset.firstPaint = "dark";
  document.documentElement.dataset.theme = landing ? (s.landingTheme === "light" ? "light" : "dark") : (s.theme === "dark" ? "dark" : "light");
} catch (e) {
  if (location.pathname === "/" || location.pathname.indexOf("/samples/") === 0) document.documentElement.dataset.firstPaint = "dark";
  document.documentElement.dataset.theme = location.pathname === "/" || location.pathname.indexOf("/samples/") === 0 ? "dark" : "light";
}
