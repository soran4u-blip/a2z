import { useState } from 'react';
import { 
  Sparkles, 
  Code2, 
  Layers, 
  Compass, 
  Rocket, 
  Database, 
  Palette, 
  Bot, 
  CheckCircle2, 
  ArrowRight,
  Terminal,
  Zap
} from 'lucide-react';

const SUGGESTIONS = [
  {
    icon: Bot,
    title: "AI-Powered Tool",
    desc: "Smart assistants, document analyzers, prompt playgrounds, or audio/vision tooling.",
    tag: "Gemini 2.5/Flash"
  },
  {
    icon: Layers,
    title: "SaaS Dashboard & CRM",
    desc: "Metrics tracking, client portals, billing overviews, and data visualization.",
    tag: "Analytics"
  },
  {
    icon: Database,
    title: "Firestore & Cloud Database",
    desc: "Real-time task boards, collaborative notes, inventory trackers with live sync.",
    tag: "Full-Stack"
  },
  {
    icon: Palette,
    title: "Interactive Canvas & Creative App",
    desc: "Generative art, diagram builders, audio synths, or design editors.",
    tag: "Creative"
  }
];

export default function App() {
  const [copiedIdea, setCopiedIdea] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedIdea(text);
    setTimeout(() => setCopiedIdea(null), 2000);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Background ambient accents */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-neutral-800/80 bg-neutral-950/70 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-tight text-neutral-100 flex items-center gap-2">
              App Studio
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Ready
              </span>
            </h1>
            <p className="text-xs text-neutral-400">Workspace initialized</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Vite + React 19 + Tailwind v4</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-6">
            <Zap className="w-3.5 h-3.5" /> Ready to build anything you need
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
            Hello! What would you like to build today?
          </h2>
          <p className="text-base text-neutral-400 leading-relaxed">
            Tell me what you'd like to create — describe the application, features, or design, and I'll build it out for you step by step.
          </p>
        </div>

        {/* Ideas Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto w-full mb-10">
          {SUGGESTIONS.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div 
                key={idx}
                className="group relative p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/90 transition-all duration-200 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl bg-neutral-800 flex items-center justify-center text-neutral-200 group-hover:bg-indigo-600/20 group-hover:text-indigo-300 transition-colors">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-mono text-neutral-400 bg-neutral-800/60 px-2 py-0.5 rounded-md border border-neutral-700/50">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm text-neutral-200 group-hover:text-white mb-1">
                    {item.title}
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between text-xs text-neutral-400">
                  <span className="text-[11px] text-neutral-500">Prompt idea</span>
                  <button
                    onClick={() => handleCopy(`Build a ${item.title.toLowerCase()}: ${item.desc}`)}
                    className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors font-medium cursor-pointer"
                  >
                    {copiedIdea === `Build a ${item.title.toLowerCase()}: ${item.desc}` ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        Copy prompt <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Tips / Capability Banner */}
        <div className="max-w-3xl mx-auto w-full p-4 rounded-xl bg-neutral-900/40 border border-neutral-800/60 text-xs text-neutral-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-neutral-400 shrink-0" />
            <span>Type your requirement in the chat to start constructing your application.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-neutral-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>Interactive & Real-time</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-neutral-800/80 px-6 py-4 text-center text-xs text-neutral-400">
        Ready for instructions. Tell me what features, layouts, or workflows to build.
      </footer>
    </div>
  );
}

