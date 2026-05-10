// src/services/marketScanner.ts
import { DerivAPI } from './derivApi';

export interface MarketScore {
  symbol: string;
  displayName: string;
  score: number;          // 0-100, higher is better
  atr: number;
  spread: number;
  avgSpread: number;
  manipulationRisk: 'low' | 'medium' | 'high';
  trend: 'bull' | 'bear' | 'sideways';
  volumeVelocity: number;
  reason: string[];
}

export class MarketScanner {
  private api: DerivAPI;
  private cache: Map<string, { score: MarketScore; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 15000; // 15 seconds

  constructor(api: DerivAPI) {
    this.api = api;
  }

  // Calculate ATR (Average True Range) from tick prices
  private calculateATR(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 0;
    const trueRanges: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const high = Math.max(prices[i], prices[i-1]);
      const low = Math.min(prices[i], prices[i-1]);
      trueRanges.push(high - low);
    }
    const atr = trueRanges.slice(-period).reduce((a,b) => a+b, 0) / period;
    return atr;
  }

  // Detect sudden large move (possible manipulation)
  private detectManipulation(prices: number[], atr: number): { risk: 'low' | 'medium' | 'high'; reason: string } {
    if (prices.length < 10) return { risk: 'low', reason: 'Insufficient data' };
    const recent = prices.slice(-10);
    let maxJump = 0;
    for (let i = 1; i < recent.length; i++) {
      const jump = Math.abs(recent[i] - recent[i-1]);
      if (jump > maxJump) maxJump = jump;
    }
    if (maxJump > atr * 3) return { risk: 'high', reason: `Gap ${maxJump.toFixed(2)} > 3×ATR` };
    if (maxJump > atr * 2) return { risk: 'medium', reason: `Gap ${maxJump.toFixed(2)} > 2×ATR` };
    return { risk: 'low', reason: 'Normal movement' };
  }

  // Calculate volume velocity (tick rate consistency)
  private calculateVolumeVelocity(prices: number[], timeMs: number = 5000): number {
    // Simulated: derivative of tick rate. For real, you'd need timestamps.
    // Here we use price change frequency as proxy.
    if (prices.length < 20) return 0.5;
    const changes = prices.slice(-20).map((p,i,arr) => i===0?0:Math.abs(p-arr[i-1]));
    const avgChange = changes.reduce((a,b)=>a+b,0)/changes.length;
    const stdDev = Math.sqrt(changes.map(x=>Math.pow(x-avgChange,2)).reduce((a,b)=>a+b,0)/changes.length);
    // Low stdDev means steady flow (good). High stdDev means erratic.
    return Math.min(1, stdDev / (avgChange + 0.001));
  }

  // Trend detection using EMA
  private detectTrend(prices: number[]): 'bull' | 'bear' | 'sideways' {
    if (prices.length < 20) return 'sideways';
    const emaShort = this.calculateEMA(prices.slice(-20), 5);
    const emaLong = this.calculateEMA(prices.slice(-20), 20);
    const lastShort = emaShort[emaShort.length-1];
    const lastLong = emaLong[emaLong.length-1];
    if (lastShort > lastLong * 1.001) return 'bull';
    if (lastShort < lastLong * 0.999) return 'bear';
    return 'sideways';
  }

  private calculateEMA(prices: number[], period: number): number[] {
    const k = 2 / (period + 1);
    let ema = prices[0];
    const result = [ema];
    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
      result.push(ema);
    }
    return result;
  }

  async scanSymbol(symbol: string, displayName: string): Promise<MarketScore> {
    try {
      // Fetch ticks
      const ticks = await this.api.getTicks(symbol, 200);
      if (!ticks.length) throw new Error('No ticks');
      
      // Get spread from proposal
      const proposal = await this.api.getProposal(symbol, 'CALL', 1);
      const spread = proposal.ask - proposal.bid;
      const avgSpread = spread; // In real, you'd store historical average. Use current as baseline.
      
      const atr = this.calculateATR(ticks);
      const mani = this.detectManipulation(ticks, atr);
      const volumeVel = this.calculateVolumeVelocity(ticks);
      const trend = this.detectTrend(ticks);
      
      let score = 0;
      const reasons: string[] = [];
      
      // Spread check (lower is better)
      if (spread < avgSpread * 1.1) { score += 20; reasons.push('Tight spread'); }
      else if (spread < avgSpread * 1.5) { score += 10; reasons.push('Acceptable spread'); }
      else { reasons.push(`High spread ${spread.toFixed(2)}`); }
      
      // Manipulation risk
      if (mani.risk === 'low') { score += 30; reasons.push('No manipulation detected'); }
      else if (mani.risk === 'medium') { score += 10; reasons.push(mani.reason); }
      else { reasons.push(`⚠️ Manipulation: ${mani.reason}`); }
      
      // Volume velocity (steady is good)
      if (volumeVel > 0.7) { score += 25; reasons.push('Stable tick flow'); }
      else if (volumeVel > 0.4) { score += 10; reasons.push('Moderate flow'); }
      else { reasons.push('Erratic ticks'); }
      
      // Volatility (ATR) - optimum range 0.5 to 2.0
      if (atr >= 0.5 && atr <= 2.0) { score += 25; reasons.push(`Optimal volatility (ATR=${atr.toFixed(2)})`); }
      else if (atr < 0.5) { reasons.push('Too low volatility'); }
      else { reasons.push('Extreme volatility'); }
      
      // Trend strength (for directional trading)
      if (trend !== 'sideways') { score += 10; reasons.push(`Trend: ${trend}`); }
      
      // Cap at 100
      score = Math.min(100, score);
      
      return {
        symbol,
        displayName,
        score,
        atr,
        spread,
        avgSpread,
        manipulationRisk: mani.risk,
        trend,
        volumeVelocity: volumeVel,
        reason: reasons,
      };
    } catch (err) {
      console.error(`Scan failed for ${symbol}:`, err);
      return {
        symbol,
        displayName,
        score: 0,
        atr: 0,
        spread: 0,
        avgSpread: 0,
        manipulationRisk: 'high',
        trend: 'sideways',
        volumeVelocity: 0,
        reason: ['Scan error'],
      };
    }
  }

  async scanAllMarkets(): Promise<MarketScore[]> {
    // Check cache
    const now = Date.now();
    const cached = Array.from(this.cache.values()).filter(v => now - v.timestamp < this.CACHE_TTL);
    if (cached.length > 0) {
      return cached.map(v => v.score);
    }
    
    // Fetch active symbols (filter only those suitable for binary options)
    const symbols = await this.api.getActiveSymbols();
    // Filter: exclude non-tradable like 'R_10' etc. Keep vol indices, boom/crash, jump
    const tradable = symbols.filter(s => 
      s.symbol.match(/R_|BOOM|CRASH|JD/) && s.trade_status === 'open'
    );
    
    // Limit to top 30 to avoid rate limits
    const limited = tradable.slice(0, 30);
    
    // Scan in parallel with concurrency control
    const batchSize = 5;
    const results: MarketScore[] = [];
    for (let i = 0; i < limited.length; i += batchSize) {
      const batch = limited.slice(i, i+batchSize);
      const batchResults = await Promise.all(batch.map(s => this.scanSymbol(s.symbol, s.display_name)));
      results.push(...batchResults);
      // Small delay to avoid hitting rate limit
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Cache results
    results.forEach(r => this.cache.set(r.symbol, { score: r, timestamp: now }));
    
    // Sort by score descending
    return results.sort((a,b) => b.score - a.score);
  }
}
