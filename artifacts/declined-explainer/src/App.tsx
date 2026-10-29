import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Activity, ArrowRight, BadgeCheck, BookOpen, ChevronDown, CircleHelp, ClipboardCheck, FileText, Fingerprint, Landmark, Scale, ShieldCheck, SlidersHorizontal, Sparkles, Waypoints } from 'lucide-react';
import {
  getDeclinedExplainerPolishStatus,
  polishDeclinedApplicationLetter,
} from '@workspace/api-client-react';
import { SAMPLE_APPLICANTS, generateDataset, FEATURE_KEYS } from '@/domain/data';
import { trainLogisticRegression, predictProbability, predictApproved } from '@/domain/model';
import { explainDecision, buildDecisionLetter, getApprovalRatesByCreditBand } from '@/domain/explain';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type FeatureKey = 'credit_score' | 'foir' | 'loan_to_income' | 'employment_years' | 'missed_payments_12m' | 'credit_utilization';
type Features = Record<FeatureKey, number>;
type Applicant = { name?: string; label?: string; scenario?: string; features?: Partial<Features> } & Partial<Features>;
type AnyRecord = Record<string, unknown>;

const featureConfig: { key: FeatureKey; title: string; unit: string; min: number; max: number; step: number; low: string; high: string; digits?: number }[] = [
  { key: 'credit_score', title: 'Credit score', unit: 'pts', min: 300, max: 900, step: 1, low: '300', high: '900' },
  { key: 'foir', title: 'Fixed obligations / income', unit: '%', min: 0, max: 1, step: 0.01, low: '0%', high: '100%' },
  { key: 'loan_to_income', title: 'Loan-to-income', unit: '×', min: 0, max: 10, step: 0.05, low: '0×', high: '10×', digits: 2 },
  { key: 'employment_years', title: 'Employment tenure', unit: 'yrs', min: 0, max: 40, step: 0.5, low: '0', high: '40' },
  { key: 'missed_payments_12m', title: 'Missed payments · 12 mo', unit: '', min: 0, max: 12, step: 1, low: '0', high: '12' },
  { key: 'credit_utilization', title: 'Credit utilization', unit: '%', min: 0, max: 1, step: 0.01, low: '0%', high: '100%' },
];
const knownFeatureKeys = FEATURE_KEYS as readonly FeatureKey[];
const shownFeatures = featureConfig.filter((feature) => knownFeatureKeys.includes(feature.key));

const defaultFeatures: Features = {
  credit_score: 684,
  foir: 0.38,
  loan_to_income: 3.2,
  employment_years: 5,
  missed_payments_12m: 0,
  credit_utilization: 0.34,
};

const safeNumber = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const asRecord = (value: unknown): AnyRecord => value && typeof value === 'object' ? value as AnyRecord : {};
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatFeature = (key: FeatureKey, value: number) => {
  if (key === 'credit_score') return `${Math.round(value)} pts`;
  if (key === 'foir' || key === 'credit_utilization') return `${Math.round(value * 100)}%`;
  if (key === 'loan_to_income') return `${value.toFixed(2)}×`;
  if (key === 'employment_years') return `${value.toFixed(value % 1 ? 1 : 0)} yrs`;
  return `${Math.round(value)}`;
};

