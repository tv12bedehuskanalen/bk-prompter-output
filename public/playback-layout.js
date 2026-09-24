// Playback position uses the server's reference layout. Each screen maps reference
// line starts to the same text in its own layout. No text measurement runs per frame.
let displayPositionMap = null;
function displayPosition(position) {
  const points = displayPositionMap;
  if (!points || points.length < 2) return position;
  let lo = 0,
    hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= position) lo = mid;
    else hi = mid;
  }
  const a = points[lo],
    b = points[hi];
  return (
    a[1] +
    Math.max(0, Math.min(1, (position - a[0]) / (b[0] - a[0] || 1))) *
      (b[1] - a[1])
  );
}
function buildDisplayPositionMap() {
  displayPositionMap = null;
  if (!content) return;
  const reference = state.settings,
    target = visualSettings();
  if (
    ["fontSize", "lineHeight", "margin"].every(
      (k) => reference[k] === target[k],
    )
  )
    return;
  const stageTransform = stage.style.transform,
    wrapper = $(".stage-transform"),
    wrapperTransform = wrapper.style.transform;
  stage.style.transform = "none";
  wrapper.style.transform = "none";
  try {
    const referenceTop = ruler.getBoundingClientRect().top,
      targetTop = content.getBoundingClientRect().top;
    const from = document.createTreeWalker(ruler, NodeFilter.SHOW_TEXT),
      to = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const sourceRange = document.createRange(),
      targetRange = document.createRange();
    const points = [[0, 0]];
    function top(range, node, index) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect().top;
    }
    function add(x, y) {
      const last = points[points.length - 1];
      if (Number.isFinite(x) && Number.isFinite(y) && x > last[0] + 0.1)
        points.push([x, Math.max(last[1], y)]);
    }
    let node, match;
    while ((node = from.nextNode()) && (match = to.nextNode())) {
      const length = node.textContent.length;
      if (!node.textContent.trim() || length !== match.textContent.length)
        continue;
      let start = 0;
      while (start < length) {
        const y = top(sourceRange, node, start);
        add(y - referenceTop, top(targetRange, match, start) - targetTop);
        if (top(sourceRange, node, length - 1) <= y + 0.5) break;
        // Find the first character on the next reference line.
        let low = start + 1,
          high = length - 1;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (top(sourceRange, node, middle) > y + 0.5) high = middle;
          else low = middle + 1;
        }
        start = low;
      }
    }
    add(
      ruler.getBoundingClientRect().height,
      content.getBoundingClientRect().height,
    );
    displayPositionMap = points;
  } finally {
    stage.style.transform = stageTransform;
    wrapper.style.transform = wrapperTransform;
  }
}
