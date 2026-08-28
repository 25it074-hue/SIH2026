import { useEffect, useRef } from 'react';

type TimelinePoint = {
  time: number;
  risk: number;
};

type RiskTimelineProps = {
  points: TimelinePoint[];
  live: boolean;
  height?: number;
};

export default function RiskTimeline({ points, live, height = 80 }: RiskTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (points.length < 2) return;

      const maxPoints = 120;
      const visible = points.slice(-maxPoints);
      const stepX = w / (maxPoints - 1);
      const offsetX = (maxPoints - visible.length) * stepX;

      // Threshold zones
      const zoneHeight = h;
      // High risk zone (50+)
      ctx.fillStyle = 'rgba(255,142,89,0.06)';
      ctx.fillRect(0, 0, w, zoneHeight * 0.5);
      // Safe zone (below 50) — no fill needed, just the threshold line

      // Threshold lines
      ctx.strokeStyle = 'rgba(255,142,89,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zoneHeight * 0.5);
      ctx.lineTo(w, zoneHeight * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Build path
      const pathPoints = visible.map((p, i) => ({
        x: offsetX + i * stepX,
        y: h - (p.risk / 100) * h,
      }));

      // Fill area under curve
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      if (live) {
        gradient.addColorStop(0, 'rgba(31,213,164,0.25)');
        gradient.addColorStop(1, 'rgba(31,213,164,0)');
      } else {
        gradient.addColorStop(0, 'rgba(141,165,168,0.15)');
        gradient.addColorStop(1, 'rgba(141,165,168,0)');
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(pathPoints[0].x, h);
      pathPoints.forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.lineTo(pathPoints[pathPoints.length - 1].x, h);
      ctx.closePath();
      ctx.fill();

      // Stroke line
      const lastRisk = visible[visible.length - 1].risk;
      ctx.strokeStyle = lastRisk >= 70 ? '#ff8e59' : lastRisk >= 50 ? '#ffcc44' : '#1fd5a4';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pathPoints.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      // Glow dot at the end
      const last = pathPoints[pathPoints.length - 1];
      ctx.fillStyle = lastRisk >= 70 ? '#ff8e59' : lastRisk >= 50 ? '#ffcc44' : '#1fd5a4';
      ctx.shadowColor = ctx.fillStyle as string;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      canvas.width = parent.clientWidth;
      canvas.height = height;
      draw();
    };

    resize();
    window.addEventListener('resize', resize);
    rafRef.current = requestAnimationFrame(function loop() {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    });

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [points, live, height]);

  return (
    <div className="risk-timeline-wrap">
      <canvas ref={canvasRef} className="risk-timeline-canvas" />
      <div className="timeline-labels">
        <span>100</span>
        <span>0</span>
      </div>
    </div>
  );
}
