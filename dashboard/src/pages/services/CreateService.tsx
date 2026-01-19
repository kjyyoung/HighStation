import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useServices } from '../../hooks/useServices';
import {
    GlobeIcon,
    ServerIcon,
    ShieldIcon,
    CheckIcon,
    ArrowUpRightIcon,
    ZapIcon,
    InfoIcon,
    ActivityIcon
} from '../../components/Icons';
import { DEMO_SERVICE_DEFAULTS } from '../../config';
import toast from 'react-hot-toast';

export default function CreateService() {
    const navigate = useNavigate();
    const { handleCreateService, testConnection, verifyOpenSealRepo } = useServices();

    // Form State
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [upstreamUrl, setUpstreamUrl] = useState('');
    const [priceUsdt, setPriceUsdt] = useState('0.01');
    const [minGrade, setMinGrade] = useState('C');
    const [repoUrl, setRepoUrl] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<string>('General');
    const [tags, setTags] = useState<string>('');
    const [endpoints, setEndpoints] = useState<any[]>([]);

    const handleFillDemoData = () => {
        setName(DEMO_SERVICE_DEFAULTS.NAME);
        setSlug('text-washer');
        setUpstreamUrl(DEMO_SERVICE_DEFAULTS.UPSTREAM_URL_DEFAULT);
        setPriceUsdt('0.25'); // $0.25 per call
        setMinGrade(DEMO_SERVICE_DEFAULTS.MIN_GRADE);
        setRepoUrl(DEMO_SERVICE_DEFAULTS.OPENSEAL_REPO);
        setDescription('Real-world AI service demo: A high-integrity text sanitization API protected by OpenSeal and x402.');
        setEndpoints(DEMO_SERVICE_DEFAULTS.ENDPOINTS || []);
        toast.success('Sentence Laundry demo data populated!');
    };

    // UI State
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [latency, setLatency] = useState<number | null>(null);
    const [isVerifyingRepo, setIsVerifyingRepo] = useState(false);
    const [repoStatus, setRepoStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [capturedHash, setCapturedHash] = useState<string | null>(null);

    // Auto-generate slug from name
    useEffect(() => {
        if (name && !slug) {
            setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
        }
    }, [name]);

    const handleTestConnection = async () => {
        if (!upstreamUrl) {
            toast.error('Please enter a URL first');
            return;
        }
        setIsTestingConnection(true);
        setConnectionStatus('idle');

        try {
            const data = await testConnection(upstreamUrl);
            setIsTestingConnection(false);
            if (data.success) {
                setConnectionStatus('success');
                setLatency(data.latency);
                toast.success('Connection Successful (200 OK)');
            } else {
                setConnectionStatus('error');
                setLatency(null);
                toast.error('Connection Failed. Check URL.');
            }
        } catch (err: any) {
            setIsTestingConnection(false);
            setConnectionStatus('error');
            setLatency(null);
            toast.error(err.message || 'Connection Probe Failed');
        }
    };

    const handleVerifyRepo = async () => {
        if (!repoUrl) {
            toast.error('Please enter a Release Tag URL');
            return;
        }
        setIsVerifyingRepo(true);
        setRepoStatus('idle');
        setCapturedHash(null);

        try {
            const data = await verifyOpenSealRepo(repoUrl);
            setIsVerifyingRepo(false);
            if (data.success) {
                setRepoStatus('success');
                setCapturedHash(data.root_hash);
                toast.success('OpenSeal Integrity Verified');
            } else {
                setRepoStatus('error');
                toast.error('Verification Failed. Check URL.');
            }
        } catch (err: any) {
            setIsVerifyingRepo(false);
            setRepoStatus('error');
            toast.error(err.message || 'Repo verification failed');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Price Conversion (USD -> Wei)
        let priceWei = '0';
        try {
            const usdVal = parseFloat(priceUsdt);
            if (!isNaN(usdVal)) {
                // Rate: 1 ETH = 2500 USD
                // Amount in ETH = usdVal / 2500
                // Amount in Wei = (usdVal / 2500) * 1e18
                const weiBig = BigInt(Math.floor((usdVal / 2500) * 1e18));
                priceWei = weiBig.toString();
            }
        } catch (err) {
            console.error(err);
        }

        const success = await handleCreateService({
            name,
            slug,
            upstream_url: upstreamUrl,
            price_wei: priceWei,
            access_requirements: {
                min_grade: minGrade,
                requires_openseal: !!repoUrl,
                requires_zk_proof: false
            },
            openseal_repo_url: repoUrl,
            category,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            description,
            capabilities: {
                endpoints: endpoints.filter(e => e.path.trim() !== '')
            }
        });

        if (success) {
            navigate('/services'); // Go back to list
        }
    };

    return (
        <div className="max-w-3xl mx-auto pb-20 animate-fade-in">
            {/* Header */}
            <div className="mb-10">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                    <Link to="/services" className="hover:text-emerald-500 transition-colors">Services</Link>
                    <span className="text-slate-300">/</span>
                    <span className="text-slate-600">New Service</span>
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Register New API Service</h1>
                        <p className="text-slate-500 mt-2 text-lg">Deploy and monetize your endpoint with high-integrity security.</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleFillDemoData}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl font-bold text-sm hover:bg-emerald-100 transition-all active:scale-95"
                    >
                        <ZapIcon className="w-4 h-4" />
                        Fill Demo Data
                    </button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">

                {/* 1. Identity */}
                <section className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <GlobeIcon className="w-24 h-24 text-emerald-500" />
                    </div>

                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-100">
                            <span className="font-bold text-lg">1</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800">Service Identity</h3>
                    </div>

                    <div className="space-y-6 relative z-10">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Service Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Premium Text Analysis"
                                className="w-full text-lg font-bold bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:font-medium placeholder:text-slate-300"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">URL Slug</label>
                                <div className="flex items-center">
                                    <span className="bg-slate-100 border border-r-0 border-slate-200 rounded-l-xl px-3 py-3 text-xs font-mono text-slate-500">highstation.net/</span>
                                    <input
                                        type="text"
                                        value={slug}
                                        onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                        placeholder="text-analysis"
                                        className="w-full font-mono text-sm bg-white border border-slate-200 rounded-r-xl px-4 py-3 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Description <span className="text-slate-300 normal-case tracking-normal">(Optional)</span></label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                rows={3}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-all resize-none"
                                placeholder="Describe what your service does..."
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Category</label>
                            <select
                                value={category}
                                onChange={e => setCategory(e.target.value)}
                                className="w-full font-bold text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-all"
                            >
                                {['General', 'DeFi', 'AI', 'Social', 'Infrastructure', 'Gaming'].map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Tags <span className="text-slate-300 normal-case tracking-normal">(comma-separated)</span></label>
                            <input
                                type="text"
                                value={tags}
                                onChange={e => setTags(e.target.value)}
                                placeholder="e.g. nlp, text, privacy"
                                className="w-full font-mono text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-all"
                            />
                        </div>
                    </div>

                </section>

                {/* 2. Network */}
                <section className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <ServerIcon className="w-24 h-24 text-blue-500" />
                    </div>

                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-100">
                            <span className="font-bold text-lg">2</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800">Network Configuration</h3>
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Upstream URL</label>
                            <span className="text-[10px] font-black px-2 py-0.5 bg-red-100 text-red-600 rounded-full uppercase tracking-tighter">Required Test</span>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                value={upstreamUrl}
                                onChange={e => setUpstreamUrl(e.target.value)}
                                placeholder="http://10.0.0.1:8080/api/v1/inference"
                                className={`flex-1 font-mono text-sm bg-slate-50 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition-all ${connectionStatus === 'error' ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20'}`}
                                required
                            />
                            <button
                                type="button"
                                onClick={handleTestConnection}
                                disabled={isTestingConnection}
                                className={`px-4 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all flex items-center gap-2 ${connectionStatus === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                {isTestingConnection ? (
                                    <ActivityIcon className="w-4 h-4 animate-spin" />
                                ) : connectionStatus === 'success' ? (
                                    <>
                                        <CheckIcon className="w-4 h-4" />
                                        Success
                                    </>
                                ) : (
                                    'Test'
                                )}
                            </button>
                        </div>
                        {connectionStatus === 'success' && latency && (
                            <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 w-fit">
                                <ActivityIcon className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="text-[10px] font-bold text-emerald-700">Latency: {latency}ms</span>
                                <span className="text-[10px] text-emerald-600/60 font-medium ml-1">Verified Baseline</span>
                            </div>
                        )}
                        <p className="mt-2 text-[10px] text-slate-400 font-medium ml-1">
                            The internal address where HighStation will forward verified requests.
                        </p>
                    </div>
                </section>

                {/* 3. Economics */}
                <section className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <ZapIcon className="w-24 h-24 text-yellow-500" />
                    </div>

                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-100">
                            <span className="font-bold text-lg">3</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800">Economics & Access</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Price per Call (USD)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={priceUsdt}
                                    onChange={e => setPriceUsdt(e.target.value)}
                                    className="w-full text-lg font-bold bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pl-10 focus:outline-none focus:border-emerald-500 transition-all"
                                />
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                            </div>
                            <p className="mt-2 text-[10px] text-slate-400 font-medium">
                                ≈ {(parseFloat(priceUsdt || '0') / 2500).toFixed(6)} ETH <span className="text-slate-300 ml-1">(Rate: 1 ETH = $2,500)</span>
                            </p>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Minimum Trust Score</label>
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Recommended: C</span>
                            </div>
                            <div className="flex justify-between bg-slate-50 p-1 rounded-xl border border-slate-200">
                                {['F', 'C', 'B', 'A'].map((grade) => (
                                    <button
                                        key={grade}
                                        type="button"
                                        onClick={() => setMinGrade(grade)}
                                        className={`flex-1 py-2 rounded-lg text-sm font-black transition-all ${minGrade === grade ? 'bg-white text-emerald-600 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {grade}
                                    </button>
                                ))}
                            </div>
                            {(minGrade === 'A' || minGrade === 'B') && (
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600 font-bold animate-pulse">
                                    <InfoIcon className="w-3 h-3" />
                                    <span>Warning: High requirement may limit agent accessibility.</span>
                                </div>
                            )}
                            <p className="mt-2 text-[10px] text-slate-400 font-medium">
                                Minimum reputation required for agents to use this API.
                            </p>
                        </div>
                    </div>
                </section>

                {/* [NEW] 4. Capabilities (Endpoints) */}
                <section className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <ActivityIcon className="w-24 h-24 text-purple-500" />
                    </div>

                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-100">
                                <span className="font-bold text-lg">4</span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800">Capabilities & Schema</h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEndpoints([...endpoints, { path: '', description: '', input_template: '{\n  "param": "value" # description\n}' }])}
                            className="bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-purple-100 hover:bg-purple-100 transition-all flex items-center gap-1"
                        >
                            <span className="text-lg">+</span> Add Endpoint
                        </button>
                    </div>

                    <div className="space-y-6 relative z-10">
                        {endpoints.length === 0 ? (
                            <div className="text-center py-10 border-2 border-dashed border-slate-100 rounded-2xl">
                                <p className="text-slate-400 text-sm font-medium">No custom endpoints defined. Root will be used.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {endpoints.map((ep, idx) => (
                                    <div key={idx} className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-4 relative">
                                        <button
                                            type="button"
                                            onClick={() => setEndpoints(endpoints.filter((_, i) => i !== idx))}
                                            className="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition-colors"
                                        >
                                            <span className="text-lg">×</span>
                                        </button>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Path</label>
                                                <div className="flex items-center">
                                                    <span className="bg-white border border-r-0 border-slate-200 rounded-l-xl px-3 py-2 text-[10px] font-mono text-slate-400">/resource/</span>
                                                    <input
                                                        type="text"
                                                        value={ep.path}
                                                        onChange={e => {
                                                            const copy = [...endpoints];
                                                            copy[idx].path = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                                                            setEndpoints(copy);
                                                        }}
                                                        placeholder="wash"
                                                        className="w-full font-mono text-xs bg-white border border-slate-200 rounded-r-xl px-3 py-2 focus:outline-none focus:border-purple-500 transition-all"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Functional Description</label>
                                                <input
                                                    type="text"
                                                    value={ep.description}
                                                    onChange={e => {
                                                        const copy = [...endpoints];
                                                        copy[idx].description = e.target.value;
                                                        setEndpoints(copy);
                                                    }}
                                                    placeholder="Standard translation chain"
                                                    className="w-full text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-purple-500 transition-all font-medium"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Input Template (JSON + Comments)</label>
                                            <textarea
                                                rows={4}
                                                value={ep.input_template}
                                                onChange={e => {
                                                    const copy = [...endpoints];
                                                    copy[idx].input_template = e.target.value;
                                                    setEndpoints(copy);
                                                }}
                                                className="w-full font-mono text-[11px] bg-white border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 transition-all resize-none leading-relaxed"
                                                placeholder='{\n  "param": "value" # description\n}'
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* 5. Security */}
                <section className="bg-emerald-50/50 rounded-2xl border border-emerald-100 p-8 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <ShieldIcon className="w-24 h-24 text-emerald-600" />
                    </div>

                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-white text-emerald-600 flex items-center justify-center border border-emerald-100 shadow-sm">
                            <ShieldIcon className="w-5 h-5" />
                        </div>
                        <h3 className="text-xl font-bold text-emerald-900">Security Verification</h3>
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-emerald-700/60">OpenSeal Repository / Release Tag URL</label>
                            <span className="text-[10px] font-black px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full uppercase tracking-tighter">Required Check</span>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={repoUrl}
                                onChange={e => setRepoUrl(e.target.value)}
                                placeholder="https://github.com/username/service-repo"
                                className="flex-1 font-mono text-sm bg-white border border-emerald-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-emerald-300/50"
                            />
                            <button
                                type="button"
                                onClick={handleVerifyRepo}
                                disabled={isVerifyingRepo}
                                className={`px-4 rounded-xl font-bold text-xs uppercase tracking-wider border -ml-px transition-all flex items-center gap-2 ${repoStatus === 'success' ? 'bg-emerald-600 border-emerald-700 text-white shadow-lg shadow-emerald-500/30' : repoStatus === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-emerald-500 text-white border-transparent hover:bg-emerald-400 shadow-lg shadow-emerald-500/20'}`}
                            >
                                {isVerifyingRepo ? (
                                    <ActivityIcon className="w-4 h-4 animate-spin text-white" />
                                ) : repoStatus === 'success' ? (
                                    <>
                                        <CheckIcon className="w-4 h-4" />
                                        Verified
                                    </>
                                ) : repoStatus === 'error' ? (
                                    'Failed'
                                ) : (
                                    'Verify'
                                )}
                            </button>
                        </div>
                        {repoStatus === 'success' && capturedHash && (
                            <div className="mt-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100/50">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tighter">Root A-Hash Registered</span>
                                </div>
                                <code className="text-[10px] text-emerald-600/70 font-mono break-all leading-tight block">
                                    {capturedHash}
                                </code>
                            </div>
                        )}
                        <div className="flex items-start gap-2 mt-3">
                            <InfoIcon className="w-4 h-4 text-emerald-600/70 shrink-0 mt-0.5" />
                            <p className="text-xs text-emerald-800/70 leading-relaxed">
                                Providing a repository URL enables <strong>OpenSeal</strong> verification.
                                HighStation will verify that your running service matches the source code,
                                earning the <span className="font-bold text-emerald-700">Verified Badge</span>.
                            </p>
                        </div>
                        {repoStatus === 'error' && (
                            <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded-xl">
                                <p className="text-[10px] text-red-600 font-bold leading-tight">
                                    Identity mismatch: No openseal.json found at target or checksum failure.
                                    Deployment is restricted until integrity is confirmed.
                                </p>
                            </div>
                        )}
                    </div>
                </section>

                <div className="flex items-center justify-end gap-6 pt-4">
                    <div className="text-right">
                        {(connectionStatus !== 'success' || repoStatus !== 'success') && (
                            <p className="text-[10px] font-bold text-slate-400 mb-1">
                                {!upstreamUrl || connectionStatus !== 'success' ? '• Connection test required ' : ''}
                                {!repoUrl || repoStatus !== 'success' ? '• Security verification required' : ''}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate('/services')}
                            className="px-6 py-4 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={connectionStatus !== 'success' || repoStatus !== 'success'}
                            className={`px-8 py-4 font-bold rounded-xl transition-all flex items-center gap-2 shadow-xl ${connectionStatus === 'success' && repoStatus === 'success' ? 'bg-slate-900 hover:bg-slate-800 text-white active:scale-[0.98] hover:shadow-2xl' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-300'}`}
                        >
                            <span>Deploy Service</span>
                            <ArrowUpRightIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

            </form>
        </div >
    );
}
