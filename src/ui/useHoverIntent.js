import { useCallback, useEffect, useRef, useState } from 'react'
import { HOVER_GRACE_MS, HOVER_INTENT_MS } from './motion'

// Hover intent for a set of things that open and close (panels, drawers): the pointer must rest on a trigger for
// HOVER_INTENT_MS before `on[id]` turns true; after it leaves both the trigger and the thing itself, it turns false once
// HOVER_GRACE_MS pass without the pointer coming back. `canHide(id)` can veto the hide (a drag, a text box in use): the
// check repeats until it allows. Both the trigger and the panel call enter(id) / leave(id), so there is no gap between them.
export function useHoverIntent({ canHide } = {}) {
  const [on, setOn] = useState({})
  const intent = useRef({})
  const grace = useRef({})
  const ok = useRef(canHide)
  ok.current = canHide
  const set = useCallback((id, v) => setOn(o => (!!o[id] === v ? o : { ...o, [id]: v })), [])
  const clear = id => { clearTimeout(intent.current[id]); clearTimeout(grace.current[id]) }
  const enter = useCallback(id => {
    clearTimeout(grace.current[id])
    clearTimeout(intent.current[id])
    intent.current[id] = setTimeout(() => set(id, true), HOVER_INTENT_MS)
  }, [set])
  // already open: re-entering cancels the pending hide at once, with no new dwell
  const hold = useCallback(id => { clearTimeout(grace.current[id]) }, [])
  const leave = useCallback(id => {
    clearTimeout(intent.current[id])
    clearTimeout(grace.current[id])
    const tick = () => { if (ok.current && !ok.current(id)) grace.current[id] = setTimeout(tick, 300); else set(id, false) }
    grace.current[id] = setTimeout(tick, HOVER_GRACE_MS)
  }, [set])
  const show = useCallback(id => { clear(id); set(id, true) }, [set])
  const hide = useCallback(id => { clear(id); set(id, false) }, [set])
  useEffect(() => () => { Object.keys({ ...intent.current, ...grace.current }).forEach(clear) }, [])
  return { on, enter, hold, leave, show, hide }
}
