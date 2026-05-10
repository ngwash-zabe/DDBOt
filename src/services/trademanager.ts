// src/services/tradeManager.ts
import { DerivAPI } from './derivApi';

export interface ActiveTrade {
  contractId: string;
  symbol: string;
  direction: 'CALL' | 'PUT';
  stake: number;
  tp: number;   // take profit in absolute profit amount
  sl: number;   // stop loss in absolute loss amount
  startTime: number;
  isRunning: boolean;
}

export class TradeManager {
  private api: DerivAPI;
  private activeTrades: Map<string, ActiveTrade> = new Map();
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(api: DerivAPI) {
    this.api = api;
  }

  async placeTrade(symbol: string, direction: 'CALL' | 'PUT', stake: number, tpAmount: number, slAmount: number): Promise<string> {
    // 1. Get proposal
    const proposal = await this.api.getProposal(symbol, direction, stake);
    if (!proposal || proposal.error) {
      throw new Error(`Proposal failed: ${proposal?.error?.message}`);
    }
    
    // 2. Buy contract
    const { contractId, buyPrice } = await this.api.buyContract(proposal.id, stake);
    
    // 3. Track trade
    const trade: ActiveTrade = {
      contractId,
      symbol,
      direction,
      stake,
      tp: tpAmount,
      sl: slAmount,
      startTime: Date.now(),
      isRunning: true,
    };
    this.activeTrades.set(contractId, trade);
    
    // Start monitor if not already running
    if (!this.monitorInterval) {
      this.monitorInterval = setInterval(() => this.monitorTrades(), 1000);
    }
    
    return contractId;
  }

  private async monitorTrades() {
    for (const [contractId, trade] of this.activeTrades.entries()) {
      if (!trade.isRunning) continue;
      
      try {
        const profit = await this.api.getProfit(contractId);
        
        // Check TP/SL
        if (profit >= trade.tp) {
          await this.api.sellContract(contractId);
          trade.isRunning = false;
          console.log(`TP hit for ${contractId}: profit ${profit}`);
          this.emitEvent('trade_closed', { contractId, profit, reason: 'TP' });
        } else if (profit <= -trade.sl) {
          await this.api.sellContract(contractId);
          trade.isRunning = false;
          console.log(`SL hit for ${contractId}: loss ${profit}`);
          this.emitEvent('trade_closed', { contractId, profit, reason: 'SL' });
        }
        
        // Also check if contract expired (profit would be fixed)
        // Deriv contracts have expiry; if profit is non-zero and trade is > expiry, we can close.
        // For simplicity, we rely on TP/SL.
      } catch (err) {
        console.error(`Monitor error for ${contractId}:`, err);
        // If error, assume trade is done, remove from active.
        trade.isRunning = false;
      }
    }
    
    // Cleanup finished trades
    for (const [id, trade] of this.activeTrades.entries()) {
      if (!trade.isRunning) {
        this.activeTrades.delete(id);
      }
    }
    
    // Stop monitor if no active trades
    if (this.activeTrades.size === 0 && this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  private emitEvent(event: string, data: any) {
    // Dispatch custom event for UI updates
    window.dispatchEvent(new CustomEvent(event, { detail: data }));
  }

  async stopAllTrades() {
    for (const [id, trade] of this.activeTrades.entries()) {
      if (trade.isRunning) {
        await this.api.sellContract(id);
        trade.isRunning = false;
      }
    }
    this.activeTrades.clear();
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  getActiveCount(): number {
    return Array.from(this.activeTrades.values()).filter(t => t.isRunning).length;
  }
}
