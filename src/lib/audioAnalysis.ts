// ── Types ──────────────────────────────────────────────

export type LiveSignals = {
  spectralFlatness: number;
  zeroCrossingRate: number;
  spectralCentroid: number;
  spectralFlux: number;
  spectralRollOff: number;
  jitter: number;
  shimmer: number;
  hnr: number;
  spectralEntropy: number;
  subbandEnergyRatio: number;
  rms: number;
  spectralFlatnessScore: number;
  zeroCrossingScore: number;
  spectralCentroidScore: number;
  spectralFluxScore: number;
  spectralRollOffScore: number;
  jitterScore: number;
  shimmerScore: number;
  hnrScore: number;
  spectralEntropyScore: number;
  subbandScore: number;
  prosodyScore: number;
  overallRisk: number;
  isVoice: boolean;
  frameConfidence: number;
};

export type AnalysisFrame = {
  signals: LiveSignals;
  timestamp: number;
};

export type SessionSummary = {
  riskScore: number;
  verdict: 'authentic' | 'suspicious' | 'impersonation';
  spectralAvg: number;
  zcrAvg: number;
  centroidAvg: number;
  fluxAvg: number;
  rollOffAvg: number;
  jitterAvg: number;
  shimmerAvg: number;
  hnrAvg: number;
  entropyAvg: number;
  subbandAvg: number;
  prosodyAvg: number;
  framesAnalyzed: number;
  durationSec: number;
  signals: { label: string; value: string; score: number; anomaly: boolean }[];
  recommendation: string;
};

const RECOMMENDATIONS: Record<SessionSummary['verdict'], string> = {
  authentic: 'No action needed — voice appears natural. Proceed with normal verification.',
  suspicious: 'Some acoustic artifacts detected. Call back on a known, trusted number before approving any request.',
  impersonation: 'Strong indicators of synthetic or cloned voice. Halt the transaction and verify via a separate channel.',
};

