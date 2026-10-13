/* Classic script, run before the modules. After a deploy the browser can hold an old
   cached module next to a new one, and the page then fails to load before app.js can
   check the version. On that error, re-fetch every site file past the cache and
   reload, at most once a minute. */
(function () {
  let done = false;
  window.addEventListener("error", e => {
    if (done || !/SyntaxError/.test(String(e.message || e.error))) return;
    done = true;
    let last = 0;
    try { last = Number(sessionStorage.getItem("awc-guard")) || 0; } catch (x) { }
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem("awc-guard", String(Date.now())); } catch (x) { }
    fetch("js/config.js", { cache: "reload" }).then(r => r.text()).then(t => {
      const m = /SITE_FILES\s*=\s*\[([^\]]*)\]/.exec(t);
      const files = m ? (m[1].match(/"[^"]+"/g) || []).map(s => s.slice(1, -1)) : [];
      return Promise.all(files.map(f => fetch(f, { cache: "reload" }).catch(() => { })));
    }).catch(() => { }).then(() => location.reload());
  });
})();
