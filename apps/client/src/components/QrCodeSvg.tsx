import React, { useMemo } from 'react';
import { encodeQrCode } from '../utils/qrCode.js';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  className?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 136,
  className,
}) => {
  const qr = useMemo(() => {
    try {
      return encodeQrCode(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!qr) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
          color: '#333',
          background: '#fff',
          borderRadius: 10,
        }}
      >
        二维码生成失败
      </div>
    );
  }

  const quiet = 3;
  const viewSize = qr.size + quiet * 2;
  const pathParts: string[] = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        pathParts.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`局域网邀请二维码 ${value}`}
    >
      <rect width={viewSize} height={viewSize} fill="#ffffff" rx="2" />
      <path d={pathParts.join('')} fill="#0b1f18" />
    </svg>
  );
};
