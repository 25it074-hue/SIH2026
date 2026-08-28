import { useState } from 'react';
import {
  ArrowRight,
  AudioWaveform,
  Cloud,
  Code2,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Menu,
  Play,
  Radio,
  ScanLine,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import UploadAnalyzer from '@/components/UploadAnalyzer';
import LiveCallDetector from '@/components/LiveCallDetector';
import RecentDetections from '@/components/RecentDetections';
import { useCountUp } from '@/hooks/useCountUp';
import { useInView } from '@/hooks/useInView';

const logoSrc = '/ChatGPT_Image_Aug_27,_2026,_03_02_55_PM.png';

const navItems = ['Platform', 'How it works', 'Solutions', 'Upload', 'Live'];

const stats = [
  { value: 12847, label: 'calls monitored', prefix: '' },
  { value: 384, label: 'threats flagged', prefix: '' },
  { value: 42, label: 'fraud prevented', prefix: '₹', suffix: ' Cr' },
  { value: 12, label: 'average response', prefix: '', suffix: 's' },
];

function StatItem({ stat, animate }: { stat: typeof stats[0]; animate: boolean }) {
  const count = useCountUp(stat.value, 2000, animate);
  return (
    <div>
      <strong>{stat.prefix}{count.toLocaleString()}{stat.suffix ?? ''}</strong>
      <span>{stat.label}</span>
    </div>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [statsRef, statsInView] = useInView<HTMLDivElement>();

  const scrollToDemo = () => {
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Cryptix Protocol home">
          <span className="brand-mark"><img src={logoSrc} alt="Cryptix Protocol logo" width={28} height={28} /></span>
          <span>Cryptix<span>Protocol</span></span>
        </a>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
          {navItems.map((item) => <a href={`#${item.toLowerCase().replace(/ /g, '-')}`} key={item} onClick={() => setMenuOpen(false)}>{item}</a>)}
          <a href="#demo" className="nav-demo" onClick={() => setMenuOpen(false)}>Try live detection <ArrowRight size={16} /></a>
        </nav>
        <button className="menu-toggle" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </header>

      <main id="top">
        <section className="hero section-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" />AI-powered voice integrity</div>
            <h1>Know who's<br /><em>really</em> speaking.</h1>
            <p className="hero-lede">Voice cloning has changed the rules of trust. Cryptix Protocol analyzes live calls in real time to spot synthetic speech, cloned voices, and high-risk impersonation before it becomes a costly mistake.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={scrollToDemo}>Start protecting <ArrowRight size={18} /></button>
              <a className="button button-ghost" href="#how-it-works"><span className="play-icon"><Play size={13} fill="currentColor" /></span> See how it works</a>
            </div>
            <div className="hero-proof"><div className="avatar-stack"><span>AS</span><span>RK</span><span>JM</span><span>+</span></div><span>Trusted by teams protecting high-stakes conversations</span></div>
          </div>
          <div className="hero-visual" aria-label="Cryptix Protocol live analysis visualization">
            <div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="hero-orb"><div className="orb-glow" /><img src={logoSrc} alt="" className="hero-orb-logo" /><span>VOICE<br /><b>AUTHENTIC</b></span></div>
            <div className="signal-card signal-card-top"><div className="signal-card-icon"><AudioWaveform size={17} /></div><div><strong>Live signal</strong><span>Analyzing now</span></div><i className="live-dot" /></div>
            <div className="signal-card signal-card-bottom"><span>Confidence score</span><strong>98.4%</strong><div className="mini-bars">{[35, 52, 42, 68, 54, 74, 85, 66, 92, 78, 98].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div></div>
            <div className="tiny-chip chip-one"><ScanLine size={13} /> DSP analysis</div><div className="tiny-chip chip-two"><LockKeyhole size={13} /> Privacy first</div>
          </div>
        </section>

        <section ref={statsRef} className="stats-strip section-grid" aria-label="Cryptix Protocol impact">
          {stats.map((stat) => <StatItem key={stat.label} stat={stat} animate={statsInView} />)}
        </section>

        <section id="how-it-works" className="section how-section">
          <div className="section-heading centered"><div className="eyebrow"><span className="eyebrow-dot" />One layer ahead</div><h2>Trust, but <em>verify.</em></h2><p>Cryptix Protocol listens for the subtle signals that human ears miss — without storing the conversation itself.</p></div>
          <div className="steps-grid">
            <article className="step-card"><span className="step-number">01</span><div className="step-icon"><Radio /></div><h3>Listen</h3><p>Continuously capture only the audio features needed to understand a live voice stream.</p><a href="#demo">Learn more <ArrowRight size={15} /></a></article>
            <article className="step-card active-step"><span className="step-number">02</span><div className="step-icon"><AudioWaveform /></div><h3>Analyze</h3><p>Compare spectral artifacts, prosody, pauses, and speaker identity against authentic patterns.</p><a href="#demo">Learn more <ArrowRight size={15} /></a></article>
            <article className="step-card"><span className="step-number">03</span><div className="step-icon"><TriangleAlert /></div><h3>Protect</h3><p>Surface a clear risk score and recommend the right action before money or access changes hands.</p><a href="#demo">Learn more <ArrowRight size={15} /></a></article>
          </div>
        </section>

        <LiveCallDetector />

        <UploadAnalyzer />

        <RecentDetections />

        <section id="platform" className="section platform-section"><div className="platform-copy"><div className="eyebrow"><span className="eyebrow-dot" />Built for real-world risk</div><h2>More than a voice<br /><em>detector.</em></h2><p>Make every high-stakes conversation safer with context-aware protection designed for the way people actually work.</p><a className="text-link" href="#solutions">Explore the platform <ArrowRight size={17} /></a></div><div className="feature-grid"><div className="feature-card"><Globe2 /><h3>Made for every voice</h3><p>Language-agnostic analysis tuned for Indian accents, dialects, and regional languages.</p></div><div className="feature-card"><Cloud /><h3>Deploy your way</h3><p>Use edge inference, APIs, or SDKs across telecom, banking, and enterprise systems.</p></div><div className="feature-card"><FileCheck2 /><h3>Actionable by design</h3><p>Turn a risk score into a clear next step with configurable response workflows.</p></div><div className="feature-card"><Code2 /><h3>Simple to integrate</h3><p>Connect to the tools your team already uses with flexible REST and gRPC interfaces.</p></div></div></section>

        <section id="solutions" className="cta-section"><div className="cta-glow" /><Sparkles size={22} className="cta-spark" /><h2>Trust should never<br />be a <em>leap of faith.</em></h2><p>Give your people a second set of ears for the moments that matter most.</p><button className="button button-primary" onClick={scrollToDemo}>Try live detection <ArrowRight size={18} /></button></section>
      </main>
      <footer className="site-footer"><a href="#top" className="brand"><span className="brand-mark"><img src={logoSrc} alt="Cryptix Protocol logo" width={24} height={24} /></span><span>Cryptix<span>Protocol</span></span></a><span>Voice integrity for a world of synthetic trust.</span><div><a href="#platform">Platform</a><a href="#how-it-works">How it works</a><a href="#demo">Live demo</a><a href="#detections">Activity</a></div></footer>
    </div>
  );
}

export default App;
