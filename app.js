(() => {
  'use strict';

  const STORAGE_KEY = 'uth-hand-recorder-v1';
  const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
  const suits = ['♠','♥','♦','♣'];
  const labels = {hole1:'Card 1',hole2:'Card 2',flop1:'F1',flop2:'F2',flop3:'F3',turn:'T',river:'R',dealer1:'Dealer 1',dealer2:'Dealer 2'};
  const $ = id => document.getElementById(id);

  let state = loadState();
  let mode = 'live';
  let editIndex = null;
  let activeCardSlot = null;
  let selectedRank = null;
  let cards = {};
  let selectedAction = null;

  function defaultState(){
    return {
      sessionId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      startingBankroll: 3000,
      defaults: {ante:25,jackpot:10,trips:0},
      hands: []
    };
  }

  function loadState(){
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !Array.isArray(parsed.hands)) return defaultState();
      parsed.defaults = {...{ante:25,jackpot:10,trips:0}, ...(parsed.defaults || {})};
      parsed.startingBankroll = Number(parsed.startingBankroll ?? 3000);
      return parsed;
    } catch { return defaultState(); }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function toNumber(value, fallback=0){
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value, signed=false){
    const n = toNumber(value);
    const abs = Math.abs(n).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
    if (signed) return `${n < 0 ? '-$' : '+$'}${abs}`;
    return `${n < 0 ? '-$' : '$'}${abs}`;
  }

  function sessionPL(){ return state.hands.reduce((sum,h)=>sum+toNumber(h.netPL),0); }
  function expectedPL(){ return state.hands.reduce((sum,h)=>sum-(toNumber(h.ante)*0.02185),0); }
  function nextHandNumber(){
    const nums = state.hands.map(h=>toNumber(h.handNumber)).filter(n=>n>0);
    return nums.length ? Math.max(...nums)+1 : 1;
  }

  function renderHeader(){
    $('handNumber').textContent = `#${editIndex !== null ? state.hands[editIndex].handNumber : nextHandNumber()}`;
    const pl = sessionPL();
    $('sessionPL').textContent = pl === 0 ? '$0.00' : money(pl,true);
    $('sessionPL').className = pl > 0 ? 'positive' : pl < 0 ? 'negative' : '';
  }

  function applyDefaults(){
    $('ante').value = state.defaults.ante;
    $('jackpot').value = state.defaults.jackpot;
    $('trips').value = state.defaults.trips;
  }

  function updateDefaultsFromInputs(){
    state.defaults.ante = toNumber($('ante').value,25);
    state.defaults.jackpot = toNumber($('jackpot').value,10);
    state.defaults.trips = toNumber($('trips').value,0);
    saveState();
  }

  function setMode(nextMode){
    mode = nextMode;
    $('liveMode').classList.toggle('active', mode === 'live');
    $('postMode').classList.toggle('active', mode === 'post');
    $('postFields').hidden = mode !== 'post';
    if (mode === 'post' && !$('handDateTime').value) $('handDateTime').value = nowLocalInput();
    updateSaveButton();
  }

  function nowLocalInput(){
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }

  function openSheet(id){ $(id).hidden = false; }
  function closeSheet(id){ $(id).hidden = true; }

  function chooseAction(action){
    selectedAction = action;
    document.querySelectorAll('[data-action]').forEach(btn => btn.classList.toggle('selected', btn.dataset.action === action));
  }

  function setCard(slot, card){
    cards[slot] = card;
    const btn = document.querySelector(`[data-card-slot="${slot}"]`);
    if (!btn) return;
    btn.textContent = card;
    btn.classList.toggle('redCard', card.includes('♥') || card.includes('♦'));
  }

  function resetForm({keepDefaults=true}={}){
    cards = {};
    selectedAction = null;
    document.querySelectorAll('[data-card-slot]').forEach(btn=>{btn.textContent=labels[btn.dataset.cardSlot];btn.classList.remove('redCard');});
    document.querySelectorAll('[data-action]').forEach(btn=>btn.classList.remove('selected'));
    $('netPL').value = '';
    $('manualHandNumber').value = '';
    $('handDateTime').value = mode === 'post' ? nowLocalInput() : '';
    $('jackpotPayout').value = '0';
    $('tripsPayout').value = '0';
    $('jackpotMeter').value = '';
    $('notes').value = '';
    if (!keepDefaults) applyDefaults();
    editIndex = null;
    updateSaveButton();
    renderHeader();
  }

  function updateSaveButton(){
    const btn = $('saveBtn');
    btn.classList.toggle('editing', editIndex !== null);
    btn.textContent = editIndex !== null ? 'SAVE CHANGES' : mode === 'post' ? 'ADD HAND' : 'SAVE HAND';
  }

  function buildHandRecord(){
    const handNo = mode === 'post' && toNumber($('manualHandNumber').value) > 0 ? toNumber($('manualHandNumber').value) : (editIndex !== null ? state.hands[editIndex].handNumber : nextHandNumber());
    return {
      id: editIndex !== null ? state.hands[editIndex].id : (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      handNumber: handNo,
      mode,
      recordedAt: mode === 'post' && $('handDateTime').value ? $('handDateTime').value : new Date().toISOString(),
      ante: toNumber($('ante').value),
      jackpot: toNumber($('jackpot').value),
      trips: toNumber($('trips').value),
      cards: {...cards},
      action: selectedAction,
      netPL: toNumber($('netPL').value),
      jackpotPayout: toNumber($('jackpotPayout').value),
      tripsPayout: toNumber($('tripsPayout').value),
      jackpotMeter: $('jackpotMeter').value === '' ? null : toNumber($('jackpotMeter').value),
      notes: $('notes').value.trim()
    };
  }

  function validateHand(){
    if (!cards.hole1 || !cards.hole2) return 'Select both hole cards.';
    if (!selectedAction) return 'Select 4×, 2×, 1× or Fold.';
    if ($('netPL').value === '') return 'Enter the actual net P/L.';
    return null;
  }

  function saveHand(){
    const error = validateHand();
    if (error) { alert(error); return; }
    updateDefaultsFromInputs();
    const record = buildHandRecord();
    if (editIndex !== null) {
      state.hands[editIndex] = record;
      state.hands.sort((a,b)=>a.handNumber-b.handNumber || String(a.recordedAt).localeCompare(String(b.recordedAt)));
      toast('Hand updated');
    } else {
      state.hands.push(record);
      state.hands.sort((a,b)=>a.handNumber-b.handNumber || String(a.recordedAt).localeCompare(String(b.recordedAt)));
      toast(mode === 'post' ? 'Post-session hand added' : 'Hand saved');
    }
    saveState();
    resetForm();
  }

  function undo(){
    if (editIndex !== null) { resetForm(); toast('Edit cancelled'); return; }
    if (!state.hands.length) { toast('No saved hands to undo'); return; }
    state.hands.pop(); saveState(); renderHeader(); renderStats(); toast('Last saved hand removed');
  }

  function renderHistory(){
    const list = $('historyList');
    list.innerHTML = '';
    if (!state.hands.length) { list.innerHTML = '<div class="emptyState">No saved hands yet.</div>'; return; }
    [...state.hands].sort((a,b)=>b.handNumber-a.handNumber).forEach(hand=>{
      const sourceIndex = state.hands.findIndex(h=>h.id===hand.id);
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'historyRow';
      const pl = toNumber(hand.netPL);
      row.innerHTML = `<strong>#${hand.handNumber}</strong><span class="historyMeta"><strong>${hand.cards.hole1 || '—'} ${hand.cards.hole2 || '—'} · ${String(hand.action).toUpperCase()}</strong><span>${hand.mode === 'post' ? 'Post-session · ' : ''}Ante $${hand.ante} · JP $${hand.jackpot} · Trips $${hand.trips}</span></span><strong class="${pl>0?'positive':pl<0?'negative':''}">${pl===0?'$0.00':money(pl,true)}</strong>`;
      row.addEventListener('click',()=>loadForEdit(sourceIndex));
      list.appendChild(row);
    });
  }

  function loadForEdit(index){
    const hand = state.hands[index]; if (!hand) return;
    editIndex = index;
    mode = hand.mode || 'live';
    setMode(mode);
    $('ante').value = hand.ante; $('jackpot').value = hand.jackpot; $('trips').value = hand.trips;
    resetCardControlsOnly();
    cards = {...hand.cards}; Object.entries(cards).forEach(([slot,card])=>setCard(slot,card));
    chooseAction(hand.action);
    $('netPL').value = hand.netPL;
    $('manualHandNumber').value = hand.handNumber;
    if (hand.mode === 'post') $('handDateTime').value = String(hand.recordedAt).slice(0,16);
    $('jackpotPayout').value = hand.jackpotPayout ?? 0;
    $('tripsPayout').value = hand.tripsPayout ?? 0;
    $('jackpotMeter').value = hand.jackpotMeter ?? '';
    $('notes').value = hand.notes || '';
    closeSheet('historySheet');
    updateSaveButton(); renderHeader();
  }

  function resetCardControlsOnly(){
    document.querySelectorAll('[data-card-slot]').forEach(btn=>{btn.textContent=labels[btn.dataset.cardSlot];btn.classList.remove('redCard');});
    document.querySelectorAll('[data-action]').forEach(btn=>btn.classList.remove('selected'));
  }

  function renderStats(){
    const actual = sessionPL(), expected = expectedPL(), n = state.hands.length;
    const current = state.startingBankroll + actual;
    const avgAnte = n ? state.hands.reduce((s,h)=>s+toNumber(h.ante),0)/n : 0;
    $('startingBankroll').value = state.startingBankroll;
    $('currentBankroll').textContent = money(current);
    $('statHands').textContent = n;
    $('statActual').textContent = actual===0?'$0.00':money(actual,true);
    $('statExpected').textContent = expected===0?'$0.00':money(expected,true);
    $('statVsEV').textContent = (actual-expected)===0?'$0.00':money(actual-expected,true);
    $('statAvgAnte').textContent = money(avgAnte);
    const freq = action => n ? (state.hands.filter(h=>h.action===action).length/n*100).toFixed(1)+'%' : '0%';
    $('freq4x').textContent=freq('4x'); $('freq2x').textContent=freq('2x'); $('freq1x').textContent=freq('1x'); $('freqFold').textContent=freq('fold');
  }

  function exportJSON(){
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `UTH_session_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  function startNewSession(){
    if (!confirm('Start a new session? This clears the current saved hands from this device. Export first if you want a copy.')) return;
    const defaults = {...state.defaults}; const bankroll = state.startingBankroll;
    state = defaultState(); state.defaults = defaults; state.startingBankroll = bankroll; saveState(); resetForm({keepDefaults:false}); renderStats(); toast('New session started');
  }

  function toast(message){
    const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),900);
  }

  // Build rank picker
  ranks.forEach(rank=>{
    const btn=document.createElement('button'); btn.type='button'; btn.textContent=rank; btn.dataset.rank=rank;
    btn.addEventListener('click',()=>{selectedRank=rank; document.querySelectorAll('[data-rank]').forEach(x=>x.classList.toggle('selected',x.dataset.rank===rank));});
    $('rankGrid').appendChild(btn);
  });

  document.querySelectorAll('[data-card-slot]').forEach(btn=>btn.addEventListener('click',()=>{
    activeCardSlot=btn.dataset.cardSlot; selectedRank=null; document.querySelectorAll('[data-rank]').forEach(x=>x.classList.remove('selected')); openSheet('cardSheet');
  }));

  document.querySelectorAll('[data-suit]').forEach(btn=>btn.addEventListener('click',()=>{
    if (!selectedRank || !activeCardSlot) return;
    const card = `${selectedRank}${btn.dataset.suit}`;
    const other = Object.entries(cards).find(([slot,value])=>slot!==activeCardSlot && value===card);
    if (other) { alert('That card is already selected.'); return; }
    setCard(activeCardSlot,card); closeSheet('cardSheet');
  }));

  document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>chooseAction(btn.dataset.action)));
  document.querySelectorAll('[data-close-sheet]').forEach(btn=>btn.addEventListener('click',()=>closeSheet(btn.dataset.closeSheet)));
  document.querySelectorAll('.sheetBackdrop').forEach(backdrop=>backdrop.addEventListener('click',e=>{if(e.target===backdrop) closeSheet(backdrop.id);}));

  $('historyOpen').addEventListener('click',()=>{renderHistory();openSheet('historySheet');});
  $('statsOpen').addEventListener('click',()=>{renderStats();openSheet('statsSheet');});
  $('moreOpen').addEventListener('click',()=>openSheet('moreSheet'));
  $('liveMode').addEventListener('click',()=>setMode('live'));
  $('postMode').addEventListener('click',()=>{setMode('post');openSheet('moreSheet');});
  $('saveBtn').addEventListener('click',saveHand);
  $('undoBtn').addEventListener('click',undo);
  $('winSign').addEventListener('click',()=>{$('netPL').value=Math.abs(toNumber($('netPL').value)).toFixed(2);$('netPL').focus();});
  $('lossSign').addEventListener('click',()=>{$('netPL').value=(-Math.abs(toNumber($('netPL').value))).toFixed(2);$('netPL').focus();});
  $('pushResult').addEventListener('click',()=>{$('netPL').value='0.00';});
  $('ante').addEventListener('change',updateDefaultsFromInputs); $('jackpot').addEventListener('change',updateDefaultsFromInputs); $('trips').addEventListener('change',updateDefaultsFromInputs);
  $('startingBankroll').addEventListener('change',()=>{state.startingBankroll=toNumber($('startingBankroll').value,3000);saveState();renderStats();});
  $('exportBtn').addEventListener('click',exportJSON);
  $('newSessionBtn').addEventListener('click',startNewSession);

  applyDefaults(); setMode('live'); renderHeader(); renderStats();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
