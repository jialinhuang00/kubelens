import { Component, signal, HostListener } from '@angular/core';

interface Page { title: string; lines: string[] }
interface Spread { en: { left: Page; right: Page }; zh: { left: Page; right: Page } }

const SPREADS: Spread[] = [
  {
    en: {
      left: {
        title: 'Welcome to kubecmds-viz',
        lines: [
          'kubecmds-viz is a visual interface for',
          'Kubernetes. Browse, query, and manage',
          'cluster resources without memorising',
          'every kubectl flag.',
          '',
          'Two modes are available:',
          '• Realtime — talks to a live cluster',
          '• Snapshot — reads local exported data',
          '',
          'See the right page for how to switch.',
        ],
      },
      right: {
        title: 'Two Modes',
        lines: [
          'The [R] / [S] toggle in the top-right',
          'corner controls the active mode.',
          '',
          'Realtime',
          'Every action runs kubectl directly.',
          'Requires a valid kubeconfig and',
          'an active cluster connection.',
          '',
          'Snapshot',
          'Reads files from k8s-snapshot/.',
          'No connection needed — great for',
          'offline analysis or sharing.',
          '',
          'Switching modes reloads the',
          'namespace list automatically.',
        ],
      },
    },
    zh: {
      left: {
        title: '歡迎使用 kubecmds-viz',
        lines: [
          'kubecmds-viz 是一套視覺化 Kubernetes',
          '操作介面，讓你不需要熟記所有',
          'kubectl 指令，就能查詢、管理、',
          '觀察叢集裡的各種資源。',
          '',
          '它有兩種工作模式：',
          '• Realtime — 直接連線到真實叢集',
          '• Snapshot — 讀取本機匯出的靜態資料',
          '',
          '右頁說明如何切換。',
        ],
      },
      right: {
        title: '兩種模式',
        lines: [
          '畫面右上角的 [R] / [S] 切換鈕',
          '控制目前使用哪種模式。',
          '',
          'Realtime 模式',
          '每次操作都打 kubectl，需要',
          'kubeconfig 設定正確並有叢集連線。',
          '',
          'Snapshot 模式',
          '讀取 k8s-snapshot/ 目錄的靜態檔。',
          '無需連線，適合離線分析或分享。',
          '',
          '切換模式時，左側 Namespace 清單',
          '會自動重新載入。',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'K8s Terminal',
        lines: [
          'Navigate to /terminal.',
          '',
          'Sidebar workflow:',
          'Pick a Namespace → expand a kind',
          '→ check a resource name.',
          'A panel opens automatically.',
          '',
          'The toolbar above each panel',
          'offers common actions:',
          'describe, logs, exec, and more.',
          '',
          'Panels can be dragged, resized,',
          'and arranged side by side.',
          'Use Workspaces to group them.',
        ],
      },
      right: {
        title: 'Quick Actions',
        lines: [
          'Custom command',
          'Type any kubectl command in the',
          'box at the bottom of the sidebar.',
          'Cmd+Enter to run.',
          '',
          'Panel controls',
          '• Drag title bar — move panel',
          '• Double-click title — maximise',
          '• Drag right/bottom edge — resize',
          '',
          'Workspaces',
          'Click W1 / W2 / + on the right',
          'to switch or add workspaces.',
          '',
          'Stop a stream',
          'Press ■ on the panel while running.',
        ],
      },
    },
    zh: {
      left: {
        title: 'K8s Terminal',
        lines: [
          '前往 /terminal 進入終端介面。',
          '',
          '左側選單：',
          '選擇 Namespace → 展開種類',
          '→ 勾選資源名稱，面板自動開啟。',
          '',
          '面板上方的按鈕列提供常見操作，',
          '例如 describe、logs、exec。',
          '',
          '想查 Pod？',
          '點左側 Pod → 勾選名稱，',
          '右側面板即顯示詳細資訊。',
          '',
          '支援多面板並排、拖曳移動、',
          '縮放大小，以及多 Workspace。',
        ],
      },
      right: {
        title: '快速操作',
        lines: [
          '自定指令',
          '左側底部輸入任意 kubectl 指令，',
          'Cmd+Enter 執行。',
          '',
          '面板操作',
          '• 拖曳標題列 — 移動面板',
          '• 雙擊標題列 — 最大化 / 還原',
          '• 拖曳右/下邊界 — 調整大小',
          '',
          'Workspace',
          '點擊右側 W1 / W2 / + 切換工作區，',
          '讓不同任務的面板分組管理。',
          '',
          '停止串流',
          '串流指令執行中，按面板的 ■ 停止。',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'K8s Universe',
        lines: [
          'Navigate to /universe.',
          '',
          'Universe renders your entire cluster',
          'as a GPU-accelerated force graph,',
          'showing relationships at a glance:',
          '',
          '• Deployment → ConfigMaps it mounts',
          '• Service → Deployment it exposes',
          '• Gateway → HTTPRoutes it owns',
          '• RoleBinding → ServiceAccount bound',
          '',
          'Node colour = resource kind.',
          'Check the left legend for the key.',
        ],
      },
      right: {
        title: 'Universe Controls',
        lines: [
          'Navigation',
          '• Scroll — zoom in / out',
          '• Drag empty space — pan',
          '• F — reset view',
          '',
          'Focus a Namespace',
          'Click a namespace chip on the left.',
          'The graph zooms to that cluster.',
          '',
          'Select a node',
          'Connected nodes stay bright;',
          'everything else dims out.',
          '',
          'Search',
          'Press / inside a namespace,',
          'or Cmd+K for global search.',
        ],
      },
    },
    zh: {
      left: {
        title: 'K8s Universe',
        lines: [
          '前往 /universe 進入圖形介面。',
          '',
          'Universe 將整個叢集的資源渲染',
          '成一張 GPU 加速的力導向圖，',
          '讓你一眼看清資源間的關聯：',
          '',
          '• Deployment → 掛載哪些 ConfigMap',
          '• Service → 暴露哪個 Deployment',
          '• Gateway → 路由到哪些 HTTPRoute',
          '• RoleBinding → 綁定哪個 ServiceAccount',
          '',
          '節點顏色代表資源種類，',
          '可在左側圖例確認對應關係。',
        ],
      },
      right: {
        title: 'Universe 操作',
        lines: [
          '導覽',
          '• 滑鼠滾輪 — 縮放',
          '• 拖曳空白處 — 平移',
          '• F 鍵 — 重置視角',
          '',
          '聚焦 Namespace',
          '點擊左側 Namespace 名稱，',
          '圖自動縮放到該命名空間群集。',
          '',
          '點擊節點',
          '右側面板顯示連結的節點清單，',
          '其他節點半透明淡出。',
          '',
          '搜尋',
          '聚焦 Namespace 後按 / 開啟搜尋，',
          '或 Cmd+K 全局搜尋。',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'Exporting Cluster Data',
        lines: [
          'Click Export Cluster on the home',
          'page, or run directly:',
          '',
          '  bash scripts/k8s-export.sh',
          '',
          'The script fetches all namespaces',
          'in parallel and writes files to',
          'k8s-snapshot/.',
          '',
          'Interrupted? Click Resume on the',
          'home page to continue from where',
          'it left off.',
          '',
          'The app switches to Snapshot mode',
          'automatically when done.',
        ],
      },
      right: {
        title: 'Snapshot Tips',
        lines: [
          'Directory layout:',
          '  namespaces.yaml',
          '  {namespace}/{kind}.yaml',
          '  {namespace}/{pod}.txt',
          '',
          'Share a snapshot',
          'Zip k8s-snapshot/ and send it.',
          'The recipient switches to Snapshot',
          'mode — no cluster needed.',
          '',
          'Refresh data',
          'Re-run the export script to',
          'overwrite existing files.',
          '',
          'Back to Realtime',
          'Toggle [R] in the top-right corner.',
        ],
      },
    },
    zh: {
      left: {
        title: '匯出叢集資料',
        lines: [
          '在首頁（/）點擊 Export Cluster，',
          '或在終端機執行：',
          '',
          '  bash scripts/k8s-export.sh',
          '',
          '腳本會平行拉取所有 Namespace',
          '的資源，寫入 k8s-snapshot/ 目錄。',
          '',
          '中斷後，回到首頁點擊 Resume',
          '即可從中斷處繼續匯出。',
          '',
          '完成後首頁自動切換到 Snapshot 模式，',
          '即可離線瀏覽整個叢集。',
        ],
      },
      right: {
        title: 'Snapshot 模式提示',
        lines: [
          'k8s-snapshot/ 目錄結構：',
          '  namespaces.yaml',
          '  {namespace}/{kind}.yaml',
          '  {namespace}/{pod}.txt  (logs)',
          '',
          '分享快照給他人',
          '壓縮 k8s-snapshot/ 並傳送，',
          '對方解壓後切到 Snapshot 模式',
          '即可瀏覽，無需叢集連線。',
          '',
          '資料更新',
          '重新執行 export 腳本覆蓋舊資料，',
          '或刪除 k8s-snapshot/ 再重跑。',
          '',
          '切回 Realtime',
          '點擊右上角切換鈕即可。',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'Log Stream — Clear',
        lines: [
          '`kubectl logs -f` never closes.',
          'Three buffers grow unboundedly:',
          '',
          '• Server outputBuffer  (Node.js)',
          '• Client fullOutput    (WS closure)',
          '• Panel signal         (Angular)',
          '',
          'Press Clear while streaming.',
          'All three buffers reset to empty.',
          'The stream keeps running.',
          'New logs append from zero.',
          '',
          'Stop still works normally after Clear.',
        ],
      },
      right: {
        title: 'Memory Monitor',
        lines: [
          'Press <kbd>M</kbd> anywhere in the app',
          '(not inside an input) to open',
          'the memory monitor.',
          '',
          'It shows every second:',
          '• Server RSS',
          '• Server heap used / total',
          '• Browser JS heap (Chrome only)',
          '',
          'Browser heap requires Chrome.',
          'Firefox / Safari show 0/0.',
          '',
          'To verify Clear works:',
          '1. Press <kbd>M</kbd> — open monitor',
          '2. Run logs -f — watch values climb',
          '3. Press Clear — values drop',
          '4. Logs resume from zero',
          '5. Press <kbd>M</kbd> again — close',
        ],
      },
    },
    zh: {
      left: {
        title: 'Log 串流 — Clear',
        lines: [
          '`kubectl logs -f` 永不關閉。',
          '三個 buffer 無上限地成長：',
          '',
          '• Server outputBuffer  (Node.js)',
          '• Client fullOutput    (WS closure)',
          '• Panel signal         (Angular)',
          '',
          '串流執行中按 Clear。',
          '三個 buffer 全部清零，',
          '串流繼續跑，新 log 從頭累積。',
          '',
          '清除後 Stop 仍可正常停止串流。',
        ],
      },
      right: {
        title: '記憶體監控',
        lines: [
          '在 app 任意處按 <kbd>M</kbd>',
          '（不能在輸入框內）',
          '開啟右下角記憶體監控面板。',
          '',
          '每秒更新：',
          '• Server RSS',
          '• Server heap 已用 / 總量',
          '• Browser JS heap（僅 Chrome）',
          '',
          'Firefox / Safari 顯示 0/0。',
          '',
          '驗證 Clear 效果：',
          '1. 按 <kbd>M</kbd> 開啟監控',
          '2. 執行 logs -f，觀察數值爬升',
          '3. 按 Clear，數值下降',
          '4. Log 繼續從零累積',
          '5. 再按 <kbd>M</kbd> 關閉',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'Keyboard Shortcuts',
        lines: [
          'Global',
          '  <kbd>⌘K</kbd>       global resource search',
          '  <kbd>Esc</kbd>      close panel / deselect',
          '  <kbd>H</kbd>        open this handbook',
          '  <kbd>M</kbd>        memory monitor',
          '',
          'Universe',
          '  <kbd>S</kbd>        toggle sidebar',
          '  <kbd>F</kbd>        fit all nodes in view',
          '  <kbd>/</kbd>        search in namespace',
          '  <kbd>⌘K</kbd>       global search palette',
          '  <kbd>Esc</kbd>      deselect / close search',
          '',
          'Terminal sidebar',
          '  <kbd>⌘↵</kbd>      run custom command',
          '',
          'Panels',
          '  <kbd>dbl-click</kbd>  maximise / restore',
          '  <kbd>drag edge</kbd>  resize',
        ],
      },
      right: {
        title: 'Troubleshooting',
        lines: [
          'Namespace list is empty',
          '→ Check kubeconfig is set and',
          '  cluster is reachable.',
          '  Run: kubectl get namespaces',
          '',
          'Universe shows no graph',
          '→ Cluster may have no resources,',
          '  or the API server is slow.',
          '  Check the browser console.',
          '',
          'Snapshot mode shows old data',
          '→ Re-run the export script.',
          '  Delete k8s-snapshot/ first',
          '  for a clean refresh.',
          '',
          'Panel output is blank',
          '→ The resource may have no logs',
          '  yet, or the command failed.',
          '  Check the command bar above.',
        ],
      },
    },
    zh: {
      left: {
        title: '鍵盤快捷鍵',
        lines: [
          '全域',
          '  <kbd>⌘K</kbd>       全局資源搜尋',
          '  <kbd>Esc</kbd>      關閉面板 / 取消選取',
          '  <kbd>H</kbd>        開啟本手冊',
          '  <kbd>M</kbd>        記憶體監控',
          '',
          'Universe',
          '  <kbd>S</kbd>        收合 / 展開側欄',
          '  <kbd>F</kbd>        重置視角',
          '  <kbd>/</kbd>        在 Namespace 內搜尋',
          '  <kbd>⌘K</kbd>       全局搜尋面板',
          '  <kbd>Esc</kbd>      取消選取 / 關閉搜尋',
          '',
          'Terminal 側欄',
          '  <kbd>⌘↵</kbd>      執行自定指令',
          '',
          '面板',
          '  <kbd>雙擊標題列</kbd>  最大化 / 還原',
          '  <kbd>拖曳邊界</kbd>    調整大小',
        ],
      },
      right: {
        title: '常見問題',
        lines: [
          'Namespace 清單空白',
          '→ 確認 kubeconfig 設定正確',
          '  且叢集可連線。',
          '  執行：kubectl get namespaces',
          '',
          'Universe 沒有圖形',
          '→ 叢集可能無資源，或 API',
          '  server 回應慢。',
          '  查看瀏覽器 console。',
          '',
          'Snapshot 顯示舊資料',
          '→ 重新執行匯出腳本。',
          '  可先刪除 k8s-snapshot/',
          '  再重跑取得乾淨資料。',
          '',
          '面板輸出空白',
          '→ 該資源可能尚無 log，',
          '  或指令執行失敗。',
          '  確認面板上方的指令列。',
        ],
      },
    },
  },
  {
    en: {
      left: {
        title: 'Advanced Tips',
        lines: [
          'Multi-panel layout',
          'Open several resources at once',
          'and drag them into columns.',
          'Use W1 / W2 / W3 to separate',
          'concerns — e.g. prod vs staging.',
          '',
          'Exec into a Pod',
          'Open a Pod panel → click exec.',
          'The command bar lets you edit',
          'before running.',
          '',
          'Live log streaming',
          'Click "logs -f" on any Pod panel.',
          'Press ■ to stop the stream.',
          '',
          'Filter by kind in Universe',
          'Click a kind badge in the legend',
          'to highlight all nodes of that type.',
        ],
      },
      right: {
        title: 'Deployment Rollouts',
        lines: [
          'Open a Deployment panel and',
          'expand the Rollout section.',
          '',
          'Available actions:',
          '• Restart — rolling restart',
          '• Scale — change replica count',
          '• Rollback — revert last rollout',
          '• History — view rollout log',
          '',
          'Image upgrade',
          'If ECR is configured, load tags',
          'directly from the panel and pick',
          'a new image tag to deploy.',
          '',
          'Status badge',
          'The Rollout section shows live',
          'status: Progressing, Complete,',
          'or Degraded.',
        ],
      },
    },
    zh: {
      left: {
        title: '進階技巧',
        lines: [
          '多面板佈局',
          '同時開啟多個資源，拖曳排成',
          '並排欄位。利用 W1 / W2 / W3',
          '分隔不同環境，例如 prod / staging。',
          '',
          'Exec 進入 Pod',
          '開啟 Pod 面板 → 點擊 exec。',
          '指令列可在執行前編輯內容。',
          '',
          '即時 Log 串流',
          '點擊任意 Pod 面板的 logs -f，',
          '按 ■ 停止串流。',
          '',
          'Universe 篩選種類',
          '點擊圖例中的種類標籤，',
          '所有同類節點會亮起。',
        ],
      },
      right: {
        title: 'Deployment Rollout',
        lines: [
          '開啟 Deployment 面板，',
          '展開 Rollout 區塊。',
          '',
          '可用操作：',
          '• Restart — 滾動重啟',
          '• Scale — 調整副本數',
          '• Rollback — 還原上次 Rollout',
          '• History — 查看 Rollout 紀錄',
          '',
          '升級映像檔',
          '若已設定 ECR，可直接從面板',
          '載入 tag 清單，選擇新版本部署。',
          '',
          '狀態標示',
          'Rollout 區塊會即時顯示狀態：',
          'Progressing、Complete 或 Degraded。',
        ],
      },
    },
  },
];

@Component({
  selector: 'app-handbook',
  standalone: true,
  template: `
    <div class="handbook-wrap">
      <!-- Trigger button -->
      <button class="handbook-btn" (click)="open.set(true)" title="Handbook (H)">
        <svg width="15" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <kbd class="handbook-key">H</kbd>
      </button>

      <!-- Overlay -->
      @if (open()) {
        <div class="overlay" (click)="onOverlayClick($event)">
          <div class="book" (click)="$event.stopPropagation()">

            <!-- Top bar: lang toggle + close -->
            <div class="book-topbar">
              <div class="lang-toggle">
                <button class="lang-btn" [class.active]="lang() === 'en'" (click)="lang.set('en')">EN</button>
                <button class="lang-btn" [class.active]="lang() === 'zh'" (click)="lang.set('zh')">中</button>
              </div>
              <button class="close-btn" (click)="open.set(false)">✕</button>
            </div>

            <!-- Pages -->
            <div class="pages">
              <!-- Left page -->
              <div class="page page-left">
                <div class="page-title">{{ spread().left.title }}</div>
                <div class="page-body">
                  @for (line of spread().left.lines; track $index) {
                    @if (line === '') { <br> } @else { <div class="line" [innerHTML]="line"></div> }
                  }
                </div>
                <div class="page-num">{{ spreadIndex() * 2 + 1 }}</div>
              </div>

              <!-- Spine -->
              <div class="spine"></div>

              <!-- Right page -->
              <div class="page page-right">
                <div class="page-title">{{ spread().right.title }}</div>
                <div class="page-body">
                  @for (line of spread().right.lines; track $index) {
                    @if (line === '') { <br> } @else { <div class="line" [innerHTML]="line"></div> }
                  }
                </div>
                <div class="page-num">{{ spreadIndex() * 2 + 2 }}</div>
              </div>
            </div>

            <!-- Navigation -->
            <div class="nav">
              <button class="nav-btn" [disabled]="spreadIndex() === 0" (click)="prev()">&#9664;</button>
              <span class="nav-label">{{ spreadIndex() + 1 }} / {{ total }}</span>
              <button class="nav-btn" [disabled]="spreadIndex() === total - 1" (click)="next()">&#9654;</button>
            </div>

          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .handbook-wrap { position: relative; }

    .handbook-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: auto;
      padding: 0 6px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--t-border);
      background: var(--t-bg-surface);
      color: var(--t-text-dim);
      cursor: pointer;
      transition: all 0.15s;
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
    }

    .handbook-key {
      font-family: monospace;
      font-size: 10px;
      font-weight: 700;
      color: var(--t-text-dim);
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--t-border);
      border-bottom-width: 2px;
      border-radius: 3px;
      padding: 0 4px;
      line-height: 1.6;
      pointer-events: none;
    }
    .handbook-btn:hover .handbook-key { color: var(--t-accent); border-color: var(--t-accent); }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9000;
    }

    .book {
      position: relative;
      width: 760px;
      max-width: 96vw;
      background: #3a2610;
      border: 3px solid #c8922a;
      border-radius: 4px;
      box-shadow:
        0 0 0 1px #7a4a10,
        0 20px 60px rgba(0, 0, 0, 0.8),
        inset 0 1px 0 rgba(255, 200, 80, 0.15);
      padding: 0 0 12px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    /* Top bar */
    .book-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px 6px;
    }

    .lang-toggle {
      display: flex;
      gap: 2px;
    }

    .lang-btn {
      padding: 2px 8px;
      font-size: 10px;
      font-family: inherit;
      font-weight: 700;
      border: 1px solid #7a5a20;
      background: #2a1a08;
      color: #a07840;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: all 0.1s;

      &:first-child { border-radius: 2px 0 0 2px; }
      &:last-child  { border-radius: 0 2px 2px 0; }

      &.active {
        background: #c8922a;
        color: #1a0d00;
        border-color: #c8922a;
      }

      &:not(.active):hover {
        background: #3a2610;
        color: #c8922a;
      }
    }

    .close-btn {
      width: 22px;
      height: 22px;
      border: 1px solid #7a5a20;
      background: #2a1a08;
      color: #c8922a;
      font-size: 12px;
      cursor: pointer;
      border-radius: 2px;
      line-height: 1;
      &:hover { background: #c8922a; color: #0e0b08; }
    }

    /* Pages */
    .pages {
      display: flex;
      padding: 0 8px;
    }

    .page {
      flex: 1;
      height: 480px;
      background: #f0e6c8;
      padding: 24px 24px 36px;
      position: relative;
      box-sizing: border-box;
    }

    .page-left  { border-radius: 2px 0 0 2px; box-shadow: inset -4px 0 8px rgba(0,0,0,0.12); }
    .page-right { border-radius: 0 2px 2px 0; box-shadow: inset  4px 0 8px rgba(0,0,0,0.12); }

    .spine {
      width: 20px;
      background: linear-gradient(90deg, #8b5e1a, #c8922a 40%, #a06a20 60%, #6b3e0e);
      flex-shrink: 0;
      box-shadow: inset -2px 0 4px rgba(0,0,0,0.3), inset 2px 0 4px rgba(0,0,0,0.3);
    }

    .page-title {
      font-size: 12px;
      font-weight: 700;
      color: #6b3e0e;
      border-bottom: 1px solid #c8a060;
      padding-bottom: 8px;
      margin-bottom: 14px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .page-body {
      font-size: 11px;
      line-height: 1.75;
      color: #2a1a00;
    }

    .line { white-space: pre-wrap; }

    :host ::ng-deep .page-body kbd {
      display: inline-block;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      color: #3a1a00;
      background: #d4b87a;
      border: 1px solid #8b5e1a;
      border-bottom-width: 2px;
      border-radius: 3px;
      padding: 0 5px;
      line-height: 1.6;
      vertical-align: baseline;
    }

    .page-num {
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      color: #a07840;
    }

    /* Navigation */
    .nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding-top: 10px;
    }

    .nav-btn {
      width: 28px;
      height: 24px;
      background: #c8922a;
      color: #1a0d00;
      border: none;
      font-size: 10px;
      cursor: pointer;
      font-weight: 700;
      box-shadow:
        inset 1px 1px 0 rgba(255, 220, 100, 0.5),
        inset -1px -1px 0 rgba(0, 0, 0, 0.4);

      &:disabled { opacity: 0.3; cursor: not-allowed; }
      &:not(:disabled):hover { background: #e0a830; }
      &:not(:disabled):active {
        box-shadow:
          inset -1px -1px 0 rgba(255, 220, 100, 0.5),
          inset 1px 1px 0 rgba(0, 0, 0, 0.4);
      }
    }

    .nav-label {
      font-size: 11px;
      color: #c8a060;
      min-width: 48px;
      text-align: center;
    }
  `],
})
export class HandbookComponent {
  readonly open = signal(false);
  readonly lang = signal<'en' | 'zh'>('en');
  readonly spreadIndex = signal(0);
  readonly total = SPREADS.length;

  readonly spread = () => SPREADS[this.spreadIndex()][this.lang()];

  prev() { this.spreadIndex.update(i => Math.max(0, i - 1)); }
  next() { this.spreadIndex.update(i => Math.min(this.total - 1, i + 1)); }

  onOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('overlay')) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.open.set(false); }

  @HostListener('window:keydown.h', ['$event'])
  onH(e: Event) {
    if (((e as KeyboardEvent).target as HTMLElement)?.tagName === 'INPUT') return;
    this.open.update(v => !v);
  }
}
