"use client";

import React, { useRef, useState, useCallback } from 'react';
import { playPress } from '../../utils/sounds';

export interface TactileCardProps {
  children: React.ReactNode;
  rarity?: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | string;
  onClick?: () => void;
  className?: string;
  maxTiltAngle?: number;
  interactive?: boolean;
}

export function TactileCard({
  children,
  rarity = 'common',
  onClick,
  className = '',
  maxTiltAngle = 14,
  interactive = true,
}: TactileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || !cardRef.current) return;

      const rect = cardRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      const rotateY = (x - 0.5) * maxTiltAngle * 2;
      const rotateX = (0.5 - y) * maxTiltAngle * 2;

      setTilt({ rotateX, rotateY });
      setMousePos({ x: x * 100, y: y * 100 });
    },
    [interactive, maxTiltAngle]
  );

  const handleMouseEnter = () => {
    if (!interactive) return;
    setIsHovered(true);
    playPress(1200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({ rotateX: 0, rotateY: 0 });
  };

  const handleClick = () => {
    if (onClick) {
      playPress(900);
      onClick();
    }
  };

  const getRarityShader = () => {
    switch (rarity.toLowerCase()) {
      case 'rare':
        return 'holo-foil-rare border-[#388bfd]/40';
      case 'epic':
        return 'holo-foil-epic border-[#a371f7]/50';
      case 'legendary':
      case 'mythic':
        return 'holo-foil-legendary border-[#d29922]/60';
      default:
        return 'border-white/10';
    }
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={
        {
          '--mouse-x': `${mousePos.x}%`,
          '--mouse-y': `${mousePos.y}%`,
          transform: isHovered
            ? `perspective(1000px) rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`
            : 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
        } as React.CSSProperties
      }
      className={`holo-card relative rounded-2xl overflow-hidden border bg-[#131722] cursor-pointer transition-transform duration-100 ease-out select-none ${getRarityShader()} ${className}`}
    >
      {/* Specular sheen layer */}
      <div className="holo-sheen" />

      {/* Card contents */}
      <div className="holo-card-inner relative z-10 w-full h-full">
        {children}
      </div>
    </div>
  );
}
