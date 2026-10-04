import { v4 as uuidv4 } from "uuid";
import { config } from "../config";

export class Person {
  id: string;
  balance: number;
  isBroken: boolean;
  balanceHistory: number[];
  totalIncome: number;
  totalExpenses: number;
  paidTo: (string | null)[];
  receivedFrom: string[][];

  constructor(balance = config.initialBalance) {
    this.id = uuidv4();
    this.balance = balance;
    this.isBroken = false;
    this.balanceHistory = [balance];
    this.totalIncome = 0;
    this.totalExpenses = 0;
    this.paidTo = [];
    this.receivedFrom = [];
  }

  refreshBrokenState() {
    this.isBroken = this.balance <= config.brokenThreshold;
  }

  startRound(): number {
    this.refreshBrokenState();
    this.paidTo.push(null);
    return this.paidTo.length - 1;
  }

  selectTarget(candidateIds: string[], roundIndex: number): string | null {
    if (this.isBroken) return null;

    const candidates = candidateIds.filter((id) => id !== this.id);
    if (candidates.length === 0) return null;

    const targetId = candidates[Math.floor(Math.random() * candidates.length)];
    this.paidTo[roundIndex] = targetId;
    return targetId;
  }

  receive() {
    this.balance += config.price;
    this.totalIncome += config.price;
    this.balanceHistory.push(this.balance);
    this.refreshBrokenState();
  }

  pay() {
    this.balance -= config.price;
    this.totalExpenses += config.price;
    this.balanceHistory.push(this.balance);
    this.refreshBrokenState();
  }

  initReceivedFrom(roundCount: number) {
    this.receivedFrom = Array.from({ length: roundCount }, () => []);
  }

  recordIncoming(fromId: string, roundIndex: number) {
    this.receivedFrom[roundIndex].push(fromId);
  }
}
