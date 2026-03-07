export type BnType = 'ok' | 'warn' | 'error' | 'info';
export type FlowCol = 'gold' | 'dim' | 'warn' | 'error' | 'success' | 'info' | 'text';
export type MathCls = 'accent' | 'warn' | 'ok';

export interface FlowLine { text: string; col: FlowCol; note?: string; }
export interface MathToken { n?: string; unit?: string; cls?: MathCls; op?: string; sep?: boolean; }

export interface RaceItem {
  config: string; time: number; barClass: string; best?: boolean;
  math: MathToken[]; flow: FlowLine[]; keypoints: string[];
  bottleneck: string; bnType: BnType;
}
export interface GroupMeta {
  concurrency: string;
  protocol: string;
  tls: string;
  spawns: string;
  rateLimiter: string;
}
export interface RaceGroup { label: string; color: string; meta: GroupMeta; items: RaceItem[]; }

export const RACE_GROUPS: RaceGroup[] = [
  {
    label: 'Go', color: '#e8b866',
    meta: { concurrency: 'goroutines', protocol: 'HTTP/2 (ALPN)', tls: '3', spawns: '0', rateLimiter: 'fixed (QPS=100)' },
    items: [
      {
        config: 'rate-limit bug (QPS=5, Burst=10)', time: 103, barClass: 'bar-go-bug',
        math: [{n:'24',unit:'goroutines'},{op:'×'},{n:'9',unit:'calls'},{op:'='},{n:'216',unit:'total'},{sep:true},{n:'QPS=5',unit:'Burst=10',cls:'warn'}],
        flow: [
          {text:'all goroutines fire simultaneously:',col:'dim'},
          {text:'  ns1: GET deployments  ← token ✓',col:'success'},
          {text:'  ns2: GET deployments  ← token ✓',col:'success'},
          {text:'  ... × 10  (burst=10 exhausted)',col:'dim'},
          {text:'  ns11: GET deployments ← wait 200ms',col:'warn'},
          {text:'  ns12: GET deployments ← wait 400ms',col:'warn'},
          {text:'  206 remaining calls queue up behind limiter',col:'error'},
          {text:'  206 × 200ms avg = ~41s of pure waiting',col:'error'},
        ],
        keypoints: ['HTTP/2 + goroutines — architecturally correct','But QPS=5 refills 1 token every 200ms','Burst=10 exhausted in the first wave of goroutines','206 API calls sit in the queue → 103s total'],
        bottleneck: 'QPS=5 Burst=10 default: 206 queued calls × 200ms avg wait ≈ 41s wasted', bnType: 'error',
      },
      {
        config: 'namespaces=2', time: 14, barClass: 'bar-go-dim',
        math: [{n:'2',unit:'concurrent ns',cls:'warn'},{sep:true},{n:'avg 14s',unit:'(6 runs: 16,14,18,14,11,8)'}],
        flow: [
          {text:'sem capacity = 2 — only 2 ns goroutines at a time',col:'warn'},
          {text:'inner: 7 goroutines per ns still run in parallel',col:'success'},
          {text:'but outer concurrency is too low',col:'warn'},
          {text:'24 ns effectively processed in 12 waves of 2',col:'dim'},
        ],
        keypoints: ['Under-using goroutine capacity','Consistent: 8–18s across 6 runs','API server barely touched'],
        bottleneck: 'Too few concurrent namespaces — goroutine capacity mostly idle', bnType: 'warn',
      },
      {
        config: 'namespaces=3', time: 9, barClass: 'bar-go-dim',
        math: [{n:'3',unit:'concurrent ns',cls:'accent'},{sep:true},{n:'avg 9s',unit:'(6 runs: 8,8,9,8,9,9)'}],
        flow: [
          {text:'original binary default before tuning',col:'dim'},
          {text:'3 × 7 inner = 21 concurrent API calls',col:'success'},
          {text:'very consistent: all runs 8–9s',col:'success'},
        ],
        keypoints: ['Consistent — no throttle events','Room to improve','Original default value'],
        bottleneck: 'Moderate concurrency — not yet pressing API server limits', bnType: 'info',
      },
      {
        config: 'namespaces=5', time: 7, barClass: 'bar-go',
        math: [{n:'5',unit:'concurrent ns',cls:'accent'},{sep:true},{n:'avg 7s',unit:'(6 runs: 6,8,7,6,6,7)'}],
        flow: [
          {text:'5 × 7 inner = 35 concurrent API calls',col:'success'},
          {text:'all 6 runs within 6–8s',col:'success'},
          {text:'no throttle events observed',col:'success'},
        ],
        keypoints: ['Stable — all runs 6–8s','Safe margin from API throttle','Good default for production'],
        bottleneck: 'No bottleneck at this level', bnType: 'ok',
      },
      {
        config: 'namespaces=7', time: 7, barClass: 'bar-go', best: true,
        math: [{n:'7',unit:'concurrent ns',cls:'ok'},{sep:true},{n:'avg 7s',unit:'(6 runs: 6,6,5,10,6,6)'}],
        flow: [
          {text:'7 × 7 inner = 49 concurrent API calls',col:'success'},
          {text:'5 of 6 runs: 5–6s',col:'success'},
          {text:'1 run spiked to 10s (transient API pressure)',col:'warn'},
          {text:'most stable high-concurrency result',col:'success'},
        ],
        keypoints: ['Most consistent at high concurrency','5 of 6 runs: 5–6s','One transient 10s spike — not systematic'],
        bottleneck: 'Occasional transient API pressure — not a systematic problem', bnType: 'ok',
      },
      {
        config: 'namespaces=8', time: 6, barClass: 'bar-go',
        math: [{n:'8',unit:'concurrent ns'},{sep:true},{n:'6s',unit:'stable'},{sep:true},{n:'79s',unit:'outlier',cls:'warn'}],
        flow: [
          {text:'pass 1 runs: 17s, 7s, 79s (!!)',col:'warn'},
          {text:'pass 2 runs: 6s, 5s, 6s',col:'success'},
          {text:'79s = API throttle triggered after cumulative test load',col:'error'},
          {text:'with a fresh cluster: consistently 5–6s',col:'success'},
        ],
        keypoints: ['Fastest in ideal conditions','79s outlier from cumulative throttle — not a fresh-cluster result','Risky in automated pipelines — no safety margin'],
        bottleneck: 'API server throttle risk: one bad run = 79s. Reserve for controlled environments.', bnType: 'warn',
      },
      {
        config: 'namespaces=10', time: 6, barClass: 'bar-go',
        math: [{n:'10',unit:'concurrent ns'},{sep:true},{n:'avg 6s',unit:'(6 runs: 9,6,5,6,7,5)'}],
        flow: [
          {text:'10 × 7 inner = 70 concurrent API calls',col:'warn'},
          {text:'runs: 9,6,5,6,7,5 — slightly more variance',col:'dim'},
          {text:'API server handling it but at the edge',col:'warn'},
        ],
        keypoints: ['Fastest average but more variance than j=7–8','API server at its limit','Not meaningfully faster than j=8'],
        bottleneck: 'API server connection pressure at 70 concurrent calls', bnType: 'warn',
      },
    ],
  },
  {
    label: 'Node.js — single thread', color: '#6aaccc',
    meta: { concurrency: 'Promise.all', protocol: 'HTTP/1.1', tls: '~72', spawns: '0', rateLimiter: 'none' },
    items: [
      {
        config: 'jobs=1', time: 47, barClass: 'bar-ns-s-d',
        math: [{n:'1',unit:'concurrent ns',cls:'warn'},{sep:true},{n:'47s'}],
        flow: [
          {text:'1 namespace at a time',col:'warn'},
          {text:'within each ns: Promise.all(22 calls) concurrent',col:'success'},
          {text:'next ns waits for current to fully finish',col:'warn'},
        ],
        keypoints: ['22 concurrent API calls within each ns','No inter-namespace overlap','API server response time adds linearly'],
        bottleneck: 'Sequential namespaces — no I/O overlap across ns boundaries', bnType: 'warn',
      },
      {
        config: 'jobs=3', time: 16, barClass: 'bar-ns-s-d',
        math: [{n:'3',unit:'concurrent ns',cls:'accent'},{op:'×'},{n:'22',unit:'calls'},{op:'='},{n:'66',unit:'peak in-flight'}],
        flow: [
          {text:'work-stealing: always 3 ns in-flight',col:'success'},
          {text:'ns done → next ns immediately starts',col:'success'},
          {text:'66 peak concurrent requests',col:'dim'},
          {text:'TIME_WAIT: 25 measured',col:'dim'},
        ],
        keypoints: ['Work-stealing: no idle slots','66 peak in-flight','HTTP/1.1 keep-alive — partial reuse across ns'],
        bottleneck: 'HTTP/1.1 — no multiplexing. Each new ns cycle may open new TCP connections.', bnType: 'info',
      },
      {
        config: 'jobs=5', time: 10, barClass: 'bar-ns-s-d',
        math: [{n:'5',unit:'concurrent ns',cls:'accent'},{op:'×'},{n:'22',unit:'calls'},{op:'='},{n:'110',unit:'peak in-flight'}],
        flow: [
          {text:'110 concurrent requests peak',col:'success'},
          {text:'API server starting to feel pressure',col:'warn'},
          {text:'TIME_WAIT: 38 measured',col:'dim'},
        ],
        keypoints: ['110 peak — approaching API server limits','Still faster than jobs=3','TIME_WAIT accumulating faster'],
        bottleneck: 'Approaching API server connection ceiling', bnType: 'info',
      },
      {
        config: 'jobs=7', time: 8, barClass: 'bar-ns-s', best: true,
        math: [{n:'7',unit:'concurrent ns',cls:'ok'},{op:'×'},{n:'22',unit:'calls'},{op:'='},{n:'154',unit:'peak in-flight',cls:'warn'}],
        flow: [
          {text:'154 peak ESTABLISHED (measured)',col:'warn'},
          {text:'at API server limit edge',col:'warn'},
          {text:'TIME_WAIT: 72 — semaphore burst closes pile up',col:'warn'},
          {text:'work-stealing: zero idle slots, no stall',col:'success'},
        ],
        keypoints: ['154 peak ESTABLISHED — at API server limit','TIME_WAIT 72 — semaphore causes burst close events','Still fastest Node.js config: 8s'],
        bottleneck: 'API server connection pressure — adding more jobs makes things worse', bnType: 'info',
      },
    ],
  },
  {
    label: 'Node.js — worker threads', color: '#4a8aaa',
    meta: { concurrency: 'thread pool', protocol: 'HTTP/1.1', tls: '~24', spawns: '0', rateLimiter: 'none' },
    items: [
      {
        config: 'workers=3', time: 25, barClass: 'bar-ns-w-d',
        math: [{n:'3',unit:'workers',cls:'accent'},{sep:true},{n:'25s'}],
        flow: [
          {text:'round-robin assignment at startup:',col:'dim'},
          {text:'Worker 0: [ns0, ns3, ns6, ...]',col:'info'},
          {text:'Worker 1: [ns1, ns4, ns7, ...]',col:'info'},
          {text:'Worker 2: [ns2, ns5, ns8, ...]',col:'info'},
          {text:'each worker: sequential ns loop, per-ns Promise.all',col:'dim'},
        ],
        keypoints: ['Static assignment — no work-stealing','Slow ns stalls its worker','3 separate HTTP pools'],
        bottleneck: 'Static assignment: slow namespace (istio-system, 180 roles) stalls its worker', bnType: 'warn',
      },
      {
        config: 'workers=4', time: 22, barClass: 'bar-ns-w', best: true,
        math: [{n:'4',unit:'workers',cls:'ok'},{sep:true},{n:'22s'},{sep:true},{n:'TIME_WAIT=23',unit:'(fewer than single-thread)'}],
        flow: [
          {text:'4 pools × ~6 conns each = ~24 TCP handshakes',col:'dim'},
          {text:'fewer total TCP opens than single-thread (23 vs 72)',col:'success'},
          {text:'istio-system → one worker stalls while others idle',col:'warn'},
        ],
        keypoints: ['Sweet spot for workers','Fewer TCP connections than single-thread','Static assignment still creates idle slots'],
        bottleneck: 'istio-system stalls its worker — others finish early and sit idle', bnType: 'info',
      },
      {
        config: 'workers=5', time: 27, barClass: 'bar-ns-w-d',
        math: [{n:'5',unit:'workers',cls:'warn'},{sep:true},{n:'27s'}],
        flow: [
          {text:'5 pools → more concurrent API requests',col:'warn'},
          {text:'API server throttle starts: 429 responses increase',col:'warn'},
          {text:'each request slower → overall time rises',col:'warn'},
        ],
        keypoints: ['Slower than workers=4 — API pressure wins','More pools = more throttling'],
        bottleneck: 'Too many concurrent pools — API server throttles all of them', bnType: 'warn',
      },
    ],
  },
  {
    label: 'Node.js — child processes', color: '#506aaa',
    meta: { concurrency: 'child processes', protocol: 'HTTP/1.1', tls: 'varies', spawns: 'varies', rateLimiter: 'none' },
    items: [
      {
        config: 'procs=3', time: 22, barClass: 'bar-ns-p-d',
        math: [{n:'3',unit:'child procs',cls:'accent'},{sep:true},{n:'22s'}],
        flow: [
          {text:'3 separate Node.js processes (full V8 + kubeconfig each)',col:'dim'},
          {text:'~150ms cold-start per process',col:'warn'},
          {text:'OS-level TCP isolation — pools cannot share connections',col:'warn'},
          {text:'same static round-robin problem as workers',col:'warn'},
        ],
        keypoints: ['V8 cold-start overhead × 3','Completely isolated TCP stacks','Static assignment'],
        bottleneck: 'V8 cold-start + isolated TCP + static assignment', bnType: 'warn',
      },
      {
        config: 'procs=4', time: 21, barClass: 'bar-ns-p', best: true,
        math: [{n:'4',unit:'child procs',cls:'ok'},{sep:true},{n:'21s'},{sep:true},{n:'TIME_WAIT=26',unit:'(measured)'}],
        flow: [
          {text:'4 × ~150ms V8 startup = ~600ms overhead',col:'warn'},
          {text:'TIME_WAIT: 26 — isolated stacks, smaller per-process bursts',col:'dim'},
          {text:'best procs result: 21s',col:'success'},
        ],
        keypoints: ['Best procs result','V8 overhead manageable at 4','Isolated TCP stacks'],
        bottleneck: 'Static assignment + V8 process isolation overhead', bnType: 'info',
      },
      {
        config: 'procs=5', time: 25, barClass: 'bar-ns-p-d',
        math: [{n:'5',unit:'child procs',cls:'warn'},{sep:true},{n:'25s'}],
        flow: [
          {text:'5 × V8 heap (~100MB each) = ~500MB RAM',col:'warn'},
          {text:'GC pressure begins',col:'warn'},
          {text:'procs=6: hung, required ctrl+c to exit',col:'error'},
        ],
        keypoints: ['Memory pressure starts at procs=5','procs=6: 600MB+ → GC + API throttle → hang'],
        bottleneck: 'Memory (V8 heap × N) + API throttling — combinatorially bad past n=5', bnType: 'warn',
      },
    ],
  },
  {
    label: 'Bash — sequential', color: '#a07840',
    meta: { concurrency: 'sequential', protocol: 'HTTP/1.1 (kubectl)', tls: '216', spawns: '216', rateLimiter: 'none' },
    items: [
      {
        config: 'jobs=1', time: 319, barClass: 'bar-bash-s',
        math: [{n:'24',unit:'ns'},{op:'×'},{n:'9',unit:'kubectl'},{op:'='},{n:'216',unit:'spawns',cls:'warn'},{sep:true},{n:'1',unit:'at a time',cls:'warn'}],
        flow: [
          {text:'ns1: kubectl get deployments  ← fork+exec+TLS ~200ms',col:'warn'},
          {text:'     kubectl get services     ← fork+exec+TLS ~200ms',col:'warn'},
          {text:'     kubectl get pods         ← fork+exec+TLS ~200ms',col:'warn'},
          {text:'     ... × 9 kubectl total',col:'warn'},
          {text:'ns2: (waits for ns1 to fully finish)',col:'dim'},
          {text:'ns3: (waits for ns2)',col:'dim'},
          {text:'... 319s total',col:'error'},
        ],
        keypoints: ['216 process spawns — all serial','216 TLS handshakes — all serial','No overlap possible: ns2 cannot start until ns1 exits completely','API server idle most of the time'],
        bottleneck: 'Fully sequential: 216 spawns × (spawn overhead + API wait) = 319s', bnType: 'error',
      },
    ],
  },
  {
    label: 'Bash — batch (no GNU parallel)', color: '#b08848',
    meta: { concurrency: 'batched subshells', protocol: 'HTTP/1.1 (kubectl)', tls: 'varies', spawns: 'varies', rateLimiter: 'none' },
    items: [
      {
        config: 'jobs=6', time: 70, barClass: 'bar-bash-bd',
        math: [{n:'24',unit:'ns'},{op:'÷'},{n:'6',unit:'per batch'},{op:'='},{n:'4',unit:'batches',cls:'accent'}],
        flow: [
          {text:'batch 1: [ns1][ns2][ns3][ns4][ns5][ns6] &',col:'success'},
          {text:'         bash wait ← blocks until slowest done',col:'warn'},
          {text:'batch 2: [ns7]...[ns12] &',col:'success'},
          {text:'         bash wait',col:'warn'},
          {text:'ns1=8s ns2=3s ns3=5s → batch takes 8s (not avg)',col:'dim'},
        ],
        keypoints: ['4 synchronous batch barriers','Slowest ns in each batch stalls all others','216 TLS handshakes still happen'],
        bottleneck: 'Batch gate: slowest namespace blocks all slots at every barrier', bnType: 'warn',
      },
      {
        config: 'jobs=8', time: 58, barClass: 'bar-bash-b', best: true,
        math: [{n:'24',unit:'ns'},{op:'÷'},{n:'8',unit:'per batch'},{op:'='},{n:'3',unit:'batches',cls:'ok'}],
        flow: [
          {text:'3 clean batches of 8 → 58s',col:'success'},
          {text:'TIME_WAIT: 6 (connections scatter across 58s)',col:'dim'},
          {text:'Peak ESTABLISHED: 72',col:'dim'},
          {text:'216 TLS handshakes still happen across run',col:'dim'},
        ],
        keypoints: ['Sweet spot — 3 clean batches','TIME_WAIT low: connections scatter, no burst close','216 handshakes spread across 58s'],
        bottleneck: 'Batch gate still exists at 3 boundaries — GNU parallel eliminates these', bnType: 'info',
      },
      {
        config: 'jobs=9', time: 62, barClass: 'bar-bash-bd',
        math: [{n:'24',unit:'ns'},{op:'÷'},{n:'9',unit:'per batch'},{sep:true},{n:'uneven batches'}],
        flow: [
          {text:'24 / 9 = 2 batches of 9, 1 batch of 6',col:'warn'},
          {text:'batch 3: only 6 slots used — 3 idle',col:'warn'},
          {text:'slower than jobs=8 due to wasted capacity',col:'warn'},
        ],
        keypoints: ['Uneven batch split wastes slots','Slower than jobs=8'],
        bottleneck: 'Uneven batch: 3 idle slots in final batch of 6', bnType: 'warn',
      },
    ],
  },
  {
    label: 'Bash — GNU parallel', color: '#6dca82',
    meta: { concurrency: 'GNU parallel', protocol: 'HTTP/1.1 (kubectl)', tls: '216', spawns: '216', rateLimiter: 'none' },
    items: [
      {
        config: 'jobs=6', time: 69, barClass: 'bar-bash-gd',
        math: [{n:'6',unit:'slots',cls:'accent'},{sep:true},{n:'24',unit:'ns'},{sep:true},{n:'69s'}],
        flow: [
          {text:'work-stealing: any slot done → next ns immediately',col:'success'},
          {text:'no synchronous batch barrier',col:'success'},
          {text:'but 69s vs batch-j6=70s → nearly identical',col:'dim'},
          {text:'API server uniform → no skewed ns to steal from',col:'dim'},
        ],
        keypoints: ['Work-stealing eliminates barriers','But API was uniform — no heavy imbalance to rescue','Nearly same result as batch at jobs=6'],
        bottleneck: 'Same as batch at this concurrency — no namespace imbalance to exploit', bnType: 'info',
      },
      {
        config: 'jobs=8', time: 58, barClass: 'bar-bash-g', best: true,
        math: [{n:'8',unit:'slots',cls:'ok'},{sep:true},{n:'58s'},{sep:true},{n:'TIME_WAIT=5',unit:'(measured)'}],
        flow: [
          {text:'always 8 slots running — zero idle time',col:'success'},
          {text:'slot finishes → next ns starts immediately',col:'success'},
          {text:'TIME_WAIT: 5 (same scatter pattern as batch)',col:'dim'},
          {text:'Peak SYN_SENT: 75 (burst-connect moments)',col:'dim'},
        ],
        keypoints: ['Work-stealing eliminates batch barriers','Same 58s as batch-j8 — API was uniform this run','TIME_WAIT identical to batch — same connection scatter','216 TLS handshakes — process spawn is still the floor'],
        bottleneck: 'Process spawn is the floor — 216 TLS handshakes regardless of job scheduler', bnType: 'info',
      },
      {
        config: 'jobs=9', time: 62, barClass: 'bar-bash-gd',
        math: [{n:'9',unit:'slots',cls:'warn'},{sep:true},{n:'62s'}],
        flow: [
          {text:'slight API server pressure at 9 concurrent ns',col:'warn'},
          {text:'some kubectl calls respond slower',col:'warn'},
          {text:'work-stealing helps but API is the bottleneck now',col:'dim'},
        ],
        keypoints: ['API throttle starts at jobs=9','Work-stealing cannot help when API is saturated'],
        bottleneck: 'API server throttle at 9 concurrent namespaces', bnType: 'warn',
      },
    ],
  },
];

