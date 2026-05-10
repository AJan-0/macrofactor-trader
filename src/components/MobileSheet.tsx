import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function MobileSheet({ open, onClose, title, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    if (diff > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${diff}px)`;
    }
  };

  const handleTouchEnd = () => {
    const diff = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = "";
    }
    if (diff > 100) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-[60] flex flex-col justify-end">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet 内容 */}
      <div
        ref={sheetRef}
        className="relative bg-[#111827] rounded-t-xl border-t border-[#1e293b] max-h-[85vh] flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* 拖动指示条 */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-[#475569] rounded-full" />
        </div>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e293b]">
          <span className="text-[13px] font-bold text-[#e2e8f0]">{title}</span>
          <button
            onClick={onClose}
            className="text-[16px] text-[#475569] hover:text-[#e2e8f0] w-8 h-8 flex items-center justify-center"
          >
            ✕
          </button>
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
