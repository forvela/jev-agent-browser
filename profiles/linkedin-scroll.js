(() => {
  const toolConfig = globalThis.__JEV_TOOL_CONFIG__ || {};
  const configured = Number(toolConfig.amount ?? globalThis.__LI_SCROLL_PX__);
  const ratio = Number(toolConfig.amountRatio);
  const configuredScroll = document.querySelector('#workspace, #feed') || document.scrollingElement;
  const amount = Number.isFinite(configured) && configured > 0
    ? configured
    : Number.isFinite(ratio) && ratio > 0
      ? Math.max(1, Math.floor((configuredScroll?.clientHeight || 800) * ratio))
      : 360;
  const node = document.querySelector('#workspace, #feed');
  const scroll = node && node.scrollHeight > node.clientHeight ? node : document.scrollingElement;
  if (!scroll) return { ok: false, reason: 'scroll container not found' };
  const before = Math.round(scroll.scrollTop);
  scroll.scrollBy({ top: amount, behavior: 'instant' });
  const after = Math.round(scroll.scrollTop);
  return { ok: true, moved: after !== before, atEnd: after >= scroll.scrollHeight - scroll.clientHeight, before, after, amount };
})()
