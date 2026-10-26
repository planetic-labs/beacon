import { useEffect, useRef, useState } from "react";

// Draw decoded pixels instead of using a user-selected file URL as an HTML source.
export function PhotoThumbnail({ file, index }: { file: File; index: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    const target = canvas.current;
    const context = target?.getContext("2d");
    if (!target || !context || typeof createImageBitmap === "undefined") { setFailed(true); return; }
    context.clearRect(0, 0, 128, 128);
    target.dataset.ready = "false";
    void createImageBitmap(file).then(bitmap => {
      try {
        if (!live) return;
        const side = Math.min(bitmap.width, bitmap.height);
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
        target.dataset.ready = "true";
      } finally { bitmap.close(); }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [file]);
  return <><canvas ref={canvas} width={128} height={128} role="img" aria-label={`Фото к отправке ${index + 1}`} hidden={failed} />{failed && <span>Фото {index + 1}</span>}</>;
}
