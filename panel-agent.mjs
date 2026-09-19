// These functions execute in the simulator's own instrument web view.
export function inspectPanelPage() {
  var parent = document.querySelector('vcockpit-panel');
  var nodes = parent ? Array.prototype.slice.call(parent.children) : [];
  if (!parent && /efb/i.test(location.pathname)) nodes = [document.body];
  return nodes.map(function (element, index) {
    var rect = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    var source = element.getAttribute('url') || '';
    var name = (source.match(/[?&](?:wasm_gauge|instrument)=([^&]+)/i) || [])[1];
    var top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      index: index, name: name ? decodeURIComponent(name) : (element.getAttribute('id') || element.tagName),
      width: Math.round(rect.width), height: Math.round(rect.height),
      visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
        rect.width >= 64 && rect.height >= 64 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 &&
        (!top || top === element || element.contains(top))
    };
  }).filter(function (panel) { return panel.visible && panel.width <= 4096 && panel.height <= 4096; });
}

export function markPanelPage(config) {
  var key = '__mofeiPanelMarkerV1';
  var previous = window[key];
  if (previous) {
    clearTimeout(previous.timer);
    previous.node.remove();
    delete window[key];
  }
  if (!config) return true;
  var parent = document.querySelector('vcockpit-panel');
  var target = parent ? parent.children[config.index] : document.body;
  if (!target) return false;
  var rect = target.getBoundingClientRect();
  var marker = document.createElement('div');
  marker.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;width:2px;height:1px;overflow:hidden;opacity:1;transform:none;';
  marker.style.left = Math.round(rect.left) + 'px';
  marker.style.top = Math.round(rect.top) + 'px';
  [config.first, config.second].forEach(function (color, index) {
    var pixel = document.createElement('div');
    pixel.style.cssText = 'position:absolute;top:0;width:1px;height:1px;';
    pixel.style.left = index + 'px';
    pixel.style.backgroundColor = '#' + ('000000' + color.toString(16)).slice(-6);
    marker.appendChild(pixel);
  });
  document.documentElement.appendChild(marker);
  // An app crash or lost connection must not leave discovery pixels behind.
  window[key] = { node: marker, timer: setTimeout(function () {
    marker.remove(); delete window[key];
  }, 12000) };
  return true;
}
