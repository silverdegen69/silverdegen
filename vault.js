  // ── CONFIG ──
  const SUPABASE_URL  = 'https://ccgehcbqdrdjvuaflhcw.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjZ2VoY2JxZHJkanZ1YWZsaGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzU2NTYsImV4cCI6MjA5MTQxMTY1Nn0.0GGaOzuUDxLASi_Bwo0nDB5L1Mp4e6uh7MClq04cnbI';
  const DIGITAL_PRICE  = 49;
  const PHYSICAL_PRICE = 59.99;

  // ── STATE ──
  let state = {
    selectedPack: null,
    currentUser: null,
    consentChecked: [false,false,false,false,false],
    session: null,
    spinCount: 0,
    currentOdds: 10,
    goldPosition: null,
    boxNumber: 1,
    packResults: Array(10).fill(null),
    isRevealing: false
  };

  // ── SCREEN MANAGEMENT ──
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
    window.scrollTo(0,0);
  }

  function goBack() {
    showScreen('landing');
  }

  // ── PACK SELECTION ──
  function selectPack(type) {
    state.selectedPack = type;
    // TEMP: bypass auth for UI testing — remove before launch
    state.currentUser = { email: 'test@silverdegen.com', token: 'test' };
    enterVault();
    // showScreen('auth'); // restore this when Stripe + Supabase auth wired
  }

  // ── AUTH ──
  let authMode = 'login';

  function toggleAuthMode() {
    authMode = authMode === 'login' ? 'register' : 'login';
    document.getElementById('auth-login-form').style.display    = authMode === 'login'    ? 'block' : 'none';
    document.getElementById('auth-register-form').style.display = authMode === 'register' ? 'block' : 'none';
  }

  async function authGoogle() {
    // Supabase Google OAuth
    const res = await supa('POST', '/auth/v1/authorize', null, {
      provider: 'google',
      redirect_to: window.location.href
    });
    if (res && res.url) window.location.href = res.url;
    else alert('Google sign-in unavailable. Please use email/password.');
  }

  async function authLogin() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { alert('Please enter email and password.'); return; }

    const res = await supa('POST', '/auth/v1/token?grant_type=password', null, { email, password });
    if (res && res.access_token) {
      state.currentUser = { email, token: res.access_token };
      await postAuth();
    } else {
      alert('Sign in failed. Check your credentials or register first.');
    }
  }

  async function authRegister() {
    const email = document.getElementById('reg-email').value.trim();
    const p1    = document.getElementById('reg-password').value;
    const p2    = document.getElementById('reg-password2').value;
    if (!email || !p1) { alert('Please fill all fields.'); return; }
    if (p1 !== p2) { alert('Passwords do not match.'); return; }

    const res = await supa('POST', '/auth/v1/signup', null, { email, password: p1 });
    if (res && res.user) {
      state.currentUser = { email, token: res.access_token };
      await postAuth();
    } else {
      alert('Registration failed. This email may already be in use.');
    }
  }

  async function postAuth() {
    // Check if customer has signed consent before
    const customer = await getCustomer(state.currentUser.email);
    if (customer && customer.consent_signed_at) {
      // Already consented — go straight to vault
      enterVault();
    } else {
      // First time — show consent
      showScreen('consent');
      document.getElementById('consent-date').textContent =
        'Date: ' + new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
  }

  function signOut() {
    state.currentUser = null;
    state.session = null;
    showScreen('landing');
  }

  // ── CONSENT ──
  function toggleConsent(n) {
    const el = document.getElementById('cs' + n);
    state.consentChecked[n-1] = !state.consentChecked[n-1];
    el.classList.toggle('checked', state.consentChecked[n-1]);
    checkConsentReady();
  }

  function checkConsentReady() {
    const allChecked = state.consentChecked.every(Boolean);
    const hasSig     = document.getElementById('consent-sig').value.trim().length > 2;
    const btn        = document.getElementById('consent-submit-btn');
    btn.classList.toggle('ready', allChecked && hasSig);
  }

  async function submitConsent() {
    const allChecked = state.consentChecked.every(Boolean);
    const sig        = document.getElementById('consent-sig').value.trim();
    if (!allChecked || sig.length < 2) return;

    // Save consent to Supabase
    await supaInsert('vault_customers', {
      email:              state.currentUser.email,
      consent_signed_at:  new Date().toISOString(),
      consent_signature:  sig
    });

    enterVault();
  }

  // ── ENTER VAULT ──
  function enterVault() {
    if (state.selectedPack === 'physical') {
      showScreen('physical');
      return;
    }
    showScreen('vault');
    document.getElementById('vault-user-label').textContent = state.currentUser?.email || '';
    initSession();
  }

  // ── SESSION INIT ──
  function initSession() {
    // Generate provably fair seeds
    const serverSeed   = generateSeed(32);
    const serverHash   = simpleHash(serverSeed);
    const clientSeed   = generateSeed(16);
    const combined     = serverSeed + clientSeed;
    const goldPosition = (simpleHashInt(combined) % 10) + 1; // 1-10

    state.session = {
      serverSeed, serverHash, clientSeed, goldPosition,
      startedAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000)
    };
    state.spinCount   = 0;
    state.currentOdds = 10;
    state.packResults = Array(10).fill(null);
    state.boxNumber   = (state.boxNumber || 0) + 1;
    state.goldWon     = false;

    // Update UI
    document.getElementById('pf-server-hash').textContent = serverHash;
    document.getElementById('pf-client-seed').textContent = clientSeed;
    document.getElementById('pf-box-id').textContent      = 'BOX-' + Date.now().toString(36).toUpperCase();
    document.getElementById('pf-expires').textContent     = new Date(state.session.expiresAt).toLocaleTimeString();
    document.getElementById('box-number-label').textContent = '· Box #' + state.boxNumber;

    updateOddsUI();
    renderPackGrid();

    // Save session to Supabase (fire and forget)
    supaInsert('vault_sessions', {
      customer_id:      null, // would be real customer ID in production
      box_number:       state.boxNumber,
      server_seed_hash: serverHash,
      client_seed:      clientSeed,
      gold_position:    goldPosition,
      started_at:       new Date(state.session.startedAt).toISOString(),
      expires_at:       new Date(state.session.expiresAt).toISOString(),
      spin_count:       0,
      current_odds:     10
    });
  }

  // ── PACK GRID ──
  function renderPackGrid() {
    const grid = document.getElementById('pack-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const result = state.packResults[i-1];
      const opened = result !== null;
      const div    = document.createElement('div');
      div.className = 'mystery-pack' + (opened ? ' opened' : '');
      div.id        = 'pack-' + i;
      div.innerHTML = `
        <div class="pack-serial">VLT-${String(i).padStart(3,'0')}</div>
        ${opened
          ? (result === 'gold_bar'
              ? '<img src="goldbar.jpg" alt="Gold Bar" style="width:52px;height:70px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(232,201,122,0.5));position:absolute;top:50%;left:50%;transform:translate(-50%,-62%);">'
              : '<img src="wtno.jpg" alt="War Nickel" style="width:64px;height:64px;object-fit:contain;border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-62%);">')
          : '<img class="pack-logo" src="logo.png" alt="" />'
        }
        <div class="pack-bottom-strip">
          <div class="pack-label">${opened ? (result === 'gold_bar' ? '🥇 GOLD' : '🪙 NICKEL') : 'Vault Series'}</div>
          <div class="pack-odds-tag">1:${state.currentOdds}</div>
        </div>
      `;
      if (!opened) div.onclick = () => openPack(i);
      grid.appendChild(div);
    }
  }

  function updateOddsUI() {
    const odds     = state.currentOdds;
    const spins    = state.spinCount;
    const fillPct  = Math.round((1 / odds) * 100);

    document.getElementById('odds-display').textContent  = '1 in ' + odds;
    document.getElementById('odds-inline').textContent   = odds;
    document.getElementById('odds-fill').style.width     = fillPct + '%';
    document.getElementById('spins-label').textContent   = spins + ' of 10 opened';
  }

  // ── LOCK GRID AFTER GOLD WIN ──
  function lockPackGrid() {
    document.querySelectorAll('.mystery-pack:not(.opened)').forEach(pack => {
      pack.style.opacity = '0.3';
      pack.style.cursor = 'not-allowed';
      pack.style.pointerEvents = 'none';
      // Update label to show locked
      const label = pack.querySelector('.pack-label');
      if (label) label.textContent = 'LOCKED';
    });

    // Show locked banner below odds bar
    const oddsBar = document.querySelector('.odds-bar');
    if (oddsBar) {
      const lockBanner = document.createElement('div');
      lockBanner.style.cssText = `
        background: rgba(232,201,122,0.08);
        border: 1px solid rgba(232,201,122,0.2);
        border-radius: 10px; padding: 12px 16px;
        font-family: 'Teko', sans-serif;
        font-size: 18px; letter-spacing: 0.06em;
        text-align: center; cursor: pointer;
        transition: background 0.2s;
      `;
      lockBanner.innerHTML = `<span style="color:var(--gold);">🏆 GOLD FOUND — THIS BOX IS CLOSED.</span> <span style="color:#fff;text-decoration:underline;text-underline-offset:3px;">OPEN A NEW BOX TO CONTINUE →</span>`;
      lockBanner.addEventListener('click', showNewBoxModal);
      lockBanner.addEventListener('mouseenter', () => lockBanner.style.background = 'rgba(232,201,122,0.14)');
      lockBanner.addEventListener('mouseleave', () => lockBanner.style.background = 'rgba(232,201,122,0.08)');
      oddsBar.insertAdjacentElement('afterend', lockBanner);
    }
  }

  // ── OPEN PACK ──
  async function openPack(packNum) {
    if (state.isRevealing) return;
    if (state.packResults[packNum-1] !== null) return;
    if (state.goldWon) return; // box is closed after gold win

    // Check session expiry
    if (Date.now() > state.session.expiresAt) {
      alert('Your session has expired. Starting a new box.');
      initSession(); return;
    }

    state.isRevealing = true;
    state.spinCount++;

    // Determine result
    let result;
    if (state.spinCount === 10) {
      result = 'gold_bar'; // guaranteed
    } else if (packNum === state.session.goldPosition && !state.packResults.includes('gold_bar')) {
      result = 'gold_bar';
    } else {
      result = 'war_nickel';
    }

    state.packResults[packNum-1] = result;

    // Update odds
    if (result === 'war_nickel') {
      state.currentOdds = Math.max(1, state.currentOdds - 1);
    }

    // Animate
    await runRevealAnimation(result);

    // Update grid
    updateOddsUI();
    renderPackGrid();
    state.isRevealing = false;

    // Save order to Supabase
    supaInsert('vault_orders', {
      pack_type:    'digital',
      spin_number:  state.spinCount,
      result:       result,
      amount_charged: DIGITAL_PRICE,
      buyback_offered: result === 'gold_bar'
    });

    // Lock grid if gold was won
    if (result === 'gold_bar') {
      state.goldWon = true;
      lockPackGrid();
    }
  }

  // ── REVEAL ANIMATION ──
  async function runRevealAnimation(result) {
    const overlay   = document.getElementById('reveal-overlay');
    const packTop   = document.getElementById('pack-top');
    const contents  = document.getElementById('pack-contents');
    const contImg   = document.getElementById('pack-contents-img');
    const contLabel = document.getElementById('pack-contents-label');
    const resultCard = document.getElementById('result-card');

    // Set content
    if (result === 'gold_bar') {
      contImg.innerHTML   = '<img src="goldbar.jpg" alt="1g Valcambi Gold Bar" style="width:100px;height:136px;object-fit:contain;filter:drop-shadow(0 4px 24px rgba(232,201,122,0.6));">';
      contImg.style.fontSize = 'inherit';
      contLabel.textContent = '1g .999 Fine Gold Bar';
      overlay.style.background = 'rgba(0,0,0,0.95)';
    } else {
      contImg.innerHTML   = '<img src="wtno.jpg" alt="1944 War Nickel" style="width:110px;height:110px;object-fit:contain;border-radius:50%;filter:drop-shadow(0 4px 16px rgba(184,200,212,0.4));">';
      contImg.style.fontSize = 'inherit';
      contLabel.textContent = 'WWII War Nickel';
    }

    // Reset
    resultCard.style.display = 'none';
    packTop.style.transform  = '';
    packTop.style.opacity    = '';
    contents.style.transform = '';
    overlay.className        = 'reveal-overlay active';

    // Phase 1: Shake (0.8s)
    await delay(100);
    overlay.classList.add('phase-shake');
    await delay(900);

    // Phase 2: Tear (0.4s)
    overlay.classList.remove('phase-shake');
    overlay.classList.add('phase-tear');
    await delay(500);

    // Phase 3: Slide (1.8s)
    overlay.classList.add('phase-slide');
    await delay(1800);

    // Phase 4: Result
    if (result === 'gold_bar') {
      // Gold flash
      const flash = document.createElement('div');
      flash.className = 'gold-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 600);
      spawnConfetti('gold');
      showBuybackModal();
    } else {
      showWarNickelResult(result);
      spawnConfetti('silver');
    }
  }

  function showWarNickelResult(result) {
    const resultCard    = document.getElementById('result-card');
    const resultType    = document.getElementById('result-type');
    const resultDesc    = document.getElementById('result-desc');
    const resultActions = document.getElementById('result-actions');

    resultType.className   = 'result-type nickel';
    resultType.textContent = 'WWII WAR NICKEL';
    resultDesc.innerHTML   = '<strong>Authentic WWII War Nickel — 1942-1945. Ships today.</strong>';

    const oddsRemaining = state.currentOdds;
    const spinsLeft     = 10 - state.spinCount;

    resultActions.innerHTML = `
      <div style="background:rgba(232,201,122,0.08);border:1px solid rgba(232,201,122,0.2);border-radius:10px;padding:12px;font-size:12px;color:var(--text);margin-bottom:8px;">
        Your odds just improved: <strong style="color:var(--gold);">1 in ${oddsRemaining}</strong> · ${spinsLeft} packs remaining
      </div>
      <button class="result-btn-primary" id="btn-next-pack">Open Next Pack →</button>
      <button class="result-btn-secondary" id="btn-new-box-result">Open New Box</button>
    `;

    // Wire buttons with addEventListener — no inline onclick
    document.getElementById('btn-next-pack').addEventListener('click', closeReveal);
    document.getElementById('btn-new-box-result').addEventListener('click', () => {
      closeReveal();
      showNewBoxModal();
    });

    resultCard.style.display = 'block';
  }

  function closeReveal() {
    document.getElementById('reveal-overlay').className = 'reveal-overlay';
  }

  // ── BUYBACK MODAL ──
  function showBuybackModal() {
    closeReveal();
    document.getElementById('buyback-modal').classList.add('active');
    startBuybackTimer();
  }

  let buybackInterval;
  function startBuybackTimer() {
    let seconds = 24 * 60 * 60;
    clearInterval(buybackInterval);
    buybackInterval = setInterval(() => {
      seconds--;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      document.getElementById('buyback-timer').textContent =
        `This offer expires in ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      if (seconds <= 0) {
        clearInterval(buybackInterval);
        closeModal('buyback-modal');
        alert('Offer expired — your gold bar will ship automatically within 72 hours.');
      }
    }, 1000);
  }

  function chooseShip() {
    clearInterval(buybackInterval);
    closeModal('buyback-modal');
    alert('Your gold bar is confirmed for shipment. You\'ll receive a tracking number within 3 business days. Congratulations! 🏆');
    // In production: trigger shipping workflow
    if (state.session) {
      state.session.goldPosition = -1; // reset
    }
    updateOddsUI();
    renderPackGrid();
  }

  function chooseSellBack() {
    clearInterval(buybackInterval);
    closeModal('buyback-modal');
    alert('Sell-back confirmed. A check for $142.50 will be mailed to your address on file within 7 business days. Thank you! 🪙');
    // In production: trigger buyback workflow
    updateOddsUI();
    renderPackGrid();
  }

  // ── SHUFFLE ──
  function shufflePacks() {
    document.querySelectorAll('.mystery-pack:not(.opened)').forEach(p => {
      p.classList.add('shuffling');
      setTimeout(() => p.classList.remove('shuffling'), 700);
    });
  }

  // ── NEW BOX MODAL ──
  function showNewBoxModal() {
    document.getElementById('newbox-modal').classList.add('active');
  }

  function confirmNewBox() {
    closeModal('newbox-modal');
    initSession();
  }

  // ── SHOW ME MODAL ──
  function showShowMeModal() {
    document.getElementById('showme-modal').classList.add('active');
  }

  function confirmShowMe() {
    closeModal('showme-modal');
    const gold = state.session?.goldPosition;

    // Fade out all non-gold packs
    for (let i = 1; i <= 10; i++) {
      const el = document.getElementById('pack-' + i);
      if (!el) continue;
      if (i === gold) {
        // Reveal gold pack
        el.style.border = '2px solid var(--gold)';
        el.style.boxShadow = '0 0 32px rgba(232,201,122,0.5)';
        el.style.transform = 'scale(1.06)';
        el.style.transition = 'all 0.4s ease';
        el.style.opacity = '1';
        el.innerHTML = `
          <div class="pack-serial">VLT-${String(gold).padStart(3,'0')}</div>
          <img src="goldbar.jpg" alt="Gold Bar" style="width:52px;height:70px;object-fit:contain;filter:drop-shadow(0 2px 16px rgba(232,201,122,0.7));position:absolute;top:50%;left:50%;transform:translate(-50%,-62%);" />
          <div class="pack-bottom-strip" style="background:rgba(232,201,122,0.25);border-top:1px solid rgba(232,201,122,0.4);">
            <div class="pack-label" style="color:var(--gold);">🥇 GOLD WAS HERE</div>
            <div class="pack-odds-tag">REVEALED</div>
          </div>
        `;
      } else {
        // Fade out other packs
        el.style.opacity = '0.2';
        el.style.transition = 'opacity 0.4s ease';
      }
    }

    // Show seed info as a non-blocking banner at top of vault content
    const content = document.querySelector('.vault-content');
    const banner = document.createElement('div');
    banner.style.cssText = `
      background: rgba(232,201,122,0.08);
      border: 1px solid rgba(232,201,122,0.25);
      border-radius: 12px; padding: 14px 18px;
      font-size: 12px; color: var(--text);
      font-family: 'DM Mono', monospace;
      line-height: 1.8; margin-bottom: 16px;
      animation: fadeUp 0.4s ease both;
    `;
    banner.innerHTML = `
      <div style="color:var(--gold);font-family:'Teko',sans-serif;font-size:18px;margin-bottom:6px;letter-spacing:0.08em;">SESSION REVEALED — PROVABLY FAIR</div>
      Server Seed: ${state.session.serverSeed}<br>
      Client Seed: ${state.session.clientSeed}<br>
      Gold was in Pack #${gold} — verify this result in My Sessions.
      <div style="margin-top:14px;">
        <button id="btn-start-fresh" style="
          background:linear-gradient(135deg,var(--gold),var(--gold-dim));
          border:none;border-radius:8px;padding:10px 24px;
          font-family:'Teko',sans-serif;font-size:20px;font-weight:700;
          letter-spacing:0.05em;color:#0C0E12;cursor:pointer;
          transition:opacity 0.2s;
        ">Start Fresh Session →</button>
      </div>
    `;
    content.insertBefore(banner, content.firstChild);

    // Wire the button — no auto reset
    document.getElementById('btn-start-fresh').addEventListener('click', () => {
      banner.remove();
      initSession();
    });
  }

  // ── VERIFIER ──
  function showVerifier() {
    alert('Session verifier coming soon. You will be able to verify all past sessions using your server seed + client seed combination.');
  }

  // ── PHYSICAL PACK ──
  let physicalQty = 1;
  function adjustQty(delta) {
    physicalQty = Math.max(1, physicalQty + delta);
    document.getElementById('qty-display').textContent = physicalQty;
    document.getElementById('qty-total').textContent =
      'Total: $' + (physicalQty * PHYSICAL_PRICE).toFixed(2);
  }

  function checkoutPhysical() {
    alert('Stripe checkout coming soon. Physical pack orders will be processed via Stripe with full address capture.');
  }

  // ── MODAL HELPERS ──
  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  // ── CONFETTI ──
  function spawnConfetti(type) {
    const colors = type === 'gold'
      ? ['#FFD700','#E8C97A','#C8A84A','#FFF3CD']
      : ['#DCE8F0','#A0A8AF','#8A9BAA','#fff'];

    for (let i = 0; i < (type === 'gold' ? 80 : 30); i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        el.style.cssText = `
          left: ${Math.random() * 100}vw;
          top: -10px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          animation-duration: ${1.5 + Math.random() * 2}s;
          animation-delay: ${Math.random() * 0.5}s;
          transform: rotate(${Math.random() * 360}deg);
          width: ${4 + Math.random() * 8}px;
          height: ${4 + Math.random() * 8}px;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
      }, i * 20);
    }
  }

  // ── CRYPTO HELPERS ──
  function generateSeed(length) {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8,'0').repeat(4).substring(0,32);
  }

  function simpleHashInt(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── SUPABASE HELPERS ──
  async function supa(method, path, token, body) {
    try {
      const res = await fetch(SUPABASE_URL + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${token || SUPABASE_ANON}`
        },
        body: body ? JSON.stringify(body) : undefined
      });
      return await res.json();
    } catch(e) { console.error(e); return null; }
  }

  async function supaInsert(table, data) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(data)
      });
    } catch(e) { console.error(e); }
  }

  async function getCustomer(email) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/vault_customers?email=eq.${encodeURIComponent(email)}&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_ANON,
            'Authorization': `Bearer ${SUPABASE_ANON}`
          }
        }
      );
      const data = await res.json();
      return data?.[0] || null;
    } catch(e) { return null; }
  }

  // ── INIT — runs immediately since script is at bottom of body ──
  (function init() {

    // Consent date
    const cd = document.getElementById('consent-date');
    if (cd) cd.textContent = 'Date: ' + new Date().toLocaleDateString('en-US', {
      weekday:'long', year:'numeric', month:'long', day:'numeric'
    });

    // ── Direct onclick assignment on pack links ──
    const linkDigital  = document.querySelector('a[href="#digital"]');
    const linkPhysical = document.querySelector('a[href="#physical"]');
    if (linkDigital)  linkDigital.onclick  = function(e) { e.preventDefault(); selectPack('digital');  return false; };
    if (linkPhysical) linkPhysical.onclick = function(e) { e.preventDefault(); selectPack('physical'); return false; };

    // Auth screen
    const btnBackAuth = document.getElementById('btn-back-auth');
    if (btnBackAuth) btnBackAuth.addEventListener('click', goBack);

    const btnGoogle = document.getElementById('btn-google');
    if (btnGoogle) btnGoogle.addEventListener('click', authGoogle);

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) btnLogin.addEventListener('click', authLogin);

    const btnRegister = document.getElementById('btn-register');
    if (btnRegister) btnRegister.addEventListener('click', authRegister);

    const btnToggleLogin = document.getElementById('btn-toggle-login');
    const btnToggleReg   = document.getElementById('btn-toggle-reg');
    if (btnToggleLogin) btnToggleLogin.addEventListener('click', toggleAuthMode);
    if (btnToggleReg)   btnToggleReg.addEventListener('click',   toggleAuthMode);

    // Consent screen
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('cs' + i);
      if (el) el.addEventListener('click', () => toggleConsent(i));
    }
    const consentSig = document.getElementById('consent-sig');
    if (consentSig) consentSig.addEventListener('input', checkConsentReady);

    const consentSubmit = document.getElementById('consent-submit-btn');
    if (consentSubmit) consentSubmit.addEventListener('click', submitConsent);

    // Vault controls
    const btnShuffle  = document.getElementById('btn-shuffle');
    const btnNewBox   = document.getElementById('btn-new-box');
    const btnShowMe   = document.getElementById('btn-show-me');
    const btnVerify   = document.getElementById('btn-verify');
    const btnSignOut  = document.getElementById('btn-sign-out');
    if (btnShuffle)  btnShuffle.addEventListener('click',  shufflePacks);
    if (btnNewBox)   btnNewBox.addEventListener('click',   showNewBoxModal);
    if (btnShowMe)   btnShowMe.addEventListener('click',   showShowMeModal);
    if (btnVerify)   btnVerify.addEventListener('click',   showVerifier);
    if (btnSignOut)  btnSignOut.addEventListener('click',  signOut);

    // Reveal overlay result buttons wired dynamically in showWarNickelResult()

    // Buyback modal
    const btnShip     = document.getElementById('btn-ship');
    const btnSellBack = document.getElementById('btn-sell-back');
    if (btnShip)     btnShip.addEventListener('click',     chooseShip);
    if (btnSellBack) btnSellBack.addEventListener('click', chooseSellBack);

    // New box modal
    const btnConfirmNewBox  = document.getElementById('btn-confirm-new-box');
    const btnCancelNewBox   = document.getElementById('btn-cancel-new-box');
    if (btnConfirmNewBox) btnConfirmNewBox.addEventListener('click', confirmNewBox);
    if (btnCancelNewBox)  btnCancelNewBox.addEventListener('click',  () => closeModal('newbox-modal'));

    // Show me modal
    const btnConfirmShowMe  = document.getElementById('btn-confirm-show-me');
    const btnCancelShowMe   = document.getElementById('btn-cancel-show-me');
    if (btnConfirmShowMe) btnConfirmShowMe.addEventListener('click', confirmShowMe);
    if (btnCancelShowMe)  btnCancelShowMe.addEventListener('click',  () => closeModal('showme-modal'));

    // Physical pack
    const btnQtyMinus   = document.getElementById('btn-qty-minus');
    const btnQtyPlus    = document.getElementById('btn-qty-plus');
    const btnPhysicalCO = document.getElementById('btn-physical-checkout');
    const btnBackPhys   = document.getElementById('btn-back-physical');
    if (btnQtyMinus)   btnQtyMinus.addEventListener('click',   () => adjustQty(-1));
    if (btnQtyPlus)    btnQtyPlus.addEventListener('click',    () => adjustQty(1));
    if (btnPhysicalCO) btnPhysicalCO.addEventListener('click', checkoutPhysical);
    if (btnBackPhys)   btnBackPhys.addEventListener('click',   goBack);
  })();