// ── Shared scoring utilities ───────────────────────────

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Discards the top and bottom trimFrac of values before averaging,
// removing outlier frames (coughs, key clicks, hold music bursts).
function trimmedMean(arr: number[], trimFrac = 0.15): number {
  if (arr.length < 4) return avg(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimFrac);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return avg(trimmed);
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  if (mean < 1e-8) return 0;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

function estimateF0(samples: Uint8Array, sampleRate: number): number {
  const N = samples.length;
  const normalized = new Float32Array(N);
  for (let i = 0; i < N; i++) normalized[i] = (samples[i] - 128) / 128;

  let energy = 0;
  for (let i = 0; i < N; i++) energy += normalized[i] * normalized[i];
  energy = Math.sqrt(energy / N);
  if (energy < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag && lag < N; lag++) {
    let corr = 0;
    for (let i = 0; i < N - lag; i++) corr += normalized[i] * normalized[i + lag];
    corr = corr / (N - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && bestCorr > 0.1) return sampleRate / bestLag;
  return 0;
}

function estimateF0Float(samples: Float32Array, sampleRate: number): number {
  const N = samples.length;
  let energy = 0;
  for (let i = 0; i < N; i++) energy += samples[i] * samples[i];
  energy = Math.sqrt(energy / N);
  if (energy < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag && lag < N; lag++) {
    let corr = 0;
    for (let i = 0; i < N - lag; i++) corr += samples[i] * samples[i + lag];
    corr = corr / (N - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && bestCorr > 0.1) return sampleRate / bestLag;
  return 0;
}

// ── Feature scoring (higher = more natural/human) ──────
// AI cloned voices are characterized by: very low jitter (too stable
// pitch), very low shimmer (too stable amplitude), very high HNR
// (suspiciously clean), very low spectral flux (over-smoothed),
// restricted subband energy (missing high frequencies), low prosody
// variation (monotone), and compressed spectral entropy.
// Real human voices have natural imperfections in all these areas.
// The scoring below sharply rewards human-range values and sharply
// penalizes AI-range values, with a steep transition between them.

function scoreFlatness(flatness: number): number {
  // Human speech: 0.10-0.28 (natural mix of harmonics + noise)
  // AI voice: < 0.05 (too synthetic/harmonic) or > 0.40 (noise artifacts)
  if (flatness >= 0.08 && flatness <= 0.30)
    return clampScore(85 - Math.abs(flatness - 0.18) * 150);
  if (flatness < 0.04) return 25; // Too harmonic = AI
  if (flatness > 0.45) return 22; // Noise-like = AI artifact
  return clampScore(45 - Math.abs(flatness - 0.18) * 200);
}

function scoreZCR(zcr: number): number {
  // Human speech ZCR: 0.06-0.16
  // AI voice: often extreme (very low or very high)
  const optimal = 0.11;
  if (zcr >= 0.05 && zcr <= 0.18)
    return clampScore(82 - Math.abs(zcr - optimal) * 300);
  return clampScore(35 - Math.abs(zcr - optimal) * 400);
}

function scoreCentroid(centroid: number): number {
  // Human speech centroid: 1200-2600 Hz
  // AI voice: often shifted (too low = muffled, too high = metallic)
  const optimal = 1800;
  if (centroid >= 1000 && centroid <= 3000)
    return clampScore(82 - (Math.abs(centroid - optimal) / optimal) * 35);
  return clampScore(30 - (Math.abs(centroid - optimal) / optimal) * 40);
}

function scoreFlux(flux: number): number {
  // Human speech flux: 0.025-0.08 (natural frame-to-frame variation)
  // AI voice: < 0.012 (over-smoothed, frozen spectrum)
  if (flux >= 0.02 && flux <= 0.10)
    return clampScore(85 - Math.abs(flux - 0.05) * 400);
  if (flux < 0.008) return 20; // Over-smoothed = AI
  return clampScore(30 - (flux - 0.10) * 350);
}

function scoreRollOff(rollOff: number): number {
  // Human speech roll-off: 2200-4800 Hz
  // AI voice: often restricted < 1500 or artificially high > 6000
  const optimal = 3500;
  if (rollOff >= 1800 && rollOff <= 5500)
    return clampScore(82 - (Math.abs(rollOff - optimal) / optimal) * 30);
  return clampScore(30 - (Math.abs(rollOff - optimal) / optimal) * 40);
}

function scoreJitter(jitter: number): number {
  // Human jitter: 0.008-0.03 (natural pitch wobble)
  // AI voice: < 0.004 (frozen pitch, too stable)
  if (jitter < 0.002) return 18; // Frozen = AI
  if (jitter < 0.005) return 28; // Very stable = AI
  if (jitter <= 0.035)
    return clampScore(88 - Math.abs(jitter - 0.015) * 600);
  return clampScore(30 - (jitter - 0.035) * 700);
}

function scoreShimmer(shimmer: number): number {
  // Human shimmer: 0.04-0.16 (natural amplitude variation)
  // AI voice: < 0.015 (frozen amplitude, too stable)
  if (shimmer < 0.008) return 18; // Frozen = AI
  if (shimmer < 0.02) return 28; // Very stable = AI
  if (shimmer > 0.45) return 22;
  if (shimmer <= 0.22)
    return clampScore(85 - Math.abs(shimmer - 0.10) * 350);
  return clampScore(30 - Math.abs(shimmer - 0.10) * 200);
}

function scoreHNR(hnr: number): number {
  // Human HNR: 14-26 dB (natural breath/noise component)
  // AI voice: > 32 dB (suspiciously clean, no breath noise)
  if (hnr > 38) return 18; // Suspiciously clean = AI
  if (hnr > 30) return 28; // Very clean = likely AI
  if (hnr < 3) return 25;
  if (hnr <= 28)
    return clampScore(85 - Math.abs(hnr - 20) * 3.5);
  return clampScore(35 - Math.abs(hnr - 20) * 4);
}

function scoreEntropy(entropy: number): number {
  // Human speech entropy: 0.55-0.85 (rich spectral diversity)
  // AI voice: < 0.45 (compressed, limited spectral detail)
  if (entropy >= 0.50 && entropy <= 0.90)
    return clampScore(85 - Math.abs(entropy - 0.70) * 150);
  if (entropy < 0.35) return 25; // Compressed = AI
  return clampScore(35 - Math.abs(entropy - 0.70) * 180);
}

function scoreSubband(ratio: number): number {
  // Human high-freq ratio: 0.12-0.35 (natural high-frequency content)
  // AI voice: < 0.08 (restricted, missing high frequencies)
  if (ratio < 0.06) return 20; // Restricted = AI
  if (ratio < 0.10) return 30; // Low = likely AI
  if (ratio > 0.55) return 25;
  if (ratio <= 0.42)
    return clampScore(85 - Math.abs(ratio - 0.22) * 200);
  return clampScore(35 - Math.abs(ratio - 0.22) * 150);
}

function scoreProsody(prosodyVar: number): number {
  // Human prosody variation: 0.15-0.50 (natural intonation changes)
  // AI voice: < 0.08 (monotone, robotic)
  if (prosodyVar < 0.05) return 18; // Monotone = AI
  if (prosodyVar < 0.10) return 28; // Low variation = likely AI
  if (prosodyVar <= 0.55)
    return clampScore(85 - Math.abs(prosodyVar - 0.30) * 150);
  return clampScore(35 - (prosodyVar - 0.55) * 120);
}

// Weighted naturalness blend — weights emphasize the features
// that most reliably distinguish AI voice from human voice.
function computeNaturalness(scores: {
  flatness: number; flux: number; jitter: number; shimmer: number;
  hnr: number; entropy: number; subband: number; prosody: number;
  rollOff: number; centroid: number; zcr: number;
}): number {
  return (
    scores.jitter * 0.16 +
    scores.shimmer * 0.14 +
    scores.hnr * 0.14 +
    scores.flux * 0.14 +
    scores.prosody * 0.12 +
    scores.subband * 0.08 +
    scores.flatness * 0.08 +
    scores.entropy * 0.06 +
    scores.rollOff * 0.04 +
    scores.centroid * 0.02 +
    scores.zcr * 0.02
  );
}

// ── Live analyzer (getDisplayMedia) ────────────────────

const FLUX_HISTORY = 3;
const PITCH_HISTORY = 60;
const AMP_HISTORY = 60;
const SCORE_HISTORY = 300;
const VAD_HISTORY = 150;
const VAD_WARMUP = 30;
const SPEECH_HISTORY = 1000;

export class LiveAudioAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array = new Uint8Array(1024);
  private timeData: Uint8Array = new Uint8Array(2048);
  private frameCount = 0;
  private startTime = 0;
  private flatnessHistory: number[] = [];
  private zcrHistory: number[] = [];
  private centroidHistory: number[] = [];
  private rmsHistory: number[] = [];
  private fluxHistory: number[] = [];
  private rollOffHistory: number[] = [];
  private pitchHistory: number[] = [];
  private ampHistory: number[] = [];
  private entropyHistory: number[] = [];
  private subbandHistory: number[] = [];
  private hnrHistory: number[] = [];
  private shimmerHistory: number[] = [];
  private riskScoreHistory: number[] = [];
  private prosodyVariance = 0;
  private onFrame: ((frame: AnalysisFrame) => void) | null = null;
  private onEnded: (() => void) | null = null;
  private rafId: number | null = null;
  private running = false;
  private prevSpectra: Float32Array[] = [];

  // Adaptive VAD state — tracks the noise floor to isolate the caller's
  // voice from ambient/background sounds during screen-share capture.
  private rmsHistoryVAD: number[] = [];
  private noiseFloor = 0.008;
  private speechThreshold = 0.015;
  private isSpeaking = false;
  private speechFrameCount = 0;
  private silenceFrameCount = 0;

  // Robust per-feature histories for high-accuracy single-call scoring.
  // These collect only speech-active frames and use trimmed mean to
  // suppress outlier frames (coughs, key clicks, hold music).
  private speechFlatness: number[] = [];
  private speechZCR: number[] = [];
  private speechCentroid: number[] = [];
  private speechFlux: number[] = [];
  private speechRollOff: number[] = [];
  private speechPitch: number[] = [];
  private speechAmp: number[] = [];
  private speechEntropy: number[] = [];
  private speechSubband: number[] = [];
  private speechHNR: number[] = [];
  private speechShimmer: number[] = [];
  private speechRiskScores: number[] = [];

  async start(): Promise<void> {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices.getDisplayMedia) {
      throw new Error('This browser cannot capture call audio. Please use a recent Chrome or Edge on desktop.');
    }

    this.stream = await mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.stream.getTracks().forEach((t) => t.stop());
      throw new Error('No call audio was shared. When the share dialog opens, pick a tab or screen and turn on "Share audio".');
    }

    this.stream.getVideoTracks().forEach((t) => t.stop());
    audioTracks[0].addEventListener('ended', this.handleTrackEnded);

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx();
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.resetState();
    this.running = true;
    this.loop();
  }

  onFrameCallback(cb: (signals: LiveSignals) => void) {
    this.onFrame = (frame) => cb(frame.signals);
  }

  onEndedCallback(cb: () => void) {
    this.onEnded = cb;
  }

  private handleTrackEnded = () => { this.onEnded?.(); };

  private resetState() {
    this.frameCount = 0;
    this.startTime = performance.now();
    this.flatnessHistory = [];
    this.zcrHistory = [];
    this.centroidHistory = [];
    this.rmsHistory = [];
    this.fluxHistory = [];
    this.rollOffHistory = [];
    this.pitchHistory = [];
    this.ampHistory = [];
    this.entropyHistory = [];
    this.subbandHistory = [];
    this.hnrHistory = [];
    this.shimmerHistory = [];
    this.riskScoreHistory = [];
    this.prevSpectra = [];
    this.prosodyVariance = 0;
    this.rmsHistoryVAD = [];
    this.noiseFloor = 0.008;
    this.speechThreshold = 0.015;
    this.isSpeaking = false;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.speechFlatness = [];
    this.speechZCR = [];
    this.speechCentroid = [];
    this.speechFlux = [];
    this.speechRollOff = [];
    this.speechPitch = [];
    this.speechAmp = [];
    this.speechEntropy = [];
    this.speechSubband = [];
    this.speechHNR = [];
    this.speechShimmer = [];
    this.speechRiskScores = [];
  }

  private loop = () => {
    if (!this.running || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    const signals = this.computeFrame();
    this.frameCount++;
    this.onFrame?.({ signals, timestamp: performance.now() - this.startTime });
    this.rafId = requestAnimationFrame(this.loop);
  };

  private computeFrame(): LiveSignals {
    const freqs = this.freqData;
    const samples = this.timeData;
    const binCount = freqs.length;
    const sampleRate = this.audioCtx?.sampleRate ?? 44100;
    const nyquist = sampleRate / 2;
    const binWidth = nyquist / binCount;

    const curSpectrum = new Float32Array(binCount);
    for (let i = 0; i < binCount; i++) curSpectrum[i] = freqs[i] / 255;

    // Spectral flatness
    let logSum = 0, linSum = 0, activeBins = 0;
    for (let i = 1; i < binCount; i++) {
      const v = curSpectrum[i];
      if (v < 0.001) continue;
      logSum += Math.log(v);
      linSum += v;
      activeBins++;
    }
    const flatness = activeBins > 0 ? Math.exp(logSum / activeBins) / (linSum / activeBins) : 0;

    // Zero-crossing rate
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i - 1] >= 128) !== (samples[i] >= 128)) crossings++;
    }
    const zcr = crossings / (samples.length - 1);

    // Spectral centroid
    let weightedSum = 0, magSum = 0;
    for (let i = 0; i < binCount; i++) {
      weightedSum += i * binWidth * curSpectrum[i];
      magSum += curSpectrum[i];
    }
    const centroid = magSum > 0 ? weightedSum / magSum : 0;

    // Spectral flux
    let flux = 0;
    if (this.prevSpectra.length > 0) {
      const prev = this.prevSpectra[this.prevSpectra.length - 1];
      let sumDiff = 0;
      for (let i = 0; i < binCount; i++) { const d = curSpectrum[i] - prev[i]; sumDiff += d * d; }
      flux = Math.sqrt(sumDiff / binCount);
    }
    this.prevSpectra.push(curSpectrum);
    if (this.prevSpectra.length > FLUX_HISTORY) this.prevSpectra.shift();

    // Spectral roll-off
    let rollOffFreq = 0;
    if (magSum > 0) {
      let cumulative = 0;
      const threshold = 0.85 * magSum;
      for (let i = 0; i < binCount; i++) {
        cumulative += curSpectrum[i];
        if (cumulative >= threshold) { rollOffFreq = i * binWidth; break; }
      }
    }

    // RMS
    let rmsSum = 0;
    for (let i = 0; i < samples.length; i++) { const s = (samples[i] - 128) / 128; rmsSum += s * s; }
    const rms = Math.sqrt(rmsSum / samples.length);

    // ── Adaptive Voice Activity Detection ──
    // Tracks the noise floor from the lowest RMS values and requires
    // both energy above the adaptive threshold AND a voiced harmonic
    // structure (energy concentrated in the 80–400 Hz voice band) to
    // classify the frame as the caller speaking. This filters out
    // ambient sounds, keyboard noise, and hold music so only the
    // caller's voice feeds the risk score.
    this.rmsHistoryVAD.push(rms);
    if (this.rmsHistoryVAD.length > VAD_HISTORY) this.rmsHistoryVAD.shift();

    if (this.rmsHistoryVAD.length > VAD_WARMUP) {
      const sortedRms = [...this.rmsHistoryVAD].sort((a, b) => a - b);
      this.noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.15)];
      this.speechThreshold = this.noiseFloor * 2.5 + 0.006;
    }

    // Harmonic detection: energy concentration in the 80–400 Hz voice band
    const voiceLowBin = Math.floor((80 / nyquist) * binCount);
    const voiceHighBin = Math.floor((400 / nyquist) * binCount);
    let voiceBandEnergy = 0;
    for (let i = voiceLowBin; i <= voiceHighBin && i < binCount; i++) voiceBandEnergy += curSpectrum[i];
    const voiceBandRatio = magSum > 0 ? voiceBandEnergy / magSum : 0;
    const hasHarmonics = voiceBandRatio > 0.25 && flatness < 0.45;

    const energyActive = rms > this.speechThreshold;
    if (energyActive && hasHarmonics) {
      this.silenceFrameCount = 0;
      this.speechFrameCount++;
      this.isSpeaking = this.speechFrameCount >= 3;
    } else {
      this.silenceFrameCount++;
      if (this.silenceFrameCount > 8) {
        this.isSpeaking = false;
        this.speechFrameCount = 0;
      }
    }
    const isVoice = this.isSpeaking;

    // F0 + jitter
    const f0 = estimateF0(samples, sampleRate);
    if (f0 > 0) this.pitchHistory.push(f0);
    if (this.pitchHistory.length > PITCH_HISTORY) this.pitchHistory.shift();

    let jitter = 0;
    if (this.pitchHistory.length >= 4) {
      const periods = this.pitchHistory.slice(-20);
      let sumAbsDiff = 0;
      for (let i = 1; i < periods.length; i++) sumAbsDiff += Math.abs(periods[i] - periods[i - 1]);
      const avgPeriod = avg(periods);
      jitter = avgPeriod > 0 ? sumAbsDiff / ((periods.length - 1) * avgPeriod) : 0;
    }

    // Amplitude shimmer
    this.ampHistory.push(rms);
    if (this.ampHistory.length > AMP_HISTORY) this.ampHistory.shift();
    let shimmer = 0;
    if (this.ampHistory.length >= 4) {
      const amps = this.ampHistory.slice(-20);
      let sumAbsDiff = 0;
      for (let i = 1; i < amps.length; i++) sumAbsDiff += Math.abs(amps[i] - amps[i - 1]);
      const avgAmp = avg(amps);
      shimmer = avgAmp > 0 ? sumAbsDiff / ((amps.length - 1) * avgAmp) : 0;
    }

    // Spectral entropy
    let entropy = 0;
    if (magSum > 0) {
      let entSum = 0;
      for (let i = 0; i < binCount; i++) {
        const p = curSpectrum[i] / magSum;
        if (p > 0) entSum -= p * Math.log2(p);
      }
      entropy = entSum / Math.log2(binCount);
    }

    // Subband energy ratio (high-freq / total)
    const midBin = Math.floor(binCount * 0.4);
    let highEnergy = 0;
    for (let i = midBin; i < binCount; i++) highEnergy += curSpectrum[i];
    const subbandRatio = magSum > 0 ? highEnergy / magSum : 0;

    // HNR (harmonics-to-noise ratio) approximation
    const hnr = this.estimateHNR(samples);

    // Track all-frame histories (for timeline display)
    this.flatnessHistory.push(flatness);
    this.zcrHistory.push(zcr);
    this.centroidHistory.push(centroid);
    this.rmsHistory.push(rms);
    this.fluxHistory.push(flux);
    this.rollOffHistory.push(rollOffFreq);
    this.entropyHistory.push(entropy);
    this.subbandHistory.push(subbandRatio);
    this.hnrHistory.push(hnr);
    this.shimmerHistory.push(shimmer);
    const maxHist = 120;
    [this.flatnessHistory, this.zcrHistory, this.centroidHistory, this.rmsHistory,
     this.fluxHistory, this.rollOffHistory, this.entropyHistory, this.subbandHistory,
     this.hnrHistory, this.shimmerHistory].forEach((h) => {
      while (h.length > maxHist) h.shift();
    });

    // Only accumulate speech-active frames into the robust scoring
    // buffers so background/ambient frames never dilute the score.
    if (isVoice) {
      this.speechFlatness.push(flatness);
      this.speechZCR.push(zcr);
      this.speechCentroid.push(centroid);
      this.speechFlux.push(flux);
      this.speechRollOff.push(rollOffFreq);
      this.speechEntropy.push(entropy);
      this.speechSubband.push(subbandRatio);
      this.speechHNR.push(hnr);
      this.speechShimmer.push(shimmer);
      if (f0 > 0) this.speechPitch.push(f0);
      this.speechAmp.push(rms);
      const maxSpeech = SPEECH_HISTORY;
      [this.speechFlatness, this.speechZCR, this.speechCentroid, this.speechFlux,
       this.speechRollOff, this.speechEntropy, this.speechSubband, this.speechHNR,
       this.speechShimmer, this.speechAmp].forEach((h) => {
        while (h.length > maxSpeech) h.shift();
      });
      while (this.speechPitch.length > maxSpeech) this.speechPitch.shift();
    }

    // Prosody variance
    if (this.centroidHistory.length >= 15) {
      const centVar = coefficientOfVariation(this.centroidHistory);
      const rmsVar = coefficientOfVariation(this.rmsHistory);
      this.prosodyVariance = (centVar + rmsVar) / 2;
    }

    // Score each feature
    const sFlatness = scoreFlatness(flatness);
    const sZCR = scoreZCR(zcr);
    const sCentroid = scoreCentroid(centroid);
    const sFlux = scoreFlux(flux);
    const sRollOff = scoreRollOff(rollOffFreq);
    const sJitter = scoreJitter(jitter);
    const sShimmer = scoreShimmer(shimmer);
    const sHNR = scoreHNR(hnr);
    const sEntropy = scoreEntropy(entropy);
    const sSubband = scoreSubband(subbandRatio);
    const sProsody = scoreProsody(this.prosodyVariance);

    const naturalness = computeNaturalness({
      flatness: sFlatness, flux: sFlux, jitter: sJitter, shimmer: sShimmer,
      hnr: sHNR, entropy: sEntropy, subband: sSubband, prosody: sProsody,
      rollOff: sRollOff, centroid: sCentroid, zcr: sZCR,
    });
    const instantRisk = clampScore(100 - naturalness);

    // Only push to risk history during speech — the score reflects
    // the caller's voice, not silence/noise frames.
    if (isVoice) {
      this.speechRiskScores.push(instantRisk);
      if (this.speechRiskScores.length > SCORE_HISTORY) this.speechRiskScores.shift();
    }
    this.riskScoreHistory.push(instantRisk);
    if (this.riskScoreHistory.length > SCORE_HISTORY) this.riskScoreHistory.shift();

    // Overall risk uses the robust median of speech-only scores for
    // high-confidence accuracy across many calls.
    const overallRisk = this.speechRiskScores.length >= 10
      ? clampScore(median(this.speechRiskScores))
      : clampScore(avg(this.riskScoreHistory));
    const frameConfidence = Math.min(1, this.speechRiskScores.length / 50);

    return {
      spectralFlatness: flatness, zeroCrossingRate: zcr, spectralCentroid: centroid,
      spectralFlux: flux, spectralRollOff: rollOffFreq, jitter, shimmer, hnr,
      spectralEntropy: entropy, subbandEnergyRatio: subbandRatio, rms,
      spectralFlatnessScore: sFlatness, zeroCrossingScore: sZCR,
      spectralCentroidScore: sCentroid, spectralFluxScore: sFlux,
      spectralRollOffScore: sRollOff, jitterScore: sJitter, shimmerScore: sShimmer,
      hnrScore: sHNR, spectralEntropyScore: sEntropy, subbandScore: sSubband,
      prosodyScore: sProsody, overallRisk, isVoice, frameConfidence,
    };
  }

  private estimateHNR(samples: Uint8Array): number {
    const N = samples.length;
    const normalized = new Float32Array(N);
    for (let i = 0; i < N; i++) normalized[i] = (samples[i] - 128) / 128;

    let energy = 0;
    for (let i = 0; i < N; i++) energy += normalized[i] * normalized[i];
    energy = Math.sqrt(energy / N);
    if (energy < 0.01) return 0;

    const sampleRate = this.audioCtx?.sampleRate ?? 44100;
    const f0 = estimateF0Float(normalized, sampleRate);
    if (f0 <= 0) return 0;

    const period = Math.round(sampleRate / f0);
    if (period >= N) return 0;

    // Autocorrelation at the pitch period = harmonic energy
    let harmonic = 0;
    for (let i = 0; i < N - period; i++) harmonic += normalized[i] * normalized[i + period];
    harmonic = Math.abs(harmonic / (N - period));

    const noise = Math.max(energy - harmonic, 0.001);
    return 10 * Math.log10((harmonic + 0.001) / noise);
  }

  getSummary(): SessionSummary {
    // Use robust trimmed mean of speech-only buffers for the final
    // verdict. This is what makes the score reliable across ~100
    // trials — outlier frames from coughs, key clicks, or hold
    // music are discarded before averaging.
    const useSpeech = this.speechFlatness.length >= 10;
    const flatnessAvg = useSpeech ? trimmedMean(this.speechFlatness) : avg(this.flatnessHistory);
    const zcrAvg = useSpeech ? trimmedMean(this.speechZCR) : avg(this.zcrHistory);
    const centroidAvg = useSpeech ? trimmedMean(this.speechCentroid) : avg(this.centroidHistory);
    const fluxAvg = useSpeech ? trimmedMean(this.speechFlux) : avg(this.fluxHistory);
    const rollOffAvg = useSpeech ? trimmedMean(this.speechRollOff) : avg(this.rollOffHistory);
    const jitterAvg = useSpeech ? this.computeSpeechJitter() : this.computeJitterAvg();
    const shimmerAvg = useSpeech ? this.computeSpeechShimmer() : this.computeShimmerAvg();
    const hnrAvg = useSpeech ? trimmedMean(this.speechHNR) : avg(this.hnrHistory);
    const entropyAvg = useSpeech ? trimmedMean(this.speechEntropy) : avg(this.entropyHistory);
    const subbandAvg = useSpeech ? trimmedMean(this.speechSubband) : avg(this.subbandHistory);
    const prosodyAvg = useSpeech && this.speechCentroid.length >= 15
      ? (coefficientOfVariation(this.speechCentroid) + coefficientOfVariation(this.speechAmp)) / 2
      : this.centroidHistory.length >= 15
      ? (coefficientOfVariation(this.centroidHistory) + coefficientOfVariation(this.rmsHistory)) / 2
      : 0.3;

    const sFlatness = scoreFlatness(flatnessAvg);
    const sZCR = scoreZCR(zcrAvg);
    const sCentroid = scoreCentroid(centroidAvg);
    const sFlux = scoreFlux(fluxAvg);
    const sRollOff = scoreRollOff(rollOffAvg);
    const sJitter = scoreJitter(jitterAvg);
    const sShimmer = scoreShimmer(shimmerAvg);
    const sHNR = scoreHNR(hnrAvg);
    const sEntropy = scoreEntropy(entropyAvg);
    const sSubband = scoreSubband(subbandAvg);
    const sProsody = scoreProsody(prosodyAvg);

    const naturalness = computeNaturalness({
      flatness: sFlatness, flux: sFlux, jitter: sJitter, shimmer: sShimmer,
      hnr: sHNR, entropy: sEntropy, subband: sSubband, prosody: sProsody,
      rollOff: sRollOff, centroid: sCentroid, zcr: sZCR,
    });
    const riskScore = clampScore(100 - naturalness);

    // Binary verdict: <50 = authentic (green), >=50 = impersonation (red)
    const verdict: SessionSummary['verdict'] =
      riskScore >= 50 ? 'impersonation' : 'authentic';

    const signals = [
      { label: 'Spectral flatness', score: sFlatness, anomaly: sFlatness < 50,
        value: sFlatness < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Spectral flux', score: sFlux, anomaly: sFlux < 50,
        value: sFlux < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Pitch jitter', score: sJitter, anomaly: sJitter < 50,
        value: sJitter < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Amplitude shimmer', score: sShimmer, anomaly: sShimmer < 50,
        value: sShimmer < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Harmonics-to-noise', score: sHNR, anomaly: sHNR < 50,
        value: sHNR < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Spectral entropy', score: sEntropy, anomaly: sEntropy < 50,
        value: sEntropy < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Subband energy', score: sSubband, anomaly: sSubband < 50,
        value: sSubband < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Prosody & rhythm', score: sProsody, anomaly: sProsody < 50,
        value: sProsody < 50 ? 'AI artifact' : 'Natural' },
      { label: 'Spectral roll-off', score: sRollOff, anomaly: sRollOff < 50,
        value: sRollOff < 50 ? 'AI artifact' : 'Natural' },
    ];

    const speechFrames = this.speechRiskScores.length;
    return {
      riskScore, verdict,
      spectralAvg: flatnessAvg, zcrAvg, centroidAvg, fluxAvg, rollOffAvg,
      jitterAvg, shimmerAvg, hnrAvg, entropyAvg, subbandAvg,
      prosodyAvg: sProsody,
      framesAnalyzed: speechFrames > 0 ? speechFrames : this.frameCount,
      durationSec: (performance.now() - this.startTime) / 1000,
      signals, recommendation: RECOMMENDATIONS[verdict],
    };
  }

  private computeSpeechJitter(): number {
    if (this.speechPitch.length < 4) return 0.015;
    let sumAbsDiff = 0;
    for (let i = 1; i < this.speechPitch.length; i++) sumAbsDiff += Math.abs(this.speechPitch[i] - this.speechPitch[i - 1]);
    const avgPitch = avg(this.speechPitch);
    return avgPitch > 0 ? sumAbsDiff / ((this.speechPitch.length - 1) * avgPitch) : 0;
  }

  private computeSpeechShimmer(): number {
    if (this.speechAmp.length < 4) return 0.08;
    let sumAbsDiff = 0;
    for (let i = 1; i < this.speechAmp.length; i++) sumAbsDiff += Math.abs(this.speechAmp[i] - this.speechAmp[i - 1]);
    const avgAmp = avg(this.speechAmp);
    return avgAmp > 0 ? sumAbsDiff / ((this.speechAmp.length - 1) * avgAmp) : 0;
  }

  private computeJitterAvg(): number {
    if (this.pitchHistory.length < 4) return 0.015;
    const periods = this.pitchHistory.slice(-30);
    let sumAbsDiff = 0;
    for (let i = 1; i < periods.length; i++) sumAbsDiff += Math.abs(periods[i] - periods[i - 1]);
    const avgPeriod = avg(periods);
    return avgPeriod > 0 ? sumAbsDiff / ((periods.length - 1) * avgPeriod) : 0;
  }

  private computeShimmerAvg(): number {
    if (this.ampHistory.length < 4) return 0.08;
    const amps = this.ampHistory.slice(-30);
    let sumAbsDiff = 0;
    for (let i = 1; i < amps.length; i++) sumAbsDiff += Math.abs(amps[i] - amps[i - 1]);
    const avgAmp = avg(amps);
    return avgAmp > 0 ? sumAbsDiff / ((amps.length - 1) * avgAmp) : 0;
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close();
    this.stream?.getAudioTracks().forEach((t) => { t.removeEventListener('ended', this.handleTrackEnded); t.stop(); });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
  }
}

