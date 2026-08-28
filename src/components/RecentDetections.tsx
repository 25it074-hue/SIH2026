import { useEffect, useState } from 'react';
import { Activity, Check, ShieldCheck, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DetectionRecord = {
  id: string;
  caller_label: string;
  call_context: string;
  duration_seconds: number;
  risk_score: number;
  verdict: string;
  created_at: string;
};

const VERDICT_META: Record<string, { label: string; color: string; icon: typeof Check }> = {
  authentic: { label: 'Verified', color: 'safe', icon: Check },
  suspicious: { label: 'Suspicious', color: 'warning', icon: TriangleAlert },
  impersonation: { label: 'Impersonation', color: 'alert', icon: TriangleAlert },
  pending: { label: 'Pending', color: 'neutral', icon: Activity },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function RecentDetections() {
  const [records, setRecords] = useState<DetectionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchRecords = async () => {
      const { data } = await supabase
        .from('call_analyses')
        .select('id, caller_label, call_context, duration_seconds, risk_score, verdict, created_at')
        .order('created_at', { ascending: false })
        .limit(6);

      if (!cancelled) {
        setRecords(data ?? []);
        setLoading(false);
      }
    };

    fetchRecords();
    const interval = setInterval(fetchRecords, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section id="detections" className="section detections-section">
      <div className="section-heading centered">
        <div className="eyebrow"><span className="eyebrow-dot" />Live activity feed</div>
        <h2>Recent <em>detections.</em></h2>
        <p>Every analysis is logged in real time. Here are the most recent voice checks run through VoiceGuard.</p>
      </div>
      <div className="detections-table">
        <div className="detections-header">
          <span>Caller</span>
          <span>Context</span>
          <span>Duration</span>
          <span>Risk</span>
          <span>Verdict</span>
          <span>When</span>
        </div>
        {loading && records.length === 0 ? (
          <div className="detections-loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="detection-row-skeleton" key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <span className="skeleton-bar" key={j} style={{ width: `${40 + ((i * 17 + j * 23) % 50)}%` }} />
                ))}
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="detections-empty">
            <ShieldCheck size={32} />
            <p>No detections yet. Run a live detection or upload a sample to see results here.</p>
          </div>
        ) : (
          records.map((rec) => {
            const meta = VERDICT_META[rec.verdict] ?? VERDICT_META.pending;
            const Icon = meta.icon;
            return (
              <div className="detection-row" key={rec.id}>
                <span className="det-caller">{rec.caller_label}</span>
                <span className="det-context">{rec.call_context}</span>
                <span className="det-duration">{rec.duration_seconds}s</span>
                <span className="det-risk">
                  <div className="det-risk-bar">
                    <i style={{ width: `${rec.risk_score}%` }} className={meta.color} />
                  </div>
                  {rec.risk_score}
                </span>
                <span className={`det-verdict ${meta.color}`}>
                  <Icon size={14} /> {meta.label}
                </span>
                <span className="det-time">{timeAgo(rec.created_at)}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
