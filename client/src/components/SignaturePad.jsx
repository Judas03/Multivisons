import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

/** Canvas signature capture (mouse, touch, pen). Exposes isEmpty(), clear(), toDataURL(). */
const SignaturePad = forwardRef(function SignaturePad({ onChange }, ref) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b2b2c';
  }, []);

  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    canvas.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    const ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  };
  const move = (e) => {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    const ctx = canvas.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) {
      dirty.current = true;
      onChange?.(false);
    }
  };
  const up = () => { drawing.current = false; };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !dirty.current,
    toDataURL: () => canvas.current.toDataURL('image/png'),
    clear: () => {
      const c = canvas.current;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      dirty.current = false;
      onChange?.(true);
    },
  }));

  return (
    <canvas
      ref={canvas}
      className="sigpad"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label="Signature drawing area"
    />
  );
});

export default SignaturePad;
