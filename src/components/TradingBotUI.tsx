// src/components/TradingBotUI.tsx
import React, { useState, useEffect } from 'react';
import { DerivAPI } from '../services/derivApi';
import { MarketScanner, MarketScore } from '../services/marketScanner';
import { TradeManager } from '../services/tradeManager';

interface TradingBotUIProps {
  appId: number;
  authToken: string;
}

export const TradingBotUI: React.FC<TradingBotUIProps> = ({ appId, authToken }) => {
  const [stake, setStake] = useState<number>(2);
  const [tp, setTp] = useState<number>(20);
  const [sl, setSl] = useState<number>(10);
  const [bothMode, setBothMode] = useState<boolean>(false);
  const [direction, setDirection] = useState<'ups' | 'downs' | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [selectedMarket, setSelectedMarket] = useState<MarketScore | null>(null);
  const [secondMarket, setSecondMarket] = useState<MarketScore | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  
  let api: DerivAPI | null = null;
  let scanner: MarketScanner | null = null;
  let tradeManager: TradeManager | null = null;
  
  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };
  
  const startBot = async () => {
    if (!direction && !bothMode) {
      addLog('❌ Please select Only Ups, Only Downs, or Both mode');
      return;
    }
    setIsRunning(true);
    addLog('🚀 Initializing bot...');
    
    try {
      api = new DerivAPI(appId, authToken);
      await api.connect();
      addLog('✅ API connected');
      
      scanner = new MarketScanner(api);
      tradeManager = new TradeManager(api);
      
      addLog('🔍 Deep scanning all markets for best entry...');
      setScanning(true);
      const scores = await scanner.scanAllMarkets();
      setScanning(false);
      
      if (scores.length === 0) {
        addLog('❌ No tradable markets found');
        setIsRunning(false);
        return;
      }
      
      const best = scores[0];
      setSelectedMarket(best);
      addLog(`🏆 Best market: ${best.displayName} (score ${best.score}) | Reason: ${best.reason.join(', ')}`);
      
      if (bothMode) {
        const second = scores[1];
        if (second && second.score > 20) {
          setSecondMarket(second);
          addLog(`🥈 Second market for opposite direction: ${second.displayName} (score ${second.score})`);
          // Trade Ups on best, Downs on second
          const id1 = await tradeManager.placeTrade(best.symbol, 'CALL', stake, tp, sl);
          const id2 = await tradeManager.placeTrade(second.symbol, 'PUT', stake, tp, sl);
          addLog(`📈 Placed CALL on ${best.symbol} (ID: ${id1})`);
          addLog(`📉 Placed PUT on ${second.symbol} (ID: ${id2})`);
        } else {
          addLog('⚠️ Not enough good markets for Both mode, falling back to single direction');
          const id = await tradeManager.placeTrade(best.symbol, direction === 'ups' ? 'CALL' : 'PUT', stake, tp, sl);
          addLog(`📊 Placed ${direction?.toUpperCase()} trade on ${best.symbol} (ID: ${id})`);
        }
      } else {
        const dirType = direction === 'ups' ? 'CALL' : 'PUT';
        const id = await tradeManager.placeTrade(best.symbol, dirType, stake, tp, sl);
        addLog(`📊 Placed ${dirType} trade on ${best.symbol} (ID: ${id})`);
      }
      
      // Listen for trade closures
      const handler = (e: CustomEvent) => {
        addLog(`🏁 Trade closed: ${e.detail.reason} | P/L = ${e.detail.profit > 0 ? '+' : ''}${e.detail.profit.toFixed(2)} USD`);
      };
      window.addEventListener('trade_closed', handler as EventListener);
      
      // Keep bot running until manual stop
      // For simplicity, we'll let trades run. User can stop.
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      setIsRunning(false);
    }
  };
  
  const stopBot = async () => {
    if (tradeManager) {
      await tradeManager.stopAllTrades();
      addLog('🛑 All trades stopped');
    }
    setIsRunning(false);
  };
  
  useEffect(() => {
    return () => {
      if (tradeManager) tradeManager.stopAllTrades();
    };
  }, []);
  
  return (
    <div className="trading-bot-container" style={{ maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>🤖 DeepScan Trader – Only Ups / Only Downs / Both</h2>
      
      <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
        <label>💵 Stake (USD): </label>
        <input type="number" value={stake} onChange={e => setStake(Number(e.target.value))} step={0.5} min={1} style={{ marginRight: '20px' }} />
        
        <label>🎯 TP (USD): </label>
        <input type="number" value={tp} onChange={e => setTp(Number(e.target.value))} step={5} min={0} style={{ marginRight: '20px' }} />
        
        <label>🛑 SL (USD): </label>
        <input type="number" value={sl} onChange={e => setSl(Number(e.target.value))} step={5} min={0} />
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={() => { setDirection('ups'); setBothMode(false); }}
          style={{ background: direction === 'ups' && !bothMode ? '#4caf50' : '#ddd', marginRight: '10px', padding: '10px 20px' }}
        >
          📈 Only Ups
        </button>
        <button 
          onClick={() => { setDirection('downs'); setBothMode(false); }}
          style={{ background: direction === 'downs' && !bothMode ? '#f44336' : '#ddd', marginRight: '10px', padding: '10px 20px' }}
        >
          📉 Only Downs
        </button>
        <button 
          onClick={() => { setBothMode(true); setDirection(null); }}
          style={{ background: bothMode ? '#2196f3' : '#ddd', padding: '10px 20px' }}
        >
          🔄 Both (Two markets)
        </button>
      </div>
      
      {scanning && <p>🔎 Scanning all markets... This may take 10-15 seconds.</p>}
      
      {selectedMarket && !scanning && (
        <div style={{ background: '#e3f2fd', padding: '10px', borderRadius: '5px', marginBottom: '20px' }}>
          <strong>Top Market:</strong> {selectedMarket.displayName} (Score: {selectedMarket.score})<br />
          <small>Trend: {selectedMarket.trend} | Manipulation risk: {selectedMarket.manipulationRisk} | ATR: {selectedMarket.atr.toFixed(4)}</small>
        </div>
      )}
      
      {secondMarket && bothMode && (
        <div style={{ background: '#fff3e0', padding: '10px', borderRadius: '5px', marginBottom: '20px' }}>
          <strong>Second Market (for opposite):</strong> {secondMarket.displayName} (Score: {secondMarket.score})
        </div>
      )}
      
      <div style={{ marginTop: '20px' }}>
        {!isRunning ? (
          <button onClick={startBot} style={{ background: '#4caf50', color: 'white', padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
            🚀 Start Strategy
          </button>
        ) : (
          <button onClick={stopBot} style={{ background: '#f44336', color: 'white', padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}>
            ⏹️ Stop Bot
          </button>
        )}
      </div>
      
      <div style={{ marginTop: '30px' }}>
        <h3>📋 Live Logs</h3>
        <div style={{ background: '#111', color: '#0f0', padding: '10px', borderRadius: '5px', height: '200px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px' }}>
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>
    </div>
  );
};
