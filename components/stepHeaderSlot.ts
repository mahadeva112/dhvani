import { useEffect, useState } from 'react';

/** The place in the app bar where the step on screen puts its own buttons (ProHeader renders it). */
export const STEP_HEADER_SLOT_ID = 'step-header-slot';

/** The app bar's slot for a step's buttons, once it is on the page; null where there is no app bar. */
export function useStepHeaderSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(STEP_HEADER_SLOT_ID));
  }, []);
  return slot;
}
