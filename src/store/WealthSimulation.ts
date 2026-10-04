import { config } from "../config";
import { Person } from "./Person";

export type RoundTransfer = {
  from: number;
  to: number;
};

export type StatSample = {
  round: number;
  mean: number;
  max: number;
  broken: number;
  scale: number;
};

export type Receivers = {
  offsets: Uint32Array;
  payers: Uint32Array;
  edgeCount: number;
};

const SAMPLE_FIELDS = 5;

export class WealthSimulation {
  price: number;
  threshold: number;
  historyLimit: number;
  stride: number;
  bins: number;

  persons: Person[];
  round: number;
  sampleCount: number;
  histogramScale: number;

  private history: Int32Array;
  private historyRound: Int32Array;
  private stats: Float64Array;
  private histograms: Uint32Array;
  private cursor: Uint32Array;

  constructor(
    count = config.personCount,
    initialBalance = config.initialBalance,
  ) {
    this.price = config.price;
    this.threshold = config.brokenThreshold;
    this.historyLimit = Math.max(0, Math.floor(config.historyLimit));
    this.stride = Math.max(1, Math.floor(config.statsStride));
    this.bins = Math.max(1, Math.floor(config.histogramBins));

    this.persons = [];
    this.round = 0;
    this.sampleCount = 0;
    this.histogramScale = 0;
    this.history = new Int32Array(0);
    this.historyRound = new Int32Array(0);
    this.stats = new Float64Array(0);
    this.histograms = new Uint32Array(0);
    this.cursor = new Uint32Array(0);

    this.reset(count, initialBalance);
  }

  get count(): number {
    return this.persons.length;
  }

  reset(
    count = config.personCount,
    initialBalance = config.initialBalance,
  ): void {
    this.price = config.price;
    this.threshold = config.brokenThreshold;
    this.historyLimit = Math.max(0, Math.floor(config.historyLimit));
    this.stride = Math.max(1, Math.floor(config.statsStride));
    this.bins = Math.max(1, Math.floor(config.histogramBins));

    const size = Math.max(0, Math.floor(count));
    const persons: Person[] = new Array<Person>(size);
    for (let i = 0; i < size; i++) persons[i] = new Person(i, initialBalance);
    this.persons = persons;

    this.round = 0;
    this.sampleCount = 0;
    this.histogramScale = 0;

    const historySize = size * this.historyLimit;
    this.history = new Int32Array(historySize).fill(-1);
    this.historyRound = new Int32Array(historySize).fill(-1);

    const capacity = Math.max(1, Math.ceil(config.rounds / this.stride) + 1);
    this.stats = new Float64Array(capacity * SAMPLE_FIELDS);
    this.histograms = new Uint32Array(capacity * this.bins);

    this.cursor = new Uint32Array(size);
  }

  runRound(): void {
    const persons = this.persons;
    const count = persons.length;
    const historyLimit = this.historyLimit;
    const slot = historyLimit > 0 ? this.round % historyLimit : 0;
    const history = this.history;
    const historyRound = this.historyRound;

    for (let i = 0; i < count; i++) {
      const person = persons[i];
      person.startRound();
      person.selectTarget(count);
      if (historyLimit > 0) {
        const base = i * historyLimit + slot;
        history[base] = person.paidTo === null ? -1 : person.paidTo;
        historyRound[base] = this.round;
      }
    }

    for (let i = 0; i < count; i++) {
      const person = persons[i];
      const target = person.paidTo;
      if (target === null) continue;
      person.pay();
      persons[target].receive();
    }

    this.round++;
    if (this.round % this.stride === 0) this.sample();
  }

  runRounds(count: number): void {
    for (let i = 0; i < count; i++) this.runRound();
  }

  private sample(): void {
    this.ensureSampleCapacity();

    const persons = this.persons;
    const count = persons.length;
    const bins = this.bins;

    let max = 0;
    let sum = 0;
    let broken = 0;
    for (let i = 0; i < count; i++) {
      const balance = persons[i].balance;
      sum += balance;
      if (balance > max) max = balance;
      if (balance <= this.threshold) broken++;
    }

    if (max > this.histogramScale) this.histogramScale = max;
    const scale = this.histogramScale;

    const index = this.sampleCount;
    const base = index * SAMPLE_FIELDS;
    this.stats[base] = this.round;
    this.stats[base + 1] = count > 0 ? sum / count : 0;
    this.stats[base + 2] = max;
    this.stats[base + 3] = broken;
    this.stats[base + 4] = scale;

    const histograms = this.histograms;
    const histBase = index * bins;
    histograms.fill(0, histBase, histBase + bins);
    const width = scale > 0 ? scale / bins : 1;
    for (let i = 0; i < count; i++) {
      let bin = Math.floor(persons[i].balance / width);
      if (bin >= bins) bin = bins - 1;
      else if (bin < 0) bin = 0;
      histograms[histBase + bin]++;
    }

    this.sampleCount++;
  }

