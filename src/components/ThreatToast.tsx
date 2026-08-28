import { useEffect, useState } from 'react';
import { ShieldAlert, TriangleAlert, X } from 'lucide-react';

export type ThreatLevel = 'warning' | 'critical';

type ThreatToastProps = {
  level: ThreatLevel;
  message: string;
  onClose: () => void;
};

export default function ThreatToast({ level, message, onClose }: ThreatToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`threat-toast ${level} ${visible ? 'toast-visible' : ''}`}>
      <div className="toast-icon">
        {level === 'critical' ? <ShieldAlert size={22} /> : <TriangleAlert size={20} />}
      </div>
      <div className="toast-body">
        <strong>{level === 'critical' ? 'Critical Threat Detected' : 'Elevated Risk Warning'}</strong>
        <span>{message}</span>
      </div>
      <button className="toast-close" onClick={() => { setVisible(false); setTimeout(onClose, 300); }} aria-label="Dismiss">
        <X size={16} />
      </button>
      <div className="toast-progress">
        <i className={level} />
      </div>
    </div>
  );
}
