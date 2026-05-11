// src/services/derivApi.ts
export class DerivAPI {
  private ws: WebSocket | null = null;
  private appId: number;
  private token: string;

  constructor(appId: number, token: string) {
    this.appId = appId;
    this.token = token;
  }

  async connect(): Promise<void> {
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`;
    this.ws = new WebSocket(url);
    await new Promise((resolve) => { this.ws!.onopen = resolve; });
    // Authorize
    this.send({ authorize: this.token });
    await this.waitFor('authorize');
  }

  send(data: any) {
    this.ws!.send(JSON.stringify(data));
  }

  async request(req: any): Promise<any> {
    return new Promise((resolve) => {
      const id = Date.now();
      this.send({ ...req, req_id: id });
      const handler = (e: MessageEvent) => {
        const msg = JSON.parse(e.data);
        if (msg.req_id === id) {
          this.ws!.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      this.ws!.addEventListener('message', handler);
    });
  }

  private async waitFor(msgType: string): Promise<any> {
    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        const msg = JSON.parse(e.data);
        if (msg.msg_type === msgType) {
          this.ws!.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      this.ws!.addEventListener('message', handler);
    });
  }

  async getActiveSymbols(): Promise<any[]> {
    const resp = await this.request({ active_symbols: 'brief' });
    return resp.active_symbols;
  }

  async getTicks(symbol: string, count: number = 200): Promise<number[]> {
    const resp = await this.request({ ticks_history: symbol, adjust_start_time: 1, count, end: 'latest', start: 1, style: 'ticks' });
    return resp.history?.prices || [];
  }

  async getProposal(symbol: string, contractType: 'CALL' | 'PUT', amount: number): Promise<any> {
    const resp = await this.request({
      proposal: 1,
      amount,
      basis: 'stake',
      contract_type: contractType === 'CALL' ? 'CALL' : 'PUT',
      currency: 'USD',
      duration: 1,
      duration_unit: 't',
      symbol,
    });
    return resp.proposal;
  }

  async buyContract(proposalId: string, amount: number): Promise<{ contractId: string; buyPrice: number }> {
    const resp = await this.request({ buy: proposalId, price: amount });
    return { contractId: resp.buy.contract_id, buyPrice: resp.buy.buy_price };
  }

  async sellContract(contractId: string): Promise<void> {
    await this.request({ sell: contractId });
  }

  async getProfit(contractId: string): Promise<number> {
    const resp = await this.request({ profit_table: contractId });
    return resp.profit_table?.transactions?.[0]?.profit_loss || 0;
  }
              }