function Home() {
  const records = useMemo(() => generateDataset(6000, 2417), []);
  const model = useMemo(() => trainLogisticRegression(records), [records]);
  const sampleApplicants = useMemo(() => Object.entries(SAMPLE_APPLICANTS as Record<string, Partial<Features>>)
    .map(([scenario, features], index) => ({ name: ['Avery Chen', 'Jordan Ellis', 'Morgan Reed', 'Taylor Brooks'][index] || `Sample applicant ${index + 1}`, scenario, features })), []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState<'decision' | 'fairness'>('decision');
  const [auditOpen, setAuditOpen] = useState(false);
  const [name, setName] = useState('');
  const [polishAvailable, setPolishAvailable] = useState(false);
  const [useClaudePolish, setUseClaudePolish] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishedLetter, setPolishedLetter] = useState<string | null>(null);
  const [polishSource, setPolishSource] = useState('template');
  const [polishError, setPolishError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getDeclinedExplainerPolishStatus({ signal: controller.signal })
      .then((status) => setPolishAvailable(status.enabled === true))
      .catch(() => setPolishAvailable(false));
    return () => controller.abort();
  }, []);

  const selected = sampleApplicants[selectedIndex] ?? sampleApplicants[0] ?? {};
  const selectedFeatures = (selected.features ?? selected) as Partial<Features>;
  const features = useMemo(() => featureConfig.reduce((current, item) => {
    current[item.key] = safeNumber(selectedFeatures[item.key], defaultFeatures[item.key]);
    return current;
  }, { ...defaultFeatures } as Features), [selectedFeatures]);
  const applicantName = name || selected.name || 'Sample applicant';
  const mandatoryDeclineCopy = 'You have the right to request a review by a human decision-maker. This decision does not affect any existing accounts you hold with us.';

  const changeFeature = (key: FeatureKey, value: number) => {
    const updated = { ...features, [key]: value };
    const match = sampleApplicants.findIndex((person) => {
      const personFeatures = (person.features ?? person) as Partial<Features>;
      return featureConfig.every((item) => Number(personFeatures[item.key]) === updated[item.key]);
    });
    if (match >= 0) setSelectedIndex(match);
    // Keep edited values local without persisting customer data.
    setEditedFeatures(updated);
  };

  const [editedFeatures, setEditedFeatures] = useState<Features | null>(null);
  const liveFeatures = editedFeatures ?? features;
  const liveProbability = Math.max(0, Math.min(1, safeNumber(predictProbability(model, liveFeatures), 0.5)));
  const liveApproved = Boolean(predictApproved(model, liveFeatures));
  const liveDecision = liveApproved ? 'Approved' : 'Declined';
  const liveAudit = explainDecision(model, liveFeatures);
  const liveLetter = buildDecisionLetter(applicantName, liveFeatures, liveAudit);
  const liveLetterText = typeof liveLetter === 'string' ? liveLetter : JSON.stringify(liveLetter, null, 2);
  const requiredFacts = JSON.stringify([
    ...liveAudit.reasons.map((reason) => reason.explanation),
    ...liveAudit.actions.map((action) => action.changeLabel),
    'Your existing accounts are not affected by this application outcome.',
    'You have the right to request a human review of this decision.',
  ]);
  useEffect(() => {
    if (!useClaudePolish || !polishAvailable || liveApproved) {
      setPolishedLetter(null);
      setPolishSource('template');
      setPolishError('');
      setIsPolishing(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsPolishing(true);
      setPolishError('');
      polishDeclinedApplicationLetter({
        draft: liveLetterText,
        requiredFacts: JSON.parse(requiredFacts) as string[],
      }, { signal: controller.signal })
        .then((result) => {
          setPolishedLetter(result.letter);
          setPolishSource(result.source);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          setPolishedLetter(null);
          setPolishSource('template');
          setPolishError('Using the original template wording.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsPolishing(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    liveApproved,
    liveLetterText,
    polishAvailable,
    requiredFacts,
    useClaudePolish,
  ]);

  const liveVisibleLetter = liveApproved || /right to request.*human|existing accounts/i.test(liveLetterText)
    ? liveLetterText : `${liveLetterText}\n\n${mandatoryDeclineCopy}`;
  const displayedLetter = useClaudePolish && polishedLetter
    ? polishedLetter
    : liveVisibleLetter;
  const liveAuditRecord = asRecord(liveAudit);
  const liveReasons = Array.isArray(liveAuditRecord.reasons) ? liveAuditRecord.reasons : [];
  const liveImpacts = Array.isArray(liveAuditRecord.impacts) ? liveAuditRecord.impacts : [];
  const liveContributions = Array.isArray(liveAuditRecord.contributions)
    ? liveAuditRecord.contributions
    : liveImpacts.filter((impact) => typeof asRecord(impact).contribution === 'number');
  const liveActions = Array.isArray(liveAuditRecord.actions) ? liveAuditRecord.actions : [];
  const liveRates = useMemo(() => getApprovalRatesByCreditBand(records), [records]);
  const liveRateRows = Array.isArray(liveRates) ? liveRates : Object.entries(asRecord(liveRates)).map(([band, value]) => ({ band, ...(typeof value === 'object' ? asRecord(value) : { approvalRate: value }) }));
  const activeApplicant = sampleApplicants[selectedIndex] ?? {};
  const activeScenario = activeApplicant.scenario || 'Sample applicant';

  const selectApplicant = (index: number) => {
    setSelectedIndex(index);
    setEditedFeatures(null);
    setName('');
  };
  const ratePercent = (row: unknown) => {
    const record = asRecord(row);
    const raw = safeNumber(record.approvalRate ?? record.approval_rate ?? record.rate ?? record.approvedRate ?? record.approvalRatePercent, 0);
    return raw <= 1 ? raw * 100 : raw;
  };
  const bandName = (row: unknown, index: number) => {
    const record = asRecord(row);
    return String(record.band ?? record.creditBand ?? record.credit_band ?? record.label ?? record.range ?? `Band ${index + 1}`);
  };
  const serializeAudit = () => {
    try { return JSON.stringify(liveAudit, null, 2); } catch { return '{}'; }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Landmark size={18} strokeWidth={1.8} /></div>
          <div><div className="brand-title">Clearline</div><div className="brand-sub">Decision studio</div></div>
        </div>
        <div className="side-label">Workspace</div>
        <nav className="side-nav" aria-label="Workspace views">
          <button className={`nav-button ${tab === 'decision' ? 'active' : ''}`} onClick={() => setTab('decision')}><FileText size={16} /><span>Decision explainer</span><span className="nav-count">01</span></button>
          <button className={`nav-button ${tab === 'fairness' ? 'active' : ''}`} onClick={() => setTab('fairness')}><Scale size={16} /><span>Fairness check</span><span className="nav-count">02</span></button>
        </nav>
        <div className="side-spacer" />
        <div className="demo-note">
          <div className="demo-note-title"><Sparkles size={14} /> Synthetic demo</div>
          Every applicant and outcome here is generated for demonstration. This is not a production credit model and must not be used to make lending decisions.
        </div>
        <div className="sidebar-foot">Clearline · Transparency lab<br />No real customer data is stored.</div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><ArrowRight size={12} /><strong>{tab === 'decision' ? 'Decision explainer' : 'Fairness check'}</strong></div>
          <div className="top-right"><div className="live-chip"><span className="live-dot" /> Demo model · local</div><span>Staff preview</span><div className="avatar-initials">CL</div></div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">Synthetic lending sandbox&nbsp; / &nbsp;v0.1</div>
              <h1 className="page-title">{tab === 'decision' ? 'A clearer answer to “why?”' : 'A broader view of fairness.'}</h1>
              <p className="page-desc">{tab === 'decision' ? 'Explore a sample decision, inspect the factors behind it, and see how the explanation reads to a customer.' : 'Compare approval rates across synthetic credit-score bands. Use this as a discussion aid—not as a fairness certification.'}</p>
            </div>
            <div className="heading-meta"><span className="live-chip"><span className="live-dot" /> Synthetic data only</span></div>
          </div>
          <div className="workspace-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'decision'} className={`tab-button ${tab === 'decision' ? 'active' : ''}`} onClick={() => setTab('decision')}><span className="tab-index">1</span> Decision explainer</button>
            <button role="tab" aria-selected={tab === 'fairness'} className={`tab-button ${tab === 'fairness' ? 'active' : ''}`} onClick={() => setTab('fairness')}><span className="tab-index">2</span> Fairness check</button>
          </div>

          {tab === 'decision' ? (
            <>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-head">
                    <div><div className="section-kicker"><SlidersHorizontal size={13} /> Application profile</div><h2 className="panel-title" style={{ marginTop: 8 }}>Applicant inputs</h2><div className="panel-subtitle">Adjust any value to see the synthetic model respond instantly.</div></div>
                    <div className="select-wrap"><select aria-label="Choose sample applicant" value={selectedIndex} onChange={(event) => selectApplicant(Number(event.target.value))}>{sampleApplicants.map((person, index) => <option key={index} value={index}>{person.scenario || `Sample ${index + 1}`}</option>)}</select><ChevronDown className="select-chevron" size={14} /></div>
                  </div>
                  <div className="applicant-card">
                    <div><div className="applicant-label">Customer name</div><input aria-label="Customer name" value={name || activeApplicant.name || 'Sample applicant'} onChange={(event) => setName(event.target.value)} style={{ display: 'block', background: 'transparent', border: 0, padding: '4px 0 0', outline: 'none', width: '100%', font: '700 16px var(--app-font-serif)', color: '#273d43' }} /></div>
                    <span className="scenario-tag">{activeScenario}</span>
                  </div>
                  <div className="features-wrap">
                    <div className="features-heading"><span>Six decision factors</span><span>LIVE INPUTS</span></div>
                    <div className="feature-list">
                      {shownFeatures.map((feature) => {
                        const value = liveFeatures[feature.key];
                        const range = ((value - feature.min) / (feature.max - feature.min)) * 100;
                        return <div className="feature-control" key={feature.key}>
                          <div className="feature-top"><label className="feature-name" htmlFor={`feature-${feature.key}`}>{feature.title}</label><span className="feature-value">{formatFeature(feature.key, value)}</span></div>
                          <div className="range-line"><input id={`feature-${feature.key}`} type="range" min={feature.min} max={feature.max} step={feature.step} value={value} style={{ ['--range' as string]: `${range}%` }} onChange={(event) => changeFeature(feature.key, Number(event.target.value))} /></div>
                          <div className="range-markers"><span>{feature.low}</span><span>{feature.high}</span></div>
                        </div>;
                      })}
                    </div>
                  </div>
                </section>

                <section className="panel result-panel">
                  <div className="decision-banner">
                    <div className="decision-label"><span className={`decision-status ${liveApproved ? 'approved' : 'declined'}`}><span className="live-dot" style={{ background: liveApproved ? '#4a9366' : '#b86a56' }} />{liveDecision}</span><span className="decision-id">DEMO · LOCAL ONLY</span></div>
                    <div className="score-row">
                      <div><div className="score-number">{Math.round(liveProbability * 100)}<small>/100</small></div><div className="score-caption">Model approval score</div></div>
                      <div className="probability-box"><div className="probability-value">{(liveProbability * 100).toFixed(1)}%</div><div className="probability-caption">estimated approval probability</div></div>
                    </div>
                    <div className="prob-track"><div className="prob-fill" style={{ width: `${liveProbability * 100}%` }} /></div>
                  </div>
                  <div className="letter-section">
                    <div className="letter-title-row">
                      <div className="letter-title"><BookOpen size={14} /> Customer decision letter</div>
                      <div className="letter-tools">
                        <label className="polish-toggle" title="When enabled, this draft is sent to Anthropic for wording only.">
                          <input
                            type="checkbox"
                            checked={useClaudePolish}
                            disabled={!polishAvailable || liveApproved}
                            onChange={(event) => setUseClaudePolish(event.target.checked)}
                          />
                          <span>{isPolishing ? 'Polishing…' : 'Claude wording'}</span>
                        </label>
                        <span className="template-label"><FileText size={11} /> Wording source: {polishSource}</span>
                      </div>
                    </div>
                    {!polishAvailable && <div className="ai-availability-note">Optional Claude wording is off. Add ANTHROPIC_API_KEY in Replit Secrets to enable it; the template works without a key.</div>}
                    {polishError && <div className="ai-availability-note">{polishError}</div>}
                    <div className="letter-copy">{displayedLetter.split('\n').filter(Boolean).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 8)}`}>{paragraph}</p>)}</div>
                    {!liveApproved && <div className="review-notice"><b>You can ask us to review this.</b> You have the right to request a human review of this decision. Existing accounts are unaffected.</div>}
                  </div>
                  <div className="letter-foot"><span><BadgeCheck size={12} /> Generated deterministically from current inputs</span><span>Not a production credit decision</span></div>
                </section>
              </div>

              <section className="panel audit-panel">
                <button className="audit-trigger" aria-expanded={auditOpen} onClick={() => setAuditOpen(!auditOpen)}>
                  <span className="audit-trigger-left"><span className="audit-icon"><Fingerprint size={16} /></span><span><span className="audit-heading" style={{ display: 'block' }}>Decision audit trail</span><span className="audit-meta">Inspect factors, contributions, impacts, and recommended actions</span></span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="template-label"><ShieldCheck size={11} /> Reproducible</span><ChevronDown className={`audit-chevron ${auditOpen ? 'open' : ''}`} size={17} /></span>
                </button>
                {auditOpen && <div className="audit-content">
                  <div className="audit-summary">
                    <div className="audit-stat"><label>Reasons</label><strong>{liveReasons.length || '—'}</strong></div><div className="audit-stat"><label>Contributions</label><strong>{liveContributions.length || '—'}</strong></div><div className="audit-stat"><label>Impacts</label><strong>{liveImpacts.length || '—'}</strong></div><div className="audit-stat"><label>Actions</label><strong>{liveActions.length || '—'}</strong></div>
                  </div>
                  <div className="section-kicker" style={{ marginBottom: 9 }}><Waypoints size={13} /> Raw model explanation · JSON</div>
                  <pre className="json-view">{serializeAudit()}</pre>
                </div>}
              </section>
            </>
          ) : (
            <div className="fairness-layout">
              <section className="panel">
                <div className="panel-head"><div><div className="section-kicker"><Activity size={13} /> Dataset overview</div><h2 className="panel-title" style={{ marginTop: 8 }}>Approval by credit-score band</h2><div className="panel-subtitle">Calculated from the same 6,000-row synthetic dataset used in this demo.</div></div><span className="template-label"><span className="live-dot" /> 6,000 generated rows</span></div>
                <div className="fairness-intro"><div className="fairness-mark"><Scale size={17} /></div><div className="fairness-message"><strong>Fairness is more than one comparison.</strong> These rates show model outcomes across score bands only. They do not establish fairness, explain every outcome, or replace a formal review of protected groups and real-world impacts.</div></div>
                <div className="rate-table-wrap">
                  <table className="rate-table"><thead><tr><th>Credit-score band</th><th>Approval rate</th><th>Relative rate</th><th>Sample count</th></tr></thead>
                    <tbody>{liveRateRows.map((row, index) => {
                      const record = asRecord(row);
                      const rate = Math.max(0, Math.min(100, ratePercent(row)));
      const count = safeNumber(record.count ?? record.applications ?? record.sampleCount ?? record.sample_count ?? record.total, 0);
                      return <tr key={index}><td>{bandName(row, index)}</td><td className="rate-percent">{rate.toFixed(1)}%</td><td><div className="rate-meter"><div className="meter-track"><div className="meter-fill" style={{ width: `${rate}%` }} /></div></div></td><td>{count ? count.toLocaleString() : '—'}</td></tr>;
                    })}</tbody>
                  </table>
                  {liveRateRows.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#829087', fontSize: 12 }}>No credit-band summaries are available in this synthetic dataset.</div>}
                </div>
              </section>
              <aside className="fairness-side">
                <div className="panel insight-card"><div className="insight-icon"><CircleHelp size={16} /></div><h3 className="insight-title">Read this carefully</h3><p className="insight-copy">A rate gap can be a useful signal to investigate, not a verdict. Sample size, feature distributions, and context matter. This view is a demo aid, not a compliance report.</p><div className="band-summary"><div className="band-pill"><span>Records used</span><strong>{records.length.toLocaleString()}</strong></div><div className="band-pill"><span>Data source</span><strong>Generated</strong></div></div></div>
                 <div className="safety-note"><ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} /><span>All example applications and approval rates are synthetic. Nothing is saved. If enabled, optional Claude wording sends the current letter to Anthropic. This is not a production credit model.</span></div>
                <div className="panel insight-card"><div className="insight-icon" style={{ background: '#e7eee8', color: '#477158' }}><ClipboardCheck size={16} /></div><h3 className="insight-title">What a responsible review asks</h3><p className="insight-copy">Check whether input features and outcomes behave consistently, look beyond score bands, document limitations, and make human review accessible to every applicant.</p></div>
              </aside>
            </div>
          )}
          <div className="footer-note">SYNTHETIC DEMONSTRATION ONLY · NOT A CREDIT DECISIONING PRODUCT · NO CUSTOMER DATA PERSISTED</div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
