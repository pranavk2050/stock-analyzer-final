import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, TrendingUp, BarChart2, List, ShieldAlert, CheckCircle, RefreshCw } from 'lucide-react';

export default function StockOptimizer() {
  const [ticker, setTicker] = useState('RELIANCE.NS');
  // Populated dynamically from the local bhavcopy CSVs (see the symbol-loading
  // effect below). Seeded with RELIANCE.NS so the picker works before load.
  const [tickerOptions, setTickerOptions] = useState(['RELIANCE.NS']);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  // Searchable-dropdown UI state.
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('ranking');
  const [strategyResults, setStrategyResults] = useState([]);
  const [selectedStrat, setSelectedStrat] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);

  // --- MATHEMATICAL MATH ENGINES (PURE JS BACKTESTERS) ---
  const calculateIndicators = (data) => {
    const closes = data.map(d => d.close);
    const highs  = data.map(d => d.high);
    const lows   = data.map(d => d.low);
    const vols   = data.map(d => d.volume);
    const n = closes.length;

    // 1. EMA of an arbitrary source series (closes by default)
    const emaOf = (src, period) => {
      if (src.length === 0) return [];
      if (src.length < period) return src.map(() => src[0] || 0);
      const k = 2 / (period + 1);
      const ema = [src[0]];
      for (let i = 1; i < src.length; i++) {
        ema.push(src[i] * k + ema[i - 1] * (1 - k));
      }
      return ema;
    };

    // 2. RSI Calculation
    const calcRSI = (period = 14) => {
      let rsi = new Array(closes.length).fill(50);
      if (closes.length <= period) return rsi;
      
      let gains = 0, losses = 0;
      for (let i = 1; i <= period; i++) {
        let diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
      }
      
      let avgGain = gains / period;
      let avgLoss = losses / period;
      rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

      for (let i = period + 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        avgGain = ((avgGain * (period - 1)) + (diff > 0 ? diff : 0)) / period;
        avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      }
      return rsi;
    };

    // 3. MACD (12/26/9): line, signal, histogram
    const ema12 = emaOf(closes, 12);
    const ema26 = emaOf(closes, 26);
    const macd = closes.map((_, i) => ema12[i] - ema26[i]);
    const macdSignal = emaOf(macd, 9);
    const macdHist = macd.map((v, i) => v - macdSignal[i]);

    // 4. Bollinger Bands (20-period SMA, 2 standard deviations)
    const bbPeriod = 20, bbK = 2;
    const bbMid = new Array(n).fill(0);
    const bbUpper = new Array(n).fill(0);
    const bbLower = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - bbPeriod + 1);
      const win = closes.slice(start, i + 1);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      bbMid[i] = mean;
      bbUpper[i] = mean + bbK * sd;
      bbLower[i] = mean - bbK * sd;
    }

    // 5. Rolling support (lowest low) / resistance (highest high), 20-bar
    const srPeriod = 20;
    const support = new Array(n).fill(0);
    const resistance = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - srPeriod + 1);
      support[i] = Math.min(...lows.slice(start, i + 1));
      resistance[i] = Math.max(...highs.slice(start, i + 1));
    }

    // 6. Fibonacci retracement levels from a 50-bar swing window
    const fibPeriod = 50;
    const fib382 = new Array(n).fill(0);
    const fib618 = new Array(n).fill(0);
    const swingHigh = new Array(n).fill(0);
    const swingLow = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - fibPeriod + 1);
      const hi = Math.max(...highs.slice(start, i + 1));
      const lo = Math.min(...lows.slice(start, i + 1));
      const range = hi - lo;
      swingHigh[i] = hi;
      swingLow[i] = lo;
      fib382[i] = hi - 0.382 * range;
      fib618[i] = hi - 0.618 * range;
    }

    // 7. Volume-Price Trend (VPT) and its 9-EMA signal line
    const vpt = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const prevClose = closes[i - 1] || closes[i] || 1;
      vpt[i] = vpt[i - 1] + vols[i] * ((closes[i] - prevClose) / (prevClose || 1));
    }
    const vptSignal = emaOf(vpt, 9);

    return {
      ema9: emaOf(closes, 9),
      ema21: emaOf(closes, 21),
      rsi: calcRSI(14),
      macd, macdSignal, macdHist,
      bbMid, bbUpper, bbLower,
      support, resistance,
      fib382, fib618, swingHigh, swingLow,
      vpt, vptSignal
    };
  };

  const executeBacktest = (rawHistory, indicators) => {
    const strategies = [
      { id: 'ema_cross', name: '9/21 EMA Crossover', desc: 'Enters when 9 EMA crosses over 21 EMA. Captures strong trending impulses.' },
      { id: 'rsi_reversal', name: 'RSI Mean Reversion', desc: 'Enters when RSI crosses back above 30 from oversold territories.' },
      { id: 'bb_breakout', name: 'Volatility Band Breakout', desc: 'Triggers when price closes above historical resistance benchmarks.' },
      { id: 'macd_signal', name: 'MACD Momentum Cross', desc: 'Tracks shifting underlying momentum lines via structural histogram shifts.' },
      { id: 'sr_bounce', name: 'Support & Resistance Bounce', desc: 'Enters on successful tests of major structural historical price floors.' },
      { id: 'fib_retracement', name: 'Fibonacci Retracement', desc: 'Enters on pullbacks matching golden ratio key levels (38.2% / 61.8%).' },
      { id: 'vpt_breakout', name: 'Volume-Price Trend (VPT)', desc: 'Identifies strong price movements confirmed by institutional volume accumulation.' },
      { id: 'candlestick_pattern', name: 'Candlestick Pattern Edge', desc: 'Triggers on powerful structural price action reversals like Bullish Engulfing.' }
    ];

    if (rawHistory.length < 30) return []; // Safety check for small datasets

    return strategies.map(strat => {
      let trades = [];
      let inPosition = false;
      let entryPrice = 0;
      let entryDate = '';
      let entryIdx = 0;

      for (let i = 25; i < rawHistory.length; i++) {
        const current = rawHistory[i];
        const prev = rawHistory[i - 1];

        let triggerBuy = false;
        let triggerSell = false;

        if (strat.id === 'ema_cross') {
          triggerBuy = (indicators.ema9[i] > indicators.ema21[i]) && (indicators.ema9[i - 1] <= indicators.ema21[i - 1]);
          triggerSell = (indicators.ema9[i] < indicators.ema21[i]);
        } else if (strat.id === 'rsi_reversal') {
          triggerBuy = (indicators.rsi[i] > 30) && (indicators.rsi[i - 1] <= 30);
          triggerSell = (indicators.rsi[i] > 70);
        } else if (strat.id === 'bb_breakout') {
          // Close pushes above the upper Bollinger band; exit on reversion to the mean.
          triggerBuy = (current.close > indicators.bbUpper[i]) && (prev.close <= indicators.bbUpper[i - 1]);
          triggerSell = (current.close < indicators.bbMid[i]);
        } else if (strat.id === 'macd_signal') {
          // MACD line crossing its signal line.
          triggerBuy = (indicators.macd[i] > indicators.macdSignal[i]) && (indicators.macd[i - 1] <= indicators.macdSignal[i - 1]);
          triggerSell = (indicators.macd[i] < indicators.macdSignal[i]) && (indicators.macd[i - 1] >= indicators.macdSignal[i - 1]);
        } else if (strat.id === 'sr_bounce') {
          // Price tests rolling support and closes up (bounce); exit near rolling resistance.
          const nearSupport = current.low <= indicators.support[i - 1] * 1.01;
          const bounced = current.close > current.open;
          triggerBuy = nearSupport && bounced;
          triggerSell = current.high >= indicators.resistance[i - 1] * 0.99;
        } else if (strat.id === 'fib_retracement') {
          // Pullback into the 38.2%-61.8% golden zone, then reclaim it; exit at the swing high.
          const inZone = (prev.close <= indicators.fib382[i]) && (prev.close >= indicators.fib618[i]);
          triggerBuy = inZone && (current.close > prev.close) && (current.close > indicators.fib382[i]);
          triggerSell = (current.close >= indicators.swingHigh[i] * 0.99) || (current.close < indicators.fib618[i]);
        } else if (strat.id === 'vpt_breakout') {
          // Volume-Price Trend crossing above its signal line = accumulation breakout.
          triggerBuy = (indicators.vpt[i] > indicators.vptSignal[i]) && (indicators.vpt[i - 1] <= indicators.vptSignal[i - 1]);
          triggerSell = (indicators.vpt[i] < indicators.vptSignal[i]) && (indicators.vpt[i - 1] >= indicators.vptSignal[i - 1]);
        } else if (strat.id === 'candlestick_pattern') {
          // Bullish engulfing entry; bearish engulfing exit.
          const bullEngulf = (prev.close < prev.open) && (current.close > current.open) &&
                             (current.close >= prev.open) && (current.open <= prev.close);
          const bearEngulf = (prev.close > prev.open) && (current.close < current.open) &&
                             (current.open >= prev.close) && (current.close <= prev.open);
          triggerBuy = bullEngulf;
          triggerSell = bearEngulf;
        }

        // Signals are detected from bar i's close, so the earliest a real
        // order can fill is the NEXT bar's open. Filling on bar i's close
        // would be look-ahead bias and inflates P&L / R:R.
        const next = rawHistory[i + 1];

        if (!inPosition && triggerBuy && next) {
          inPosition = true;
          entryPrice = next.open;
          entryDate = next.date;
          entryIdx = i + 1;
        } else if (inPosition && (triggerSell || i === rawHistory.length - 1)) {
          inPosition = false;
          // Exit on the next bar's open after a sell signal. At the very end of
          // the dataset there is no next bar, so we close at the last close.
          const exitOnNext = triggerSell && next;
          const exitPrice = exitOnNext ? next.open : current.close;
          const exitDate = exitOnNext ? next.date : current.date;
          const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          // Calendar days between fills (the dataset is sampled/deduped, so an
          // index delta would not equal real days held).
          const daysHeld = Math.max(
            0,
            Math.round((new Date(exitDate) - new Date(entryDate)) / 86400000)
          );
          trades.push({
            id: trades.length + 1,
            entryDate,
            entryPrice: entryPrice.toFixed(2),
            exitDate,
            exitPrice: exitPrice.toFixed(2),
            pnl: pnlPct.toFixed(2),
            daysHeld,
            type: pnlPct >= 0 ? 'WIN' : 'LOSS'
          });
        }
      }

      const wins = trades.filter(t => parseFloat(t.pnl) >= 0).length;
      const losses = trades.length - wins;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      
      let sumGains = 0, sumLosses = 0;
      trades.forEach(t => {
        let val = parseFloat(t.pnl);
        if (val >= 0) sumGains += val; else sumLosses += Math.abs(val);
      });
      
      const avgWin = wins > 0 ? sumGains / wins : 0;
      const avgLoss = losses > 0 ? sumLosses / losses : 0;
      // R:R is only defined when there is measured downside (at least one loss).
      // With zero losses it is undefined (effectively infinite), so we report it
      // as null rather than dividing by a fabricated denominator of 1.
      const rrRatio = avgLoss > 0 ? (avgWin / avgLoss) : null;
      // For scoring, fall back to the average win magnitude as a downside proxy
      // when R:R is undefined, so an all-wins strategy is not silently zeroed.
      const rrForScore = rrRatio === null ? avgWin : rrRatio;
      const score = (winRate * rrForScore) / 10;

      let currentEquity = 100;
      const equityCurve = [{ tradeNum: 0, equity: 100 }];
      trades.forEach((t, index) => {
        currentEquity = currentEquity * (1 + parseFloat(t.pnl) / 100);
        equityCurve.push({ tradeNum: index + 1, equity: Math.round(currentEquity * 10) / 10 });
      });

      return {
        ...strat,
        winRate: Math.round(winRate),
        rrRatio: rrRatio === null ? null : Math.round(rrRatio * 100) / 100,
        score: Math.round(score * 10) / 10,
        totalTrades: trades.length,
        trades,
        equityCurve
      };
    }).sort((a, b) => b.score - a.score);
  };

  const parseCsv = (text) => {
    // Very small CSV parser that handles quoted fields.
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];

    const parseLine = (line) => {
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          // Handle escaped quote "" inside quoted field
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          out.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out;
    };

    const headers = parseLine(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = parseLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (parts[idx] ?? '').trim();
      });
      rows.push(row);
    }
    return rows;
  };

  // Build the full ticker universe from the local bhavcopy CSVs instead of a
  // hardcoded shortlist. The symbol set is stable across days, so we sample a
  // handful of files spread over the date range (rather than parsing hundreds
  // of MB) and union their EQ-series symbols.
  useEffect(() => {
    let cancelled = false;

    const loadAllSymbols = async () => {
      try {
        const modules = import.meta.glob('/jugaad_data_download/*.csv', { query: '?raw', import: 'default' });
        const entries = Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1));
        if (!entries.length) return;

        // Sample up to ~15 files evenly across the dataset so symbols that were
        // listed or delisted partway through the period are still captured.
        const MAX_FILES = 15;
        const step = Math.max(1, Math.floor(entries.length / MAX_FILES));
        const sampled = entries.filter((_, i) => i % step === 0).slice(0, MAX_FILES);

        const symbols = new Set();

        const collectFromCsv = (rawCsv) => {
          if (typeof rawCsv !== 'string' || !rawCsv) return;
          const head = rawCsv.slice(0, 40).toLowerCase();
          if (head.includes('<!doctype') || head.includes('<html')) return;

          let rows;
          try {
            rows = parseCsv(rawCsv);
          } catch {
            return;
          }
          if (!rows.length) return;

          const headerKeys = Object.keys(rows[0] || {});
          const symKey = headerKeys.find(k => {
            const ku = k.toUpperCase();
            return ku === 'SYMBOL' || ku === 'TCKRSYMB' || ku.includes('SYMBOL');
          }) || 'SYMBOL';
          const seriesKey = headerKeys.find(k => {
            const ku = k.toUpperCase();
            return ku === 'SERIES' || ku === 'SCTYSRS';
          });

          for (const r of rows) {
            // Keep only cash-equity listings when a series column exists.
            if (seriesKey && String(r[seriesKey]).trim().toUpperCase() !== 'EQ') continue;
            const sym = String(r?.[symKey] ?? '').trim().toUpperCase();
            if (sym) symbols.add(sym);
          }
        };

        const BATCH = 5;
        for (let b = 0; b < sampled.length; b += BATCH) {
          if (cancelled) return;
          const batch = sampled.slice(b, b + BATCH);
          const raws = await Promise.all(batch.map(async ([, loader]) => {
            try {
              return typeof loader === 'function' ? await loader() : loader;
            } catch {
              return null;
            }
          }));
          for (const raw of raws) collectFromCsv(raw);
        }

        if (cancelled) return;

        const options = Array.from(symbols)
          .sort((a, b) => a.localeCompare(b))
          .map(s => `${s}.NS`);

        if (options.length) {
          // Keep the current default available even if it wasn't sampled.
          if (!options.includes('RELIANCE.NS')) options.unshift('RELIANCE.NS');
          setTickerOptions(options);
        }
      } finally {
        if (!cancelled) setSymbolsLoading(false);
      }
    };

    loadAllSymbols();
    return () => { cancelled = true; };
  }, []);

  const normalizeTicker = (t) => {
    const raw = (t ?? '').toString().trim().toUpperCase();
    // Common formats: RELIANCE.NS, RELIANCE.NSE, or plain RELIANCE
    return raw.replace(/\.NS$/g, '').replace(/\.NSE$/g, '').replace(/\s+/g, '');
  };

  const loadJugaadBhavHistory = async (inputTicker) => {
    const normalizedTicker = normalizeTicker(inputTicker);

    // Vite provides a static file manifest via import.meta.glob.
    // This ensures the app uses only locally bundled CSVs (no Yahoo/external calls).
    const modules = import.meta.glob('/jugaad_data_download/*.csv', { query: '?raw', import: 'default' });

    const pickNum = (obj, keys) => {
      for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        const s = String(v).trim();
        if (!s) continue;
        const n = Number(s.replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    // Parse a date out of the row's own date column (e.g. DATE1 "01-Apr-2020"
    // or TradDt) which preserves the real trading day.
    const parseRowDate = (row) => {
      const dateKey = Object.keys(row).find(k => {
        const ku = k.toUpperCase();
        return ku === 'DATE1' || ku === 'DATE' || ku === 'TRADDT' || ku === 'TIMESTAMP';
      });
      if (!dateKey) return null;
      const rawVal = String(row[dateKey] ?? '').trim();
      if (!rawVal) return null;
      // dd-Mon-yyyy (e.g. 01-Apr-2020)
      const m = rawVal.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
      const d = m ? new Date(`${m[2]} ${m[1]}, ${m[3]}`) : new Date(rawVal);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    // Fallback: parse the date from the filename (cm01Apr2020bhav.csv),
    // keeping the day-of-month so daily samples don't collapse together.
    const parseFileDate = (file) => {
      const m = file.match(/cm(\d{2})([A-Z][a-z]{2})(\d{4})bhav\.csv$/i);
      if (!m) return null;
      const d = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    const extractRow = (file, rawCsv) => {
      if (typeof rawCsv !== 'string' || !rawCsv) return null;
      // Skip HTML error pages that some failed downloads saved as .csv.
      const head = rawCsv.slice(0, 40).toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html')) return null;

      let rows;
      try {
        rows = parseCsv(rawCsv);
      } catch {
        return null;
      }
      if (!rows.length) return null;

      const headerKeys = Object.keys(rows[0] || {});

      // Identify likely symbol column (standard SYMBOL, new-format TckrSymb).
      const symKey = headerKeys.find(k => {
        const ku = k.toUpperCase();
        return ku === 'SYMBOL' || ku === 'TCKRSYMB' || ku.includes('SYMBOL');
      }) || 'SYMBOL';

      const seriesKey = headerKeys.find(k => {
        const ku = k.toUpperCase();
        return ku === 'SERIES' || ku === 'SCTYSRS';
      });

      const matches = rows.filter(r => normalizeTicker(r?.[symKey]) === normalizedTicker);
      if (!matches.length) return null;

      // Prefer the EQ (equity) series when multiple series exist for a symbol.
      const matchRow = (seriesKey && matches.find(r => String(r[seriesKey]).trim().toUpperCase() === 'EQ')) || matches[0];

      const open = pickNum(matchRow, ['OPEN_PRICE', 'OPEN', 'Open', 'OpnPric']);
      const high = pickNum(matchRow, ['HIGH_PRICE', 'HIGH', 'High', 'HghPric']);
      const low = pickNum(matchRow, ['LOW_PRICE', 'LOW', 'Low', 'LwPric']);
      const close = pickNum(matchRow, ['CLOSE_PRICE', 'CLOSE', 'Close', 'ClsPric']);
      const volume = pickNum(matchRow, ['TTL_TRD_QNTY', 'TOTTRDQTY', 'VOLUME', 'Volume', 'TtlTradgVol']);

      if ([open, high, low, close].some(v => v === null)) return null;

      const date = parseRowDate(matchRow) || parseFileDate(file);
      if (!date) return null;

      return { date, open, high, low, close, volume: volume === null ? 0 : volume };
    };

    const fetched = [];
    const entries = Object.entries(modules);

    // Process in batches so we only hold a handful of raw CSV strings in memory
    // at once (the full dataset is hundreds of MB).
    const BATCH = 40;
    for (let b = 0; b < entries.length; b += BATCH) {
      const batch = entries.slice(b, b + BATCH);
      const results = await Promise.all(batch.map(async ([filePath, loader]) => {
        const file = filePath.split('/').pop();
        if (!file) return null;
        let rawCsv;
        try {
          rawCsv = typeof loader === 'function' ? await loader() : loader;
        } catch {
          return null;
        }
        return extractRow(file, rawCsv);
      }));
      for (const r of results) if (r) fetched.push(r);
    }

    const history = fetched
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .reduce((acc, cur) => {
        const last = acc[acc.length - 1];
        if (!last || last.date !== cur.date) acc.push(cur);
        else acc[acc.length - 1] = cur;
        return acc;
      }, []);

    if (history.length < 30) {
      throw new Error(`Not enough local historical data found for ${inputTicker}. Found ${history.length} samples (min 30 required).`);
    }

    return history;
  };

  const handleAnalyze = async () => {
    if (!ticker.trim()) {
      setError("Please enter a valid stock ticker.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Local-only historical data path (no Yahoo / no proxy)
      const formattedHistory = await loadJugaadBhavHistory(ticker);

      setPriceHistory(formattedHistory);
      const computedInd = calculateIndicators(formattedHistory);
      const optimizedResults = executeBacktest(formattedHistory, computedInd);

      if (!optimizedResults || optimizedResults.length === 0) {
        throw new Error("Optimization failed. Unable to compute strategy metrics.");
      }

      setStrategyResults(optimizedResults);
      setSelectedStrat(optimizedResults[0]);
      setActiveTab('ranking');
    } catch (err) {
      setError(err.message || 'Error occurred loading local historical data.');
      setStrategyResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-2xl border border-slate-800 font-sans">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <TrendingUp className="text-emerald-400" /> Stock-First Strategy Optimizer
          </h2>
          <p className="text-sm text-slate-400 mt-1">Extract performance footprints using local Jugaad bhavcopy historical data.</p>
        </div>
        <div className="flex w-full md:w-auto gap-2">
          <div className="relative flex flex-col w-full md:w-56">
            <input
              type="text"
              className="bg-slate-800 border border-slate-700 rounded px-4 py-2 text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full"
              value={pickerOpen ? pickerQuery : ticker}
              onFocus={() => { setPickerQuery(''); setPickerOpen(true); }}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              onChange={(e) => { setPickerQuery(e.target.value.toUpperCase()); setPickerOpen(true); }}
              placeholder={symbolsLoading ? 'Loading symbols…' : 'Type or pick a stock'}
              spellCheck={false}
              autoComplete="off"
            />
            {pickerOpen && (
              <ul className="absolute top-full left-0 right-0 mt-1 z-20 max-h-72 overflow-y-auto bg-slate-800 border border-slate-700 rounded shadow-xl shadow-black/40">
                {(() => {
                  const q = pickerQuery.trim();
                  const matches = (q
                    ? tickerOptions.filter(o => o.includes(q))
                    : tickerOptions
                  ).slice(0, 200);
                  if (!matches.length) {
                    return <li className="px-4 py-2 text-sm text-slate-500">No matching stocks</li>;
                  }
                  return matches.map(opt => (
                    <li
                      key={opt}
                      // onMouseDown fires before the input's onBlur, so the
                      // selection registers before the list closes.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTicker(opt);
                        setPickerOpen(false);
                      }}
                      className={`px-4 py-2 text-sm font-mono cursor-pointer hover:bg-emerald-600/30 ${opt === ticker ? 'text-emerald-400' : 'text-slate-200'}`}
                    >
                      {opt}
                    </li>
                  ));
                })()}
              </ul>
            )}
            <span className="text-[11px] text-slate-500 mt-1 px-1">
              {symbolsLoading ? 'Loading available stocks…' : `${tickerOptions.length} stocks available`}
            </span>
          </div>
          <button

            onClick={handleAnalyze}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-medium px-5 py-2 rounded transition flex items-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            {loading ? <RefreshCw className="animate-spin h-4 w-4" /> : <Play className="h-4 w-4" />}
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-950/40 border border-rose-800 rounded-lg flex items-start gap-3 text-rose-200 text-sm">
          <ShieldAlert className="text-rose-400 shrink-0 mt-0.5" />
          <div><span className="font-semibold">Execution Halt:</span> {error}</div>
        </div>
      )}

      {!error && strategyResults.length > 0 && (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
          
          <div className="flex gap-4 border-b border-slate-800 pb-2">
            <button 
              className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${activeTab === 'ranking' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setActiveTab('ranking')}
            >
              <BarChart2 className="w-4 h-4" /> Strategy Rankings
            </button>
            <button 
              className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${activeTab === 'log' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setActiveTab('log')}
            >
              <List className="w-4 h-4" /> Live Trade Log
            </button>
          </div>

          {activeTab === 'ranking' && strategyResults[0] && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <h3 className="text-lg font-semibold mb-4 text-white">Composite Scores (8 Strategies)</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strategyResults} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                      <XAxis type="number" stroke="#94a3b8" />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" width={160} fontSize={11} />
                      <Tooltip cursor={{fill: '#1e293b'}} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                      <Bar dataKey="score" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <h3 className="text-lg font-semibold text-white">Top Performing Strategy</h3>
                <div className="bg-emerald-950/30 border border-emerald-800 p-5 rounded-xl flex flex-col h-full justify-center">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle className="text-emerald-400 h-6 w-6" />
                    <h4 className="text-xl font-bold text-emerald-300">{strategyResults[0].name}</h4>
                  </div>
                  <p className="text-slate-300 text-sm mb-6">{strategyResults[0].desc}</p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                      <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Win Rate</div>
                      <div className="text-2xl font-mono text-white">{strategyResults[0].winRate}%</div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                      <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">R:R Ratio</div>
                      <div className="text-2xl font-mono text-white">{strategyResults[0].rrRatio === null ? '∞' : strategyResults[0].rrRatio}</div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                      <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Trades (5Y)</div>
                      <div className="text-2xl font-mono text-white">{strategyResults[0].totalTrades}</div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                      <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Opt. Score</div>
                      <div className="text-2xl font-mono text-emerald-400">{strategyResults[0].score}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'log' && selectedStrat && (
            <div className="flex flex-col gap-6">
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <div className="flex justify-between items-center mb-4">
                   <h3 className="text-lg font-semibold text-white">Base 100 Equity Curve: {selectedStrat.name}</h3>
                   <div className="text-sm px-3 py-1 bg-slate-900 rounded-full border border-slate-700 text-slate-300">
                      Final Equity: <span className="font-mono text-emerald-400 font-bold">{selectedStrat.equityCurve[selectedStrat.equityCurve.length - 1]?.equity}</span>
                   </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedStrat.equityCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="tradeNum" stroke="#94a3b8" />
                      <YAxis domain={['auto', 'auto']} stroke="#94a3b8" />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                      <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-sm relative">
                    <thead className="bg-slate-900 text-slate-300 sticky top-0 z-10 shadow-md">
                      <tr>
                        <th className="p-4 font-semibold">Entry Date</th>
                        <th className="p-4 font-semibold">Exit Date</th>
                        <th className="p-4 font-semibold">Entry Price</th>
                        <th className="p-4 font-semibold">Exit Price</th>
                        <th className="p-4 font-semibold">Days Held</th>
                        <th className="p-4 font-semibold text-right">PnL %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {selectedStrat.trades.map((trade, i) => (
                        <tr key={i} className="hover:bg-slate-800/80 transition-colors">
                          <td className="p-4 text-slate-300 font-mono">{trade.entryDate}</td>
                          <td className="p-4 text-slate-300 font-mono">{trade.exitDate}</td>
                          <td className="p-4 text-slate-300 font-mono">{trade.entryPrice}</td>
                          <td className="p-4 text-slate-300 font-mono">{trade.exitPrice}</td>
                          <td className="p-4 text-slate-400">{trade.daysHeld}</td>
                          <td className={`p-4 font-bold text-right font-mono ${trade.type === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {trade.type === 'WIN' ? '+' : ''}{trade.pnl}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedStrat.trades.length === 0 && (
                  <div className="p-8 text-center text-slate-500 bg-slate-800">
                    No trade signals generated for this strategy within the timeframe.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
