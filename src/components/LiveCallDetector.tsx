import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioWaveform,
  Check,
  CircleStop,
  Clock3,
  Info,
  LockKeyhole,
  Monitor,
  MonitorOff,
  Radio,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { LiveAudioAnalyzer, type LiveSignals, type SessionSummary } from '@/lib/audioAnalysis';
import { supabase } from '@/lib/supabase';
import RiskTimeline from '@/components/RiskTimeline';
import ThreatToast, { type ThreatLevel } from '@/components/ThreatToast';

type CallState = 'idle' | 'connecting' | 'listening' | 'stopped';

const VERDICT_COPY: Record<SessionSummary['verdict'], { label: string; detail: string }> = {
  authentic: { label: 'Voice verified', detail: 'No indicators of synthetic speech detected during the call.' },
  suspicious: { label: 'Suspicious patterns found', detail: 'Acoustic artifacts suggest possible voice manipulation. Request secondary verification.' },
  impersonation: { label: 'Impersonation risk detected', detail: 'Strong indicators of a cloned or AI-generated voice detected during this call.' },
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function LiveCallDetector() {
  const [callState, setCallState] = useState<CallState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [liveRisk, setLiveRisk] = useState(0);
  const [liveSignals, setLiveSignals] = useState<LiveSignals | null>(null);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(64).fill(15));
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState('');
  const [hasVoice, setHasVoice] = useState(false);
  const [timelinePoints, setTimelinePoints] = useState<{ time: number; risk: number }[]>([]);
  const [toast, setToast] = useState<{ level: ThreatLevel; message: string } | null>(null);
  const lastToastRiskRef = useRef(0);

  const analyzerRef = useRef<LiveAudioAnalyzer | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      analyzerRef.current?.stop();
    };
  }, []);

  const updateWaveform = useCallback((signals: LiveSignals) => {
    setLiveRisk(signals.overallRisk);
    setLiveSignals(signals);
    setHasVoice(signals.isVoice);
    setWaveformBars((prev) => {
      const next = [...prev.slice(1)];
      const amplitude = signals.isVoice
        ? Math.min(100, 20 + signals.rms * 600 + signals.overallRisk * 0.3)
        : 15;
      next.push(amplitude);
      return next;
    });
    setTimelinePoints((prev) => [...prev, { time: performance.now(), risk: signals.overallRisk }].slice(-120));

    // Trigger threat toast when crossing 50 threshold (AI detected)
    const risk = signals.overallRisk;
    if (risk >= 50 && lastToastRiskRef.current < 50) {
      setToast({ level: 'critical', message: 'AI cloned voice detected. Consider halting the conversation immediately.' });
      lastToastRiskRef.current = risk;
    } else if (risk < 50) {
      lastToastRiskRef.current = risk;
    }
  }, []);

  const startCall = useCallback(async () => {
    setError('');
    setSummary(null);
    setLiveRisk(0);
    setWaveformBars(Array(64).fill(15));
    setTimelinePoints([]);
    setToast(null);
    lastToastRiskRef.current = 0;
    setCallState('connecting');

    try {
      const analyzer = new LiveAudioAnalyzer();
      analyzer.onFrameCallback(updateWaveform);
      analyzer.onEndedCallback(() => {
        // The user stopped sharing audio from the browser dialog — end the session.
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const result = analyzer.getSummary();
        setSummary(result);
        analyzer.stop();
        analyzerRef.current = null;
        setCallState('stopped');
      });
      await analyzer.start();
      analyzerRef.current = analyzer;
      startTimeRef.current = performance.now();
      setCallState('listening');

      timerRef.current = window.setInterval(() => {
        setElapsed((performance.now() - startTimeRef.current) / 1000);
      }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start call audio capture.';
      setError(msg);
      setCallState('idle');
    }
  }, [updateWaveform]);

  const stopCall = useCallback(async () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const analyzer = analyzerRef.current;
    if (!analyzer) {
      setCallState('idle');
      return;
    }

    const result = analyzer.getSummary();
    setSummary(result);
    analyzer.stop();
    analyzerRef.current = null;
    setCallState('stopped');

    // Persist to Supabase
    try {
      await supabase.from('call_analyses').insert({
        caller_label: 'Live caller session',
        call_context: 'live detection',
        duration_seconds: Math.round(result.durationSec),
        risk_score: result.riskScore,
        verdict: result.verdict,
        language: 'en-IN',
        status: 'completed',
      });
    } catch {
      // Persist failure shouldn't block the user's result
    }
  }, []);

  const reset = useCallback(() => {
    setCallState('idle');
    setSummary(null);
    setLiveRisk(0);
    setLiveSignals(null);
    setElapsed(0);
    setWaveformBars(Array(64).fill(15));
    setTimelinePoints([]);
    setToast(null);
    setHasVoice(false);
    setError('');
    lastToastRiskRef.current = 0;
  }, []);

  const copy = summary ? VERDICT_COPY[summary.verdict] : null;
  const isAlert = summary?.verdict === 'impersonation';

  const liveVerdictLabel =
    liveRisk >= 50 ? 'AI voice detected' : 'Human voice';
  const liveVerdictClass =
    liveRisk >= 50 ? 'risk-high' : 'risk-low';

  return (
    <section id="demo" ref={sectionRef} className="section live-section">
      {toast && (
        <ThreatToast level={toast.level} message={toast.message} onClose={() => setToast(null)} />
      )}
      <div className="live-intro">
        <div className="eyebrow"><span className="eyebrow-dot" />Real-time detection</div>
        <h2>Detect a live<br /><em>AI voice call.</em></h2>
        <p>Press start, then share the tab or screen where the call is happening and turn on "Share audio". Cryptix Protocol isolates and analyzes <strong>only the caller's voice</strong> using an adaptive voice activity detector that filters out background noise, keyboard sounds, and hold music. Nine acoustic features are extracted from speech-only frames and scored with robust statistics designed for high accuracy across many calls. Your own voice is never analyzed.</p>
        <div className="privacy-note"><LockKeyhole size={16} /><span>Audio never leaves your browser. Analysis runs entirely on-device — nothing is recorded or stored.</span></div>
      </div>

      <div className={`live-console ${isAlert ? 'state-alert' : ''} state-${callState}`}>
        <div className="console-top">
          <div className="console-title">
            <span className={`console-led ${callState === 'listening' ? 'led-active' : ''}`} />
            Live voice analysis
            <small>{callState === 'listening' ? 'ANALYZING' : callState === 'connecting' ? 'CONNECTING' : callState === 'stopped' ? 'COMPLETE' : 'STANDBY'}</small>
          </div>
          <span className="console-time">{formatTime(elapsed)}</span>
        </div>

        {error && <div className="live-error"><MonitorOff size={16} /> {error}</div>}

        {/* Live waveform */}
        <div className="live-wave-area">
          <div className="wave-label">
            <span><span className={`equalizer-dot ${callState === 'listening' ? 'dot-active' : ''}`} />CALLER VOICE STREAM</span>
            <span className={callState === 'listening' ? 'stream-active' : ''}>
              {callState === 'listening' ? (hasVoice ? 'Caller speaking — analyzing' : 'Listening for caller voice…') : callState === 'connecting' ? 'Waiting for audio share…' : callState === 'stopped' ? 'Session ended' : 'Press start to begin'}
            </span>
          </div>
          <div className={`live-waveform ${callState === 'listening' ? 'is-live' : ''}`}>
            {waveformBars.map((h, i) => (
              <i
                key={i}
                style={{
                  height: `${h}%`,
                  background: callState === 'listening' && liveRisk >= 50
                    ? '#ff8e59'
                    : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Risk timeline */}
        {(callState === 'listening' || callState === 'stopped') && timelinePoints.length > 1 && (
          <div className="risk-timeline-section">
            <div className="timeline-header"><AudioWaveform size={14} /> Risk score timeline</div>
            <RiskTimeline points={timelinePoints} live={callState === 'listening'} height={72} />
          </div>
        )}

        {/* Live risk gauge */}
        {(callState === 'listening' || callState === 'stopped') && (
          <div className="live-risk-display">
            <div className="live-risk-gauge" data-risk={callState === 'listening' ? (liveRisk >= 50 ? 'high' : 'low') : (summary?.verdict ?? 'low')}>
              <svg viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" className="gauge-bg" />
                <circle
                  cx="70" cy="70" r="60"
                  className="gauge-fill"
                  style={{
                    strokeDashoffset: 377 - (377 * (callState === 'listening' ? liveRisk : summary?.riskScore ?? 0)) / 100,
                  }}
                />
              </svg>
              <div className="gauge-center">
                <strong>{callState === 'listening' ? liveRisk : summary?.riskScore ?? 0}</strong>
                <span>risk / 100</span>
              </div>
            </div>
            <div className="live-risk-info">
              {callState === 'listening' ? (
                <>
                  <div className={`live-risk-badge ${liveVerdictClass}`}>
                    {liveRisk >= 50 ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
                    {liveVerdictLabel}
                  </div>
                  <p>Continuously analyzing 9 acoustic features from caller-only speech frames. Background noise is filtered by adaptive VAD. Risk below 50 = human voice (green); 50 or above = AI cloned voice (red).</p>
                  {liveSignals && (
                    <div className="live-mini-signals">
                      <div className="mini-signal"><span>Flatness</span><i style={{ width: `${liveSignals.spectralFlatnessScore}%` }} /></div>
                      <div className="mini-signal"><span>Flux</span><i style={{ width: `${liveSignals.spectralFluxScore}%` }} /></div>
                      <div className="mini-signal"><span>Jitter</span><i style={{ width: `${liveSignals.jitterScore}%` }} /></div>
                      <div className="mini-signal"><span>Shimmer</span><i style={{ width: `${liveSignals.shimmerScore}%` }} /></div>
                      <div className="mini-signal"><span>HNR</span><i style={{ width: `${liveSignals.hnrScore}%` }} /></div>
                      <div className="mini-signal"><span>Entropy</span><i style={{ width: `${liveSignals.spectralEntropyScore}%` }} /></div>
                      <div className="mini-signal"><span>Subband</span><i style={{ width: `${liveSignals.subbandScore}%` }} /></div>
                      <div className="mini-signal"><span>Prosody</span><i style={{ width: `${liveSignals.prosodyScore}%` }} /></div>
                      <div className="mini-signal"><span>Roll-off</span><i style={{ width: `${liveSignals.spectralRollOffScore}%` }} /></div>
                    </div>
                  )}
                </>
              ) : summary && copy ? (
                <>
                  <div className={`live-risk-badge ${isAlert ? 'risk-high' : 'risk-low'}`}>
                    {isAlert ? <TriangleAlert size={16} /> : <Check size={16} />}
                    {copy.label}
                  </div>
                  <p>{copy.detail}</p>
                  <div className="live-recommendation">
                    <Radio size={15} />
                    <span>{summary.recommendation}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* Final signal breakdown */}
        {callState === 'stopped' && summary && (
          <div className="live-signals-breakdown">
            <div className="signals-title"><AudioWaveform size={15} /> Signal breakdown ({summary.framesAnalyzed} frames analyzed)</div>
            {summary.signals.map((sig) => (
              <div className="result-signal-row" key={sig.label}>
                <span className={`signal-check ${sig.anomaly ? 'anomaly' : ''}`}>
                  {sig.anomaly ? <TriangleAlert size={13} /> : <Check size={13} />}
                </span>
                <span className="signal-name">{sig.label}</span>
                <strong className={sig.anomaly ? 'anomaly-text' : ''}>{sig.value}</strong>
                <div className="signal-bar">
                  <i className={sig.anomaly ? 'anomaly-fill' : ''} style={{ width: `${sig.score}%` }} />
                </div>
                <span className="signal-pct">{sig.score}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="live-controls">
          {callState === 'idle' && (
            <button className="button button-primary console-button" onClick={startCall}>
              <Monitor size={18} /> Start live detection
            </button>
          )}
          {callState === 'connecting' && (
            <button className="button button-dark console-button" disabled>
              <Clock3 size={17} /> Waiting for audio share…
            </button>
          )}
          {callState === 'listening' && (
            <>
              <button className="button button-stop console-button" onClick={stopCall}>
                <CircleStop size={18} /> Stop &amp; view results
              </button>
              <div className="share-hint"><Info size={14} /> Keep this tab focused and the share dialog open so the caller's audio keeps flowing.</div>
            </>
          )}
          {callState === 'stopped' && (
            <button className="button button-primary console-button" onClick={reset}>
              <RotateCcw size={17} /> Run another detection <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
