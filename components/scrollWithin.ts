/**
 * Brings an element into view inside the list that scrolls it, and only
 * there: unlike scrollIntoView, the page itself never moves, so the player
 * above a list stays where the user clicked it. Does nothing when the element
 * has no scrolling list around it.
 */
export const scrollWithin = (el: Element | null | undefined, block: 'nearest' | 'center' = 'nearest', smooth = false) => {
  if (!el) return;
  let box = el.parentElement;
  while (box && box !== document.body) {
    const { overflowY } = getComputedStyle(box);
    if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return;
  const boxRect = box.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const top = rect.top - boxRect.top + box.scrollTop;
  let next: number;
  if (block === 'center') next = top - (box.clientHeight - rect.height) / 2;
  else if (rect.top < boxRect.top) next = top;
  else if (rect.bottom > boxRect.bottom) next = top + rect.height - box.clientHeight;
  else return;
  box.scrollTo({ top: Math.max(0, next), behavior: smooth ? 'smooth' : 'auto' });
};
