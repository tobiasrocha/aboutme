(function () {
  var canvas = document.getElementById('nodes-canvas');
  var ctx = canvas.getContext('2d');
  var particles = [];
  var mouse = { x: -9999, y: -9999 };
  var maxDist = 120;
  var mouseRadius = 160;
  var count = 70;
  var w, h;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  function createParticle() {
    return {
      x: random(0, w),
      y: random(0, h),
      vx: random(-0.4, 0.4),
      vy: random(-0.4, 0.4),
      r: random(1.2, 2.8)
    };
  }

  function init() {
    resize();
    particles = [];
    for (var i = 0; i < count; i++) {
      particles.push(createParticle());
    }
  }

  function update() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    }
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  var isDark = document.body.className.indexOf('theme-dark') !== -1;
  var colorNode = isDark ? 'rgba(138, 180, 248, 0.7)' : 'rgba(74, 111, 165, 0.6)';
  var colorLine = isDark
    ? function (a) { return 'rgba(138, 180, 248, ' + a + ')'; }
    : function (a) { return 'rgba(74, 111, 165, ' + a + ')'; };

  document.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  document.addEventListener('mouseleave', function () {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  document.addEventListener('touchmove', function (e) {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  }, { passive: false });

  document.addEventListener('touchend', function () {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  window.addEventListener('resize', resize);

  function draw() {
    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = colorNode;
      ctx.fill();

      for (var j = i + 1; j < particles.length; j++) {
        var q = particles[j];
        var dx = p.x - q.x;
        var dy = p.y - q.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = colorLine((1 - dist / maxDist) * 0.22);
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      var mdx = p.x - mouse.x;
      var mdy = p.y - mouse.y;
      var mdist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mdist < mouseRadius && mouse.x > 0) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = colorLine((1 - mdist / mouseRadius) * 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  init();
  loop();
})();
