export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>若道远程 · 管理后台</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--ink:#1d2330;--ink2:#4b5563;--muted:#79808f;--line:#e5e7eb;--line2:#d8dce4;--primary:#f4512c;--primary-dark:#d83c18;--primary-soft:#fff1ec;--green:#16a34a;--green-soft:#e8f7ee;--amber:#b45309;--amber-soft:#fff5e6;--red:#dc2626;--red-soft:#fdecec;--radius:18px;--mono:"SFMono-Regular","Cascadia Mono",Consolas,monospace;--shadow:0 14px 34px -16px rgba(20,26,38,.22),0 2px 8px rgba(20,26,38,.04);color-scheme:light}
*{box-sizing:border-box}
html,body{min-height:100%}
body{margin:0;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:14px;line-height:1.55;background:radial-gradient(1100px 520px at 6% -10%,rgba(244,81,44,.1),transparent 62%),radial-gradient(900px 480px at 102% -4%,rgba(59,130,246,.07),transparent 55%),var(--bg);-webkit-font-smoothing:antialiased}
h1,h2,h3,p{margin:0}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
a{color:var(--primary)}
.mono{font-family:var(--mono)}
[hidden]{display:none!important}
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar-inner{width:min(1240px,100%);margin:0 auto;padding:14px clamp(16px,4vw,32px);display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.brand-mark{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(140deg,#ff7a4d 0%,#f4512c 45%,#e23a16 100%);box-shadow:0 10px 20px -10px rgba(228,62,26,.75),inset 0 1px 0 rgba(255,255,255,.35);flex:none}
.brand-copy{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.brand-name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand-sub{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.dot-online{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--green);background:var(--green-soft);border:1px solid #c9ecd5;padding:5px 10px;border-radius:999px;white-space:nowrap}
.dot-online::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(22,163,74,.14)}
.page{width:min(1240px,100%);margin:0 auto;padding:26px clamp(16px,4vw,32px) 60px}
.hero{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--primary-dark);background:var(--primary-soft);border:1px solid #ffd9cd;padding:4px 9px;border-radius:999px}
.hero h1{font-size:26px;letter-spacing:-.01em;margin-top:10px;line-height:1.25}
.hero p{color:var(--ink2);margin-top:6px;max-width:680px}
.hero-meta{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px;font-size:12px;color:var(--muted)}
.hero-meta .url{font-family:var(--mono);color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:10px;padding:6px 10px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 1px 2px rgba(20,26,38,.04)}
.stat-label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:7px}
.stat-value{font-size:28px;font-weight:700;letter-spacing:-.02em;margin-top:7px;line-height:1.1}
.stat-foot{font-size:11.5px;color:var(--muted);margin-top:4px}
.tabs{display:flex;gap:3px;padding:4px;background:#e9ebef;border:1px solid #e1e4e9;border-radius:12px;width:max-content;max-width:100%;overflow:auto}
.tab{border:0;background:transparent;padding:7px 14px;border-radius:9px;font-size:13px;color:var(--ink2);white-space:nowrap;transition:.15s}
.tab.active{background:#fff;color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(20,26,38,.1)}
.layout{display:flex;flex-direction:column;gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid var(--line)}
.card-head h2{font-size:16px}
.card-head .sub{font-size:12px;color:var(--muted)}
.card-head .right{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.card-body{padding:16px 18px}
.grid-2{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:18px}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:720px}
th{text-align:left;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:10px 16px;background:#fafbfc;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:13px 16px;border-bottom:1px solid #f0f1f4;vertical-align:middle}
tr:last-child td{border-bottom:0}
tr:hover td{background:#fcfcfd}
.device-name{display:flex;align-items:center;gap:10px;min-width:0}
.avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:700;font-size:13px;color:#fff;background:linear-gradient(140deg,#ff8a63,#e94a25);flex:none}
.device-copy{display:flex;flex-direction:column;min-width:0}
.device-copy strong{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.device-copy span{font-size:11.5px;color:var(--muted);font-family:var(--mono)}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.green{color:var(--green);background:var(--green-soft);border-color:#c9ecd5}
.pill.amber{color:var(--amber);background:var(--amber-soft);border-color:#f3ddb6}
.pill.red{color:var(--red);background:var(--red-soft);border-color:#f5c6c6}
.pill.gray{color:var(--muted);background:#f3f4f6;border-color:var(--line)}
.pill.blue{color:#1d4ed8;background:#eef3ff;border-color:#d6e2ff}
.role-tags{display:flex;gap:5px;flex-wrap:wrap}
.role-tag{font-size:11px;padding:2px 7px;border-radius:6px;background:#f3f4f6;border:1px solid var(--line);color:var(--ink2)}
.role-tag.host{background:var(--primary-soft);border-color:#ffd9cd;color:var(--primary-dark)}
.role-tag.shared{background:var(--green-soft);border-color:#c9ecd5;color:var(--green)}
.muted{color:var(--muted)}
.small{font-size:12px}
.btn{border:1px solid var(--line2);background:#fff;padding:7px 11px;border-radius:9px;font-size:12.5px;color:var(--ink2);transition:.15s;white-space:nowrap}
.btn:hover{background:#f7f8fa;border-color:#c9ced8;color:var(--ink)}
.btn.primary{background:linear-gradient(180deg,#ff6a42,#f4512c);border-color:#e7441f;color:#fff;font-weight:600;box-shadow:0 6px 14px -8px rgba(228,62,26,.8)}
.btn.primary:hover{background:linear-gradient(180deg,#ff7855,#f55b37)}
.btn.danger{color:var(--red);border-color:#f2c4c4;background:#fff}
.btn.danger:hover{background:var(--red-soft)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{background:#f3f4f6;color:var(--ink)}
.btn.sm{padding:5px 9px;font-size:12px;border-radius:8px}
.btn:disabled{opacity:.55;cursor:not-allowed}
.action-row{display:flex;gap:6px;flex-wrap:wrap}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:12px;font-weight:600;color:var(--ink2)}
.input,.select{width:100%;border:1px solid var(--line2);border-radius:10px;padding:9px 11px;background:#fff;outline:none;transition:.15s;font-size:13px}
.input:focus,.select:focus{border-color:rgba(244,81,44,.55);box-shadow:0 0 0 3px rgba(244,81,44,.12)}
.form-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.form-row .field{min-width:120px}
.form-row .grow{flex:1;min-width:180px}
.hint{font-size:11.5px;color:var(--muted)}
.divider{height:1px;background:var(--line);margin:16px 0}
.code{font-family:var(--mono);font-size:13px;letter-spacing:.08em;background:#f7f8fa;border:1px dashed var(--line2);border-radius:8px;padding:6px 9px;display:inline-flex;align-items:center;gap:8px}
.code.revoked{text-decoration:line-through;color:var(--muted)}
.empty{padding:38px 16px;text-align:center;color:var(--muted);font-size:13px}
.empty strong{display:block;color:var(--ink2);font-size:14px;margin-bottom:4px}
.session-list{display:flex;flex-direction:column;gap:10px;padding:4px 0}
.session-item{border:1px solid var(--line);border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:6px;background:#fcfcfd}
.session-line{display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap}
.session-line .arrow{color:var(--muted)}
.session-meta{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11.5px;color:var(--muted);flex-wrap:wrap}
.session-stats{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:11.5px;color:var(--ink2);border-top:1px dashed var(--line);padding-top:7px}
.session-stats .muted{color:var(--muted)}
.danger-tags{display:flex;flex-wrap:wrap;gap:5px}
.danger-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--red-soft);border:1px solid #f5c6c6;color:#b91c1c}
.history-safe{font-size:11.5px;color:var(--green)}
.net-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.net-metric{display:flex;flex-direction:column;gap:2px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:#fcfcfd}
.net-metric span{font-size:11px;color:var(--muted)}
.net-metric strong{font-size:18px;font-weight:700;letter-spacing:-.01em}
.net-metric small{font-size:10.5px;color:var(--muted)}
.history-item{align-items:flex-start}
@media(max-width:900px){.net-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.invite-list{display:flex;flex-direction:column}
.invite-row{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #f0f1f4;flex-wrap:wrap}
.invite-row:last-child{border-bottom:0}
.invite-main{flex:1;min-width:220px;display:flex;flex-direction:column;gap:3px}
.invite-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.invite-title strong{font-weight:600}
.invite-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.activity{display:flex;flex-direction:column;gap:0}
.activity-row{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid #f0f1f4;font-size:12.5px}
.activity-row:last-child{border-bottom:0}
.activity-dot{width:8px;height:8px;border-radius:50%;background:var(--primary);margin-top:6px;flex:none;box-shadow:0 0 0 3px var(--primary-soft)}
.activity-main{flex:1;min-width:0}
.activity-main strong{font-weight:600}
.activity-main .detail{color:var(--muted);font-size:11.5px;margin-top:1px;word-break:break-all}
.activity-time{color:var(--muted);font-size:11px;white-space:nowrap;flex:none}
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
.login-card{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 34px 80px -32px rgba(20,26,38,.4),0 2px 8px rgba(20,26,38,.05);padding:32px}
.login-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.login-brand .brand-mark{width:48px;height:48px;border-radius:15px}
.login-card h1{font-size:22px;letter-spacing:-.01em;margin-bottom:6px}
.login-card>p{color:var(--muted);font-size:13px;margin-bottom:22px}
.login-fields{display:flex;flex-direction:column;gap:14px}
.login-note{margin-top:18px;padding:12px;border-radius:12px;background:#f7f8fa;border:1px solid var(--line);font-size:11.5px;color:var(--muted);line-height:1.6}
.alert{padding:10px 12px;border-radius:10px;font-size:12.5px;background:var(--red-soft);color:#a52626;border:1px solid #f5c6c6;margin-bottom:12px}
.login-card .btn.primary{width:100%;padding:11px;border-radius:11px;font-size:14px}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(12px);background:#1d2330;color:#fff;padding:10px 16px;border-radius:11px;font-size:13px;box-shadow:0 12px 30px rgba(20,26,38,.3);opacity:0;pointer-events:none;transition:.2s;z-index:100;max-width:90vw}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.error{background:#b91c1c}
.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.settings-card{border:1px solid var(--line);border-radius:14px;padding:16px;background:#fcfcfd}
.settings-card h3{font-size:13.5px;margin-bottom:6px}
.settings-card p{font-size:12px;color:var(--muted);margin-bottom:12px}
.update-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.update-head h3{font-size:13.5px}
.update-head .pill{margin-left:auto}
.update-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.update-notes{font-size:12px;color:var(--ink2);background:#fcfcfd;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-top:8px;white-space:pre-wrap;max-height:140px;overflow:auto}
.settings-actions{display:flex;gap:8px;align-items:center;margin-top:14px}
.spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1000px){.grid-2{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.hero-meta{margin-left:0;align-items:flex-start}}
@media(max-width:640px){.page{padding:18px 14px 50px}.stats{grid-template-columns:1fr 1fr;gap:10px}.stat{padding:13px 14px}.stat-value{font-size:23px}.hero h1{font-size:21px}.card-head{padding:14px}.card-body{padding:14px}.topbar-inner{padding:12px 14px}.brand-sub{display:none}.settings-grid{grid-template-columns:1fr}.login-card{padding:24px}}
</style>
</head>
<body>
<div id="login-view" class="login-wrap" hidden>
  <div class="login-card">
    <div class="login-brand">
      <span class="brand-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M7.2 17.8 5.9 19.1a3.5 3.5 0 0 1-5-5l3.2-3.2a3.5 3.5 0 0 1 5 0"/><path d="M16.8 6.2 18.1 4.9a3.5 3.5 0 1 1 5 5l-3.2 3.2a3.5 3.5 0 0 1-5 0"/></svg>
      </span>
      <div class="brand-copy"><span class="brand-name">若道远程</span><span class="brand-sub">管理后台</span></div>
    </div>
    <h1>管理员登录</h1>
    <p>查看在线客户端、管理远控权限与邀请码。</p>
    <div id="login-error" class="alert" hidden></div>
    <form id="login-form" class="login-fields" autocomplete="off">
      <div class="field">
        <label for="admin-password">管理员密码</label>
        <input class="input" id="admin-password" type="password" placeholder="部署服务端时设置的密码" autocomplete="current-password" required />
      </div>
      <button class="btn primary" type="submit" id="login-submit">进入管理后台</button>
    </form>
    <div class="login-note">管理员密码在部署服务端时生成或指定。忘记密码可在客户端重新部署服务端，或修改服务器上的 <span class="mono">ADMIN_PASSWORD</span> 环境变量后重启服务。</div>
  </div>
</div>

<div id="app-view" hidden>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M7.2 17.8 5.9 19.1a3.5 3.5 0 0 1-5-5l3.2-3.2a3.5 3.5 0 0 1 5 0"/><path d="M16.8 6.2 18.1 4.9a3.5 3.5 0 1 1 5 5l-3.2 3.2a3.5 3.5 0 0 1-5 0"/></svg>
        </span>
        <div class="brand-copy"><span class="brand-name" id="top-server-name">若道远程</span><span class="brand-sub">服务端管理后台</span></div>
      </div>
      <div class="top-actions">
        <span class="dot-online" id="online-pill">服务端在线</span>
        <button class="btn ghost sm" id="refresh-btn" type="button">刷新</button>
        <button class="btn ghost sm" id="logout-btn" type="button">退出</button>
      </div>
    </div>
  </header>

  <main class="page">
    <section class="hero">
      <div>
        <span class="eyebrow">Ruodao Remote Console</span>
        <h1 id="hero-title">客户端与远控管理</h1>
        <p>这里可以看到当前在线的客户端明细。放行、禁止远控或断开连接会立即生效。</p>
      </div>
      <div class="hero-meta">
        <span class="url" id="public-url">未设置公网地址</span>
        <span id="server-meta">版本 0.1.0</span>
      </div>
    </section>

    <section class="stats" aria-label="概览">
      <div class="stat">
        <div class="stat-label">在线客户端</div>
        <div class="stat-value" id="stat-online">0</div>
        <div class="stat-foot" id="stat-devices">共 0 个客户端</div>
      </div>
      <div class="stat">
        <div class="stat-label">进行中的会话</div>
        <div class="stat-value" id="stat-sessions">0</div>
        <div class="stat-foot">点对点加密传输</div>
      </div>
      <div class="stat">
        <div class="stat-label">待处理申请</div>
        <div class="stat-value" id="stat-pending">0</div>
        <div class="stat-foot">批准后即可远控</div>
      </div>
      <div class="stat">
        <div class="stat-label">可用邀请码</div>
        <div class="stat-value" id="stat-invites">0</div>
        <div class="stat-foot">分发给可信用的人</div>
      </div>
    </section>

    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <nav class="tabs" aria-label="后台分区">
        <button class="tab active" data-tab="clients" type="button">客户端</button>
        <button class="tab" data-tab="invites" type="button">邀请码</button>
        <button class="tab" data-tab="history" type="button">会话历史</button>
        <button class="tab" data-tab="activity" type="button">活动与设置</button>
      </nav>
      <span class="hint" id="updated-at"></span>
    </div>

    <section id="tab-clients" class="layout">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>服务端带宽与负载</h2>
            <span class="sub">每 5 秒采样，网卡数值包含服务器上全部服务</span>
          </div>
          <div class="right" id="net-risk"></div>
        </div>
        <div class="card-body">
          <div class="net-grid" id="net-grid"></div>
          <p class="hint" id="net-note" style="margin-top:10px"></p>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>客户端</h2>
              <span class="sub">在线状态与远控权限</span>
            </div>
            <div class="right">
              <div class="tabs" id="device-filter">
                <button class="tab active" data-filter="all" type="button">全部</button>
                <button class="tab" data-filter="online" type="button">在线</button>
                <button class="tab" data-filter="pending" type="button">待审核</button>
                <button class="tab" data-filter="blocked" type="button">已禁止</button>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>客户端</th><th>状态</th><th>连接</th><th>远端信息</th><th>最后在线</th><th>操作</th></tr></thead>
              <tbody id="device-body"></tbody>
            </table>
            <div class="empty" id="device-empty" hidden><strong>还没有客户端接入</strong>把服务器地址和邀请码发给需要远控的人。</div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>进行中的会话</h2><span class="sub">实时连接</span></div></div>
          <div class="card-body" id="session-list"></div>
        </div>
      </div>
    </section>

    <section id="tab-invites" class="layout" hidden>
      <div class="card">
        <div class="card-head"><div><h2>邀请码</h2><span class="sub">只有持有效邀请码的新客户端才能接入</span></div></div>
        <div class="card-body">
          <form id="invite-form" class="form-row">
            <div class="field grow"><label for="invite-label">备注</label><input class="input" id="invite-label" maxlength="40" placeholder="例如：设计部小王" /></div>
            <div class="field"><label for="invite-uses">可用次数</label><select class="select" id="invite-uses"><option value="0">不限</option><option value="1">1 次</option><option value="5">5 次</option><option value="20">20 次</option></select></div>
            <div class="field"><label for="invite-expiry">有效期</label><select class="select" id="invite-expiry"><option value="0">永久</option><option value="1">1 天</option><option value="7" selected>7 天</option><option value="30">30 天</option></select></div>
            <button class="btn primary" type="submit" id="invite-submit">生成邀请码</button>
          </form>
          <div class="divider"></div>
          <div class="invite-list" id="invite-list"></div>
          <div class="empty" id="invite-empty" hidden><strong>还没有邀请码</strong>生成一个后发给需要接入的人。</div>
        </div>
      </div>
    </section>

    <section id="tab-history" class="layout" hidden>
      <div class="card">
        <div class="card-head">
          <div>
            <h2>会话历史</h2>
            <span class="sub">每段远控的开始时间、时长、双方 IP 与危险操作</span>
          </div>
        </div>
        <div class="card-body">
          <div class="session-list" id="history-list"></div>
          <div class="empty" id="history-empty" hidden><strong>还没有已结束的会话</strong>远控结束后会自动记录在这里。</div>
        </div>
      </div>
    </section>

    <section id="tab-activity" class="layout" hidden>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><div><h2>活动记录</h2><span class="sub">最近的管理操作与接入记录</span></div></div>
          <div class="card-body"><div class="activity" id="activity-list"></div><div class="empty" id="activity-empty" hidden><strong>暂无活动</strong></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>服务端设置</h2><span class="sub">实时生效</span></div></div>
          <div class="card-body">
            <form id="settings-form" class="settings-grid">
              <div class="settings-card">
                <h3>接入模式</h3>
                <p>决定新客户端如何进入服务器。</p>
                <select class="select" id="setting-mode">
                  <option value="invite">邀请码接入（推荐）</option>
                  <option value="approval">管理员审批</option>
                  <option value="open">完全开放</option>
                </select>
              </div>
              <div class="settings-card">
                <h3>服务名称</h3>
                <p>显示在客户端接入与分享页。</p>
                <input class="input" id="setting-name" maxlength="64" placeholder="设计部远控服务" />
              </div>
              <div class="settings-card" style="grid-column:1/-1">
                <h3>部署信息</h3>
                <p>服务端地址与版本。修改管理员密码需在服务器上调整环境变量并重启服务。</p>
                <div class="code" id="settings-url">-</div>
                <div class="hint" id="settings-version" style="margin-top:8px"></div>
              </div>
              <div style="grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px">
                <button class="btn primary" type="submit" id="settings-submit">保存设置</button>
              </div>
            </form>
            <div class="divider"></div>
            <div class="update-box">
              <div class="update-head">
                <h3>服务端更新</h3>
                <span class="pill gray" id="update-pill">未检查</span>
              </div>
              <p class="hint" id="update-current">当前版本 —</p>
              <div class="hint" id="update-detail"></div>
              <div class="update-notes" id="update-notes" hidden></div>
              <div class="code" id="update-command" hidden></div>
              <div class="update-actions">
                <button class="btn sm" type="button" id="update-check">检查更新</button>
                <button class="btn sm primary" type="button" id="update-download" hidden>下载并校验</button>
                <button class="btn sm primary" type="button" id="update-apply" hidden>立即更新</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>
<div class="toast" id="toast" role="status"></div>

<script>
(function () {
  "use strict";
  var TOKEN_KEY = "ruodao_admin_token";
  var state = {
    overview: null,
    devices: [],
    sessions: [],
    history: [],
    invites: [],
    activity: [],
    settings: null,
    update: null,
    filter: "all",
    timer: null,
    loggedIn: false
  };
  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var toastEl = document.getElementById("toast");
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(value) {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }
  function text(id, value) {
    var el = $(id);
    if (el) el.textContent = value == null ? "" : String(value);
  }
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (isError ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, 2600);
  }
  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["accept"] = "application/json";
    if (options.body) headers["content-type"] = "application/json";
    var token = getToken();
    if (token) headers["authorization"] = "Bearer " + token;
    return fetch(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.status === 401) {
          setToken("");
          showLogin();
          throw new Error(data.message || "登录已过期，请重新登录。");
        }
        if (!response.ok) {
          throw new Error(data.message || data.error || "请求失败，请稍后再试。");
        }
        return data;
      });
    });
  }
  function platformLabel(value) {
    if (value === "win32") return "Windows";
    if (value === "darwin") return "macOS";
    if (value === "linux") return "Linux";
    return "未知系统";
  }
  function roleLabel(role) {
    return role === "host" ? "被控端" : "主控端";
  }
  function relative(ts) {
    if (!ts) return "—";
    var delta = Date.now() - ts;
    if (delta < 10000) return "刚刚";
    if (delta < 60000) return Math.floor(delta / 1000) + " 秒前";
    if (delta < 3600000) return Math.floor(delta / 60000) + " 分钟前";
    if (delta < 86400000) return Math.floor(delta / 3600000) + " 小时前";
    return new Date(ts).toLocaleDateString("zh-CN");
  }
  function duration(ts) {
    var seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seconds < 60) return seconds + " 秒";
    if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟";
    return Math.floor(seconds / 3600) + " 小时 " + Math.floor((seconds % 3600) / 60) + " 分";
  }
  function durationMs(ms) {
    if (!ms || ms < 0) return "—";
    var seconds = Math.floor(ms / 1000);
    if (seconds < 60) return seconds + " 秒";
    if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟";
    return Math.floor(seconds / 3600) + " 小时 " + Math.floor((seconds % 3600) / 60) + " 分";
  }
  function rateLabel(kbps) {
    if (!kbps || kbps <= 0) return "0 Kbps";
    if (kbps >= 1000) return (kbps / 1000).toFixed(1) + " Mbps";
    return Math.round(kbps) + " Kbps";
  }
  function riskOf(stats) {
    if (!stats) return { cls: "gray", label: "等待指标" };
    if (stats.rttMs >= 250 || stats.lossPct >= 3 || stats.jitterMs >= 60) {
      return { cls: "red", label: "可能卡顿" };
    }
    if (stats.rttMs >= 120 || stats.lossPct >= 1 || stats.jitterMs >= 30) {
      return { cls: "amber", label: "轻微延迟" };
    }
    return { cls: "green", label: "流畅" };
  }
  function riskRank(pill) {
    return pill.cls === "red" ? 3 : pill.cls === "amber" ? 2 : pill.cls === "green" ? 1 : 0;
  }
  function reasonLabel(reason) {
    var labels = {
      "controller-left": "控制方离开",
      "host-left": "被控端离开",
      "host-closed": "被控端关闭连接",
      "host-offline": "被控端离线",
      "admin-disconnect": "管理员结束",
      "key-rotated": "密钥已轮换",
      "unpublished": "停止共享",
      "timeout": "连接超时"
    };
    return labels[reason] || reason || "—";
  }
  function dangerTags(events) {
    var wrap = el("div", "danger-tags");
    events.forEach(function (event) {
      wrap.appendChild(el("span", "danger-tag", event.label + " · " + new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })));
    });
    return wrap;
  }
  function shortId(id) {
    return id ? id.slice(0, 8) : "—";
  }
  function inviteCode(code) {
    if (!code) return "—";
    return code.length === 8 ? code.slice(0, 4) + "-" + code.slice(4) : code;
  }
  function expiryLabel(invite) {
    if (!invite.expiresAt) return "永久有效";
    if (invite.expiresAt <= Date.now()) return "已过期";
    return "有效至 " + new Date(invite.expiresAt).toLocaleDateString("zh-CN");
  }
  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }
  function button(label, action, className, data) {
    var btn = el("button", "btn sm" + (className ? " " + className : ""), label);
    btn.type = "button";
    btn.setAttribute("data-action", action);
    if (data) Object.keys(data).forEach(function (key) { btn.setAttribute("data-" + key, data[key]); });
    return btn;
  }
  function showLogin() {
    state.loggedIn = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    loginView.hidden = false;
    appView.hidden = true;
    var input = $("admin-password");
    if (input) input.focus();
  }
  function showApp() {
    state.loggedIn = true;
    loginView.hidden = true;
    appView.hidden = false;
    if (!state.timer) {
      state.timer = setInterval(function () {
        if (document.visibilityState === "visible") loadAll(true).catch(function () {});
      }, 6000);
    }
  }
  function login(password) {
    var submit = $("login-submit");
    var errorBox = $("login-error");
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = "正在登录…";
    return fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: password }),
      credentials: "same-origin"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || "登录失败");
        setToken(data.token);
        showApp();
        return loadAll(false);
      });
    }).catch(function (error) {
      errorBox.textContent = error.message || "登录失败";
      errorBox.hidden = false;
    }).finally(function () {
      submit.disabled = false;
      submit.textContent = "进入管理后台";
    });
  }

  function loadAll(silent) {
    return Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/devices"),
      api("/api/admin/sessions"),
      api("/api/admin/sessions/history?limit=100"),
      api("/api/admin/invites"),
      api("/api/admin/activity?limit=80"),
      api("/api/admin/settings"),
      api("/api/admin/update")
    ]).then(function (results) {
      state.overview = results[0];
      state.devices = results[1].devices || [];
      state.sessions = results[2].sessions || [];
      state.history = results[3].sessions || [];
      state.invites = results[4].invites || [];
      state.activity = results[5].entries || [];
      state.settings = results[6];
      state.update = results[7].update || null;
      render();
      if (!silent) showApp();
    });
  }

  function render() {
    var overview = state.overview;
    if (!overview) return;
    var server = overview.server;
    var stats = overview.stats;
    text("top-server-name", server.name);
    text("hero-title", server.name);
    text("public-url", server.publicUrl || "未设置公网地址，当前通过服务器地址访问");
    text("server-meta", "版本 " + server.version + " · 接入模式 " + modeLabel(server.registrationMode));
    text("stat-online", stats.onlineDevices);
    text("stat-devices", "共 " + (state.devices.length) + " 个客户端");
    text("stat-sessions", stats.activeSessions);
    text("stat-pending", stats.pendingDevices);
    text("stat-invites", stats.activeInvites);
    text("updated-at", "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    renderNetwork();
    renderDevices();
    renderSessions();
    renderHistory();
    renderInvites();
    renderActivity();
    renderSettings();
    renderUpdate();
  }
  function renderNetwork() {
    var grid = $("net-grid");
    grid.textContent = "";
    var overview = state.overview || {};
    var network = overview.network;
    var security = overview.security || {};
    var riskEl = $("net-risk");
    riskEl.textContent = "";
    if (!network) {
      grid.appendChild(el("p", "hint", "服务端指标采样中，约 5 秒后显示。"));
      text("net-note", "");
      return;
    }
    var worst = { cls: "gray", label: "当前无人远控" };
    state.sessions.forEach(function (session) {
      var pill = riskOf(session.telemetry);
      if (riskRank(pill) > riskRank(worst)) worst = pill;
    });
    if (state.sessions.length && worst.cls === "gray") {
      worst = { cls: "gray", label: "等待客户端上报" };
    } else if (worst.cls === "red") {
      worst.label = "有会话可能卡顿";
    } else if (worst.cls === "amber") {
      worst.label = "轻微延迟";
    } else if (worst.cls === "green") {
      worst.label = "远控流畅";
    }
    riskEl.appendChild(el("span", "pill " + worst.cls, worst.label));
    var metrics = [
      ["服务器下行", rateLabel(network.bandwidthInKbps), "网卡接收 · 全部流量"],
      ["服务器上行", rateLabel(network.bandwidthOutKbps), "网卡发送 · 全部流量"],
      ["信令下行", rateLabel(network.wsInKbps), "WebSocket 接收"],
      ["信令上行", rateLabel(network.wsOutKbps), "WebSocket 发送"],
      ["CPU", Number(network.cpuPct || 0).toFixed(1) + "%", "服务端进程与系统均值"],
      ["1 分钟负载", Number(network.load1 || 0).toFixed(2), "Linux load average"],
      ["信令延迟", Number(network.lagMs || 0).toFixed(1) + " ms", "事件循环采样"],
      ["内存占用", Number(network.memoryPct || 0).toFixed(1) + "%", Number(network.memoryMb || 0) + " MB RSS"]
    ];
    metrics.forEach(function (metric) {
      var item = el("div", "net-metric");
      item.appendChild(el("span", "", metric[0]));
      item.appendChild(el("strong", "", metric[1]));
      item.appendChild(el("small", "", metric[2]));
      grid.appendChild(item);
    });
    var note = "当前 " + state.sessions.length + " 人正在远控 · 已封禁 IP " + (security.activeBans || 0) + " 个";
    if (!network.nicSupported) note += " · 当前系统未暴露网卡计数，仅信令流量可参考";
    text("net-note", note);
  }
  function modeLabel(mode) {
    if (mode === "approval") return "管理员审批";
    if (mode === "open") return "完全开放";
    return "邀请码接入";
  }

  function renderDevices() {
    var body = $("device-body");
    body.textContent = "";
    var filter = state.filter;
    var devices = state.devices.filter(function (device) {
      if (filter === "online") return device.online;
      if (filter === "pending") return device.status === "pending";
      if (filter === "blocked") return device.status === "blocked";
      return true;
    });
    $("device-empty").hidden = devices.length !== 0;
    devices.forEach(function (device) {
      var tr = document.createElement("tr");

      var nameCell = document.createElement("td");
      var wrap = el("div", "device-name");
      var avatar = el("span", "avatar", (device.name || "?").slice(0, 1));
      var copy = el("div", "device-copy");
      copy.appendChild(el("strong", "", device.name || "未命名客户端"));
      copy.appendChild(el("span", "", shortId(device.id)));
      wrap.appendChild(avatar);
      wrap.appendChild(copy);
      nameCell.appendChild(wrap);

      var statusCell = document.createElement("td");
      var statusPill = el("span", "pill " + (device.status === "approved" ? "green" : device.status === "blocked" ? "red" : "amber"),
        device.status === "approved" ? "已允许远控" : device.status === "blocked" ? "已禁止远控" : "待审核");
      statusCell.appendChild(statusPill);
      if (device.online) {
        statusCell.appendChild(document.createTextNode(" "));
        statusCell.appendChild(el("span", "pill blue", "在线"));
      }

      var roleCell = document.createElement("td");
      var roles = el("div", "role-tags");
      if (device.roles && device.roles.length) {
        device.roles.forEach(function (role) {
          roles.appendChild(el("span", "role-tag " + role, roleLabel(role)));
        });
      } else {
        roles.appendChild(el("span", "muted small", "—"));
      }
      if (device.published) {
        roles.appendChild(el("span", "role-tag shared", "已共享"));
      }
      roleCell.appendChild(roles);

      var infoCell = document.createElement("td");
      infoCell.appendChild(el("div", "small", platformLabel(device.platform) + " · v" + (device.version || "?")));
      infoCell.appendChild(el("div", "hint", device.ip || "—"));
      if (device.code) infoCell.appendChild(el("div", "hint mono", "远控码 " + device.code));
      if (device.publishedNote) {
        infoCell.appendChild(el("div", "hint", "共享说明：" + device.publishedNote));
      }

      var lastCell = document.createElement("td");
      lastCell.appendChild(el("div", "small", relative(device.lastSeen)));
      lastCell.appendChild(el("div", "hint", device.online ? "当前在线" : "离线"));

      var actionCell = document.createElement("td");
      var actions = el("div", "action-row");
      if (device.status === "pending") {
        actions.appendChild(button("批准", "approve", "primary", { id: device.id }));
        actions.appendChild(button("禁止", "block", "danger", { id: device.id }));
      } else if (device.status === "blocked") {
        actions.appendChild(button("允许远控", "approve", "primary", { id: device.id }));
        actions.appendChild(button("移除", "remove", "danger", { id: device.id }));
      } else {
        actions.appendChild(button("禁止远控", "block", "danger", { id: device.id }));
        if (device.online) actions.appendChild(button("断开", "disconnect", "", { id: device.id }));
        else actions.appendChild(button("移除", "remove", "", { id: device.id }));
      }
      actionCell.appendChild(actions);

      tr.appendChild(nameCell);
      tr.appendChild(statusCell);
      tr.appendChild(roleCell);
      tr.appendChild(infoCell);
      tr.appendChild(lastCell);
      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function renderSessions() {
    var list = $("session-list");
    list.textContent = "";
    if (!state.sessions.length) {
      var empty = el("div", "empty", "");
      empty.appendChild(el("strong", "", "当前没有进行中的会话"));
      empty.appendChild(document.createTextNode("被控端上线后，把远控码和密钥发给对方即可。"));
      list.appendChild(empty);
      return;
    }
    state.sessions.forEach(function (session) {
      var item = el("div", "session-item");
      var risk = riskOf(session.telemetry);
      var line = el("div", "session-line");
      line.appendChild(el("strong", "", session.controller.name));
      line.appendChild(el("span", "arrow", "控制"));
      line.appendChild(el("strong", "", session.host.name));
      line.appendChild(el("span", "pill green", "加密中"));
      line.appendChild(el("span", "pill " + risk.cls, risk.label));
      item.appendChild(line);
      var meta = el("div", "session-meta");
      meta.appendChild(el("span", "mono", "远控码 " + session.code));
      meta.appendChild(el("span", "", "已进行 " + duration(session.createdAt)));
      meta.appendChild(el("span", "", "控制方 IP " + (session.controller.ip || "—")));
      meta.appendChild(button("结束会话", "end-session", "danger", { id: session.id }));
      item.appendChild(meta);
      var stats = el("div", "session-stats");
      if (session.telemetry) {
        stats.appendChild(el("span", "", "RTT " + Math.round(session.telemetry.rttMs) + " ms"));
        stats.appendChild(el("span", "", "丢包 " + Number(session.telemetry.lossPct || 0).toFixed(1) + "%"));
        stats.appendChild(el("span", "", "抖动 " + Math.round(session.telemetry.jitterMs) + " ms"));
        stats.appendChild(el("span", "", "码率 " + Math.round(session.telemetry.kbps) + " Kbps"));
        if (session.telemetry.fps > 0) stats.appendChild(el("span", "", Math.round(session.telemetry.fps) + " FPS"));
        if (session.telemetry.width > 0) stats.appendChild(el("span", "", session.telemetry.width + "×" + session.telemetry.height));
        stats.appendChild(el("span", "muted", (session.telemetry.reporter === "host" ? "被控端" : "控制端") + "上报 · " + relative(session.telemetry.updatedAt)));
      } else {
        stats.appendChild(el("span", "muted", "等待客户端上报实时质量，约 5 秒一次。"));
      }
      item.appendChild(stats);
      if (session.dangerEvents && session.dangerEvents.length) item.appendChild(dangerTags(session.dangerEvents));
      list.appendChild(item);
    });
  }

  function renderHistory() {
    var list = $("history-list");
    list.textContent = "";
    $("history-empty").hidden = state.history.length !== 0;
    state.history.forEach(function (record) {
      var item = el("div", "session-item history-item");
      var line = el("div", "session-line");
      line.appendChild(el("strong", "", record.controller.name));
      line.appendChild(el("span", "arrow", "控制"));
      line.appendChild(el("strong", "", record.host.name));
      item.appendChild(line);
      var meta = el("div", "session-meta");
      meta.appendChild(el("span", "", new Date(record.startedAt).toLocaleString("zh-CN", { hour12: false }) + " 开始"));
      meta.appendChild(el("span", "", "持续 " + durationMs(record.durationMs)));
      meta.appendChild(el("span", "", "被控方 IP " + (record.host.ip || "—")));
      meta.appendChild(el("span", "", "控制方 IP " + (record.controller.ip || "—")));
      meta.appendChild(el("span", "", "结束原因：" + reasonLabel(record.reason)));
      item.appendChild(meta);
      if (record.telemetry) {
        var stats = el("div", "session-stats");
        stats.appendChild(el("span", "", "平均 RTT " + Math.round(record.telemetry.rttMs) + " ms"));
        stats.appendChild(el("span", "", "丢包 " + Number(record.telemetry.lossPct || 0).toFixed(1) + "%"));
        stats.appendChild(el("span", "", "抖动 " + Math.round(record.telemetry.jitterMs) + " ms"));
        stats.appendChild(el("span", "", "码率 " + Math.round(record.telemetry.kbps) + " Kbps"));
        item.appendChild(stats);
      }
      if (record.dangerEvents && record.dangerEvents.length) {
        item.appendChild(dangerTags(record.dangerEvents));
      } else {
        item.appendChild(el("span", "history-safe", "无危险操作记录"));
      }
      list.appendChild(item);
    });
  }

  function renderInvites() {
    var list = $("invite-list");
    list.textContent = "";
    $("invite-empty").hidden = state.invites.length !== 0;
    state.invites.forEach(function (invite) {
      var row = el("div", "invite-row");
      var main = el("div", "invite-main");
      var title = el("div", "invite-title");
      var code = el("span", "code" + (invite.active ? "" : " revoked"), inviteCode(invite.code));
      title.appendChild(code);
      title.appendChild(el("strong", "", invite.label || "未命名邀请码"));
      title.appendChild(el("span", "pill " + (invite.active ? "green" : "gray"), invite.active ? "可用" : "已失效"));
      main.appendChild(title);
      var meta = el("div", "hint");
      var used = invite.maxUses > 0 ? invite.uses + " / " + invite.maxUses + " 次" : invite.uses + " 次（不限）";
      meta.textContent = used + " · " + expiryLabel(invite) + " · 创建于 " + new Date(invite.createdAt).toLocaleDateString("zh-CN");
      main.appendChild(meta);
      var actions = el("div", "invite-actions");
      actions.appendChild(button("复制", "copy-invite", "", { code: invite.code }));
      if (invite.active) actions.appendChild(button("撤销", "revoke-invite", "danger", { code: invite.code }));
      else actions.appendChild(button("删除", "delete-invite", "", { code: invite.code }));
      row.appendChild(main);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function actionLabel(action) {
    var map = {
      "device.registered": "客户端接入",
      "device.status": "调整权限",
      "device.disconnect": "断开客户端",
      "device.remove": "移除客户端",
      "session.end": "结束会话",
      "invite.create": "生成邀请码",
      "invite.revoke": "撤销邀请码",
      "invite.remove": "删除邀请码",
      "settings.update": "修改设置",
      "update.check": "检查服务端更新",
      "update.download": "下载服务端更新",
      "update.apply": "应用服务端更新",
      "admin.login": "管理员登录",
      "admin.login-failed": "登录失败",
      "admin.login-locked": "登录已临时锁定"
    };
    return map[action] || action;
  }

  function renderActivity() {
    var list = $("activity-list");
    list.textContent = "";
    $("activity-empty").hidden = state.activity.length !== 0;
    state.activity.forEach(function (entry) {
      var row = el("div", "activity-row");
      row.appendChild(el("span", "activity-dot"));
      var main = el("div", "activity-main");
      main.appendChild(el("strong", "", actionLabel(entry.action)));
      if (entry.detail) main.appendChild(el("div", "detail", entry.detail));
      row.appendChild(main);
      row.appendChild(el("span", "activity-time", new Date(entry.at).toLocaleString("zh-CN", { hour12: false })));
      list.appendChild(row);
    });
  }

  function renderSettings() {
    if (!state.settings) return;
    var settings = state.settings.settings;
    $("setting-mode").value = settings.registrationMode;
    $("setting-name").value = settings.serverName;
    text("settings-url", state.settings.publicUrl || "未设置公网地址");
    text("settings-version", "服务端版本 " + state.settings.version);
  }

  function sizeLabel(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderUpdate() {
    var update = state.update;
    if (!update) return;
    var phase = update.phase || "idle";
    var labels = {
      idle: "未检查",
      checking: "正在检查",
      "up-to-date": "已是最新",
      available: "有新版本",
      downloading: "正在下载",
      ready: "等待安装",
      applying: "正在更新",
      error: "更新失败"
    };
    var pill = $("update-pill");
    pill.textContent = labels[phase] || phase;
    pill.className = "pill " + (
      phase === "error" ? "red"
        : phase === "available" || phase === "ready" ? "amber"
        : phase === "up-to-date" ? "green" : "gray"
    );
    text(
      "update-current",
      "当前版本 v" + update.currentVersion + " · 更新源 " + (update.channel || "stable") +
        (update.systemUpdater ? " · 系统自动更新" : "")
    );
    var detail = "";
    if (!update.supported) detail = update.reason || "当前部署未启用服务端更新。";
    else if (update.error) detail = update.error;
    else if (phase === "up-to-date") detail = "已经是最新版本。";
    else if (update.latest && (phase === "available" || phase === "ready")) {
      detail = "最新版本 v" + update.latest.version + (update.latest.size ? " · " + sizeLabel(update.latest.size) : "");
      if (update.applyMode === "manual") detail += " · 下载后需在服务器上执行命令完成替换";
      else if (update.systemUpdater) detail += " · 系统更新服务会在无远控会话时自动安装，失败自动回滚";
    } else if (phase === "idle") detail = "点击“检查更新”向若道更新源查询版本。";
    text("update-detail", detail);

    var notes = $("update-notes");
    if (update.latest && update.latest.notes && (phase === "available" || phase === "ready")) {
      notes.textContent = update.latest.notes;
      notes.hidden = false;
    } else {
      notes.textContent = "";
      notes.hidden = true;
    }

    var command = $("update-command");
    command.hidden = !update.manualCommand;
    command.textContent = update.manualCommand || "";

    $("update-check").hidden = !update.supported;
    $("update-check").disabled = phase === "checking" || phase === "downloading";
    $("update-download").hidden = !(update.supported && phase === "available");
    $("update-apply").hidden = !(update.supported && phase === "ready");
  }

  function runUpdate(action, busyLabel, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    var entry = { check: "update-check", download: "update-download", apply: "update-apply" }[action];
    var btn = $(entry);
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyLabel;
    api("/api/admin/update/" + action, { method: "POST" })
      .then(function (data) {
        state.update = data.update || state.update;
        if (data.result && data.result.message) toast(data.result.message);
        else toast(action === "check" ? "已检查更新" : "更新包已下载并校验");
        return loadAll(true);
      })
      .catch(function (error) {
        toast(error.message, true);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  function updateDevice(id, status) {
    var confirmText = status === "blocked" ? "禁止后该客户端会立即掉线，且无法再进行远控。确定继续？" : "允许该客户端进行远控？";
    if (!window.confirm(confirmText)) return;
    api("/api/admin/devices/" + encodeURIComponent(id), { method: "PATCH", body: { status: status } })
      .then(function () { toast(status === "blocked" ? "已禁止该客户端" : "已允许该客户端"); return loadAll(true); })
      .catch(function (error) { toast(error.message, true); });
  }
  function disconnectDevice(id) {
    if (!window.confirm("断开后该客户端与服务器的连接会立即关闭。确定继续？")) return;
    api("/api/admin/devices/" + encodeURIComponent(id) + "/disconnect", { method: "POST" })
      .then(function () { toast("已断开客户端"); return loadAll(true); })
      .catch(function (error) { toast(error.message, true); });
  }
  function removeDevice(id) {
    if (!window.confirm("移除后该客户端再次接入需要重新使用邀请码。确定继续？")) return;
    api("/api/admin/devices/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function () { toast("已移除客户端"); return loadAll(true); })
      .catch(function (error) { toast(error.message, true); });
  }
  function endSession(id) {
    if (!window.confirm("确定结束这个远程会话？")) return;
    api("/api/admin/sessions/" + encodeURIComponent(id) + "/end", { method: "POST" })
      .then(function () { toast("会话已结束"); return loadAll(true); })
      .catch(function (error) { toast(error.message, true); });
  }

  $("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var password = $("admin-password").value;
    if (!password) return;
    login(password);
  });
  $("logout-btn").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).catch(function () {}).finally(function () {
      setToken("");
      showLogin();
    });
  });
  $("refresh-btn").addEventListener("click", function () {
    loadAll(true).then(function () { toast("已刷新"); }).catch(function (error) { toast(error.message, true); });
  });
  document.querySelectorAll(".tab[data-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab[data-tab]").forEach(function (item) { item.classList.remove("active"); });
      tab.classList.add("active");
      var name = tab.getAttribute("data-tab");
      ["clients", "invites", "history", "activity"].forEach(function (key) {
        $("tab-" + key).hidden = key !== name;
      });
    });
  });
  $("device-filter").addEventListener("click", function (event) {
    var target = event.target.closest("button[data-filter]");
    if (!target) return;
    state.filter = target.getAttribute("data-filter");
    document.querySelectorAll("#device-filter .tab").forEach(function (item) { item.classList.remove("active"); });
    target.classList.add("active");
    renderDevices();
  });
  $("device-body").addEventListener("click", function (event) {
    var target = event.target.closest("button[data-action]");
    if (!target) return;
    var id = target.getAttribute("data-id");
    var action = target.getAttribute("data-action");
    if (action === "approve") updateDevice(id, "approved");
    else if (action === "block") updateDevice(id, "blocked");
    else if (action === "disconnect") disconnectDevice(id);
    else if (action === "remove") removeDevice(id);
  });
  $("session-list").addEventListener("click", function (event) {
    var target = event.target.closest("button[data-action='end-session']");
    if (target) endSession(target.getAttribute("data-id"));
  });
  $("invite-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var submit = $("invite-submit");
    submit.disabled = true;
    api("/api/admin/invites", {
      method: "POST",
      body: {
        label: $("invite-label").value,
        maxUses: Number($("invite-uses").value),
        expiresInDays: Number($("invite-expiry").value)
      }
    }).then(function () {
      $("invite-label").value = "";
      toast("邀请码已生成");
      return loadAll(true);
    }).catch(function (error) {
      toast(error.message, true);
    }).finally(function () {
      submit.disabled = false;
    });
  });
  $("invite-list").addEventListener("click", function (event) {
    var target = event.target.closest("button[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    var code = target.getAttribute("data-code");
    if (action === "copy-invite") {
      navigator.clipboard.writeText(inviteCode(code)).then(function () {
        toast("邀请码已复制");
      }).catch(function () {
        toast("复制失败，请手动选择", true);
      });
    } else if (action === "revoke-invite") {
      if (!window.confirm("撤销后该邀请码立即失效。确定继续？")) return;
      api("/api/admin/invites/" + encodeURIComponent(code) + "/revoke", { method: "POST" })
        .then(function () { toast("邀请码已撤销"); return loadAll(true); })
        .catch(function (error) { toast(error.message, true); });
    } else if (action === "delete-invite") {
      if (!window.confirm("删除这条邀请码记录？")) return;
      api("/api/admin/invites/" + encodeURIComponent(code), { method: "DELETE" })
        .then(function () { toast("记录已删除"); return loadAll(true); })
        .catch(function (error) { toast(error.message, true); });
    }
  });
  $("settings-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var submit = $("settings-submit");
    submit.disabled = true;
    api("/api/admin/settings", {
      method: "PATCH",
      body: { registrationMode: $("setting-mode").value, serverName: $("setting-name").value }
    }).then(function () {
      toast("设置已保存");
      return loadAll(true);
    }).catch(function (error) {
      toast(error.message, true);
    }).finally(function () {
      submit.disabled = false;
    });
  });

  $("update-check").addEventListener("click", function () {
    runUpdate("check", "检查中…");
  });
  $("update-download").addEventListener("click", function () {
    runUpdate("download", "下载中…");
  });
  $("update-apply").addEventListener("click", function () {
    runUpdate("apply", "处理中…", "更新会重启服务端，正在进行的远控会话会中断。确定继续？");
  });

  var hash = window.location.hash || "";
  if (hash.indexOf("#token=") === 0) {
    try {
      setToken(decodeURIComponent(hash.slice(7)));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (error) {
      // Ignore malformed auto-login tokens.
    }
  }
  api("/api/admin/me").then(function () {
    showApp();
    return loadAll(false);
  }).catch(function () {
    showLogin();
  });
})();
</script>
</body>
</html>`;
