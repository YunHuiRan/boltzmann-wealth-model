import { config } from "../config";

export class Person {
  id: number;
  balance: number;
  isBroken: boolean;
  totalIncome: number;
  totalExpenses: number;
  paidRounds: number;
  paidTo: number | null;

  constructor(id: number, balance = config.initialBalance) {
    this.id = id;
    this.balance = balance;
    this.isBroken = balance <= config.brokenThreshold;
    this.totalIncome = 0;
    this.totalExpenses = 0;
    this.paidRounds = 0;
    this.paidTo = null;
  }

  refreshBrokenState() {
    this.isBroken = this.balance <= config.brokenThreshold;
  }

  startRound() {
    this.refreshBrokenState();
    this.paidTo = null;
  }

  selectTarget(count: number): number | null {
    if (this.isBroken || count <= 1) return null;

    let target = Math.floor(Math.random() * (count - 1));
    if (target >= this.id) target++;
    this.paidTo = target;
    return target;
  }

  pay() {
    const price = config.price;
    this.balance -= price;
    this.totalExpenses += price;
    this.paidRounds++;
  }

  receive() {
    const price = config.price;
    this.balance += price;
    this.totalIncome += price;
  }
}
