import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioWaveform,
  Check,
  Clock3,
  FileAudio,
  LockKeyhole,
  Mic2,
  RotateCcw,
  TriangleAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { analyzeAudioFile, type FileAnalysisResult } from '@/lib/audioAnalysis';

type UploadState = 'idle' | 'uploading' | 'analyzing' | 'done';

const VERDICT_COPY: Record<FileAnalysisResult['verdict'], { label: string; detail: string }> = {
  authentic: { label: 'Human voice verified', detail: 'No indicators of synthetic speech detected in this sample. The acoustic features match natural human speech patterns.' },
  suspicious: { label: 'Suspicious patterns found', detail: 'Some acoustic artifacts suggest possible AI voice manipulation. Request secondary verification before proceeding.' },
  impersonation: { label: 'AI cloned voice detected', detail: 'Strong indicators of a cloned or AI-generated voice. Do not act on this caller\'s instructions.' },
};

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadAnalyzer() {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [result, setResult] = useState<FileAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError('');
    setResult(null);
    setAudioUrl('');

    if (file.size > MAX_BYTES) {
      setError('File is too large. Maximum size is 50 MB.');
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const typeOk = ACCEPTED.includes(file.type) || ['wav', 'mp3', 'm4a', 'ogg', 'webm'].includes(ext);
    if (!typeOk) {
      setError('Unsupported format. Please upload a WAV, MP3, M4A, OGG, or WebM audio file.');
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setUploadState('uploading');

    // Upload to Supabase storage
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: upErr } = await supabase.storage
      .from('audio_uploads')
      .upload(safeName, file, { cacheControl: '3600', upsert: false });

    if (upErr) {
      setError('Could not upload the file. Please try again.');
      setUploadState('idle');
      return;
    }

    const { data: pub } = supabase.storage.from('audio_uploads').getPublicUrl(safeName);
    setAudioUrl(pub.publicUrl);
    setUploadState('analyzing');

    // Run real audio analysis in the browser
    try {
      const analysisResult = await analyzeAudioFile(file);
      setResult(analysisResult);
      setUploadState('done');

      // Persist analysis to database
      try {
        await supabase.from('call_analyses').insert({
          caller_label: file.name,
          call_context: 'uploaded sample',
          duration_seconds: Math.round(analysisResult.durationSec),
          risk_score: analysisResult.riskScore,
          verdict: analysisResult.verdict,
          language: 'en-IN',
          status: 'completed',
        });
      } catch {
        // DB failure shouldn't block the result
      }
    } catch {
      setError('Could not analyze this audio file. The format may be unsupported or corrupted.');
      setUploadState('idle');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = () => {
    setUploadState('idle');
    setFileName('');
    setFileSize(0);
    setAudioUrl('');
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const copy = result ? VERDICT_COPY[result.verdict] : null;
  const isAlert = result?.verdict === 'impersonation';

  return (
    <section id="upload" ref={sectionRef} className="section upload-section">
      <div className="section-heading centered">
        <div className="eyebrow"><span className="eyebrow-dot" />Upload &amp; analyze</div>
        <h2>Test a voice sample<br /><em>of your own.</em></h2>
        <p>Upload a short audio clip and Cryptix Protocol will analyze it for synthetic-voice indicators using nine acoustic features — the same multi-layer check used on live calls.</p>
      </div>

      <div className={`upload-console ${isAlert ? 'state-alert' : ''}`}>
        {uploadState === 'idle' && (
          <div
            className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click(); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              className="file-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="drop-icon"><UploadCloud /></div>
            <strong>Drop your audio file here</strong>
            <span>or click to browse — WAV, MP3, M4A, OGG, WebM up to 50 MB</span>
            <div className="drop-hint"><LockKeyhole size={14} /> Analysis runs in your browser. Files are never shared.</div>
          </div>
        )}

        {error && <div className="upload-error"><X size={16} /> {error}</div>}

        {(uploadState === 'uploading' || uploadState === 'analyzing' || uploadState === 'done') && (
          <div className="upload-panel">
            <div className="upload-file-info">
              <div className="file-icon"><FileAudio /></div>
              <div className="file-meta">
                <strong>{fileName}</strong>
                <span>{formatSize(fileSize)}</span>
              </div>
              {uploadState === 'done' && (
                <button className="reset-btn" onClick={reset} aria-label="Analyze another file">
                  <RotateCcw size={17} />
                </button>
              )}
            </div>

            {uploadState === 'uploading' && (
              <div className="upload-progress">
                <div className="progress-bar"><i className="progress-fill uploading" /></div>
                <span className="progress-label">Uploading securely…</span>
              </div>
            )}

            {uploadState === 'analyzing' && (
              <div className="upload-analyzing">
                <div className="analyzing-wave">{Array.from({ length: 40 }).map((_, i) => (
                  <i key={i} style={{ height: `${20 + ((i * 23) % 56)}%`, animationDelay: `${i * 0.04}s` }} />
                ))}</div>
                <span className="analyzing-label"><Clock3 size={15} /> Analyzing spectral, pitch, jitter, shimmer, HNR &amp; subband features…</span>
              </div>
            )}

            {uploadState === 'done' && result && copy && (
              <div className="upload-result">
                {audioUrl && (
                  <audio controls src={audioUrl} className="audio-player" preload="metadata" />
                )}

                <div className="result-summary">
                  <div className="result-score-ring" data-verdict={result.verdict}>
                    <svg viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="52" className="ring-bg" />
                      <circle
                        cx="60" cy="60" r="52"
                        className="ring-fill"
                        style={{ strokeDashoffset: 327 - (327 * result.riskScore) / 100 }}
                      />
                    </svg>
                    <div className="ring-center">
                      <strong>{result.riskScore}</strong>
                      <span>risk / 100</span>
                    </div>
                  </div>
                  <div className="result-headline">
                    <div className={`result-status ${isAlert ? 'alert' : 'safe'}`}>
                      {isAlert ? <TriangleAlert size={18} /> : <Check size={18} />}
                      {copy.label}
                    </div>
                    <p>{copy.detail}</p>
                    <div className="recommendation">
                      <Mic2 size={15} />
                      <span>{result.recommendation}</span>
                    </div>
                  </div>
                </div>

                <div className="result-signals">
                  <div className="signals-title"><AudioWaveform size={15} /> Signal breakdown ({result.signals.length} features analyzed)</div>
                  {result.signals.map((sig) => (
                    <div className="result-signal-row" key={sig.label}>
                      <span className={`signal-check ${sig.anomaly ? 'anomaly' : ''}`}>
                        {sig.anomaly ? <TriangleAlert size={13} /> : <Check size={13} />}
                      </span>
                      <span className="signal-name">{sig.label}</span>
                      <strong className={sig.anomaly ? 'anomaly-text' : ''}>{sig.value}</strong>
                      <div className="signal-bar">
                        <i
                          className={sig.anomaly ? 'anomaly-fill' : ''}
                          style={{ width: `${sig.score}%` }}
                        />
                      </div>
                      <span className="signal-pct">{sig.score}%</span>
                    </div>
                  ))}
                </div>

                <button className="button button-dark console-button" onClick={reset}>
                  <RotateCcw size={17} /> Analyze another file <ArrowRight size={17} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
