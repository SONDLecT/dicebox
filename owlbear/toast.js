// Fills the toast from its query string and lets a click dismiss it early. The
// background owns opening and closing; this page only displays and, on click,
// asks for its own close.
const params = new URLSearchParams(location.search);
const put = (id, key) => {
  const el = document.getElementById(id);
  if (el) el.textContent = (params.get(key) || '').slice(0, 80);
};
put('who', 'who');
put('head', 'head');
put('sub', 'sub');

document.getElementById('toast')?.addEventListener('click', () => {
  import('/obr-sdk.js')
    .then(m => m.default.popover.close('cc.dicebox/toast'))
    .catch(() => { /* the timed close still lands */ });
});
