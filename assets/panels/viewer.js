(() => {
  const settings = new URLSearchParams(location.search);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const panel = decodeURIComponent(location.pathname.split('/').pop());
  const image = document.getElementById('panel');
  const status = document.getElementById('status');
  image.className = ['contain', 'stretch', 'native'].includes(settings.get('fit')) ? settings.get('fit') : 'contain';
  let socket, retry, displayedUrl, pendingUrl, lastFrame = 0, disposed = false;
  function clearImage() {
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    if (displayedUrl) URL.revokeObjectURL(displayedUrl);
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    displayedUrl = pendingUrl = null;
    lastFrame = 0;
  }
  function connect() {
    if (disposed) return;
    if (!token) { status.textContent = '访问令牌缺失，请从软件重新复制地址'; return; }
    socket = new WebSocket(`ws://${location.host}/stream?panel=${encodeURIComponent(panel)}&fps=${Number(settings.get('fps')) || 30}&token=${encodeURIComponent(token)}`);
    socket.binaryType = 'blob';
    socket.onopen = () => { status.textContent = '等待面板画面'; };
    socket.onmessage = event => {
      if (typeof event.data === 'string') {
        try {
          const update = JSON.parse(event.data);
          status.textContent = update.phase === 'live' ? `${image.naturalWidth} × ${image.naturalHeight} · ${update.fps} FPS` : update.message;
          if (update.clear !== false) clearImage();
        } catch { /* Ignore invalid status. */ }
        return;
      }
      // Decode one frame at a time; discard backlog on slower mobile devices.
      if (pendingUrl) return;
      pendingUrl = URL.createObjectURL(event.data);
      image.onload = () => {
        if (displayedUrl) URL.revokeObjectURL(displayedUrl);
        displayedUrl = pendingUrl; pendingUrl = null; lastFrame = Date.now();
        status.textContent = `${image.naturalWidth} × ${image.naturalHeight} · 实时画面`;
      };
      image.onerror = () => { clearImage(); status.textContent = '画面解码失败'; };
      image.src = pendingUrl;
    };
    socket.onclose = event => {
      clearImage(); status.textContent = event.code === 1008 ? '地址已失效，请重新复制' : '连接断开，正在重试';
      if (!disposed && event.code !== 1008) retry = setTimeout(connect, 3000);
    };
    socket.onerror = () => { status.textContent = '无法连接，请检查局域网、防火墙或重新复制地址'; };
  }
  const staleTimer = setInterval(() => {
    if (lastFrame && Date.now() - lastFrame > 5000) { status.textContent = '画面已中断'; clearImage(); lastFrame = 0; }
  }, 1000);
  document.getElementById('fullscreen').onclick = () => document.fullscreenElement
    ? document.exitFullscreen?.() : document.body.requestFullscreen?.().catch(() => {});
  window.addEventListener('pagehide', () => { disposed = true; clearInterval(staleTimer); clearTimeout(retry); socket?.close(); clearImage(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  connect();
})();
