/* Runs before first paint (layout.tsx loads it as a blocking script). THEMES (id -> browser bar color) and
   FAMILIES (id -> [light, dark]) mirror src/theme/themes.ts, and "wallet-theme" is its THEME_KEY;
   tests/theme/themes.test.ts checks all three. The preference comes from the server (data-theme-pref on <html>),
   else the cached copy, else "system". It is a theme id, "system" or "system-<family>"; anything else follows
   the OS with the default family. */
(function () {
  var THEMES = {"wallet-light": "#f2f4f7", "wallet-dark": "#0f1115", "catppuccin-mocha": "#11111b", "catppuccin-latte": "#dce0e8", "rose-pine-moon": "#232136", "rose-pine-dawn": "#f2e9e1", "gruvbox-dark": "#1d2021", "gruvbox-light": "#f2e5bc", "cyberdream": "#16181a", "cyberdream-light": "#eaeaea", "optura": "#1a1616", "optura-light": "#e6e3d6"};
  var FAMILIES = {"default": ["wallet-light", "wallet-dark"], "catppuccin": ["catppuccin-latte", "catppuccin-mocha"], "rose-pine": ["rose-pine-dawn", "rose-pine-moon"], "gruvbox": ["gruvbox-light", "gruvbox-dark"], "cyberdream": ["cyberdream-light", "cyberdream"], "optura": ["optura-light", "optura"]};
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var root = document.documentElement;
  var pref = root.dataset.themePref;
  if (!pref) { try { pref = localStorage.getItem("wallet-theme"); } catch (e) {} }
  pref = pref || "system";
  var id = pref;
  if (!has(THEMES, id)) {
    var family = pref.indexOf("system-") === 0 ? pref.slice(7) : "default";
    if (!has(FAMILIES, family)) family = "default";
    var dark = false;
    try { dark = matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    id = FAMILIES[family][dark ? 1 : 0];
  }
  root.dataset.theme = id;
  root.dataset.scheme = /light|latte|dawn/.test(id) ? "light" : "dark";
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute("content", THEMES[id]);
})();
