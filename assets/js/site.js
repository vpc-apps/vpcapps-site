// Theme toggle (remembered per browser) and click-to-play game frames.
(function () {
  var root = document.documentElement;
  function current() {
    return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.theme');
    if (btn) btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });

    // The game loads only when the player asks for it: pages stay light and fast.
    document.querySelectorAll('.player').forEach(function (box) {
      var play = box.querySelector('.play-btn');
      var fs = box.parentNode.querySelector('.fs');
      function start() {
        if (box.classList.contains('on')) return;
        var f = document.createElement('iframe');
        f.src = box.dataset.src;
        f.title = box.dataset.title + ' (game)';
        f.allow = 'autoplay; fullscreen; gamepad';
        f.setAttribute('allowfullscreen', '');
        box.appendChild(f);
        box.classList.add('on');
        f.focus();
        if (fs && box.requestFullscreen) fs.hidden = false;
      }
      play.addEventListener('click', start);
      if (fs) fs.addEventListener('click', function () { box.requestFullscreen && box.requestFullscreen(); });
      if (location.hash === '#play' && matchMedia('(min-width: 700px)').matches) start();
    });
  });
})();
