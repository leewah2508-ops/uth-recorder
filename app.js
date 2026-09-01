(() => {
  'use strict';

  const STORAGE_KEY = 'uth-hand-recorder-v2';
  const OLD_STORAGE_KEY = 'uth-hand-recorder-v1';
  const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
  const suits = ['♠','♥','♦','♣'];
  const slotLabels = {hole1:'Card 1',hole2:'Card 2',flop1:'F1',flop2:'F2',flop3:'F3',turn:'T',river:'R',dealer1:'Dealer 1',dealer2:'Dealer 2'};
  const actionLabels = { '4x':'4×', '2x':'2×', '1x':'1×', fold:'Fold' };
  const rankLabels = {below:'Below Straight',straight:'Straight',flush:'Flush',fullhouse:'Full House',quads:'Quads',straightflush:'Straight Flush',royal:'Royal'};
  const blindMultipliers = {below:0,straight:1,flush:1.5,fullhouse:3,quads:10,straightflush:50,royal:500};
  const $ = id => document.getElementById(id);

  let state = loadState();
  let mode = 'live';
  let editIndex = null;
  let activeCardSlot = null;
  let selectedRank = null;
  let cards = {};
  let selectedAction = null;
  let selectedQualifies = null;
  let selectedResult = null;
  let selectedRankResult = 'below';
  let overrideActive = false;
  let recommendedAction = null;

  function defaultState(){
    return {
      sessionId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      startingBankroll: 3000,
      defaults: {ante:25,jackpot:10,trips:0},
      hands: []
    };
  }

  function migrateHand(hand){
    return {
      ...hand,
      blind: toNumber(hand.blind, toNumber(hand.ante)),
      playAmount: toNumber(hand.playAmount, actionMultiplier(hand.action) * toNumber(hand.ante)),
      qualifies: hand.qualifies || null,
      result: hand.result || inferResult(hand.netPL),
      handRank: hand.handRank || 'below',
      mainPL: toNumber(hand.mainPL, toNumber(hand.netPL) - toNumber(hand.jackpotPayout) + toNumber(hand.jackpot) - toNumber(hand.tripsPayout) + toNumber(hand.trips)),
      netPL: toNumber(hand.netPL),
      recommendedAction: hand.recommendedAction || null,
      strategyDeviation: Boolean(hand.strategyDeviation)
    };
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY);
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.hands)) return defaultState();
      parsed.defaults = {...{ante:25,jackpot:10,trips:0}, ...(parsed.defaults || {})};
      parsed.startingBankroll = Number(parsed.startingBankroll ?? 3000);
      parsed.hands = parsed.hands.map(migrateHand);
      return parsed;
    } catch {
      return defaultState();
    }
  }

  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function toNumber(value, fallback=0){ const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function actionMultiplier(action){ return action === '4x' ? 4 : action === '2x' ? 2 : action === '1x' ? 1 : 0; }
  function inferResult(net){ const n = toNumber(net); return n > 0 ? 'win' : n < 0 ? 'loss' : 'push'; }
  function money(value, signed=false){
    const n = toNumber(value);
    const abs = Math.abs(n).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
    if (signed) return `${n < 0 ? '-' : '+'}$${abs}`;
    return `${n < 0 ? '-' : ''}$${abs}`;
  }
  function cardParts(card){ return {rank: String(card || '').replace(/[♠♥♦♣]/g,''), suit: String(card || '').match(/[♠♥♦♣]/)?.[0] || ''}; }
  function rankValue(rank){ return {A:14,K:13,Q:12,J:11,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2}[rank] || 0; }
  function cardHtml(card){
    if (!card) return '-';
    const {rank,suit} = cardParts(card);
    const cls = suit === '♥' || suit === '♦' ? 'redCard' : 'blackCard';
    return `<span class="${cls}">${rank}${suit}</span>`;
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
    updateDerivedDisplay();
  }

  function updateDefaultsFromInputs(){
    state.defaults.ante = toNumber($('ante').value,25);
    state.defaults.jackpot = toNumber($('jackpot').value,10);
    state.defaults.trips = toNumber($('trips').value,0);
    saveState();
    updateDerivedDisplay();
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
    return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  function openSheet(id){ $(id).hidden = false; }
  function closeSheet(id){ $(id).hidden = true; }
  function haptic(){ if (navigator.vibrate) navigator.vibrate(8); }

  function recommendPreflop(){
    if (!cards.hole1 || !cards.hole2) return {action:null,title:'Recommended: select cards',detail:'Pre-flop 4× guide appears here.'};
    const c1 = cardParts(cards.hole1), c2 = cardParts(cards.hole2);
    const v1 = rankValue(c1.rank), v2 = rankValue(c2.rank);
    const high = v1 >= v2 ? c1 : c2;
    const low = v1 >= v2 ? c2 : c1;
    const suited = c1.suit === c2.suit;
    let raise = false;
    if (c1.rank === c2.rank) raise = rankValue(c1.rank) >= 3;
    else if (high.rank === 'A') raise = true;
    else if (high.rank === 'K') raise = suited || rankValue(low.rank) >= 5;
    else if (high.rank === 'Q') raise = suited ? rankValue(low.rank) >= 6 : rankValue(low.rank) >= 8;
    else if (high.rank === 'J') raise = suited ? rankValue(low.rank) >= 8 : low.rank === '10';
    return raise
      ? {action:'4x',title:'Recommended: 4×',detail:`${cards.hole1} ${cards.hole2} is in the standard 4× range.`}
      : {action:'check',title:'Recommended: Check',detail:`${cards.hole1} ${cards.hole2} is outside the standard 4× range.`};
  }

  function renderRecommendation(){
    const rec = recommendPreflop();
    recommendedAction = rec.action;
    $('recommendationTitle').textContent = rec.title;
    $('recommendationDetail').textContent = rec.detail;
    $('recommendationBox').classList.toggle('ok', selectedAction && !isStrategyDeviation());
    $('recommendationBox').classList.toggle('warn', selectedAction && isStrategyDeviation());
    const warn = $('strategyWarning');
    if (selectedAction && isStrategyDeviation()) {
      warn.hidden = false;
      warn.textContent = `Warning: you selected ${actionLabels[selectedAction]}. Recommended: ${recommendedAction === '4x' ? '4×' : 'Check first'}.`;
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  }

  function isStrategyDeviation(){
    if (!selectedAction || !recommendedAction) return false;
    if (recommendedAction === '4x') return selectedAction !== '4x';
    return selectedAction === '4x';
  }

  function chooseAction(action){
    selectedAction = action;
    document.querySelectorAll('[data-action]').forEach(btn => btn.classList.toggle('selected', btn.dataset.action === action));
    $('qualifySection').classList.toggle('hiddenFlow', action === 'fold');
    if (action === 'fold') {
      selectedQualifies = null;
      selectButtonGroup('qualifies', null);
      if (!selectedResult) chooseResult('loss');
    }
    renderRecommendation();
    updateDerivedDisplay();
    haptic();
  }

  function chooseQualifies(value){
    selectedQualifies = value;
    selectButtonGroup('qualifies', value);
    if (value === 'standoff') chooseResult('push');
    updateDerivedDisplay();
    haptic();
  }

  function chooseResult(value){
    selectedResult = value;
    selectButtonGroup('result', value);
    if (value !== 'win') selectedRankResult = 'below';
    renderRankSection();
    updateDerivedDisplay();
    haptic();
  }

  function chooseRank(value){
    selectedRankResult = value;
    document.querySelectorAll('[data-rank-result]').forEach(btn => btn.classList.toggle('selected', btn.dataset.rankResult === value));
    updateDerivedDisplay();
  }

  function selectButtonGroup(name, value){
    const attr = name === 'qualifies' ? 'data-qualifies' : 'data-result';
    document.querySelectorAll(`[${attr}]`).forEach(btn => btn.classList.toggle('selected', btn.getAttribute(attr) === value));
  }

  function renderRankSection(){
    const needed = selectedResult === 'win' && selectedAction !== 'fold';
    $('rankSection').hidden = !needed;
    if (needed) document.querySelectorAll('[data-rank-result]').forEach(btn => btn.classList.toggle('selected', btn.dataset.rankResult === selectedRankResult));
  }

  function calculatePL(){
    const ante = toNumber($('ante').value);
    const blind = ante;
    const play = ante * actionMultiplier(selectedAction);
    const jackpot = toNumber($('jackpot').value);
    const trips = toNumber($('trips').value);
    const jackpotPayout = toNumber($('jackpotPayout').value);
    const tripsPayout = toNumber($('tripsPayout').value);
    let antePL = 0, blindPL = 0, playPL = 0;

    if (selectedAction === 'fold') {
      antePL = -ante;
      blindPL = -blind;
      playPL = 0;
    } else if (selectedQualifies === 'standoff') {
      antePL = 0;
      playPL = 0;
      blindPL = 0;
    } else if (selectedResult === 'win') {
      antePL = selectedQualifies === 'yes' ? ante : 0;
      playPL = play;
      blindPL = blind * (blindMultipliers[selectedRankResult] || 0);
    } else if (selectedResult === 'loss') {
      antePL = selectedQualifies === 'yes' ? -ante : 0;
      playPL = -play;
      blindPL = -blind;
    } else if (selectedResult === 'push') {
      antePL = 0;
      playPL = 0;
      blindPL = 0;
    }

    const mainPL = antePL + blindPL + playPL;
    const jpPL = jackpotPayout - jackpot;
    const tripsPL = tripsPayout - trips;
    const calculatedNet = mainPL + jpPL + tripsPL;
    const netPL = overrideActive && $('netOverride').value !== '' ? toNumber($('netOverride').value) : calculatedNet;
    return {ante,blind,play,jackpot,trips,jackpotPayout,tripsPayout,antePL,blindPL,playPL,mainPL,jpPL,tripsPL,calculatedNet,netPL};
  }

  function updateDerivedDisplay(){
    const ante = toNumber($('ante').value);
    $('play4x').textContent = money(ante * 4);
    $('play2x').textContent = money(ante * 2);
    $('play1x').textContent = money(ante);
    const calc = calculatePL();
    setMoneyText('mainPL', calc.mainPL);
    setMoneyText('jpPL', calc.jpPL);
    setMoneyText('tripsPL', calc.tripsPL);
    setMoneyText('netCalculated', calc.netPL);
    updateSaveButton();
  }

  function setMoneyText(id, value){
    const el = $(id);
    el.textContent = value === 0 ? '$0.00' : money(value,true);
    el.className = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  }

  function setCard(slot, card){
    cards[slot] = card;
    const btn = document.querySelector(`[data-card-slot="${slot}"]`);
    if (!btn) return;
    btn.innerHTML = cardHtml(card);
    const red = /[♥♦]/.test(card);
    btn.classList.toggle('redCard', red);
    btn.classList.toggle('blackCard', !red);
    renderRecommendation();
    updateDerivedDisplay();
  }

  function resetCardControlsOnly(){
    document.querySelectorAll('[data-card-slot]').forEach(btn=>{
      btn.textContent = slotLabels[btn.dataset.cardSlot];
      btn.classList.remove('redCard','blackCard');
    });
    document.querySelectorAll('[data-action]').forEach(btn=>btn.classList.remove('selected'));
    selectButtonGroup('qualifies', null);
    selectButtonGroup('result', null);
    document.querySelectorAll('[data-rank-result]').forEach(btn=>btn.classList.remove('selected'));
  }

  function resetForm({keepDefaults=true}={}){
    cards = {};
    selectedAction = null;
    selectedQualifies = null;
    selectedResult = null;
    selectedRankResult = 'below';
    overrideActive = false;
    editIndex = null;
    resetCardControlsOnly();
    $('manualHandNumber').value = '';
    $('handDateTime').value = mode === 'post' ? nowLocalInput() : '';
    $('jackpotPayout').value = '0';
    $('tripsPayout').value = '0';
    $('jackpotMeter').value = '';
    $('notes').value = '';
    $('netOverride').value = '';
    $('overrideField').hidden = true;
    $('overrideToggle').classList.remove('active');
    $('qualifySection').classList.remove('hiddenFlow');
    renderRankSection();
    if (!keepDefaults) applyDefaults();
    renderRecommendation();
    updateDerivedDisplay();
    renderHeader();
  }

  function updateSaveButton(){
    const btn = $('saveBtn');
    const calc = calculatePL();
    btn.classList.toggle('editing', editIndex !== null);
    const prefix = editIndex !== null ? 'SAVE CHANGES' : mode === 'post' ? 'ADD' : 'SAVE';
    btn.textContent = `${prefix} ${calc.netPL === 0 ? '$0.00' : money(calc.netPL,true)}`;
  }

  function buildHandRecord(){
    const calc = calculatePL();
    const handNo = mode === 'post' && toNumber($('manualHandNumber').value) > 0
      ? toNumber($('manualHandNumber').value)
      : (editIndex !== null ? state.hands[editIndex].handNumber : nextHandNumber());
    return {
      id: editIndex !== null ? state.hands[editIndex].id : (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      handNumber: handNo,
      mode,
      recordedAt: mode === 'post' && $('handDateTime').value ? $('handDateTime').value : new Date().toISOString(),
      ante: calc.ante,
      blind: calc.blind,
      jackpot: calc.jackpot,
      trips: calc.trips,
      cards: {...cards},
      action: selectedAction,
      playAmount: calc.play,
      qualifies: selectedAction === 'fold' ? null : selectedQualifies,
      result: selectedResult,
      handRank: selectedResult === 'win' ? selectedRankResult : 'below',
      recommendedAction,
      strategyDeviation: isStrategyDeviation(),
      overrideActive,
      antePL: calc.antePL,
      blindPL: calc.blindPL,
      playPL: calc.playPL,
      mainPL: calc.mainPL,
      jackpotPayout: calc.jackpotPayout,
      tripsPayout: calc.tripsPayout,
      jackpotPL: calc.jpPL,
      tripsPL: calc.tripsPL,
      calculatedNet: calc.calculatedNet,
      netPL: calc.netPL,
      jackpotMeter: $('jackpotMeter').value === '' ? null : toNumber($('jackpotMeter').value),
      notes: $('notes').value.trim()
    };
  }

  function validateHand(){
    if (!cards.hole1 || !cards.hole2) return 'Select both hole cards.';
    if (!selectedAction) return 'Select 4×, 2×, 1× or Fold.';
    if (selectedAction !== 'fold' && !selectedQualifies) return 'Select whether the dealer qualifies.';
    if (!selectedResult) return 'Select Win, Push or Loss.';
    if (selectedResult === 'win' && selectedAction !== 'fold' && !selectedRankResult) return 'Select the Blind payout rank.';
    return null;
  }

  function saveHand(){
    const error = validateHand();
    if (error) { alert(error); return; }
    updateDefaultsFromInputs();
    const record = buildHandRecord();
    if (editIndex !== null) {
      state.hands[editIndex] = record;
      state.hands.sort(sortHands);
      toast('Hand updated');
    } else {
      state.hands.push(record);
      state.hands.sort(sortHands);
      toast(mode === 'post' ? 'Post-session hand added' : 'Hand saved');
    }
    saveState();
    resetForm();
    renderStats();
    haptic();
  }

  function sortHands(a,b){ return a.handNumber-b.handNumber || String(a.recordedAt).localeCompare(String(b.recordedAt)); }
  function undo(){
    if (editIndex !== null) { resetForm(); toast('Edit cancelled'); return; }
    if (!state.hands.length) { toast('No saved hands to undo'); return; }
    state.hands.pop();
    saveState();
    renderHeader();
    renderStats();
    toast('Last saved hand removed');
  }

  function renderHistory(){
    const list = $('historyList');
    list.innerHTML = '';
    if (!state.hands.length) { list.innerHTML = '<div class="emptyState">No saved hands yet.</div>'; return; }
    [...state.hands].sort((a,b)=>b.handNumber-a.handNumber).forEach(hand=>{
      const sourceIndex = state.hands.findIndex(h=>h.id===hand.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'historyRow';
      const pl = toNumber(hand.netPL);
      const deviation = hand.strategyDeviation ? ' · Warning' : '';
      const modeText = hand.mode === 'post' ? 'Post · ' : '';
      row.innerHTML = `
        <span class="historyNo">#${hand.handNumber}</span>
        <span class="historyMeta">
          <span class="historyCards">${cardHtml(hand.cards?.hole1)} ${cardHtml(hand.cards?.hole2)} · ${actionLabels[hand.action] || '-'}</span>
          <small>${modeText}${String(hand.result || '-').toUpperCase()} · ${hand.qualifies ? 'Dealer ' + hand.qualifies : 'Fold'} · A $${hand.ante} JP $${hand.jackpot} Trips $${hand.trips}${deviation}</small>
        </span>
        <strong class="historyPL ${pl>0?'positive':pl<0?'negative':''}">${pl===0?'$0.00':money(pl,true)}</strong>`;
      row.addEventListener('click',()=>loadForEdit(sourceIndex));
      list.appendChild(row);
    });
  }

  function loadForEdit(index){
    const hand = state.hands[index]; if (!hand) return;
    editIndex = index;
    mode = hand.mode || 'live';
    setMode(mode);
    $('ante').value = hand.ante;
    $('jackpot').value = hand.jackpot;
    $('trips').value = hand.trips;
    resetCardControlsOnly();
    cards = {...(hand.cards || {})};
    Object.entries(cards).forEach(([slot,card])=>setCard(slot,card));
    chooseAction(hand.action);
    if (hand.qualifies) chooseQualifies(hand.qualifies);
    if (hand.result) chooseResult(hand.result);
    chooseRank(hand.handRank || 'below');
    overrideActive = Boolean(hand.overrideActive);
    $('overrideField').hidden = !overrideActive;
    $('overrideToggle').classList.toggle('active', overrideActive);
    $('netOverride').value = overrideActive ? hand.netPL : '';
    $('manualHandNumber').value = hand.handNumber;
    if (hand.mode === 'post') $('handDateTime').value = String(hand.recordedAt).slice(0,16);
    $('jackpotPayout').value = hand.jackpotPayout ?? 0;
    $('tripsPayout').value = hand.tripsPayout ?? 0;
    $('jackpotMeter').value = hand.jackpotMeter ?? '';
    $('notes').value = hand.notes || '';
    closeSheet('historySheet');
    renderRankSection();
    updateDerivedDisplay();
    renderHeader();
  }

  function renderStats(){
    const actual = sessionPL(), expected = expectedPL(), n = state.hands.length;
    const current = state.startingBankroll + actual;
    const avgAnte = n ? state.hands.reduce((s,h)=>s+toNumber(h.ante),0)/n : 0;
    const deviations = state.hands.filter(h=>h.strategyDeviation).length;
    const decisions = state.hands.filter(h=>h.recommendedAction).length;
    const accuracy = decisions ? ((decisions - deviations) / decisions * 100).toFixed(1) + '%' : '0%';
    $('startingBankroll').value = state.startingBankroll;
    $('currentBankroll').textContent = money(current);
    $('statHands').textContent = n;
    $('statActual').textContent = actual===0?'$0.00':money(actual,true);
    $('statExpected').textContent = expected===0?'$0.00':money(expected,true);
    $('statVsEV').textContent = (actual-expected)===0?'$0.00':money(actual-expected,true);
    $('statAvgAnte').textContent = money(avgAnte);
    const freq = action => n ? (state.hands.filter(h=>h.action===action).length/n*100).toFixed(1)+'%' : '0%';
    $('freq4x').textContent=freq('4x'); $('freq2x').textContent=freq('2x'); $('freq1x').textContent=freq('1x'); $('freqFold').textContent=freq('fold');
    $('statAccuracy').textContent = accuracy;
    $('statDeviations').textContent = deviations;
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
    const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1000);
  }

  function enableSelectAllMoneyFields(){
    document.querySelectorAll('.moneyInput').forEach(input => {
      const armReplace = () => { input.dataset.replaceOnNextInput = 'true'; };
      const selectAll = () => requestAnimationFrame(() => {
        try { input.select(); } catch (_) {}
        armReplace();
      });
      input.addEventListener('focus', selectAll);
      input.addEventListener('pointerup', event => { event.preventDefault(); selectAll(); });
      input.addEventListener('touchend', selectAll, {passive:true});
      input.addEventListener('beforeinput', event => {
        if (input.dataset.replaceOnNextInput === 'true' && event.inputType && event.inputType.startsWith('insert')) {
          input.value = '';
          input.dataset.replaceOnNextInput = 'false';
        }
      });
      input.addEventListener('keydown', event => {
        const editingKey = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete';
        if (input.dataset.replaceOnNextInput === 'true' && editingKey) {
          input.value = '';
          input.dataset.replaceOnNextInput = 'false';
        }
      });
      input.addEventListener('input', () => { input.dataset.replaceOnNextInput = 'false'; });
    });
  }

  ranks.forEach(rank=>{
    const btn=document.createElement('button'); btn.type='button'; btn.textContent=rank; btn.dataset.rank=rank;
    btn.addEventListener('click',()=>{selectedRank=rank; document.querySelectorAll('[data-rank]').forEach(x=>x.classList.toggle('selected',x.dataset.rank===rank)); haptic();});
    $('rankGrid').appendChild(btn);
  });

  document.querySelectorAll('[data-card-slot]').forEach(btn=>btn.addEventListener('click',()=>{
    activeCardSlot=btn.dataset.cardSlot;
    selectedRank=null;
    document.querySelectorAll('[data-rank]').forEach(x=>x.classList.remove('selected'));
    $('cardTitle').textContent = `Select ${slotLabels[activeCardSlot]}`;
    openSheet('cardSheet');
  }));

  document.querySelectorAll('[data-suit]').forEach(btn=>btn.addEventListener('click',()=>{
    if (!selectedRank || !activeCardSlot) return;
    const card = `${selectedRank}${btn.dataset.suit}`;
    const other = Object.entries(cards).find(([slot,value])=>slot!==activeCardSlot && value===card);
    if (other) { alert('That card is already selected.'); return; }
    const slot = activeCardSlot;
    setCard(slot,card);
    haptic();
    if (slot === 'hole1' && !cards.hole2) {
      activeCardSlot = 'hole2';
      selectedRank = null;
      $('cardTitle').textContent = 'Select Card 2';
      document.querySelectorAll('[data-rank]').forEach(x=>x.classList.remove('selected'));
      return;
    }
    closeSheet('cardSheet');
  }));

  document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>chooseAction(btn.dataset.action)));
  document.querySelectorAll('[data-qualifies]').forEach(btn=>btn.addEventListener('click',()=>chooseQualifies(btn.dataset.qualifies)));
  document.querySelectorAll('[data-result]').forEach(btn=>btn.addEventListener('click',()=>chooseResult(btn.dataset.result)));
  document.querySelectorAll('[data-rank-result]').forEach(btn=>btn.addEventListener('click',()=>chooseRank(btn.dataset.rankResult)));
  document.querySelectorAll('[data-close-sheet]').forEach(btn=>btn.addEventListener('click',()=>closeSheet(btn.dataset.closeSheet)));
  document.querySelectorAll('.sheetBackdrop').forEach(backdrop=>backdrop.addEventListener('click',e=>{if(e.target===backdrop) closeSheet(backdrop.id);}));

  $('historyOpen').addEventListener('click',()=>{renderHistory();openSheet('historySheet');});
  $('statsOpen').addEventListener('click',()=>{renderStats();openSheet('statsSheet');});
  $('moreOpen').addEventListener('click',()=>openSheet('moreSheet'));
  $('liveMode').addEventListener('click',()=>setMode('live'));
  $('postMode').addEventListener('click',()=>{setMode('post');openSheet('moreSheet');});
  $('saveBtn').addEventListener('click',saveHand);
  $('undoBtn').addEventListener('click',undo);
  $('overrideToggle').addEventListener('click',()=>{
    overrideActive = !overrideActive;
    $('overrideField').hidden = !overrideActive;
    $('overrideToggle').classList.toggle('active', overrideActive);
    if (overrideActive) $('netOverride').focus();
    updateDerivedDisplay();
  });
  ['ante','jackpot','trips'].forEach(id => {
    $(id).addEventListener('input',updateDerivedDisplay);
    $(id).addEventListener('change',updateDefaultsFromInputs);
  });
  ['jackpotPayout','tripsPayout','netOverride'].forEach(id => $(id).addEventListener('input',updateDerivedDisplay));
  $('startingBankroll').addEventListener('change',()=>{state.startingBankroll=toNumber($('startingBankroll').value,3000);saveState();renderStats();});
  $('exportBtn').addEventListener('click',exportJSON);
  $('newSessionBtn').addEventListener('click',startNewSession);

  enableSelectAllMoneyFields();
  applyDefaults();
  setMode('live');
  renderRecommendation();
  renderHeader();
  renderStats();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