export interface TcpRow {
  mode: string; color: 'gold' | 'info' | 'dim';
  established: number; synSent: number; timeWait: number;
  why: string; best?: boolean;
}

export const TCP_ROWS: TcpRow[] = [
  { mode: 'go-j7',         color: 'gold', established: 12,  synSent: 76,  timeWait: 3,  why: 'HTTP/2 multiplex — 1 TCP shared by all streams. 3 total: 2 EKS IPs + 1 reconnect.', best: true },
  { mode: 'node-single-j7',color: 'info', established: 154, synSent: 153, timeWait: 72, why: 'Semaphore releases 7 ns simultaneously → 154 connections at once → burst close → TIME_WAIT spikes.', best: true },
  { mode: 'node-single-j5',color: 'dim',  established: 110, synSent: 108, timeWait: 38, why: 'Fewer ns in-flight → fewer simultaneous connections.' },
  { mode: 'node-single-j3',color: 'dim',  established: 62,  synSent: 61,  timeWait: 25, why: '3 ns × 22 calls = 66 peak. TIME_WAIT lower — burst closes are smaller.' },
  { mode: 'node-workers-4',color: 'dim',  established: 61,  synSent: 48,  timeWait: 23, why: '4 separate pools, each serves a fixed namespace set. Fewer total opens than single-thread.', best: true },
  { mode: 'node-workers-3',color: 'dim',  established: 46,  synSent: 44,  timeWait: 72, why: 'Fewer workers but pools held open longer — more TIME_WAIT accumulation despite lower peak.' },
  { mode: 'node-procs-4',  color: 'dim',  established: 55,  synSent: 44,  timeWait: 26, why: '4 OS processes with completely isolated TCP stacks.', best: true },
  { mode: 'node-procs-5',  color: 'dim',  established: 84,  synSent: 81,  timeWait: 29, why: 'More processes, more pools, more connections.' },
  { mode: 'bash-seq-j1',   color: 'dim',  established: 14,  synSent: 14,  timeWait: 22, why: 'Sequential — only ~9 kubectl alive at a time, but run is slow enough some TIME_WAIT survives.' },
  { mode: 'bash-batch-j8', color: 'dim',  established: 72,  synSent: 64,  timeWait: 6,  why: 'Connections scatter across 58s run — no simultaneous burst close, TIME_WAIT expires mid-run.', best: true },
  { mode: 'bash-batch-j9', color: 'dim',  established: 84,  synSent: 60,  timeWait: 4,  why: 'Same scatter pattern — connections cycle fast enough to expire.' },
  { mode: 'bash-gnu-j8',   color: 'dim',  established: 54,  synSent: 75,  timeWait: 5,  why: 'Work-stealing vs batch: similar connection count, but lower ESTABLISHED (fewer idle slots).', best: true },
  { mode: 'bash-gnu-j9',   color: 'dim',  established: 55,  synSent: 75,  timeWait: 3,  why: 'Near-zero accumulation — connections too scattered to pile up in the 60s window.' },
];