  private ensureSampleCapacity(): void {
    const capacity = this.stats.length / SAMPLE_FIELDS;
    if (this.sampleCount < capacity) return;

    const next = Math.max(4, capacity * 2);
    const stats = new Float64Array(next * SAMPLE_FIELDS);
    stats.set(this.stats);
    this.stats = stats;

    const histograms = new Uint32Array(next * this.bins);
    histograms.set(this.histograms);
    this.histograms = histograms;
  }

  paidToOf(personIndex: number, round: number): number {
    if (personIndex < 0 || personIndex >= this.persons.length) return -1;

    if (round === this.round - 1 && this.round > 0) {
      const paidTo = this.persons[personIndex].paidTo;
      return paidTo === null ? -1 : paidTo;
    }

    const historyLimit = this.historyLimit;
    if (historyLimit === 0) return -1;
    if (round < 0 || round >= this.round || round < this.round - historyLimit)
      return -1;

    const base = personIndex * historyLimit + (round % historyLimit);
    return this.historyRound[base] === round ? this.history[base] : -1;
  }

  transfersOfRound(round = this.round - 1): RoundTransfer[] {
    const transfers: RoundTransfer[] = [];
    for (let i = 0; i < this.persons.length; i++) {
      const to = this.paidToOf(i, round);
      if (to >= 0) transfers.push({ from: i, to });
    }
    return transfers;
  }

  buildReceivers(round = this.round - 1): Receivers {
    const count = this.persons.length;
    const offsets = new Uint32Array(count + 1);

    let edgeCount = 0;
    for (let i = 0; i < count; i++) {
      const to = this.paidToOf(i, round);
      if (to >= 0) {
        offsets[to + 1]++;
        edgeCount++;
      }
    }

    for (let i = 0; i < count; i++) offsets[i + 1] += offsets[i];

    if (this.cursor.length < count) this.cursor = new Uint32Array(count);
    const cursor = this.cursor;
    for (let i = 0; i < count; i++) cursor[i] = offsets[i];

    const payers = new Uint32Array(edgeCount);
    for (let i = 0; i < count; i++) {
      const to = this.paidToOf(i, round);
      if (to >= 0) payers[cursor[to]++] = i;
    }

    return { offsets, payers, edgeCount };
  }

  currentHistogram(): Uint32Array {
    const persons = this.persons;
    const count = persons.length;
    const bins = this.bins;
    const histogram = new Uint32Array(bins);

    let max = 0;
    for (let i = 0; i < count; i++) {
      const balance = persons[i].balance;
      if (balance > max) max = balance;
    }
    if (max > this.histogramScale) this.histogramScale = max;

    const width = this.histogramScale > 0 ? this.histogramScale / bins : 1;
    for (let i = 0; i < count; i++) {
      let bin = Math.floor(persons[i].balance / width);
      if (bin >= bins) bin = bins - 1;
      else if (bin < 0) bin = 0;
      histogram[bin]++;
    }

    return histogram;
  }

  statSample(index: number): StatSample {
    const base = index * SAMPLE_FIELDS;
    return {
      round: this.stats[base],
      mean: this.stats[base + 1],
      max: this.stats[base + 2],
      broken: this.stats[base + 3],
      scale: this.stats[base + 4],
    };
  }

  statSamples(): StatSample[] {
    const samples: StatSample[] = new Array<StatSample>(this.sampleCount);
    for (let i = 0; i < this.sampleCount; i++) samples[i] = this.statSample(i);
    return samples;
  }

  sampleHistogram(index: number): Uint32Array {
    const base = index * this.bins;
    return this.histograms.slice(base, base + this.bins);
  }

  giniOfSample(index: number): number {
    const bins = this.bins;
    const histogram = this.histograms;
    const base = index * bins;
    const scale = this.stats[index * SAMPLE_FIELDS + 4];
    const width = scale > 0 ? scale / bins : 1;

    let population = 0;
    let income = 0;
    for (let bin = 0; bin < bins; bin++) {
      const weight = histogram[base + bin];
      population += weight;
      income += weight * (bin + 0.5) * width;
    }
    if (population === 0 || income === 0) return 0;

    let cumulativePopulation = 0;
    let cumulativeIncome = 0;
    let area = 0;
    let previousPopulationShare = 0;
    let previousIncomeShare = 0;
    for (let bin = 0; bin < bins; bin++) {
      const weight = histogram[base + bin];
      cumulativePopulation += weight;
      cumulativeIncome += weight * (bin + 0.5) * width;

      const populationShare = cumulativePopulation / population;
      const incomeShare = cumulativeIncome / income;
      area +=
        (populationShare - previousPopulationShare) *
        (incomeShare + previousIncomeShare);

      previousPopulationShare = populationShare;
      previousIncomeShare = incomeShare;
    }

    return 1 - area;
  }

  estimatedHistoryBytes(): number {
    return (
      this.history.byteLength +
      this.historyRound.byteLength +
      this.stats.byteLength +
      this.histograms.byteLength
    );
  }
}
