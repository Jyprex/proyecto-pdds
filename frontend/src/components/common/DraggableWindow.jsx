import React, { useState, useRef, useEffect } from 'react';

export default function DraggableWindow({ 
  title, 
  children, 
  onClose, 
  initialPosition = { x: 50, y: 50 },
  defaultSize = { width: 400, height: "auto" },
  isActive = false,
  onFocus
}) {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });

  const handleMouseDown = (e) => {
    if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
    setIsDragging(true);
    if (onFocus) onFocus();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(0, dragRef.current.initialX + dx),
        y: Math.max(0, dragRef.current.initialY + dy)
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      onClick={onFocus}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: defaultSize.width,
        height: defaultSize.height,
        minWidth: 300,
        background: 'rgba(30, 41, 59, 0.85)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${isActive ? 'rgba(96, 165, 250, 0.8)' : 'rgba(255, 255, 255, 0.15)'}`,
        borderRadius: '8px',
        boxShadow: isActive ? '0 10px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(96,165,250,0.4)' : '0 10px 25px rgba(0,0,0,0.5)',
        zIndex: isActive ? 1000 : 900,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        resize: 'both',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          padding: '8px 12px',
          background: isActive ? 'rgba(51, 65, 85, 0.9)' : 'rgba(51, 65, 85, 0.5)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none'
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 'bold', color: isActive ? '#93c5fd' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          ✕
        </button>
      </div>
      <div className="draggable-content-wrapper" style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {children}
      </div>
    </div>
  );
}
