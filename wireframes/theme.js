// Botfather wireframe theme toggle — dark default, persisted in localStorage
(function () {
  var saved = localStorage.getItem('bf-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  window.bfToggleTheme = function () {
    var el = document.documentElement;
    var light = el.getAttribute('data-theme') === 'light';
    if (light) { el.removeAttribute('data-theme'); localStorage.setItem('bf-theme', 'dark'); }
    else { el.setAttribute('data-theme', 'light'); localStorage.setItem('bf-theme', 'light'); }
    var b = document.querySelector('.theme-btn'); if (b) b.textContent = light ? '☀' : '☾';
  };
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.querySelector('.theme-btn');
    if (b) b.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☾' : '☀';
  });
})();