export interface PrimStat { label: string; value: string; cls?: 'error' | 'warn' | 'ok'; }
export interface PrimCard { title: string; stats: PrimStat[]; }

export const PRIM_CARDS: PrimCard[] = [
  {
    title: 'OS Process',
    stats: [
      { label: 'Memory', value: 'Isolated address space' },
      { label: 'Stack', value: '~1–8 MB' },
      { label: 'Create', value: 'fork() + exec()' },
      { label: 'OS visible', value: 'PID ✓' },
      { label: 'Kill', value: 'SIGKILL' },
      { label: 'Context switch', value: '~10,000 ns', cls: 'error' },
      { label: 'New TLS per unit', value: 'Yes — every spawn', cls: 'error' },
      { label: 'In this project', value: 'bash kubectl, node procs' },
    ],
  },
  {
    title: 'OS Thread',
    stats: [
      { label: 'Memory', value: 'Shared heap' },
      { label: 'Stack', value: '~1–8 MB fixed' },
      { label: 'Create', value: 'pthread_create()' },
      { label: 'OS visible', value: 'TID ✓' },
      { label: 'Kill', value: 'pthread_cancel()' },
      { label: 'Context switch', value: '~1,000 ns', cls: 'warn' },
      { label: 'New TLS per unit', value: 'No — shared pool' },
      { label: 'In this project', value: 'node worker_threads' },
    ],
  },
  {
    title: 'Goroutine',
    stats: [
      { label: 'Memory', value: 'Shared heap' },
      { label: 'Stack', value: '~2–8 KB (grows)', cls: 'ok' },
      { label: 'Create', value: 'go func()' },
      { label: 'OS visible', value: 'No' },
      { label: 'Kill', value: 'channel / context' },
      { label: 'Context switch', value: '~100 ns (10× thread)', cls: 'ok' },
      { label: 'New TLS per unit', value: 'No — HTTP/2 shared', cls: 'ok' },
      { label: 'In this project', value: 'Go binary (ns + batch)' },
    ],
  },
];