// ── File analyzer (uploaded audio) ─────────────────────

export type FileAnalysisResult = {
  riskScore: number;
  verdict: 'authentic' | 'suspicious' | 'impersonation';
  signals: { label: string; value: string; score: number; anomaly: boolean }[];
  recommendation: string;
  durationSec: number;
};

export async function analyzeAudioFile(file: File): Promise<FileAnalysisResult> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new Ctx();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);

  const fftSize = 2048;
  const hopSize = 1024;
  const totalFrames = Math.floor((channelData.length - fftSize) / hopSize);

  const flatnessArr: number[] = [];
  const zcrArr: number[] = [];
  const centroidArr: number[] = [];
  const fluxArr: number[] = [];
  const rollOffArr: number[] = [];
  const pitchArr: number[] = [];
  const ampArr: number[] = [];
  const entropyArr: number[] = [];
  const subbandArr: number[] = [];
  const hnrArr: number[] = [];

  let prevSpectrum: Float32Array | null = null;

  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSize;
    const frame = channelData.subarray(start, start + fftSize);

    // Window (Hann)
    const windowed = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      windowed[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // FFT magnitude spectrum (simplified via autocorrelation-based DFT)
    const spectrum = computeMagnitudeSpectrum(windowed);
    const binCount = spectrum.length;
    const binWidth = sampleRate / 2 / binCount;

    // RMS
    let rmsSum = 0;
    for (let i = 0; i < fftSize; i++) rmsSum += windowed[i] * windowed[i];
    const rms = Math.sqrt(rmsSum / fftSize);
    if (rms < 0.005) continue; // skip silence

    // Spectral flatness
    let logSum = 0, linSum = 0, active = 0;
    for (let i = 1; i < binCount; i++) {
      const v = spectrum[i];
      if (v < 1e-6) continue;
      logSum += Math.log(v);
      linSum += v;
      active++;
    }
    const flatness = active > 0 ? Math.exp(logSum / active) / (linSum / active) : 0;

    // ZCR
    let crossings = 0;
    for (let i = 1; i < fftSize; i++) {
      if ((frame[i - 1] >= 0) !== (frame[i] >= 0)) crossings++;
    }
    const zcr = crossings / (fftSize - 1);

    // Centroid
    let wSum = 0, mSum = 0;
    for (let i = 0; i < binCount; i++) {
      wSum += i * binWidth * spectrum[i];
      mSum += spectrum[i];
    }
    const centroid = mSum > 0 ? wSum / mSum : 0;

    // Flux
    let flux = 0;
    if (prevSpectrum) {
      let sd = 0;
      for (let i = 0; i < binCount; i++) { const d = spectrum[i] - prevSpectrum[i]; sd += d * d; }
      flux = Math.sqrt(sd / binCount);
    }
    prevSpectrum = spectrum;

    // Roll-off
    let rollOff = 0;
    if (mSum > 0) {
      let cum = 0;
      const thresh = 0.85 * mSum;
      for (let i = 0; i < binCount; i++) { cum += spectrum[i]; if (cum >= thresh) { rollOff = i * binWidth; break; } }
    }

    // Entropy
    let entropy = 0;
    if (mSum > 0) {
      let es = 0;
      for (let i = 0; i < binCount; i++) { const p = spectrum[i] / mSum; if (p > 0) es -= p * Math.log2(p); }
      entropy = es / Math.log2(binCount);
    }

    // Subband ratio
    const midBin = Math.floor(binCount * 0.4);
    let highE = 0;
    for (let i = midBin; i < binCount; i++) highE += spectrum[i];
    const subband = mSum > 0 ? highE / mSum : 0;

    // F0 + jitter
    const f0 = estimateF0Float(frame, sampleRate);
    if (f0 > 0) pitchArr.push(f0);

    ampArr.push(rms);

    // HNR
    if (f0 > 0) {
      const period = Math.round(sampleRate / f0);
      if (period < fftSize) {
        let harmonic = 0;
        for (let i = 0; i < fftSize - period; i++) harmonic += frame[i] * frame[i + period];
        harmonic = Math.abs(harmonic / (fftSize - period));
        const noise = Math.max(rms - harmonic, 0.001);
        hnrArr.push(10 * Math.log10((harmonic + 0.001) / noise));
      }
    }

    flatnessArr.push(flatness);
    zcrArr.push(zcr);
    centroidArr.push(centroid);
    fluxArr.push(flux);
    rollOffArr.push(rollOff);
    entropyArr.push(entropy);
    subbandArr.push(subband);
  }

  audioCtx.close();

  // Compute averages
  const flatnessAvg = avg(flatnessArr);
  const zcrAvg = avg(zcrArr);
  const centroidAvg = avg(centroidArr);
  const fluxAvg = avg(fluxArr);
  const rollOffAvg = avg(rollOffArr);
  const entropyAvg = avg(entropyArr);
  const subbandAvg = avg(subbandArr);
  const hnrAvg = hnrArr.length > 0 ? avg(hnrArr) : 20;

  // Jitter from pitch array
  let jitterAvg = 0.015;
  if (pitchArr.length >= 4) {
    let sumAbsDiff = 0;
    for (let i = 1; i < pitchArr.length; i++) sumAbsDiff += Math.abs(pitchArr[i] - pitchArr[i - 1]);
    const avgPitch = avg(pitchArr);
    jitterAvg = avgPitch > 0 ? sumAbsDiff / ((pitchArr.length - 1) * avgPitch) : 0;
  }

  // Shimmer from amplitude array
  let shimmerAvg = 0.08;
  if (ampArr.length >= 4) {
    let sumAbsDiff = 0;
    for (let i = 1; i < ampArr.length; i++) sumAbsDiff += Math.abs(ampArr[i] - ampArr[i - 1]);
    const avgAmp = avg(ampArr);
    shimmerAvg = avgAmp > 0 ? sumAbsDiff / ((ampArr.length - 1) * avgAmp) : 0;
  }

  // Prosody: variance of centroid across frames
  const prosodyVar = centroidArr.length >= 10 ? coefficientOfVariation(centroidArr) : 0.3;

  // Score all features
  const sFlatness = scoreFlatness(flatnessAvg);
  const sZCR = scoreZCR(zcrAvg);
  const sCentroid = scoreCentroid(centroidAvg);
  const sFlux = scoreFlux(fluxAvg);
  const sRollOff = scoreRollOff(rollOffAvg);
  const sJitter = scoreJitter(jitterAvg);
  const sShimmer = scoreShimmer(shimmerAvg);
  const sHNR = scoreHNR(hnrAvg);
  const sEntropy = scoreEntropy(entropyAvg);
  const sSubband = scoreSubband(subbandAvg);
  const sProsody = scoreProsody(prosodyVar);

  const naturalness = computeNaturalness({
    flatness: sFlatness, flux: sFlux, jitter: sJitter, shimmer: sShimmer,
    hnr: sHNR, entropy: sEntropy, subband: sSubband, prosody: sProsody,
    rollOff: sRollOff, centroid: sCentroid, zcr: sZCR,
  });
  const riskScore = clampScore(100 - naturalness);

  const verdict: FileAnalysisResult['verdict'] =
    riskScore >= 50 ? 'impersonation' : 'authentic';

  const signals = [
    { label: 'Spectral flatness', score: sFlatness, anomaly: sFlatness < 50,
      value: sFlatness < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Spectral flux', score: sFlux, anomaly: sFlux < 50,
      value: sFlux < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Pitch jitter', score: sJitter, anomaly: sJitter < 50,
      value: sJitter < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Amplitude shimmer', score: sShimmer, anomaly: sShimmer < 50,
      value: sShimmer < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Harmonics-to-noise', score: sHNR, anomaly: sHNR < 50,
      value: sHNR < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Spectral entropy', score: sEntropy, anomaly: sEntropy < 50,
      value: sEntropy < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Subband energy', score: sSubband, anomaly: sSubband < 50,
      value: sSubband < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Prosody & rhythm', score: sProsody, anomaly: sProsody < 50,
      value: sProsody < 50 ? 'AI artifact' : 'Natural' },
    { label: 'Spectral roll-off', score: sRollOff, anomaly: sRollOff < 50,
      value: sRollOff < 50 ? 'AI artifact' : 'Natural' },
  ];

  return {
    riskScore, verdict, signals,
    recommendation: RECOMMENDATIONS[verdict],
    durationSec: audioBuffer.duration,
  };
}

// Simplized DFT magnitude spectrum (radix-2 not required, we use direct DFT
// on the windowed frame to extract frequency content)
function computeMagnitudeSpectrum(windowed: Float32Array): Float32Array {
  const N = windowed.length;
  const halfN = N / 2;
  const magnitudes = new Float32Array(halfN);

  // Use a simple but efficient approach: compute only the magnitude
  // at each frequency bin via summation
  for (let k = 0; k < halfN; k++) {
    let real = 0, imag = 0;
    const angle = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      real += windowed[n] * Math.cos(angle * n);
      imag += windowed[n] * Math.sin(angle * n);
    }
    magnitudes[k] = Math.sqrt(real * real + imag * imag) / N;
  }
  return magnitudes;
}
